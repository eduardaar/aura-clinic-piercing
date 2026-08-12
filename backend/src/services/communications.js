import { normalizeWhatsappNumber, whatsappLink } from "./notifications.js";
import { sendWhatsAppCloudText, whatsappCloudStatus } from "./whatsappCloud.js";
import { emailProviderStatus, sendTransactionalEmail } from "./emailProvider.js";
import {
  consumeCommunicationCredit,
  releaseCommunicationCredit,
  reserveCommunicationCredits
} from "./communicationCredits.js";

export const TEMPLATE_VARIABLES = [
  "cliente", "profissional", "estudio", "servico", "joias", "data", "horario", "total",
  "desconto", "sinal", "restante", "endereco", "protocolo", "link", "promocao", "cupom"
];

export function renderTemplate(body, variables = {}) {
  return String(body || "").replace(/\{\{([a-z_]+)\}\}/gi, (match, key) => {
    if (!TEMPLATE_VARIABLES.includes(key)) return match;
    return String(variables[key] ?? "");
  });
}

export async function queueTemplateNotification(db, {
  templateKey, clientId = null, professionalId = null, appointmentId = null,
  destination, variables = {}, scheduledAt = new Date().toISOString(), uniqueKey, automationRuleId = null
}) {
  const template = await db.get("SELECT * FROM communication_templates WHERE template_key=? AND is_active=1", [templateKey]);
  if (!template) return null;
  // As automações existentes passam o WhatsApp do cliente como destino. Ao
  // trocar um modelo para e-mail, buscamos o e-mail cadastrado do mesmo
  // cliente, sem exigir que cada disparador saiba qual canal está ativo.
  const emailRecipient = template.channel === "email" && clientId
    ? await db.get("SELECT email FROM clients WHERE id=?", [clientId])
    : null;
  const normalizedDestination = template.channel === "email"
    ? String(emailRecipient?.email || destination || "").trim().toLowerCase()
    : normalizeWhatsappNumber(destination);
  const message = renderTemplate(template.body, variables);
  const subject = renderTemplate(template.subject || template.name, variables);
  const status = normalizedDestination ? "pending" : "failed";
  await db.run(
    `INSERT INTO notification_queue
      (client_id, professional_id, appointment_id, automation_rule_id, channel, destination, template, payload, message, status, attempts, last_error, scheduled_at, unique_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      clientId, professionalId, appointmentId, automationRuleId, template.channel, normalizedDestination,
      templateKey, JSON.stringify({
        variables,
        subject,
        ...(template.channel === "whatsapp" ? { whatsapp_link: whatsappLink(normalizedDestination, message) } : {})
      }),
      message, status, normalizedDestination ? "" : "Destino inválido.", scheduledAt, uniqueKey
    ]
  );
  return uniqueKey ? db.get("SELECT * FROM notification_queue WHERE unique_key=?", [uniqueKey]) : null;
}

export async function processDueCommunications(db, limit = 100, tenantId = null) {
  const due = await db.all(
    "SELECT * FROM notification_queue WHERE status='pending' AND scheduled_at <= ? ORDER BY scheduled_at, id LIMIT ?",
    [new Date().toISOString(), Math.min(Math.max(Number(limit || 100), 1), 500)]
  );
  for (const item of due) {
    let status = "ready";
    let details = { channel: item.channel, automatic_send: false };
    let lastError = "";
    let reservation = null;
    let provider = null;
    try {
      // `null` significa que a clínica ainda não ativou a Cloud API: mantém a
      // mensagem pronta para abertura manual pelo wa.me, como era antes.
      // A mensagem manual continua gratuita para a plataforma. Quando existe
      // envio oficial, a reserva é feita ANTES da chamada externa: assim não
      // há mensagem paga sem saldo, nem saldo perdido em falha da Meta.
      const officialWhatsApp = item.channel === "whatsapp" ? await whatsappCloudStatus(db) : null;
      const officialEmail = item.channel === "email" ? emailProviderStatus() : null;
      provider = tenantId && officialWhatsApp?.enabled ? "whatsapp_cloud"
        : tenantId && officialEmail?.enabled ? "resend"
          : null;
      if (provider) {
        reservation = await reserveCommunicationCredits(db, tenantId, {
          channel: item.channel,
          credits: 1,
          referenceKey: `notification:${item.id}:${item.channel}`,
          metadata: { notification_id: item.id, provider }
        });
      }
      const sent = item.channel === "whatsapp" && provider
        ? await sendWhatsAppCloudText(db, { destination: item.destination, message: item.message })
        : item.channel === "email" && provider && tenantId
          ? await sendTransactionalEmail({
            to: item.destination,
            subject: (() => {
              try { return JSON.parse(item.payload || "{}").subject || item.template; } catch { return item.template; }
            })(),
            text: item.message
          })
          : null;
      if (sent) {
        if (reservation) await consumeCommunicationCredit(db, { reservationId: reservation.id, metadata: { message_id: sent.messageId } });
        status = "sent";
        details = { channel: item.channel, automatic_send: true, provider, message_id: sent.messageId };
      } else if (reservation) {
        // A configuração pode ser removida entre a checagem e o envio. Nesse
        // caso a mensagem segue disponível para ação manual e a reserva volta
        // imediatamente para a carteira.
        await releaseCommunicationCredit(db, { reservationId: reservation.id, metadata: { reason: "provider_unavailable" } });
        reservation = null;
      }
    } catch (error) {
      // Se a reserva foi criada mas a chamada ao provedor falhou, o próximo
      // processamento não pode encontrar um saldo artificialmente menor.
      if (reservation) await releaseCommunicationCredit(db, { reservationId: reservation.id, metadata: { reason: "provider_failure" } });
      status = "failed";
      lastError = error?.message || "Falha ao enviar pela API oficial de comunicação.";
      details = { channel: item.channel, automatic_send: true, provider, error: lastError };
    }
    await db.run(
      "UPDATE notification_queue SET status=?, attempts=attempts+1, last_error=?, sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END WHERE id=? AND status='pending'",
      [status, lastError, status, item.id]
    );
    if (item.automation_rule_id) {
      await db.run(
        "INSERT INTO automation_runs (rule_id, entity_type, entity_id, status, details) VALUES (?, 'notification', ?, ?, ?)",
        [item.automation_rule_id, item.id, status, JSON.stringify(details)]
      );
    }
  }
  return due.length;
}

export async function scheduleAppointmentClientAutomations(db, appointmentId) {
  const appointment = await db.get(`
    SELECT a.*, c.full_name, c.whatsapp, p.name AS professional_name, ct.brand_name,
      (SELECT value FROM catalog_settings WHERE key='company_address') AS company_address
    FROM appointments a
    JOIN clients c ON c.id=a.client_id
    JOIN professionals p ON p.id=a.professional_id
    LEFT JOIN catalog_theme ct ON ct.id=1
    WHERE a.id=?
  `, [appointmentId]);
  if (!appointment) return [];
  const start = new Date(`${appointment.appointment_date}T${appointment.appointment_time}:00`);
  const rules = await db.all("SELECT * FROM automation_rules WHERE is_active=1 AND event_type IN ('booking_created','appointment_upcoming')");
  const queued = [];
  for (const rule of rules) {
    const scheduled = rule.event_type === "booking_created"
      ? new Date()
      : new Date(start.getTime() + Number(rule.offset_minutes || 0) * 60_000);
    if (scheduled < new Date() && rule.event_type !== "booking_created") continue;
    const key = `appointment:${appointment.id}:client:${rule.rule_key}`;
    await queueTemplateNotification(db, {
      templateKey: rule.template_key, clientId: appointment.client_id, appointmentId: appointment.id,
      automationRuleId: rule.id, destination: appointment.whatsapp, scheduledAt: scheduled.toISOString(), uniqueKey: key,
      variables: {
        cliente: appointment.full_name, profissional: appointment.professional_name,
        estudio: appointment.brand_name || "Estúdio", servico: appointment.procedure,
        data: appointment.appointment_date, horario: appointment.appointment_time,
        total: appointment.total_value, sinal: appointment.deposit_value, restante: appointment.remaining_value,
        endereco: appointment.company_address || "", protocolo: appointment.public_booking_key || appointment.id
      }
    });
    queued.push(key);
  }
  return queued;
}
