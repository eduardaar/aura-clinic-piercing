// Rotas de termos digitais (anamnese): registro pelo balcão, listagem e PDF;
// modelos de termo geridos pela clínica; e solicitações com link individual
// para o próprio cliente preencher e assinar (no estúdio ou à distância).
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import { termRequestSchema, termTemplateSchema, termTemplateUpdateSchema } from "../schemas/index.js";
import { P } from "../config/permissions.js";
import { listAppointments, upsertClient } from "../services/appointments.js";
import {
  listDigitalTerms, countDigitalTerms, createDigitalTermRecord,
  syncClientRegistration, validateDigitalTermBody
} from "../services/terms.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import { recordPrivacyAudit } from "../services/privacy.js";
import { recordAudit } from "../services/audit.js";
import {
  TERM_TEMPLATE_KINDS, TERM_TEMPLATE_KIND_LABELS, TERM_REQUEST_CHANNELS,
  cancelOpenRequestsFor, cancelTermRequest, createTermRequest, findRequestByToken, getTermRequest,
  listTermRequests, markRequestCompleted, publicRequestView, termRequestMessage, termRequestUrl, whatsappShareUrl
} from "../services/termRequests.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const TERM_SORTABLE = {
  signed_at: "t.signed_at",
  name: "t.full_name",
  procedure: "t.procedure",
  client: "c.full_name",
  appointment_date: "a.appointment_date"
};

router.get("/api/digital-terms", withFeature("digital_terms", async (req, res, db) => {
  // Termos carregam anamnese, documento, assinatura e declaração de saúde.
  // Autenticar no tenant não basta: recepção e financeiro não precisam desses
  // dados para exercer suas funções (menor privilégio, também no backend).
  if (!authorizePermission(req, res, P.CLINICAL_FILES_VIEW)) return;
  const clauses = [];
  const params = [];
  if (req.query.client_id) {
    clauses.push("t.client_id = ?");
    params.push(req.query.client_id);
  }
  if (req.query.appointment_id) {
    clauses.push("t.appointment_id = ?");
    params.push(req.query.appointment_id);
  }
  // Período pela data da assinatura (signed_at guarda "YYYY-MM-DD HH:MM:SS").
  if (req.query.from) {
    clauses.push("t.signed_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("t.signed_at <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  if (req.query.search) {
    clauses.push("(t.full_name ILIKE ? OR t.whatsapp ILIKE ? OR t.document_number ILIKE ? OR t.procedure ILIKE ?)");
    params.push(...Array(4).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: TERM_SORTABLE,
    tieBreak: "t.id",
    defaultOrderBy: "ORDER BY t.signed_at DESC, t.id DESC"
  });
  const items = await listDigitalTerms(db, { where, params, paging });
  const total = paging.paginated ? await countDigitalTerms(db, { where, params }) : items.length;
  await recordPrivacyAudit(db, {
    req, action: "digital_terms_read", resourceType: "digital_term_list",
    clientId: req.query.client_id || null,
    detail: { result_count: items.length, filtered_by_client: Boolean(req.query.client_id) }
  });
  res.json(pageResponse(items, total, paging));
}));

// Resolve (ou cria) o cliente do termo preenchido pelo balcão.
async function resolveTermClient(db, body, appointment) {
  const linkedClientId = appointment?.client_id || body.client_id;
  if (appointment?.client_id && body.client_id && String(appointment.client_id) !== String(body.client_id)) {
    return { error: { status: 409, message: "A anamnese deve usar o cliente vinculado ao agendamento." } };
  }
  const client = linkedClientId
    ? await db.get("SELECT * FROM clients WHERE id = ?", [linkedClientId])
    : await upsertClient(db, {
      full_name: body.full_name,
      whatsapp: body.whatsapp || "",
      instagram: body.instagram || "",
      birth_date: body.birth_date || "",
      client_notes: "Cliente criado pelo termo digital."
    });
  if (!client?.id) return { error: { status: 400, message: "Nao foi possivel vincular o cliente ao termo." } };
  return { client };
}

async function loadTemplate(db, templateId) {
  if (!templateId) return null;
  return db.get("SELECT * FROM term_templates WHERE id = ?", [templateId]);
}

router.post("/api/digital-terms", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  const body = req.body || {};
  const validationError = validateDigitalTermBody(body);
  if (validationError) return res.status(400).json({ error: validationError });

  const appointment = body.appointment_id
    ? await listAppointments(db, "WHERE a.id = ?", [body.appointment_id]).then((rows) => rows[0])
    : null;
  if (body.appointment_id && !appointment) {
    return res.status(404).json({ error: "Agendamento nao encontrado." });
  }
  const resolved = await resolveTermClient(db, body, appointment);
  if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
  const client = await syncClientRegistration(db, resolved.client, body);
  const template = await loadTemplate(db, body.template_id);
  if (body.template_id && !template) return res.status(404).json({ error: "Modelo de termo nao encontrado." });

  const term = await createDigitalTermRecord(db, {
    body, client, appointment, template, userId: req.user?.id || null, channel: "staff",
    ip: req.ip, userAgent: req.headers["user-agent"]
  });
  await recordAudit(db, {
    req, module: "terms", action: "term_signed", entityType: "digital_term", entityId: term.id,
    reason: "Termo registrado pela equipe", metadata: { client_id: client.id, template_id: template?.id || null, channel: "staff" }
  });
  res.status(201).json(term);
}));

