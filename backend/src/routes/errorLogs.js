// Log central de erros. Ingestão do frontend é pública (POST) para capturar
// erros de telas não autenticadas; leitura/gestão é restrita ao admin.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole, extractBearerToken, decodeToken } from "../middleware/auth.js";
import { recordError, listErrorLogs } from "../services/errorLogs.js";

const router = Router();

// Atribuição best-effort do usuário quando há um token de clínica válido para
// este tenant (a rota é pública, então normalmente não há req.user).
function softUserId(req) {
  const decoded = decodeToken(extractBearerToken(req));
  if (!decoded || decoded.plt === true || !decoded.sub) return null;
  if (req.tenant && decoded.tid !== req.tenant.id) return null;
  return decoded.sub;
}

// Ingestão pública de erros do frontend.
router.post("/api/error-logs", withDb(async (req, res, db) => {
  const body = req.body || {};
  await recordError(db, {
    source: "frontend",
    level: body.level,
    message: body.message,
    stack: body.stack,
    url: body.url,
    context: body.context,
    status_code: body.status_code,
    user_id: softUserId(req),
    user_email: body.user_email,
    user_agent: req.headers["user-agent"]
  });
  res.status(201).json({ ok: true });
}));

// Listagem (admin). Filtros: ?source=backend|frontend&resolved=true|false&limit=200
router.get("/api/error-logs", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const resolved = req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : undefined;
  const data = await listErrorLogs(db, {
    source: req.query.source,
    resolved,
    limit: req.query.limit
  });
  res.json(data);
}));

// Marcar como resolvido / reabrir (admin).
router.patch("/api/error-logs/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const resolved = req.body?.resolved !== false;
  await db.run("UPDATE error_logs SET resolved = ? WHERE id = ?", [resolved, req.params.id]);
  res.json({ ok: true, resolved });
}));

// Excluir um erro (admin).
router.delete("/api/error-logs/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  await db.run("DELETE FROM error_logs WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
