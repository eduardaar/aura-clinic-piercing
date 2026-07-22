// Serviço de assinaturas: lê a assinatura do tenant e decide o que o plano
// libera. As FEATURES vêm sempre de plans.js (planByCode) — a fonte da verdade
// no código — para nunca dependerem de um seed desatualizado em
// platform.subscription_plans. Só status e datas vêm da linha do banco.
import { query } from "../database/connection.js";
import { planByCode } from "./plans.js";

const SUB_CACHE_TTL_MS = 30 * 1000;
const subCache = new Map();

export function invalidateSubscriptionCache(tenantId) {
  if (tenantId != null) subCache.delete(Number(tenantId));
  else subCache.clear();
}

function daysUntil(dateValue) {
  const end = new Date(dateValue);
  if (Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Assinatura do tenant, enriquecida com o plano (nome/preço/features) e os dias
// restantes de trial. Cacheada por 30s (invalidada em troca de plano).
export async function tenantSubscription(tenantId) {
  const key = Number(tenantId);
  if (!Number.isInteger(key)) return null;
  const cached = subCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const result = await query(
    "SELECT * FROM platform.tenant_subscriptions WHERE tenant_id = $1",
    [key]
  );
  const row = result.rows[0] || null;
  let value = null;
  if (row) {
    const plan = planByCode(row.plan_code);
    value = {
      ...row,
      plan_code: plan.code,
      plan_name: plan.name,
      price_cents: plan.price_cents,
      features: plan.features,
      days_left: daysUntil(row.trial_ends_at || row.current_period_ends_at)
    };
  }
  subCache.set(key, { value, expiresAt: Date.now() + SUB_CACHE_TTL_MS });
  return value;
}

export function hasFeature(subscription, feature) {
  if (!feature) return true;
  const features = Array.isArray(subscription?.features) ? subscription.features : [];
  return features.includes(feature);
}

// Assinatura "ativa": paga (active) ou em trial dentro do prazo. Qualquer outro
// estado (trial_expired, overdue, canceled, suspended) é considerado inativo.
export function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  const status = String(subscription.status || "");
  if (status === "active") return true;
  if (status === "trial_active") return (subscription.days_left ?? 0) > 0;
  return false;
}

// Guard inline (mesmo padrão de requireRole): valida assinatura ativa + feature.
// Retorna true se liberado; caso contrário já responde 402/403 e retorna false.
// IMPORTANTE: como consulta o banco, o handler DEVE usar `await`.
export async function requireFeature(req, res, feature) {
  const subscription = await tenantSubscription(req.tenant?.id);
  if (!isSubscriptionActive(subscription)) {
    res.status(402).json({
      error: "Seu período de teste terminou ou a assinatura está inativa. Renove o plano para continuar.",
      code: "subscription_inactive"
    });
    return false;
  }
  if (feature && !hasFeature(subscription, feature)) {
    const plan = planByCode(subscription?.plan_code);
    res.status(403).json({
      error: `Este recurso não está incluído no seu plano (${plan.name}). Faça upgrade para liberá-lo.`,
      code: "plan_upgrade_required",
      feature
    });
    return false;
  }
  return true;
}
