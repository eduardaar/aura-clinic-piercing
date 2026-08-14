import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { query } from "../database/connection.js";
import { listPlans, planByCode, normalizePlanCode } from "../services/plans.js";
import { tenantSubscription, invalidateSubscriptionCache } from "../services/subscriptions.js";

const router = Router();

router.get("/api/store-identity", withDb(async (req, res, db) => {
  const theme = await db.get("SELECT * FROM catalog_theme WHERE id = 1") || {};
  const settingsRows = await db.all("SELECT key, value FROM catalog_settings");
  const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
  const tenant = await query("SELECT id, name, slug, plan, store_short_name, phone, city, state, logo_url, responsible_name FROM platform.tenants WHERE id = $1", [req.tenant.id]);
  const subscription = await tenantSubscription(req.tenant.id);
  res.json({
    tenant: tenant.rows[0],
    subscription,
    // Só planos ativos: a tela de upgrade não pode oferecer um plano que a
    // Monitence tirou de linha.
    plans: listPlans({ onlyActive: true }),
    identity: {
      store_name: theme.brand_name || tenant.rows[0]?.name || req.tenant.name,
      short_name: tenant.rows[0]?.store_short_name || "",
      description: settings.institutional_text || "",
      logo_url: theme.logo_url || tenant.rows[0]?.logo_url || "",
      slogan: theme.slogan || "",
      phone: tenant.rows[0]?.phone || "",
      whatsapp: settings.whatsapp_phone || "",
      instagram: settings.company_instagram || "",
      address: settings.company_address || "",
      city: tenant.rows[0]?.city || "",
      state: tenant.rows[0]?.state || "",
      primary_color: theme.primary_color || "#C8A96A",
      secondary_color: theme.secondary_color || "#D8C3A5",
      catalog_banner_url: settings.hero_image_url || "",
      welcome_text: settings.title || ""
    }
  });
}));

router.patch("/api/store-identity", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const body = req.body || {};
  await query(
    `UPDATE platform.tenants
     SET name = COALESCE($1, name),
         store_short_name = COALESCE($2, store_short_name),
         responsible_name = COALESCE($3, responsible_name),
         phone = COALESCE($4, phone),
         city = COALESCE($5, city),
         state = COALESCE($6, state),
         logo_url = COALESCE($7, logo_url)
     WHERE id = $8`,
    [body.store_name || null, body.short_name || null, body.responsible_name || null, body.phone || null, body.city || null, body.state || null, body.logo_url || null, req.tenant.id]
  );
  await db.run(
    `INSERT INTO catalog_theme (id, brand_name, slogan, logo_url, primary_color, secondary_color)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       brand_name = excluded.brand_name,
       slogan = excluded.slogan,
       logo_url = excluded.logo_url,
       primary_color = excluded.primary_color,
       secondary_color = excluded.secondary_color`,
    [
      body.store_name || req.tenant.name,
      body.slogan || "",
      body.logo_url || "",
      body.primary_color || "#C8A96A",
      body.secondary_color || "#D8C3A5"
    ]
  );
  const settings = {
    institutional_text: body.description,
    whatsapp_phone: body.whatsapp,
    company_instagram: body.instagram,
    company_address: body.address,
    hero_image_url: body.catalog_banner_url,
    title: body.welcome_text
  };
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    await db.run("INSERT INTO catalog_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, String(value || "")]);
  }
  res.json({ ok: true, subscription: await tenantSubscription(req.tenant.id) });
}));

// Troca de plano self-service (admin da clínica). Não altera trial/status —
// apenas troca o plano; o gating passa a refletir as features do novo plano.
router.patch("/api/subscription", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;
  const planCode = normalizePlanCode(req.body?.plan_code, "");
  if (!planCode) return res.status(400).json({ error: "Plano inválido." });
  const current = await tenantSubscription(req.tenant.id);
  if (current?.plan_code === planCode) {
    return res.json({ ok: true, subscription: current, plan: planByCode(planCode), unchanged: true });
  }
  // A troca direta serve apenas para experimentar recursos durante o trial,
  // antes de existir recorrência. Em assinatura ativa, alterar o banco primeiro
  // e sincronizar o gateway depois concederia acesso mesmo quando a cobrança
  // falhasse. Até existir prorrata/plan_change pendente, o caminho seguro é o
  // checkout inicial ou uma alteração administrativa auditada.
  if (current?.status !== "trial_active" || current?.asaas_subscription_id) {
    return res.status(409).json({
      error: "A alteração de uma assinatura já contratada precisa ser feita pelo suporte para manter cobrança e acesso consistentes.",
      code: "plan_change_requires_support"
    });
  }
  await query(
    "UPDATE platform.tenant_subscriptions SET plan_code = $1, updated_at = now() WHERE tenant_id = $2",
    [planCode, req.tenant.id]
  );
  await query("UPDATE platform.tenants SET plan = $1 WHERE id = $2", [planCode, req.tenant.id]);
  invalidateSubscriptionCache(req.tenant.id);
  // Trial sem recorrência: não existe cobrança no gateway para sincronizar.
  const gateway = { applied: false, reason: "trial_without_gateway_subscription" };
  res.json({
    ok: true,
    subscription: await tenantSubscription(req.tenant.id),
    plan: planByCode(planCode),
    gateway,
    warning: null
  });
}));

export default router;
