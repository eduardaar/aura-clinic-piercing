// Fila persistente de tarefas pesadas por tenant.
//
// O request apenas ENFILEIRA. O worker reivindica uma linha com SKIP LOCKED,
// portanto duas instâncias podem consumir a mesma tabela sem processar o mesmo
// job duas vezes. Este módulo não é uma fila distribuída completa: depende de
// Postgres disponível e o worker deve ser ligado explicitamente no ambiente.
import crypto from "node:crypto";
import { buildReport, getReportDefinition, reportExportColumns, reportExportValue, validReportType } from "./reports.js";
import { csvEscape } from "./utils.js";
import { buildKey, storage } from "./storage/index.js";

const JOB_TYPES = new Set(["report_export", "aura_jewelry_import", "asaas_reconcile"]);
const JOB_STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled"]);
const MAX_KEY_LENGTH = 160;
const MAX_ERROR_LENGTH = 500;

export class JobError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "JobError";
    this.status = status;
  }
}

function json(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "null") ?? fallback; } catch { return fallback; }
}

function publicJob(row) {
  if (!row) return null;
  const payload = row.type === "report_export" ? json(row.payload) : null;
  return {
    id: row.id,
    type: row.type,
    report_type: payload?.type || null,
    // Escopo gravado no enfileiramento (profissional próprio): o download
    // confere que quem baixa tem o mesmo escopo de quem pediu.
    report_professional_id: payload?.scope?.own_professional_id ?? null,
    // Colunas opcionais (comissão, custo) liberadas para quem pediu: quem
    // baixa precisa poder ver as mesmas colunas.
    report_context: payload?.type ? {
      commissionColumns: Boolean(payload?.scope?.context?.commissionColumns),
      canViewCost: Boolean(payload?.scope?.context?.canViewCost)
    } : null,
    requested_by: row.requested_by == null ? null : Number(row.requested_by),
    status: row.status,
    result: json(row.result, null),
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    available_at: row.available_at,
    locked_at: row.locked_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    error: row.status === "failed" ? row.last_error : null
  };
}

function normalizedKey(key) {
  const value = String(key || "").trim();
  if (!value) return null;
  return value.slice(0, MAX_KEY_LENGTH);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function requestHash(type, payload) {
  return crypto.createHash("sha256").update(stableStringify({ type, payload }), "utf8").digest("hex");
}

const ID_FILTERS = new Set(["professional_id", "product_id", "supplier_id", "consumable_id", "service_id", "appointment_id", "user_id", "profile_id", "days"]);

// Só os filtros que o relatório declara (mais busca/ordenação) seguem para o
// worker, já saneados. O que muda o ALCANCE do relatório — profissional
// próprio e colunas de comissão/custo — vem de `scope`, calculado pela rota a
// partir das permissões do usuário, nunca do corpo da requisição.
function exportPayload(input = {}, scope = {}) {
  const type = String(input.type || "");
  if (!validReportType(type)) throw new JobError("Tipo de relatório inválido.");
  const format = String(input.format || "csv").toLowerCase();
  // XLSX/PDF podem ser adicionados depois, mas CSV é streaming-friendly e
  // evita prender heap do worker com uma planilha inteira.
  if (format !== "csv") throw new JobError("A exportação assíncrona aceita apenas CSV.");
  const raw = input.filters && typeof input.filters === "object" ? input.filters : {};
  const allowed = new Set([...(getReportDefinition(type)?.filters || []).map(({ key }) => key), "search", "sort"]);
  const filters = {};
  for (const key of [...allowed].sort()) {
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "from" || key === "to") {
      if (typeof value === "string") filters[key] = value.slice(0, 10);
    } else if (ID_FILTERS.has(key)) {
      if (Number.isInteger(Number(value)) && Number(value) > 0) filters[key] = Number(value);
    } else {
      filters[key] = String(value).slice(0, 120);
    }
  }
  const ownProfessionalId = Number(scope.ownProfessionalId) || null;
  if (ownProfessionalId) filters.professional_id = ownProfessionalId;
  return {
    type,
    format,
    filters,
    scope: {
      own_professional_id: ownProfessionalId,
      context: {
        commissionColumns: Boolean(scope.context?.commissionColumns),
        canViewCost: Boolean(scope.context?.canViewCost)
      }
    }
  };
}

export async function enqueueJob(db, { type, payload, userId, idempotencyKey, scope = {} }) {
  if (!JOB_TYPES.has(type)) throw new JobError("Tipo de job inválido.");
  const key = normalizedKey(idempotencyKey);
  if (!key) throw new JobError("Informe Idempotency-Key para criar um job.");
  const jobPayload = type === "report_export" ? exportPayload(payload, scope) : (payload || {});
  const hash = requestHash(type, jobPayload);
  const id = crypto.randomUUID();
  try {
    const inserted = await db.run(
      `INSERT INTO background_jobs (id, type, payload, request_hash, idempotency_key, requested_by)
       VALUES (?, ?, ?::jsonb, ?, ?, ?) RETURNING *`,
      [id, type, JSON.stringify(jobPayload), hash, key, userId]
    );
    return { job: publicJob(inserted.rows[0]), replayed: false };
  } catch (error) {
    // Índice parcial faz a idempotência sobreviver a múltiplas instâncias.
    if (error?.code !== "23505") throw error;
    const existing = await db.get(
      `SELECT *, request_hash FROM background_jobs
       WHERE type = ? AND requested_by = ? AND idempotency_key = ?
       ORDER BY created_at DESC LIMIT 1`,
      [type, userId, key]
    );
    if (!existing) throw error;
    if (existing.request_hash !== hash) {
      throw new JobError("Esta chave de idempotência já foi usada para outro pedido.", 409);
    }
    return { job: publicJob(existing), replayed: true };
  }
}

