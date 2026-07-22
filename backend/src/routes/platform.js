// Rotas de plataforma (multi-tenant): cadastro público de clínicas (signup),
// login do super-admin e painel de administração dos tenants.
//
// IMPORTANTE: estas rotas NÃO usam withDb — operam apenas no schema de
// controle `platform` via query() global (sempre com prefixo platform.) e,
// quando precisam olhar dentro de um tenant (métricas), usam um client
// dedicado com SET search_path + reset.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { pool, query } from "../database/connection.js";
import { createPlatformToken, verifyPlatformToken, createToken } from "../middleware/auth.js";
import { invalidateTenantCache } from "../middleware/tenant.js";
import {
  provisionTenant,
  deprovisionTenant,
  generateUniqueSlug,
  TenantServiceError
} from "../services/tenants.js";
import { validateBody } from "../middleware/validate.js";
import { signupSchema, platformLoginSchema, tenantStatusSchema } from "../schemas/index.js";
import { isProduction } from "../config/index.js";
import { SUBSCRIPTION_PLANS, normalizePlanCode } from "../services/plans.js";
import { invalidateSubscriptionCache } from "../services/subscriptions.js";

const router = Router();

// Rate limit estrito do signup público: 5 cadastros/hora por IP.
// Desliga rate limit apenas na suíte de testes (nunca em produção).
const skipRateLimit = () => process.env.DISABLE_RATE_LIMIT === "true";

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
  message: { error: "Muitos cadastros deste endereço. Tente novamente em uma hora." }
});

// Rate limit do login de plataforma (mesma política do login de clínica:
// 10 tentativas / 15 min por IP), mas com contador próprio.
const platformLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
  message: { error: "Muitas tentativas de login. Tente novamente em alguns minutos." }
});

// Converte erros conhecidos do serviço em resposta HTTP; demais viram 500.
function handleServiceError(res, error) {
  if (error instanceof TenantServiceError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({
    error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
  });
}

// Auth do painel de plataforma. SEM bypass de dev: plataforma SEMPRE exige login.
function requirePlatform(req, res, next) {
  const decoded = verifyPlatformToken(req);
  if (!decoded) {
    return res.status(401).json({ error: "Sessão de plataforma inválida ou expirada." });
  }
  req.platformUser = decoded;
  next();
}

// ---------- Signup público ----------
router.post("/api/signup", signupLimiter, async (req, res) => {
  try {
    if (process.env.ALLOW_PUBLIC_SIGNUP === "false") {
      return res.status(403).json({ error: "Cadastro público desabilitado." });
    }
    if (!validateBody(signupSchema, req, res)) return;
    const b = req.body;
    // Cadastro público: o slug não é digitado — deriva-se do nome da clínica.
    const slug = String(b.slug || "").trim()
      ? String(b.slug).trim().toLowerCase()
      : await generateUniqueSlug(b.name);
    const tenant = await provisionTenant({
      name: b.name,
      slug,
      adminName: b.admin_name,
      adminEmail: b.admin_email,
      adminPassword: b.admin_password,
      phone: b.phone,
      city: b.city,
      state: b.state,
      logoUrl: b.logo_url,
      plan: normalizePlanCode(b.plan_code || b.plan)
    });
    // Login automático: emite um token de clínica para o admin recém-criado,
    // evitando que o usuário tenha de fazer login de novo digitando o slug.
    const token = tenant.admin ? createToken(tenant.admin, tenant) : null;
    res.status(201).json({
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan },
      token,
      user: tenant.admin
        ? { id: tenant.admin.id, name: tenant.admin.name, email: tenant.admin.email, role: tenant.admin.role }
        : null
    });
  } catch (error) {
    handleServiceError(res, error);
  }
});

