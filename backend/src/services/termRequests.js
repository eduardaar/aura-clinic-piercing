// Solicitações de termo digital: link individual e seguro para o cliente
// preencher e assinar no estúdio (celular/tablet) ou à distância (WhatsApp).
//
// O token viaja só na URL e só é mostrado na criação; no banco fica o SHA-256,
// como o link de redefinição de senha. Quem precisa do link de novo gera outro
// (a solicitação anterior é cancelada).
import crypto from "node:crypto";
import { PUBLIC_APP_URL } from "../config/index.js";

export const TERM_TEMPLATE_KINDS = Object.freeze(["consent", "authorization", "procedure", "other"]);
export const TERM_TEMPLATE_KIND_LABELS = Object.freeze({
  consent: "Termo de consentimento",
  authorization: "Autorização",
  procedure: "Termo específico de procedimento",
  other: "Outro documento de aceite"
});
export const TERM_REQUEST_CHANNELS = Object.freeze(["in_studio", "remote"]);
// Horas de validade padrão. No estúdio o link é para a próxima meia hora; à
// distância a pessoa lê e assina quando puder, mas o link não fica aberto
// para sempre.
export const TERM_REQUEST_DEFAULT_HOURS = Object.freeze({ in_studio: 6, remote: 72 });
export const TERM_REQUEST_MAX_HOURS = 24 * 30;

export function generateTermToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashTermToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function isValidTermToken(token) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(String(token || ""));
}

