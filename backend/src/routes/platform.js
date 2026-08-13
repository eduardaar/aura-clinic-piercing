// Rotas de plataforma (multi-tenant): cadastro público de clínicas (signup),
// login do super-admin e painel de administração dos tenants.
//
// IMPORTANTE: estas rotas NÃO usam withDb — operam apenas no schema de
// controle `platform` via query() global (sempre com prefixo platform.) e,
// quando precisam olhar dentro de um tenant (métricas), usam um client
// dedicado com SET search_path + reset.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { clientIp } from "../middleware/rateLimit.js";
import { checkAccess, registerFailure, registerSuccess } from "../services/loginGuard.js";
import bcrypt from "bcryptjs";
import { pool, query } from "../database/connection.js";
import { createDb } from "../db/postgres.js";
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
import { PLAN_FEATURES, listPlans, normalizePlanCode, planByCode } from "../services/plans.js";
import { subscriptionSyncWarning, syncSubscriptionPrice } from "../services/platformBilling.js";
import { invalidateSubscriptionCache } from "../services/subscriptions.js";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, otpauthUri, verifyTotp } from "../services/totp.js";
import { createClinicSession, setRefreshCookie } from "../services/sessions.js";

const router = Router();

// Rate limit estrito do signup público: 5 cadastros/hora por IP.
// Desliga rate limit apenas na suíte de testes (nunca em produção).
const skipRateLimit = () => process.env.DISABLE_RATE_LIMIT === "true";