// ---------- Login do super-admin ----------
router.post("/api/platform/login", platformLoginLimiter, async (req, res) => {
  try {
    if (!validateBody(platformLoginSchema, req, res)) return;
    const { email, password } = req.body;
    const result = await query(
      "SELECT * FROM platform.platform_users WHERE email = $1",
      [String(email).trim().toLowerCase()]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }
    res.json({
      token: createPlatformToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.get("/api/plans", async (_req, res) => {
  res.json({ trial_days: 7, plans: SUBSCRIPTION_PLANS });
});

// Diretório público de clínicas (para /catalogo sem ?t): lista as clínicas
// ativas e marcadas como listáveis. Público (sem auth), como /api/plans.
router.get("/api/clinics", async (_req, res) => {
  try {
    const result = await query(
      `SELECT name, slug, store_short_name, city, state, logo_url
       FROM platform.tenants
       WHERE status = 'ativo' AND listed = true
       ORDER BY name`
    );
    res.json({ clinics: result.rows });
  } catch (error) {
    handleServiceError(res, error);
  }
});

// ---------- Painel (protegido) ----------
router.get("/api/platform/tenants", requirePlatform, async (_req, res) => {
  try {
    const result = await query(
      `SELECT t.id, t.name, t.slug, t.status, t.plan, t.created_at,
        s.status AS subscription_status,
        s.trial_ends_at,
        s.current_period_ends_at,
        GREATEST(0, CEIL(EXTRACT(EPOCH FROM ((COALESCE(s.trial_ends_at, s.current_period_ends_at)) - NOW())) / 86400))::int AS subscription_days_left
       FROM platform.tenants t
       LEFT JOIN platform.tenant_subscriptions s ON s.tenant_id = t.id
       ORDER BY t.id`
    );
    res.json(result.rows);
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.post("/api/platform/tenants", requirePlatform, async (req, res) => {
  try {
    if (!validateBody(signupSchema, req, res)) return;
    const b = req.body;
    const slug = String(b.slug || "").trim()
      ? String(b.slug).trim().toLowerCase()
      : await generateUniqueSlug(b.name);
    const tenant = await provisionTenant({
      name: b.name,
      slug,
      adminName: b.admin_name,
      adminEmail: b.admin_email,
      adminPassword: b.admin_password,
      phone: b.phone,
      city: b.city,
      state: b.state,
      logoUrl: b.logo_url,
      plan: normalizePlanCode(b.plan_code || b.plan)
    });
    res.status(201).json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan } });
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.patch("/api/platform/tenants/:id", requirePlatform, async (req, res) => {
  try {
    if (!validateBody(tenantStatusSchema, req, res)) return;
    const result = await query(
      "UPDATE platform.tenants SET status = $1 WHERE id = $2 RETURNING id, name, slug, status, plan, created_at",
      [req.body.status, req.params.id]
    );
    const tenant = result.rows[0];
    if (!tenant) return res.status(404).json({ error: "Clínica não encontrada." });
    invalidateTenantCache(tenant.slug);
    res.json(tenant);
  } catch (error) {
    handleServiceError(res, error);
  }
});

// Troca de plano pelo super-admin. Além de trocar o plano, ATIVA a assinatura
// (status 'active' + período de 30 dias) — é a forma de liberar/renovar uma
// clínica cujo trial expirou, já que ainda não há gateway de pagamento.
router.patch("/api/platform/tenants/:id/plan", requirePlatform, async (req, res) => {
  try {
    const planCode = normalizePlanCode(req.body?.plan_code, "");
    if (!planCode) return res.status(400).json({ error: "Plano inválido." });
    const found = await query("SELECT id, slug FROM platform.tenants WHERE id = $1", [req.params.id]);
    const tenant = found.rows[0];
    if (!tenant) return res.status(404).json({ error: "Clínica não encontrada." });
    const periodEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await query("UPDATE platform.tenants SET plan = $1 WHERE id = $2", [planCode, tenant.id]);
    await query(
      `UPDATE platform.tenant_subscriptions
       SET plan_code = $1, status = 'active', current_period_ends_at = $2, updated_at = now()
       WHERE tenant_id = $3`,
      [planCode, periodEnds, tenant.id]
    );
    invalidateSubscriptionCache(tenant.id);
    invalidateTenantCache(tenant.slug);
    res.json({ ok: true, id: tenant.id, plan: planCode, status: "active" });
  } catch (error) {
    handleServiceError(res, error);
  }
});

router.delete("/api/platform/tenants/:id", requirePlatform, async (req, res) => {
  try {
    const result = await query("SELECT id, slug FROM platform.tenants WHERE id = $1", [req.params.id]);
    const tenant = result.rows[0];
    if (!tenant) return res.status(404).json({ error: "Clínica não encontrada." });
    // Exclusão destrutiva: exige digitar o slug como confirmação.
    if (String(req.body?.confirmation || "") !== tenant.slug) {
      return res.status(400).json({
        error: "Confirmação incorreta. Envie o identificador (slug) da clínica no campo 'confirmation'."
      });
    }
    await deprovisionTenant(tenant.id);
    res.json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
});

// Métricas simples por clínica ativa: total de clientes e agendamentos.
router.get("/api/platform/metrics", requirePlatform, async (_req, res) => {
  try {
    const tenants = await query(
      "SELECT id, name, slug, status FROM platform.tenants WHERE status = 'ativo' ORDER BY id"
    );
    const metrics = [];
    for (const tenant of tenants.rows) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "tenant_${tenant.id}", public`);
        const clients = await client.query("SELECT COUNT(*)::int AS total FROM clients");
        const appointments = await client.query("SELECT COUNT(*)::int AS total FROM appointments");
        metrics.push({
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          clients: clients.rows[0].total,
          appointments: appointments.rows[0].total
        });
      } finally {
        try {
          await client.query("SET search_path TO public");
          client.release();
        } catch {
          client.release(true);
        }
      }
    }
    res.json(metrics);
  } catch (error) {
    handleServiceError(res, error);
  }
});

export default router;