export function termRequestUrl(slug, token) {
  const base = String(PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return `${base}/termo/${encodeURIComponent(token)}?t=${encodeURIComponent(slug)}`;
}

export function whatsappShareUrl(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function termRequestMessage({ clinicName, clientName, templateName, url }) {
  const firstName = String(clientName || "").trim().split(/\s+/)[0] || "Olá";
  return `${firstName}, aqui é do estúdio ${clinicName}. Para agilizar o seu atendimento, leia e assine o documento "${templateName}" pelo link abaixo. O link é individual e expira automaticamente.\n\n${url}`;
}

const REQUEST_SELECT = `
  SELECT
    r.id, r.template_id, r.client_id, r.appointment_id, r.channel, r.status, r.expires_at, r.completed_at,
    r.cancelled_at, r.digital_term_id, r.message, r.created_by, r.created_at, r.updated_at,
    c.full_name AS client_name, c.whatsapp AS client_whatsapp, c.email AS client_email,
    c.social_name AS client_social_name, c.birth_date AS client_birth_date, c.cpf AS client_cpf, c.instagram AS client_instagram,
    t.name AS template_name, t.kind AS template_kind,
    a.appointment_date, a.appointment_time, a.procedure AS appointment_procedure,
    u.name AS created_by_name,
    d.pdf_url AS term_pdf_url, d.signed_at AS term_signed_at
  FROM term_requests r
  JOIN clients c ON c.id = r.client_id
  LEFT JOIN term_templates t ON t.id = r.template_id
  LEFT JOIN appointments a ON a.id = r.appointment_id
  LEFT JOIN users u ON u.id = r.created_by
  LEFT JOIN digital_terms d ON d.id = r.digital_term_id
`;

// Pendente vencida vira "expired" na leitura: não há job para isso e a lista
// precisa refletir a verdade quando alguém abre a tela.
export async function expireStaleRequests(db) {
  await db.run("UPDATE term_requests SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE status='pending' AND expires_at < now()");
}

export async function listTermRequests(db, { clientId = null, appointmentId = null, status = null, limit = 200 } = {}) {
  await expireStaleRequests(db);
  const clauses = [];
  const params = [];
  if (clientId) { clauses.push("r.client_id = ?"); params.push(clientId); }
  if (appointmentId) { clauses.push("r.appointment_id = ?"); params.push(appointmentId); }
  if (status) { clauses.push("r.status = ?"); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.all(`${REQUEST_SELECT} ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, [...params, Math.min(Math.max(Number(limit) || 200, 1), 500)]);
}

export async function getTermRequest(db, id) {
  return db.get(`${REQUEST_SELECT} WHERE r.id = ?`, [id]);
}

export function resolveExpiry({ channel, expiresInHours }) {
  const fallback = TERM_REQUEST_DEFAULT_HOURS[channel] || TERM_REQUEST_DEFAULT_HOURS.remote;
  const hours = Number(expiresInHours);
  const safe = Number.isFinite(hours) && hours > 0 ? Math.min(hours, TERM_REQUEST_MAX_HOURS) : fallback;
  return new Date(Date.now() + safe * 60 * 60 * 1000);
}

export async function createTermRequest(db, { clientId, templateId, appointmentId = null, channel = "remote", expiresInHours = null, message = "", userId = null }) {
  const token = generateTermToken();
  const expiresAt = resolveExpiry({ channel, expiresInHours });
  const result = await db.run(
    `INSERT INTO term_requests (template_id, client_id, appointment_id, token_hash, channel, expires_at, message, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [templateId, clientId, appointmentId || null, hashTermToken(token), channel, expiresAt.toISOString(), String(message || "").trim() || null, userId]
  );
  return { request: await getTermRequest(db, result.returnedId), token };
}

export async function cancelTermRequest(db, id) {
  await db.run("UPDATE term_requests SET status='cancelled', cancelled_at=now(), updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'", [id]);
  return getTermRequest(db, id);
}

// Uma solicitação pendente por cliente+modelo(+agendamento) de cada vez: gerar
// um link novo cancela o anterior, para o cliente nunca ter dois links vivos.
export async function cancelOpenRequestsFor(db, { clientId, templateId, appointmentId = null }) {
  await db.run(
    `UPDATE term_requests SET status='cancelled', cancelled_at=now(), updated_at=CURRENT_TIMESTAMP
      WHERE status='pending' AND client_id=? AND template_id IS NOT DISTINCT FROM ? AND appointment_id IS NOT DISTINCT FROM ?`,
    [clientId, templateId, appointmentId || null]
  );
}

// Devolve { request } quando o link é válido; caso contrário { reason }.
export async function findRequestByToken(db, token) {
  if (!isValidTermToken(token)) return { reason: "not_found" };
  const request = await db.get(`${REQUEST_SELECT} WHERE r.token_hash = ?`, [hashTermToken(token)]);
  if (!request) return { reason: "not_found" };
  if (request.status === "completed") return { reason: "completed", request };
  if (request.status === "cancelled") return { reason: "cancelled", request };
  if (request.status === "expired" || new Date(request.expires_at).getTime() < Date.now()) {
    if (request.status === "pending") await db.run("UPDATE term_requests SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE id=?", [request.id]);
    return { reason: "expired", request };
  }
  return { request };
}

export async function markRequestCompleted(db, id, digitalTermId) {
  await db.run(
    "UPDATE term_requests SET status='completed', completed_at=now(), digital_term_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
    [digitalTermId, id]
  );
}

// Só o que o próprio cliente já conhece sobre si; nada de prontuário.
export function publicRequestView(request, { clinicName, template }) {
  return {
    request: { id: request.id, channel: request.channel, status: request.status, expires_at: request.expires_at, message: request.message || "" },
    clinic: { name: clinicName },
    template: template ? {
      id: template.id, name: template.name, kind: template.kind, description: template.description || "", content: template.content,
      requires_health_history: Boolean(template.requires_health_history),
      requires_guardian_for_minors: Boolean(template.requires_guardian_for_minors)
    } : null,
    client: {
      full_name: request.client_full_name || request.client_name || "",
      social_name: request.client_social_name || "",
      birth_date: request.client_birth_date || "",
      whatsapp: request.client_whatsapp || "",
      email: request.client_email || "",
      instagram: request.client_instagram || "",
      document_number: request.client_cpf || ""
    },
    appointment: request.appointment_id ? {
      id: request.appointment_id, date: request.appointment_date, time: request.appointment_time, procedure: request.appointment_procedure || ""
    } : null
  };
}
