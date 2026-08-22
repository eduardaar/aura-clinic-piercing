import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { buildKey, storage } from "../services/storage/index.js";
import { enqueueJob, findJobArtifact, jobMetrics, listJobs, JobError } from "../services/jobs.js";
import { hasFeature, requireFeature, tenantSubscription } from "../services/subscriptions.js";
import { REPORT_FEATURE_REQUIREMENTS } from "../services/reports.js";

const router = Router();
const financialReports = new Set(["financial", "payments", "commissions"]);

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

router.post("/api/jobs/report-exports", withFeature("basic_reports", async (req, res, db) => {
  const reportType = String(req.body?.type || "");
  if (!(await requireReportFeatures(req, res, reportType))) return;
  const roles = financialReports.has(reportType) ? ["admin", "finance"] : ["admin", "finance", "reception"];
  if (!requireRole(req, res, roles)) return;
  try {
    const created = await enqueueJob(db, {
      type: "report_export", payload: req.body, userId: req.user.id,
      idempotencyKey: req.headers["idempotency-key"]
    });
    res.status(created.replayed ? 200 : 202).json(created);
  } catch (error) {
    if (!handleError(res, error)) throw error;
  }
}));

router.get("/api/jobs", withFeature("basic_reports", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception"])) return;
  // Recepção pode solicitar seus próprios relatórios operacionais, mas não
  // deve descobrir ou baixar exportações solicitadas por financeiro/admin.
  const requestedBy = req.user.role === "reception" ? req.user.id : undefined;
  const items = await listJobs(db, { ...req.query, requestedBy });
  const subscription = await tenantSubscription(req.tenant?.id);
  const visible = items.filter((item) => {
    const reportType = item.report_type || item.result?.report_type;
    return (REPORT_FEATURE_REQUIREMENTS[reportType] || [])
      .every((feature) => hasFeature(subscription, feature));
  });
  res.json({ items: visible });
}));

router.get("/api/jobs/metrics", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await jobMetrics(db));
}));

router.get("/api/jobs/:id/download", withFeature("basic_reports", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception"])) return;
  try {
    const found = await findJobArtifact(db, req.params.id);
    if (!found) return res.status(404).json({ error: "Job não encontrado." });
    if (req.user.role === "reception" && found.job.requested_by !== Number(req.user.id)) {
      return res.status(404).json({ error: "Job não encontrado." });
    }
    const reportType = found.artifact?.report_type || found.job?.report_type;
    if (!(await requireReportFeatures(req, res, reportType))) return;
    if (!found.artifact) return res.status(409).json({ error: "Exportação ainda não está disponível." });
    if (financialReports.has(found.artifact.report_type) && !["admin", "finance"].includes(req.user.role)) {
      return res.status(403).json({ error: "Sem permissão para baixar este relatório." });
    }
    const key = buildKey({ scope: "private", tenantId: req.tenant.id, purpose: "report_export", filename: found.artifact.filename });
    const object = await storage.getPrivateStream(key);
    if (!object) return res.status(404).json({ error: "Arquivo de exportação não encontrado." });
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