export async function listJobs(db, { limit = 30, status, requestedBy } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const safeStatus = JOB_STATUSES.has(String(status)) ? String(status) : null;
  const ownsOnly = Number.isInteger(Number(requestedBy));
  const conditions = [
    ...(safeStatus ? ["status = ?"] : []),
    ...(ownsOnly ? ["requested_by = ?"] : [])
  ];
  const params = [
    ...(safeStatus ? [safeStatus] : []),
    ...(ownsOnly ? [Number(requestedBy)] : []),
    boundedLimit
  ];
  const rows = await db.all(
    `SELECT * FROM background_jobs ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    params
  );
  return rows.map(publicJob);
}

export async function jobMetrics(db) {
  const rows = await db.all(
    `SELECT status, COUNT(*)::int AS count,
       COALESCE(ROUND(EXTRACT(EPOCH FROM (now() - (MIN(created_at) FILTER (WHERE status = 'queued'))) * 1000)), 0) AS oldest_queued_ms
       FROM background_jobs GROUP BY status`
  );
  const byStatus = Object.fromEntries([...JOB_STATUSES].map((status) => [status, 0]));
  let oldestQueuedMs = 0;
  for (const row of rows) {
    byStatus[row.status] = Number(row.count || 0);
    if (row.status === "queued") oldestQueuedMs = Number(row.oldest_queued_ms || 0);
  }
  return { by_status: byStatus, oldest_queued_ms: oldestQueuedMs, generated_at: new Date().toISOString() };
}

// Claim atômico: o lock da linha dura só a transação de UPDATE; a marcação
// running é o lease. Job abandonado por crash é recuperado pelo watchdog.
export async function claimNextJob(db, workerId) {
  return db.transaction(async (tx) => {
    await tx.run(
      `UPDATE background_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL,
          updated_at = now(), last_error = COALESCE(last_error, 'lease expirado; reenfileirado')
       WHERE status = 'running' AND locked_at < now() - INTERVAL '15 minutes' AND attempts < max_attempts`
    );
    const claimed = await tx.run(
      `WITH next_job AS (
         SELECT id FROM background_jobs
          WHERE status = 'queued' AND available_at <= now() AND attempts < max_attempts
          ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE background_jobs j SET status = 'running', attempts = attempts + 1,
         locked_at = now(), locked_by = ?, updated_at = now()
       FROM next_job WHERE j.id = next_job.id RETURNING j.*`,
      [String(workerId || "worker").slice(0, 100)]
    );
    return claimed.rows[0] || null;
  });
}

async function processReportExport(db, job, tenantId) {
  const payload = json(job.payload);
  // Exportação traz o período inteiro (sem a página de 25 linhas da tela) e
  // os mesmos rótulos pt-BR da exportação síncrona.
  const report = await buildReport(db, payload.type, { ...(payload.filters || {}), paginated: false }, payload.scope?.context || {});
  const columns = reportExportColumns(report);
  const csv = [
    columns.map(({ label }) => csvEscape(label)).join(","),
    ...report.rows.map((row) => columns.map((column) => csvEscape(reportExportValue(column, row[column.key]))).join(","))
  ].join("\n");
  const filename = `export-${payload.type}-${job.id}.csv`;
  const key = buildKey({ scope: "private", tenantId, purpose: "report_export", filename });
  await storage.putPrivate(key, Buffer.from(`\uFEFF${csv}`, "utf8"), { contentType: "text/csv; charset=utf-8" });
  await db.run(
    `INSERT INTO private_files (filename, original_name, mime_type, purpose, uploaded_by)
     VALUES (?, ?, 'text/csv', 'report_export', ?) ON CONFLICT (filename) DO NOTHING`,
    [filename, `${payload.type}-${report.from}-${report.to}.csv`, job.requested_by]
  );
  return { filename, rows: report.total_rows, report_type: payload.type, format: "csv" };
}

export async function processClaimedJob(db, job, { tenantId }) {
  let result;
  try {
    if (job.type === "report_export") result = await processReportExport(db, job, tenantId);
    else throw new JobError(`Executor ainda não configurado para ${job.type}.`, 501);
    await db.run(
      `UPDATE background_jobs SET status = 'completed', result = ?::jsonb, completed_at = now(),
       locked_at = NULL, locked_by = NULL, updated_at = now(), last_error = NULL WHERE id = ?`,
      [JSON.stringify(result), job.id]
    );
    return publicJob({ ...job, status: "completed", result, completed_at: new Date().toISOString() });
  } catch (error) {
    const message = String(error?.message || "Falha no job.").replace(/[\r\n]+/g, " ").slice(0, MAX_ERROR_LENGTH);
    await db.run(
      `UPDATE background_jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
       available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE now() + INTERVAL '1 minute' END,
       locked_at = NULL, locked_by = NULL, last_error = ?, updated_at = now() WHERE id = ?`,
      [message, job.id]
    );
    throw error;
  }
}

export async function findJob(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new JobError("Identificador de job inválido.");
  return publicJob(await db.get("SELECT * FROM background_jobs WHERE id = ?", [id]));
}

export async function findJobArtifact(db, id) {
  const job = await findJob(db, id);
  if (!job) return null;
  const filename = job.result?.filename;
  if (!filename || job.status !== "completed") return { job, artifact: null };
  return { job, artifact: { filename, report_type: job.result.report_type } };
}
