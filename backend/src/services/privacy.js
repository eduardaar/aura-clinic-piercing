// Controles de privacidade que vivem no tenant: trilha de acesso a dados
// sensíveis, solicitações de titulares e retenção explícita de logs. Não
// guardamos o conteúdo clínico na auditoria — apenas quem acessou, o recurso e
// quando — para não criar uma segunda cópia desnecessária de dados pessoais.
import crypto from "node:crypto";

export const SUBJECT_REQUEST_TYPES = new Set([
  "access", "correction", "anonymization", "deletion", "portability", "objection"
]);
export const SUBJECT_REQUEST_STATUSES = new Set([
  "received", "identity_verification", "identity_verified", "in_progress", "completed", "rejected", "cancelled"
]);
export const RETENTION_CATEGORIES = new Set(["error_logs", "privacy_audit_logs"]);

function cleanText(value, max = 500) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function positiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function requestMetadata(req) {
  return {
    ip: cleanText(req.ip || req.socket?.remoteAddress || "", 128) || null,
    user_agent: cleanText(req.get?.("user-agent") || req.headers?.["user-agent"] || "", 500) || null
  };
}

/** Registra acesso sem copiar prontuário, termo, foto ou documento para o log. */
export async function recordPrivacyAudit(db, {
  req = null,
  action,
  resourceType,
  resourceId = null,
  clientId = null,
  detail = null
} = {}) {
  if (!action || !resourceType) return;
  const metadata = req ? requestMetadata(req) : { ip: null, user_agent: null };
  await db.run(
    `INSERT INTO privacy_audit_logs
      (actor_user_id, actor_email, actor_role, action, resource_type, resource_id, client_id, detail, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req?.user?.id || null,
      cleanText(req?.user?.email || "", 320) || null,
      cleanText(req?.user?.role || "", 40) || null,
      cleanText(action, 80),
      cleanText(resourceType, 80),
      positiveInteger(resourceId),
      positiveInteger(clientId),
      detail ? JSON.stringify(detail) : null,
      metadata.ip,
      metadata.user_agent
    ]
  );
}

export async function listPrivacyAudit(db, filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.action) { clauses.push("action = ?"); params.push(cleanText(filters.action, 80)); }
  if (filters.resource_type) { clauses.push("resource_type = ?"); params.push(cleanText(filters.resource_type, 80)); }
  if (positiveInteger(filters.client_id)) { clauses.push("client_id = ?"); params.push(positiveInteger(filters.client_id)); }
  if (positiveInteger(filters.actor_user_id)) { clauses.push("actor_user_id = ?"); params.push(positiveInteger(filters.actor_user_id)); }
  if (filters.from) { clauses.push("created_at >= ?"); params.push(cleanText(filters.from, 32)); }
  if (filters.to) { clauses.push("created_at <= ?"); params.push(`${cleanText(filters.to, 16)} 23:59:59`); }
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 100));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.all(`SELECT * FROM privacy_audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`, [...params, limit]);
}

export async function createSubjectRequest(db, body = {}, actor = null) {
  const clientId = positiveInteger(body.client_id);
  const type = cleanText(body.request_type, 40);
  if (!clientId) throw new PrivacyError("Informe o titular vinculado à solicitação.", 400);
  if (!SUBJECT_REQUEST_TYPES.has(type)) throw new PrivacyError("Tipo de solicitação inválido.", 400);
  const client = await db.get("SELECT id, full_name, email, whatsapp, deleted_at FROM clients WHERE id = ?", [clientId]);
  if (!client) throw new PrivacyError("Titular não encontrado.", 404);
  const requestCode = crypto.randomUUID();
  const result = await db.run(
    `INSERT INTO data_subject_requests
      (request_code, client_id, request_type, status, requester_name, requester_contact, notes, created_by)
     VALUES (?, ?, ?, 'received', ?, ?, ?, ?) RETURNING id`,
    [
      requestCode,
      client.id,
      type,
      cleanText(body.requester_name || client.full_name, 255) || null,
      cleanText(body.requester_contact || client.email || client.whatsapp, 255) || null,
      cleanText(body.notes, 4000) || null,
      actor?.id || null
    ]
  );
  return db.get("SELECT * FROM data_subject_requests WHERE id = ?", [result.returnedId]);
}

export async function updateSubjectRequest(db, id, body = {}, actor = null) {
  const request = await db.get("SELECT * FROM data_subject_requests WHERE id = ?", [id]);
  if (!request) throw new PrivacyError("Solicitação não encontrada.", 404);
  const nextStatus = body.status === undefined ? request.status : cleanText(body.status, 40);
  if (!SUBJECT_REQUEST_STATUSES.has(nextStatus)) throw new PrivacyError("Status da solicitação inválido.", 400);
  const identityVerifiedAt = nextStatus === "identity_verified"
    ? (request.identity_verified_at || new Date().toISOString())
    : request.identity_verified_at;
  const completedAt = nextStatus === "completed"
    ? (request.completed_at || new Date().toISOString())
    : request.completed_at;
  await db.run(
    `UPDATE data_subject_requests
     SET status = ?, notes = ?, identity_verified_at = ?, completed_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [nextStatus, body.notes === undefined ? request.notes : cleanText(body.notes, 4000) || null, identityVerifiedAt, completedAt, actor?.id || null, request.id]
  );
  return db.get("SELECT * FROM data_subject_requests WHERE id = ?", [request.id]);
}