// ---------- Modelos de termo ----------

function templateRow(row) {
  return row ? { ...row, kind_label: TERM_TEMPLATE_KIND_LABELS[row.kind] || row.kind } : row;
}

router.get("/api/term-templates", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_VIEW)) return;
  const includeInactive = String(req.query.include_inactive || "") === "1" || req.query.include_inactive === "true";
  const rows = await db.all(
    `SELECT t.*, s.name AS service_name,
            (SELECT COUNT(*) FROM digital_terms d WHERE d.template_id = t.id) AS signed_count,
            (SELECT COUNT(*) FROM term_requests r WHERE r.template_id = t.id AND r.status = 'pending') AS pending_count
       FROM term_templates t
       LEFT JOIN services s ON s.id = t.service_id
      ${includeInactive ? "" : "WHERE t.is_active = true"}
      ORDER BY t.is_active DESC, t.sort_order, t.name`
  );
  res.json({ items: rows.map(templateRow), kinds: TERM_TEMPLATE_KINDS.map((kind) => ({ value: kind, label: TERM_TEMPLATE_KIND_LABELS[kind] })) });
}));

function templateFields(body, current = {}) {
  const kind = body.kind ?? current.kind ?? "consent";
  if (!TERM_TEMPLATE_KINDS.includes(kind)) return { error: "Tipo de termo inválido." };
  const name = String(body.name ?? current.name ?? "").trim();
  const content = String(body.content ?? current.content ?? "").trim();
  if (name.length < 3 || name.length > 160) return { error: "O nome do modelo deve ter entre 3 e 160 caracteres." };
  if (content.length < 20) return { error: "O texto do termo precisa ter pelo menos 20 caracteres." };
  if (content.length > 40000) return { error: "O texto do termo é longo demais (máximo de 40.000 caracteres)." };
  const bool = (value, fallback) => value === undefined ? Boolean(fallback) : value === true || value === "true" || value === 1;
  return {
    fields: {
      name, kind, content,
      description: String(body.description ?? current.description ?? "").trim() || null,
      requires_health_history: bool(body.requires_health_history, current.requires_health_history ?? true),
      requires_guardian_for_minors: bool(body.requires_guardian_for_minors, current.requires_guardian_for_minors ?? true),
      service_id: body.service_id === undefined ? (current.service_id ?? null) : (body.service_id || null),
      is_active: bool(body.is_active, current.is_active ?? true),
      sort_order: Number.isFinite(Number(body.sort_order ?? current.sort_order)) ? Number(body.sort_order ?? current.sort_order ?? 0) : 0
    }
  };
}

router.post("/api/term-templates", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  if (!validateBody(termTemplateSchema, req, res)) return;
  const { fields, error } = templateFields(req.body || {});
  if (error) return res.status(400).json({ error });
  if (fields.service_id && !(await db.get("SELECT id FROM services WHERE id = ?", [fields.service_id]))) {
    return res.status(404).json({ error: "Procedimento vinculado nao encontrado." });
  }
  const result = await db.run(
    `INSERT INTO term_templates (name, kind, description, content, requires_health_history, requires_guardian_for_minors, service_id, is_active, sort_order, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [fields.name, fields.kind, fields.description, fields.content, fields.requires_health_history, fields.requires_guardian_for_minors, fields.service_id, fields.is_active, fields.sort_order, req.user?.id || null]
  );
  const row = await db.get("SELECT * FROM term_templates WHERE id = ?", [result.returnedId]);
  await recordAudit(db, { req, module: "terms", action: "template_create", entityType: "term_template", entityId: row.id, after: { name: row.name, kind: row.kind, is_active: row.is_active } });
  res.status(201).json(templateRow(row));
}));

router.patch("/api/term-templates/:id", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  if (!validateBody(termTemplateUpdateSchema, req, res)) return;
  const current = await db.get("SELECT * FROM term_templates WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Modelo de termo nao encontrado." });
  const { fields, error } = templateFields(req.body || {}, current);
  if (error) return res.status(400).json({ error });
  if (fields.service_id && !(await db.get("SELECT id FROM services WHERE id = ?", [fields.service_id]))) {
    return res.status(404).json({ error: "Procedimento vinculado nao encontrado." });
  }
  await db.run(
    `UPDATE term_templates SET name=?, kind=?, description=?, content=?, requires_health_history=?, requires_guardian_for_minors=?,
        service_id=?, is_active=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [fields.name, fields.kind, fields.description, fields.content, fields.requires_health_history, fields.requires_guardian_for_minors, fields.service_id, fields.is_active, fields.sort_order, current.id]
  );
  const row = await db.get("SELECT * FROM term_templates WHERE id = ?", [current.id]);
  await recordAudit(db, {
    req, module: "terms", action: "template_update", entityType: "term_template", entityId: row.id,
    before: { name: current.name, kind: current.kind, is_active: current.is_active }, after: { name: row.name, kind: row.kind, is_active: row.is_active }
  });
  res.json(templateRow(row));
}));

