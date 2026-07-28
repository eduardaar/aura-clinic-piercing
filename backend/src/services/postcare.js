// Serviços de pós-atendimento: geração e listagem de acompanhamentos.
import { dateAfter, defaultCareMessage } from "./utils.js";

const POST_CARE_QUERY = `
  SELECT
    f.*,
    c.full_name,
    c.whatsapp,
    c.instagram,
    a.procedure,
    a.piercing_region,
    a.appointment_date,
    a.appointment_time,
    p.name AS professional_name,
    j.name AS jewelry_name
  FROM post_care_followups f
  JOIN clients c ON c.id = f.client_id
  JOIN appointments a ON a.id = f.appointment_id
  JOIN professionals p ON p.id = a.professional_id
  LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
`;

export async function listPostCareFollowups(db) {
  return db.all(`${POST_CARE_QUERY} ORDER BY f.due_date ASC, f.reminder_day ASC`);
}

// Busca direta por id, para responder ao PATCH sem varrer a lista inteira.
export async function getPostCareFollowup(db, id) {
  return db.get(`${POST_CARE_QUERY} WHERE f.id = ?`, [id]);
}

// Varredura de backfill: gera os acompanhamentos de TODOS os atendimentos já
// concluídos. Custa 4 queries por atendimento, então fica fora do caminho de
// leitura — o fluxo normal já cria os followups ao marcar o status "atendido"
// (routes/appointments.js). Mantida para reprocessar bases importadas/semeadas.
export async function ensureFollowupsForCompletedAppointments(db) {
  const appointments = await db.all("SELECT id FROM appointments WHERE status = 'atendido'");
  for (const appointment of appointments) {
    await ensurePostCareFollowups(db, appointment.id);
  }
}

export async function ensurePostCareFollowups(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || appointment.status !== "atendido") return;
  const reminders = [7, 15, 30];
  for (const day of reminders) {
    await db.run(
      `INSERT INTO post_care_followups
      (appointment_id, client_id, reminder_day, due_date, care_message)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (appointment_id, reminder_day) DO NOTHING`,
      [appointment.id, appointment.client_id, day, dateAfter(appointment.appointment_date, day), defaultCareMessage(day)]
    );
  }
}
