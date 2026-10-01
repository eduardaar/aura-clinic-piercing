import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { buildKey, storage } from "../services/storage/index.js";
import { enqueueJob, findJobArtifact, jobMetrics, listJobs, JobError } from "../services/jobs.js";
import { hasFeature, requireFeature, tenantSubscription } from "../services/subscriptions.js";
import { REPORT_FEATURE_REQUIREMENTS, resolveReportAccess, validReportType } from "../services/reports.js";
import { hasPermission } from "../services/permissionService.js";
import { P } from "../config/permissions.js";
import { recordAudit } from "../services/audit.js";

// Exportação assíncrona de relatórios. As regras de acesso são AS MESMAS da
// rota síncrona (/api/reports/:type), via resolveReportAccess: permissão por
// relatório (financeiro, comissões, próprio/todos), escopo do profissional
// vinculado e gate de plano. Antes esta rota usava requireRole e deixava a
// recepção enfileirar e baixar relatórios financeiros que a tela bloqueava.
const router = Router();

function handleError(res, error) {
  if (error instanceof JobError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

async function requireReportFeatures(req, res, reportType) {
  for (const feature of REPORT_FEATURE_REQUIREMENTS[reportType] || []) {
    if (!(await requireFeature(req, res, feature))) return false;
  }
  return true;
}

// Quem enxerga a fila inteira (jobs pedidos por outras pessoas): o
// administrador e quem já vê todos os relatórios, inclusive os financeiros.
// Os demais só veem os próprios pedidos.
function seesAllJobs(user) {
  return user?.role === "admin"
    || (hasPermission(user, P.REPORTS_VIEW_ALL) && hasPermission(user, P.REPORTS_VIEW_FINANCIAL));
}

async function reportAccess(req, reportType) {
  const subscription = await tenantSubscription(req.tenant?.id);
  return resolveReportAccess(req.user, reportType, { hasPlanFeature: (feature) => hasFeature(subscription, feature) });
}

router.post("/api/jobs/report-exports", withFeature("basic_reports", async (req, res, db) => {
  const reportType = String(req.body?.type || "");
  if (!validReportType(reportType)) return res.status(400).json({ error: "Tipo de relatório inválido." });
  if (!(await requireReportFeatures(req, res, reportType))) return;
  const access = await reportAccess(req, reportType);
  if (!access.allowed) return res.status(access.status).json({ error: access.error });
  try {
    const created = await enqueueJob(db, {
      type: "report_export", payload: req.body, userId: req.user.id,
      idempotencyKey: req.headers["idempotency-key"],
      scope: { ownProfessionalId: access.ownProfessionalId, context: access.context }
    });
    if (!created.replayed) {
      await recordAudit(db, {
        req, module: "reports", action: "export_requested", entityType: "report", entityId: reportType,
        metadata: { format: "csv", job_id: created.job.id, scope: access.ownProfessionalId ? "own" : "all" }
      });
    }
    res.status(created.replayed ? 200 : 202).json(created);
  } catch (error) {
    if (!handleError(res, error)) throw error;
  }
}));

router.get("/api/jobs", withFeature("basic_reports", async (req, res, db) => {
  const requestedBy = seesAllJobs(req.user) ? undefined : req.user.id;
  const items = await listJobs(db, { ...req.query, requestedBy });
  const subscription = await tenantSubscription(req.tenant?.id);
  const hasPlanFeature = (feature) => hasFeature(subscription, feature);
  const visible = items.filter((item) => {
    const reportType = item.report_type || item.result?.report_type;
    if (!reportType) return true;
    if (!(REPORT_FEATURE_REQUIREMENTS[reportType] || []).every(hasPlanFeature)) return false;
    // Só lista exportações de relatórios que o usuário pode abrir hoje.
    return resolveReportAccess(req.user, reportType, { hasPlanFeature }).allowed;
  });
  res.json({ items: visible });
}));

router.get("/api/jobs/metrics", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await jobMetrics(db));
}));

router.get("/api/jobs/:id/download", withFeature("basic_reports", async (req, res, db) => {
  try {
    const found = await findJobArtifact(db, req.params.id);
    if (!found) return res.status(404).json({ error: "Job não encontrado." });
    if (!seesAllJobs(req.user) && found.job.requested_by !== Number(req.user.id)) {
      return res.status(404).json({ error: "Job não encontrado." });
    }
    const reportType = found.artifact?.report_type || found.job?.report_type;
    if (!(await requireReportFeatures(req, res, reportType))) return;
    if (reportType) {
      const access = await reportAccess(req, reportType);
      if (!access.allowed) return res.status(access.status === 409 ? 403 : access.status).json({ error: access.error || "Sem permissão para baixar este relatório." });
      // Quem só vê o próprio profissional não baixa exportação de outro escopo
      // (por exemplo, uma exportação da clínica inteira pedida pelo admin).
      if (access.ownProfessionalId && Number(found.job.report_professional_id) !== Number(access.ownProfessionalId)) {
        return res.status(403).json({ error: "Sem permissão para baixar este relatório." });
      }
      // A exportação foi gerada com as colunas de quem pediu: quem não pode ver
      // comissão ou custo não baixa um arquivo que traz essas colunas.
      const jobContext = found.job.report_context || {};
      if ((jobContext.commissionColumns && !access.context?.commissionColumns)
        || (jobContext.canViewCost && !access.context?.canViewCost)) {
        return res.status(403).json({ error: "Sem permissão para baixar este relatório." });
      }
    }
    if (!found.artifact) return res.status(409).json({ error: "Exportação ainda não está disponível." });
    const key = buildKey({ scope: "private", tenantId: req.tenant.id, purpose: "report_export", filename: found.artifact.filename });
    const object = await storage.getPrivateStream(key);
    if (!object) return res.status(404).json({ error: "Arquivo de exportação não encontrado." });
    await recordAudit(db, {
      req, module: "reports", action: "export", entityType: "report", entityId: reportType || "job",
      metadata: { format: "csv", job_id: found.job.id, row_count: found.job.result?.rows ?? null }
    });
    res.type("text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.attachment(found.artifact.filename);
    object.body.on("error", () => res.destroy());
    object.body.pipe(res);
  } catch (error) {
    if (!handleError(res, error)) throw error;
  }
}));

export default router;