// Modelo já usado por algum termo assinado não some: fica inativo, para o
// histórico continuar apontando para o texto que a pessoa aceitou.
router.delete("/api/term-templates/:id", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  const current = await db.get("SELECT * FROM term_templates WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Modelo de termo nao encontrado." });
  const used = await db.get(
    "SELECT (SELECT COUNT(*) FROM digital_terms WHERE template_id = ?) + (SELECT COUNT(*) FROM term_requests WHERE template_id = ?) AS total",
    [current.id, current.id]
  );
  if (Number(used?.total || 0) > 0) {
    await db.run("UPDATE term_templates SET is_active=false, updated_at=CURRENT_TIMESTAMP WHERE id=?", [current.id]);
    await recordAudit(db, { req, module: "terms", action: "template_deactivate", entityType: "term_template", entityId: current.id, before: { name: current.name } });
    return res.json({ ok: true, archived: true });
  }
  await db.run("DELETE FROM term_templates WHERE id=?", [current.id]);
  await recordAudit(db, { req, module: "terms", action: "template_delete", entityType: "term_template", entityId: current.id, before: { name: current.name }, severity: "warning" });
  res.json({ ok: true, archived: false });
}));

// ---------- Solicitações com link ----------

function requestPayload(request, { req, token = null }) {
  if (!request) return request;
  const url = token ? termRequestUrl(req.tenant.slug, token) : null;
  const message = url ? termRequestMessage({ clinicName: req.tenant.name, clientName: request.client_name, templateName: request.template_name || "Termo digital", url }) : null;
  return {
    ...request,
    url,
    whatsapp_url: url ? whatsappShareUrl(request.client_whatsapp, message) : null,
    message_text: message
  };
}

router.get("/api/term-requests", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_VIEW)) return;
  const items = await listTermRequests(db, {
    clientId: req.query.client_id || null,
    appointmentId: req.query.appointment_id || null,
    status: req.query.status && ["pending", "completed", "cancelled", "expired"].includes(String(req.query.status)) ? String(req.query.status) : null
  });
  res.json({ items: items.map((item) => requestPayload(item, { req })) });
}));

async function issueRequest(db, req, { clientId, templateId, appointmentId, channel, expiresInHours, message }) {
  const client = await db.get("SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL", [clientId]);
  if (!client) return { status: 404, error: "Cliente nao encontrado." };
  const template = await db.get("SELECT * FROM term_templates WHERE id = ? AND is_active = true", [templateId]);
  if (!template) return { status: 404, error: "Modelo de termo nao encontrado ou inativo." };
  let appointment = null;
  if (appointmentId) {
    appointment = await db.get("SELECT id, client_id FROM appointments WHERE id = ?", [appointmentId]);
    if (!appointment) return { status: 404, error: "Agendamento nao encontrado." };
    if (String(appointment.client_id) !== String(client.id)) return { status: 409, error: "O agendamento pertence a outro cliente." };
  }
  if (!TERM_REQUEST_CHANNELS.includes(channel)) return { status: 400, error: "Canal inválido: use in_studio ou remote." };
  await cancelOpenRequestsFor(db, { clientId: client.id, templateId: template.id, appointmentId: appointment?.id || null });
  const { request, token } = await createTermRequest(db, {
    clientId: client.id, templateId: template.id, appointmentId: appointment?.id || null, channel, expiresInHours, message, userId: req.user?.id || null
  });
  await recordAudit(db, {
    req, module: "terms", action: "request_create", entityType: "term_request", entityId: request.id,
    metadata: { client_id: client.id, template_id: template.id, appointment_id: appointment?.id || null, channel, expires_at: request.expires_at }
  });
  return { status: 201, payload: requestPayload(request, { req, token }) };
}

router.post("/api/term-requests", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  if (!validateBody(termRequestSchema, req, res)) return;
  const body = req.body || {};
  const outcome = await issueRequest(db, req, {
    clientId: body.client_id, templateId: body.template_id, appointmentId: body.appointment_id || null,
    channel: String(body.channel || "remote"), expiresInHours: body.expires_in_hours, message: body.message
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.status(201).json(outcome.payload);
}));

