import { normalizeWhatsappNumber, whatsappLink } from "./notifications.js";

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
  const normalizedDestination = normalizeWhatsappNumber(destination);
  const message = renderTemplate(template.body, variables);
  const status = normalizedDestination ? "pending" : "failed";
  await db.run(
    `INSERT INTO notification_queue
      (client_id, professional_id, appointment_id, automation_rule_id, channel, destination, template, payload, message, status, attempts, last_error, scheduled_at, unique_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      clientId, professionalId, appointmentId, automationRuleId, template.channel, normalizedDestination,
      templateKey, JSON.stringify({ variables, whatsapp_link: whatsappLink(normalizedDestination, message) }),
      message, status, normalizedDestination ? "" : "Destino inválido.", scheduledAt, uniqueKey
    ]
  );
  return uniqueKey ? db.get("SELECT * FROM notification_queue WHERE unique_key=?", [uniqueKey]) : null;
}

export async function processDueCommunications(db, limit = 100) {
  const due = await db.all(
    "SELECT * FROM notification_queue WHERE status='pending' AND scheduled_at <= ? ORDER BY scheduled_at, id LIMIT ?",
    [new Date().toISOString(), Math.min(Math.max(Number(limit || 100), 1), 500)]
  );
  for (const item of due) {
    // Sem provedor oficial configurado, a mensagem fica pronta para abertura via wa.me.
    await db.run("UPDATE notification_queue SET status='ready', attempts=attempts+1 WHERE id=? AND status='pending'", [item.id]);
    if (item.automation_rule_id) {
      await db.run(
        "INSERT INTO automation_runs (rule_id, entity_type, entity_id, status, details) VALUES (?, 'notification', ?, 'ready', ?)",
        [item.automation_rule_id, item.id, JSON.stringify({ channel: item.channel, automatic_send: false })]
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
