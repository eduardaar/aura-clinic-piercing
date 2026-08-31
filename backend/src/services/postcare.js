// Serviços de pós-atendimento: geração e listagem de acompanhamentos.
import { dateAfter, defaultCareMessage } from "./utils.js";
import { limitOffset, countRows } from "./pagination.js";
import { parseServiceRulesSnapshot } from "./serviceRules.js";

const POST_CARE_FROM = `
  post_care_followups f
  JOIN clients c ON c.id = f.client_id
  JOIN appointments a ON a.id = f.appointment_id
  JOIN professionals p ON p.id = a.professional_id
  LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
`;

const POST_CARE_COLUMNS = `
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
`;

const POST_CARE_QUERY = `SELECT ${POST_CARE_COLUMNS} FROM ${POST_CARE_FROM}`;

// `paging` é opcional: sem ele o comportamento é o de sempre (lista inteira).
export async function listPostCareFollowups(db, { where = "", params = [], paging = null } = {}) {
  const page = limitOffset(paging);
  const orderBy = paging?.orderBy || "ORDER BY f.due_date ASC, f.reminder_day ASC";
  return db.all(`${POST_CARE_QUERY} ${where} ${orderBy}${page.clause}`, [...params, ...page.params]);
}

export async function countPostCareFollowups(db, { where = "", params = [] } = {}) {
  return countRows(db, { from: POST_CARE_FROM, where, params });
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
  const rules = parseServiceRulesSnapshot(appointment.service_rules_snapshot);
  // Snapshot vazio identifica registros anteriores à regra configurável e
  // preserva o acompanhamento histórico. Novos agendamentos sempre gravam ao
  // menos uma regra por serviço selecionado.
  const reminders = rules.length
    ? [...new Set(rules.flatMap((rule) => [
      ...(rule.postcare_enabled ? (Array.isArray(rule.postcare_days) ? rule.postcare_days : []) : []),
      rule.return_after_days
    ]).map(Number).filter((day) => Number.isInteger(day) && day > 0))].sort((a, b) => a - b)
    : [7, 15, 30];
  for (const day of reminders) {
    const customInstructions = rules.find((rule) => rule.aftercare_instructions)?.aftercare_instructions;
    await db.run(
      `INSERT INTO post_care_followups
      (appointment_id, client_id, reminder_day, due_date, care_message)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (appointment_id, reminder_day) DO NOTHING`,
      [appointment.id, appointment.client_id, day, dateAfter(appointment.appointment_date, day), customInstructions || defaultCareMessage(day)]
    );
  }
}