async function validateLegalAcceptance(acceptances) {
  const received = acceptances && typeof acceptances === "object" ? acceptances : {};
  const result = await query(
    "SELECT document_key, version FROM platform.legal_documents WHERE document_key IN ('terms_of_use', 'privacy_policy')"
  );
  const current = Object.fromEntries(result.rows.map((row) => [row.document_key, Number(row.version)]));
  const valid = current.terms_of_use
    && current.privacy_policy
    && Number(received.terms_of_use) === current.terms_of_use
    && Number(received.privacy_policy) === current.privacy_policy;
  return { valid, current };
}

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
    const legal = await validateLegalAcceptance(b.legal_acceptances);
    if (!legal.valid) {
      return res.status(400).json({
        error: "Leia e aceite os Termos de Uso e a Política de Privacidade para continuar.",
        code: "legal_acceptance_required",
        documents: legal.current
      });
    }
    // Cadastro público: o slug não é digitado — deriva-se do nome da clínica.
    const slug = String(b.slug || "").trim()
      ? String(b.slug).trim().toLowerCase()
      : await generateUniqueSlug(b.name);
    // Plano desativado não pode ser assinado pelo cadastro público.
    //
    // A vitrine já só mostra os ativos, mas o código do plano vem do CORPO da
    // requisição: sem esta checagem, quem enviasse na mão o código de um plano
    // tirado de linha assinaria mesmo assim. Recusar é melhor que trocar em
    // silêncio por outro — a pessoa acharia que contratou o que pediu.
    //
    // A rota equivalente do super-admin (POST /api/platform/tenants) NÃO tem
    // esta guarda de propósito: atribuir um plano fora de linha é justamente
    // como se honra um contrato antigo ou um acordo especial.
    const planoPedido = String(b.plan_code || b.plan || "").trim().toLowerCase();
    const planCode = normalizePlanCode(planoPedido);
    if (planoPedido && planByCode(planCode).is_active === false) {
      return res.status(400).json({
        error: "Este plano não está mais disponível para contratação.",
        code: "plano_indisponivel"
      });
    }
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
      plan: planCode
    });
    // Login automático: emite um token de clínica para o admin recém-criado,
    // evitando que o usuário tenha de fazer login de novo digitando o slug.
    let token = null;
    if (tenant.admin) {
      // O cadastro também entra pelo fluxo de sessão persistida; devolver só o
      // access token aqui faria o login automático falhar na primeira rota
      // protegida, pois todo token de clínica precisa de uma sessão ativa.
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "tenant_${Number(tenant.id)}", public`);
        const session = await createClinicSession(createDb(client), tenant.admin, req);
        setRefreshCookie(res, session.refreshToken);
        token = createToken(tenant.admin, tenant, { sessionId: session.id });
      } finally {
        try { await client.query("SET search_path TO public"); client.release(); } catch { client.release(true); }
      }
    }
    await query(
      `INSERT INTO platform.legal_acceptances (tenant_id, user_email, document_key, document_version, ip_address, user_agent)
       VALUES ($1, $2, 'terms_of_use', $3, $4, $5), ($1, $2, 'privacy_policy', $6, $4, $5)`,
      [tenant.id, String(b.admin_email).trim().toLowerCase(), legal.current.terms_of_use, clientIp(req), req.get("user-agent") || null, legal.current.privacy_policy]
    );
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
// Além do rate limit por janela, passa pelo loginGuard: 5 falhas bloqueiam o IP
// por 15 min; dois bloqueios viram ban permanente em platform.blocked_ips, que
// só sai por remoção manual (ver backend/src/services/loginGuard.js).
router.post("/api/platform/login", platformLoginLimiter, async (req, res) => {
  const ip = clientIp(req);
  try {
    const access = await checkAccess(ip);
    if (!access.allowed) {
      if (access.retryAfterSeconds) res.set("Retry-After", String(access.retryAfterSeconds));
      return res.status(access.status).json({ error: access.error });
    }

    if (!validateBody(platformLoginSchema, req, res)) return;
    const { email, password } = req.body;
    const result = await query(
      "SELECT * FROM platform.platform_users WHERE email = $1",
      [String(email).trim().toLowerCase()]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      // Conta a falha DEPOIS de responder o mesmo erro genérico de sempre — a
      // resposta não muda conforme o IP se aproxima do bloqueio.
      await registerFailure(ip, { userAgent: req.headers["user-agent"], email });
      return res.status(401).json({ error: "Credenciais inválidas." });
    }
    if (user.mfa_enabled) {
      const secret = decryptTotpSecret(user.mfa_totp_secret_encrypted);
      if (!secret || !verifyTotp(secret, req.body?.mfa_code)) {
        return res.status(401).json({ error: "Informe o código do seu autenticador.", code: "mfa_required" });
      }
    }
    await registerSuccess(ip);
    res.json({
      token: createPlatformToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    handleServiceError(res, error);
  }
});

// O painel de plataforma é o acesso de maior privilégio. A configuração é
// separada da clínica, com segredo cifrado no schema `platform`.
router.get("/api/platform/mfa", requirePlatform, async (req, res) => {
  try {
    const result = await query("SELECT mfa_enabled FROM platform.platform_users WHERE id = $1", [req.platformUser.sub]);
    res.json({ enabled: Boolean(result.rows[0]?.mfa_enabled) });
  } catch (error) { handleServiceError(res, error); }
});

router.post("/api/platform/mfa/setup", requirePlatform, async (req, res) => {
  try {
    const result = await query("SELECT id, email, password_hash FROM platform.platform_users WHERE id = $1", [req.platformUser.sub]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(String(req.body?.current_password || ""), user.password_hash))) {
      return res.status(400).json({ error: "Confirme sua senha atual para configurar o autenticador." });
    }
    const secret = generateTotpSecret();
    await query("UPDATE platform.platform_users SET mfa_totp_secret_encrypted = $1, mfa_enabled = false WHERE id = $2", [encryptTotpSecret(secret), user.id]);
    res.json({ secret, otpauth_url: otpauthUri({ secret, email: user.email, issuer: "Aura Platform" }) });
  } catch (error) { handleServiceError(res, error); }
});

router.post("/api/platform/mfa/verify", requirePlatform, async (req, res) => {
  try {
    const result = await query("SELECT mfa_totp_secret_encrypted FROM platform.platform_users WHERE id = $1", [req.platformUser.sub]);
    const secret = decryptTotpSecret(result.rows[0]?.mfa_totp_secret_encrypted);
    if (!secret || !verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: "Código do autenticador inválido." });
    await query("UPDATE platform.platform_users SET mfa_enabled = true, session_version = session_version + 1 WHERE id = $1", [req.platformUser.sub]);
    res.json({ ok: true, enabled: true });
  } catch (error) { handleServiceError(res, error); }
});

// Vitrine pública de planos (landing e cadastro).
//
// `onlyActive` é o que dá sentido a desativar um plano no painel: sem ele, o
// plano some da lista administrativa mas continua sendo oferecido a quem chega
// pela landing — e alguém assinaria um plano que a Monitence tirou de linha.
router.get("/api/plans", async (_req, res) => {
  res.json({ trial_days: 7, plans: listPlans({ onlyActive: true }) });
});

// Diretório público de clínicas (/catalogo e /agendar sem ?t): lista as
// clínicas ativas e marcadas como listáveis. Público (sem auth), como /api/plans.
//
// `has_booking` é derivado do plano — só quem tem a feature `online_booking`
// aparece no diretório de agendamento. O cálculo fica aqui, e não no frontend,
// para não expor o mapa de features por plano numa rota pública.
router.get("/api/clinics", async (_req, res) => {
  try {
    const result = await query(
      `SELECT name, slug, store_short_name, city, state, logo_url, plan, created_at
       FROM platform.tenants
       WHERE status = 'ativo' AND listed = true
       ORDER BY name`
    );
    const clinics = result.rows.map(({ plan, ...clinic }) => ({
      ...clinic,
      has_booking: (PLAN_FEATURES[normalizePlanCode(plan)] || []).includes("online_booking")
    }));
    res.json({ clinics });
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
// clínica cujo trial expirou sem passar pelo gateway.
//
// O reajuste da recorrência no Asaas acontece aqui também, e não só na rota
// equivalente de `/api/platform/accounts/:id/plan`: as duas trocam o plano de
// verdade, e uma delas que não propagasse deixaria a clínica no plano novo
// pagando o preço velho — exatamente o buraco que a propagação veio tapar. É
// best-effort e vem DEPOIS da escrita: gateway fora do ar não pode impedir a
// liberação de uma clínica.
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

    const gateway = await syncSubscriptionPrice(tenant.id);
    res.json({
      ok: true,
      id: tenant.id,
      plan: planCode,
      status: "active",
      gateway,
      warning: subscriptionSyncWarning(gateway)
    });
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