export async function subjectDataExport(db, clientId) {
  const client = await db.get("SELECT * FROM clients WHERE id = ?", [clientId]);
  if (!client) throw new PrivacyError("Titular não encontrado.", 404);
  // `db` compartilha o mesmo client PG da requisição: as consultas precisam
  // ser sequenciais (Promise.all no mesmo client gera concorrência inválida).
  const appointments = await db.all("SELECT * FROM appointments WHERE client_id = ? ORDER BY appointment_date, appointment_time", [clientId]);
  const payments = await db.all("SELECT * FROM payments WHERE client_id = ? ORDER BY paid_at DESC, id DESC", [clientId]);
  const sales = await db.all("SELECT * FROM sales_orders WHERE client_id = ? ORDER BY created_at DESC, id DESC", [clientId]);
  const medicalRecords = await db.all("SELECT * FROM client_medical_records WHERE client_id = ? ORDER BY record_date DESC, id DESC", [clientId]);
  // Assinaturas em data URL seriam uma duplicação pesada e desnecessária do
  // dado. O PDF/arquivo permanece no cofre privado e seu acesso é auditado.
  const terms = await db.all("SELECT id, appointment_id, client_id, full_name, social_name, document_number, birth_date, whatsapp, instagram, address, procedure, piercing_region, orientations_confirmed, health_declaration, form_data, pdf_url, signed_at FROM digital_terms WHERE client_id = ? ORDER BY signed_at DESC", [clientId]);
  const followups = await db.all("SELECT * FROM post_care_followups WHERE client_id = ? ORDER BY due_date DESC, id DESC", [clientId]);
  return {
    generated_at: new Date().toISOString(),
    format_version: 1,
    client,
    appointments,
    payments,
    sales,
    medical_records: medicalRecords,
    digital_terms: terms,
    post_care_followups: followups,
    // Arquivos privados legados ainda não têm uma chave client_id obrigatória.
    // Eles não entram na exportação para evitar que um titular receba metadados
    // de outra pessoa; a vinculação e a exportação de anexos ficam pendentes.
    private_files: { included: false, reason: "client_file_linkage_not_available" }
  };
}

export async function listRetentionPolicies(db) {
  return db.all("SELECT * FROM privacy_retention_policies ORDER BY category");
}

export async function updateRetentionPolicy(db, category, body = {}, actor = null) {
  if (!RETENTION_CATEGORIES.has(category)) throw new PrivacyError("Categoria de retenção não suportada.", 400);
  const current = await db.get("SELECT * FROM privacy_retention_policies WHERE category = ?", [category]);
  if (!current) throw new PrivacyError("Política não encontrada.", 404);
  const days = body.retention_days === undefined ? current.retention_days : positiveInteger(body.retention_days);
  if (!days || days > 36500) throw new PrivacyError("Informe entre 1 e 36500 dias de retenção.", 400);
  const enabled = body.enabled === undefined ? current.enabled : (body.enabled ? 1 : 0);
  await db.run(
    `UPDATE privacy_retention_policies
     SET retention_days = ?, enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE category = ?`,
    [days, enabled, actor?.id || null, category]
  );
  return db.get("SELECT * FROM privacy_retention_policies WHERE category = ?", [category]);
}

export async function retentionPreview(db, category) {
  if (!RETENTION_CATEGORIES.has(category)) throw new PrivacyError("Categoria de retenção não suportada.", 400);
  const policy = await db.get("SELECT * FROM privacy_retention_policies WHERE category = ?", [category]);
  if (!policy) throw new PrivacyError("Política não encontrada.", 404);
  const table = category;
  const additionalWhere = category === "error_logs" ? "AND resolved = TRUE" : "";
  const result = await db.get(
    `SELECT COUNT(*)::int AS eligible_count FROM ${table}
     WHERE created_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 day')) ${additionalWhere}`,
    [policy.retention_days]
  );
  return { policy, eligible_count: Number(result?.eligible_count || 0), executable: Boolean(policy.enabled) };
}

export async function applyRetention(db, category) {
  const preview = await retentionPreview(db, category);
  if (!preview.policy.enabled) throw new PrivacyError("A política está desativada; revise-a antes de executar a retenção.", 409);
  const additionalWhere = category === "error_logs" ? "AND resolved = TRUE" : "";
  const result = await db.run(
    `DELETE FROM ${category} WHERE created_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 day')) ${additionalWhere}`,
    [preview.policy.retention_days]
  );
  return { ...preview, deleted_count: Number(result?.changes || 0) };
}

export class PrivacyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
