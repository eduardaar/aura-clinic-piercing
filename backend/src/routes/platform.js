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
import { createPlatformToken, verifyPlatformToken } from "../middleware/auth.js";
import { invalidateTenantCache } from "../middleware/tenant.js";
import {
  provisionTenant,
  deprovisionTenant,
  TenantServiceError
} from "../services/tenants.js";
import { validateBody } from "../middleware/validate.js";
import { signupSchema, platformLoginSchema, tenantStatusSchema } from "../schemas/index.js";
import { isProduction } from "../config/index.js";
import { SUBSCRIPTION_PLANS, normalizePlanCode } from "../services/plans.js";

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
    const tenant = await provisionTenant({
      name: b.name,
      slug: b.slug,
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

// ---------- Painel (protegido) ----------
router.get("/api/platform/tenants", requirePlatform, async (_req, res) => {
  try {
    const result = await query(
      "SELECT id, name, slug, status, plan, created_at FROM platform.tenants ORDER BY id"
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
    const tenant = await provisionTenant({
      name: b.name,
      slug: b.slug,
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
