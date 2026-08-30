// Ciclo de inadimplência da assinatura SaaS.
// O Asaas emite/avisa as cobranças; a Aura complementa com avisos da carência
// e aplica o bloqueio somente após cinco dias completos do vencimento.
import { isProduction, PUBLIC_APP_URL } from "../config/index.js";
import { pool, query } from "../database/connection.js";
import { invalidateSubscriptionCache } from "./subscriptions.js";
import { syncPendingCheckouts } from "./platformBilling.js";
import { emailProviderStatus, isValidEmailAddress, sendTransactionalEmail } from "./emailProvider.js";

const enabled = process.env.ALLOW_INSECURE_TEST_ENV !== "true" &&
  String(process.env.BILLING_LIFECYCLE_ENABLED ?? (isProduction ? "true" : "false")).toLowerCase() === "true";
const intervalMs = Math.min(Math.max(Number(process.env.BILLING_LIFECYCLE_INTERVAL_MIN) || 15, 5), 1440) * 60_000;
let timer = null;
let running = false;

async function suspendExpiredGrace() {
  const result = await query(
    `UPDATE platform.tenant_subscriptions
        SET status = 'suspended', billing_suspended_at = now(), updated_at = now()
      WHERE status = 'overdue'
        AND grace_ends_at IS NOT NULL
        AND grace_ends_at <= now()
      RETURNING tenant_id`
  );
  for (const row of result.rows) invalidateSubscriptionCache(row.tenant_id);
  return result.rowCount || 0;
}

async function notificationCandidates() {
  const result = await query(
    `SELECT i.id AS invoice_id, i.tenant_id, i.amount, i.due_date, i.invoice_url,
            i.billing_type, t.name, t.email, s.status AS subscription_status,
            CASE
              WHEN s.status = 'suspended' AND s.billing_suspended_at IS NOT NULL THEN 'suspended'
              WHEN i.due_date < CURRENT_DATE - 4 THEN 'last_grace_day'
              WHEN i.due_date < CURRENT_DATE - 2 THEN 'overdue_3'
              WHEN i.due_date < CURRENT_DATE THEN 'overdue_1'
              WHEN i.due_date = CURRENT_DATE THEN 'due_today'
              WHEN i.due_date <= CURRENT_DATE + 5 THEN 'due_soon'
              ELSE NULL
            END AS kind
       FROM platform.tenant_invoices i
       JOIN platform.tenants t ON t.id = i.tenant_id
       JOIN platform.tenant_subscriptions s ON s.tenant_id = i.tenant_id
      WHERE i.status IN ('pendente', 'atrasada')
        AND i.billing_type IN ('PIX', 'CREDIT_CARD')
        AND i.due_date <= CURRENT_DATE + 5
        AND t.email IS NOT NULL
      ORDER BY i.due_date
      LIMIT 100`
  );
  return result.rows.filter((row) => row.kind && isValidEmailAddress(row.email));
}

async function claimNotification(row) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `INSERT INTO platform.billing_notifications (tenant_id, invoice_id, kind)
       VALUES ($1, $2, $3)
       ON CONFLICT (invoice_id, kind) DO UPDATE SET
         status = 'sending', attempts = platform.billing_notifications.attempts + 1,
         updated_at = now(), last_error = NULL
       WHERE platform.billing_notifications.status = 'failed'
         AND platform.billing_notifications.updated_at < now() - INTERVAL '15 minutes'
       RETURNING id`,
      [row.tenant_id, row.invoice_id, row.kind]
    );
    await client.query("COMMIT");
    return locked.rows[0]?.id || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function emailCopy(row) {
  const amount = Number(row.amount || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const method = row.billing_type === "PIX" ? "PIX" : "cartão de crédito";
  const messages = {
    due_soon: `Sua próxima mensalidade de ${amount} vence em breve.`,
    due_today: `Sua mensalidade de ${amount} vence hoje.`,
    overdue_1: `Sua mensalidade de ${amount} está vencida. O acesso permanece liberado durante a carência de 5 dias.`,
    overdue_3: `Sua mensalidade de ${amount} continua pendente. Regularize para evitar o bloqueio ao fim da carência.`,
    last_grace_day: `Último aviso: a mensalidade de ${amount} segue pendente e o acesso será bloqueado ao fim da carência.`,
    suspended: `O acesso foi bloqueado porque a mensalidade de ${amount} não foi paga dentro da carência. O pagamento reativa o sistema automaticamente.`
  };
  return {
    subject: row.kind === "suspended" ? "Acesso bloqueado por pagamento pendente" : "Lembrete da mensalidade Aura Clinic",
    text: `${row.name},\n\n${messages[row.kind]}\n\nForma de pagamento: ${method}.\nAcesse suas faturas: ${PUBLIC_APP_URL}/app/meu-plano\n${row.invoice_url ? `Fatura Asaas: ${row.invoice_url}\n` : ""}\nO Asaas confirmará o pagamento automaticamente.`
  };
}

async function sendNotices() {
  if (!(await emailProviderStatus()).enabled) return 0;
  let sent = 0;
  for (const row of await notificationCandidates()) {
    const notificationId = await claimNotification(row);
    if (!notificationId) continue;
    try {
      const result = await sendTransactionalEmail({ to: row.email, ...emailCopy(row) });
      if (!result) throw new Error("Provedor de e-mail não configurado.");
      await query(
        `UPDATE platform.billing_notifications
            SET status = 'sent', sent_at = now(), provider_message_id = $1, updated_at = now()
          WHERE id = $2`,
        [result.messageId, notificationId]
      );
      sent += 1;
    } catch (error) {
      await query(
        `UPDATE platform.billing_notifications
            SET status = 'failed', last_error = $1, updated_at = now() WHERE id = $2`,
        [String(error?.message || error).slice(0, 400), notificationId]
      );
    }
  }
  return sent;
}

export async function runBillingLifecycleOnce() {
  if (running) return { skipped: true };
  running = true;
  try {
    // Lock de sessão evita dois containers enviarem o mesmo lote em paralelo.
    const client = await pool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('aura:billing-lifecycle')) AS acquired");
      if (!lock.rows[0]?.acquired) return { skipped: true };
      try {
        const checkouts = await syncPendingCheckouts();
        const suspended = await suspendExpiredGrace();
        const notices = await sendNotices();
        return { skipped: false, checkouts, suspended, notices };
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('aura:billing-lifecycle'))");
      }
    } finally {
      client.release();
    }
  } finally {
    running = false;
  }
}

export function startBillingLifecycleWorker() {
  if (!enabled || timer) return false;
  timer = setInterval(() => runBillingLifecycleOnce().catch((error) => {
    console.error(`[billing/lifecycle] ${error?.message || error}`);
  }), intervalMs);
  timer.unref?.();
  runBillingLifecycleOnce().catch((error) => console.error(`[billing/lifecycle] inicial: ${error?.message || error}`));
  console.log(`[billing/lifecycle] ativo; intervalo ${intervalMs / 60_000} min.`);
  return true;
}
