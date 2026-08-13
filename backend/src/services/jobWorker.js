// Consumidor opcional da fila. Sem JOBS_WORKER_ENABLED=true nenhum processo
// executa jobs automaticamente; isso evita subir workers duplicados por acaso.
import { query } from "../database/connection.js";
import { withTenantSchema } from "../db/tenantSession.js";
import { claimNextJob, processClaimedJob } from "./jobs.js";

const enabled = String(process.env.JOBS_WORKER_ENABLED || "").toLowerCase() === "true";
const intervalMs = Math.min(Math.max(Number(process.env.JOBS_WORKER_INTERVAL_MS) || 5000, 1000), 60_000);
const workerId = `api-${process.pid}`;
let timer = null;
let running = false;

export async function runJobWorkerOnce() {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;
  let processed = 0;
  try {
    const tenants = await query("SELECT id FROM platform.tenants WHERE status = 'ativo' ORDER BY id");
    for (const tenant of tenants.rows) {
      await withTenantSchema(tenant.id, async (db) => {
        const job = await claimNextJob(db, workerId);
        if (!job) return;
        try {
          await processClaimedJob(db, job, { tenantId: Number(tenant.id) });
          processed += 1;
        } catch (error) {
          console.error(`[jobs] tenant ${tenant.id}, job ${job.id}: ${error.message}`);
        }
      });
    }
    return { processed };
  } finally {
    running = false;
  }
}

export function startJobWorker() {
  if (!enabled || timer) return false;
  timer = setInterval(() => runJobWorkerOnce().catch((error) => console.error(`[jobs] worker: ${error.message}`)), intervalMs);
  timer.unref?.();
  runJobWorkerOnce().catch((error) => console.error(`[jobs] worker inicial: ${error.message}`));
  console.log(`[jobs] worker ativo; intervalo ${intervalMs} ms.`);
  return true;
}