router.post("/api/term-requests/:id/cancel", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  const current = await getTermRequest(db, req.params.id);
  if (!current) return res.status(404).json({ error: "Solicitacao nao encontrada." });
  if (current.status !== "pending") return res.status(409).json({ error: "Só solicitações pendentes podem ser canceladas." });
  const updated = await cancelTermRequest(db, current.id);
  await recordAudit(db, { req, module: "terms", action: "request_cancel", entityType: "term_request", entityId: current.id, reason: String(req.body?.reason || "").trim() || null });
  res.json(requestPayload(updated, { req }));
}));

// Link novo para a mesma pessoa e o mesmo modelo: a solicitação anterior é
// cancelada (o token original nunca é reexibido).
router.post("/api/term-requests/:id/renew", withFeature("digital_terms", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  const current = await getTermRequest(db, req.params.id);
  if (!current) return res.status(404).json({ error: "Solicitacao nao encontrada." });
  if (current.status === "completed") return res.status(409).json({ error: "Esta solicitação já foi concluída." });
  const outcome = await issueRequest(db, req, {
    clientId: current.client_id, templateId: current.template_id, appointmentId: current.appointment_id,
    channel: String(req.body?.channel || current.channel), expiresInHours: req.body?.expires_in_hours, message: req.body?.message ?? current.message
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.status(201).json(outcome.payload);
}));

// ---------- Página pública do cliente (link individual) ----------

const PUBLIC_REASON = {
  not_found: { status: 404, error: "Link inválido. Peça um novo link ao estúdio." },
  expired: { status: 410, error: "Este link expirou. Peça um novo link ao estúdio." },
  cancelled: { status: 410, error: "Este link foi cancelado pelo estúdio." },
  completed: { status: 409, error: "Este termo já foi assinado. Obrigado!" }
};

router.get("/api/public/terms/:token", loginLimiter, withFeature("digital_terms", async (req, res, db) => {
  const found = await findRequestByToken(db, req.params.token);
  if (found.reason) {
    const answer = PUBLIC_REASON[found.reason];
    return res.status(answer.status).json({ error: answer.error, code: found.reason, ...(found.reason === "completed" ? { signed_at: found.request?.term_signed_at || null } : {}) });
  }
  const template = await loadTemplate(db, found.request.template_id);
  res.json(publicRequestView(found.request, { clinicName: req.tenant.name, template }));
}));

router.post("/api/public/terms/:token", loginLimiter, withFeature("digital_terms", async (req, res, db) => {
  const found = await findRequestByToken(db, req.params.token);
  if (found.reason) {
    const answer = PUBLIC_REASON[found.reason];
    return res.status(answer.status).json({ error: answer.error, code: found.reason });
  }
  const request = found.request;
  const template = await loadTemplate(db, request.template_id);
  const body = { ...(req.body || {}) };
  // O cliente não escolhe a quem o termo pertence: vínculos vêm da solicitação.
  body.client_id = request.client_id;
  body.appointment_id = request.appointment_id || null;
  delete body.template_id;
  const validationError = validateDigitalTermBody(body, { requireGuardianForMinors: template ? Boolean(template.requires_guardian_for_minors) : true });
  if (validationError) return res.status(400).json({ error: validationError });
  if (template?.requires_health_history && !body.form_data?.health_history) {
    return res.status(400).json({ error: "Responda o histórico de saúde antes de assinar." });
  }
  const storedClient = await db.get("SELECT * FROM clients WHERE id = ?", [request.client_id]);
  if (!storedClient) return res.status(404).json({ error: PUBLIC_REASON.not_found.error, code: "not_found" });
  const appointment = request.appointment_id
    ? await listAppointments(db, "WHERE a.id = ?", [request.appointment_id]).then((rows) => rows[0] || null)
    : null;
  const client = await syncClientRegistration(db, storedClient, body);
  const term = await createDigitalTermRecord(db, {
    body, client, appointment, template, userId: null, channel: request.channel, requestId: request.id,
    ip: req.ip, userAgent: req.headers["user-agent"]
  });
  await markRequestCompleted(db, request.id, term.id);
  await recordAudit(db, {
    req, actor: { id: null, name: client.full_name, email: client.email || null, role: "client" },
    module: "terms", action: "term_signed_by_client", entityType: "digital_term", entityId: term.id,
    reason: request.channel === "remote" ? "Assinado pelo cliente por link" : "Assinado pelo cliente no estúdio",
    metadata: { request_id: request.id, template_id: template?.id || null, channel: request.channel }
  });
  res.status(201).json({ ok: true, term: { id: term.id, signed_at: term.signed_at, template_name: term.template_name || null } });
}));

export default router;
