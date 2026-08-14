// Rotas administrativas para governança LGPD no nível da clínica.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import {
  PrivacyError,
  applyRetention,
  createSubjectRequest,
  listPrivacyAudit,
  listRetentionPolicies,
  recordPrivacyAudit,
  retentionPreview,
  subjectDataExport,
  updateRetentionPolicy,
  updateSubjectRequest
} from "../services/privacy.js";

const router = Router();

function handlePrivacyError(res, error) {
  if (error instanceof PrivacyError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

router.get("/api/privacy/audit", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const items = await listPrivacyAudit(db, req.query);
  res.json({ items });
}));

router.get("/api/privacy/data-subject-requests", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const status = req.query.status ? "WHERE r.status = ?" : "";
  const params = req.query.status ? [String(req.query.status)] : [];
  const items = await db.all(
    `SELECT r.*, c.full_name AS client_name FROM data_subject_requests r
     LEFT JOIN clients c ON c.id = r.client_id ${status} ORDER BY r.created_at DESC, r.id DESC`, params
  );
  res.json({ items });
}));

router.post("/api/privacy/data-subject-requests", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    const item = await createSubjectRequest(db, req.body, req.user);
    await recordPrivacyAudit(db, {
      req, action: "data_subject_request_created", resourceType: "data_subject_request",
      resourceId: item.id, clientId: item.client_id, detail: { request_type: item.request_type }
    });
    res.status(201).json(item);
  } catch (error) {
    if (!handlePrivacyError(res, error)) throw error;
  }
}));

router.patch("/api/privacy/data-subject-requests/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    const item = await updateSubjectRequest(db, req.params.id, req.body, req.user);
    await recordPrivacyAudit(db, {
      req, action: "data_subject_request_updated", resourceType: "data_subject_request",
      resourceId: item.id, clientId: item.client_id, detail: { status: item.status }
    });
    res.json(item);
  } catch (error) {
    if (!handlePrivacyError(res, error)) throw error;
  }
}));

router.get("/api/privacy/data-subject-requests/:id/export", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const request = await db.get("SELECT * FROM data_subject_requests WHERE id = ?", [req.params.id]);
  if (!request) return res.status(404).json({ error: "Solicitação não encontrada." });
  if (!["identity_verified", "in_progress", "completed"].includes(request.status)) {
    return res.status(409).json({ error: "Valide a identidade do titular antes de exportar seus dados." });
  }
  const payload = await subjectDataExport(db, request.client_id);
  await recordPrivacyAudit(db, {
    req, action: "data_subject_export", resourceType: "data_subject_request",
    resourceId: request.id, clientId: request.client_id, detail: { request_type: request.request_type }
  });
  res.setHeader("Content-Disposition", `attachment; filename="dados-titular-${request.request_code}.json"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(payload);
}));

router.get("/api/privacy/retention-policies", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json({ items: await listRetentionPolicies(db) });
}));

router.patch("/api/privacy/retention-policies/:category", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    const item = await updateRetentionPolicy(db, req.params.category, req.body, req.user);
    await recordPrivacyAudit(db, {
      req, action: "retention_policy_updated", resourceType: "retention_policy",
      detail: { category: item.category, retention_days: item.retention_days, enabled: Boolean(item.enabled) }
    });
    res.json(item);
  } catch (error) {
    if (!handlePrivacyError(res, error)) throw error;
  }
}));

router.post("/api/privacy/retention/:category/preview", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    res.json(await retentionPreview(db, req.params.category));
  } catch (error) {
    if (!handlePrivacyError(res, error)) throw error;
  }
}));

router.post("/api/privacy/retention/:category/run", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (req.body?.confirmation !== "CONFIRMAR RETENCAO") {
    return res.status(400).json({ error: "Digite CONFIRMAR RETENCAO para executar a eliminação." });
  }
  try {
    const result = await applyRetention(db, req.params.category);
    // A própria tabela de auditoria não deve registrar uma linha nela mesma
    // após apagar seu passado; a ação fica rastreada quando a categoria é log
    // de erros e, para auditoria, deve ser também registrada no procedimento
    // operacional externo (backup/imutabilidade).
    if (req.params.category !== "privacy_audit_logs") {
      await recordPrivacyAudit(db, {
        req, action: "retention_executed", resourceType: "retention_policy",
        detail: { category: req.params.category, deleted_count: result.deleted_count, retention_days: result.policy.retention_days }
      });
    }
    res.json(result);
  } catch (error) {
    if (!handlePrivacyError(res, error)) throw error;
  }
}));

export default router;
