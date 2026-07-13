import { formatCurrency } from "./utils.js";

export function normalizeWhatsappNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 11) return `+55${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function whatsappLink(destination, message) {
  const digits = String(destination || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message || "")}`;
}

function appointmentDatePt(date) {
  if (!date) return "data não informada";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("pt-BR");
}

export function professionalBookingMessage({ professional = {}, client = {}, service = {}, appointment = {}, storeName = "Aura Clinic" }) {
  return [
    `Olá, ${professional.name || "profissional"}. Um novo agendamento foi solicitado para você.`,
    "",
    `Cliente: ${client.full_name || appointment.full_name || "Cliente"}`,
    `Serviço: ${service.name || appointment.procedure || "Atendimento"}`,
    `Data: ${appointmentDatePt(appointment.appointment_date)}`,
    `Horário: ${appointment.appointment_time || ""}`,
    `Sinal: ${formatCurrency(Number(appointment.deposit_value || 0))}`,
    `Valor total: ${formatCurrency(Number(appointment.total_value || 0))}`,
    "Status: aguardando confirmação",
    "",
    `Acesse o ${storeName} ERP para confirmar ou ajustar o agendamento.`
  ].join("\n");
}

export function clientBookingMessage({ client = {}, service = {}, professional = {}, appointment = {}, storeName = "Aura Clinic" }) {
  const firstName = String(client.full_name || appointment.full_name || "cliente").trim().split(/\s+/)[0];
  return [
    `Olá, ${firstName}, tudo bem?`,
    "",
    `Recebemos sua solicitação de agendamento na ${storeName}.`,
    "",
    `Serviço: ${service.name || appointment.procedure || "Atendimento"}`,
    `Profissional: ${professional.name || "Profissional"}`,
    `Data: ${appointmentDatePt(appointment.appointment_date)}`,
    `Horário: ${appointment.appointment_time || ""}`,
    `Sinal: ${formatCurrency(Number(appointment.deposit_value || 0))}`,
    `Valor total: ${formatCurrency(Number(appointment.total_value || 0))}`,
    "",
    "Seu horário está aguardando confirmação."
  ].join("\n");
}

export async function getStoreName(db, fallback = "Aura Clinic") {
  const theme = await db.get("SELECT brand_name FROM catalog_theme WHERE id = 1").catch(() => null);
  return theme?.brand_name || fallback;
}

export async function queueProfessionalBookingNotification(db, { appointmentId, professionalId, client, service, appointment, storeName }) {
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [professionalId]);
  if (!professional) return null;
  const destination = normalizeWhatsappNumber(professional.whatsapp || professional.phone);
  const optedIn = Number(professional.notification_opt_in ?? 1) === 1;
  const message = professionalBookingMessage({ professional, client, service, appointment, storeName });
  const status = destination && optedIn ? "pending" : "failed";
  const lastError = destination ? optedIn ? "" : "Profissional não autorizou notificações automáticas." : "Profissional sem WhatsApp válido.";
  const uniqueKey = `appointment:${appointmentId}:professional:new_request`;
  await db.run(
    `INSERT INTO notification_queue
      (professional_id, appointment_id, channel, destination, template, payload, message, status, attempts, last_error, scheduled_at, unique_key)
     VALUES (?, ?, 'whatsapp', ?, 'professional_new_public_booking', ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      professionalId,
      appointmentId,
      destination,
      JSON.stringify({ appointment_id: appointmentId, professional_id: professionalId, service_id: service?.id || null, whatsapp_link: whatsappLink(destination, message) }),
      message,
      status,
      lastError,
      appointment?.created_at || new Date().toISOString(),
      uniqueKey
    ]
  );
  return db.get("SELECT * FROM notification_queue WHERE unique_key = ?", [uniqueKey]);
}

export async function queueAppointmentReminderNotifications(db, appointment) {
  if (!appointment?.id || !appointment.professional_id || !appointment.appointment_date || !appointment.appointment_time) return [];
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [appointment.professional_id]);
  const destination = normalizeWhatsappNumber(professional?.whatsapp || professional?.phone);
  if (!destination || Number(professional?.notification_opt_in ?? 1) !== 1) return [];
  const appointmentStart = new Date(`${appointment.appointment_date}T${appointment.appointment_time}:00`);
  if (Number.isNaN(appointmentStart.getTime())) return [];
  const reminders = [
    { type: "reminder_24h", offsetMs: 24 * 60 * 60 * 1000, label: "24 horas" },
    { type: "reminder_2h", offsetMs: 2 * 60 * 60 * 1000, label: "2 horas" }
  ];
  const queued = [];
  for (const reminder of reminders) {
    const scheduledAt = new Date(appointmentStart.getTime() - reminder.offsetMs);
    const uniqueKey = `appointment:${appointment.id}:professional:${reminder.type}`;
    const message = `Olá, ${professional.name}. Lembrete: você tem um agendamento em ${reminder.label}.\n\nCliente: ${appointment.full_name || "Cliente"}\nServiço: ${appointment.procedure || appointment.service_name || "Atendimento"}\nData: ${appointmentDatePt(appointment.appointment_date)}\nHorário: ${appointment.appointment_time}`;
    await db.run(
      `INSERT INTO notification_queue
        (professional_id, appointment_id, channel, destination, template, payload, message, status, attempts, scheduled_at, unique_key)
       VALUES (?, ?, 'whatsapp', ?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT DO NOTHING`,
      [appointment.professional_id, appointment.id, destination, reminder.type, JSON.stringify({ appointment_id: appointment.id, whatsapp_link: whatsappLink(destination, message) }), message, scheduledAt.toISOString(), uniqueKey]
    );
    queued.push(uniqueKey);
  }
  return queued;
}
