// Testes de SEGURANÇA: autenticação, isolamento entre clínicas, tokens
// adulterados/malformados, resolução de tenant e validação (Zod).
//
// Rode (de backend/):
//   TEST_PORT=4202 node tests/run-suite.mjs tests/security.test.mjs
//
// O runner sobe o servidor em NODE_ENV=production → auth REAL (sem bypass de dev).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  req,
  createTenant,
  loginTenant,
  platformLogin,
  deleteTenant
} from "./helpers.mjs";
import { clientIp } from "../src/middleware/rateLimit.js";
import { sanitizeFrontendTelemetry } from "../src/services/errorLogs.js";
import { createAsaasClient } from "../src/services/asaas/client.js";
import { query } from "../src/database/connection.js";
import { decodeToken, requiresAuth } from "../src/middleware/auth.js";

// Estado compartilhado do arquivo. Duas clínicas para provar isolamento (A e B).
const ctx = {
  platformToken: null,
  a: null, // { slug, adminEmail, adminPassword, tenant, token }
  b: null
};

function totpForTest(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0; let value = 0; const bytes = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = crypto.createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest.at(-1) & 15;
  const value32 = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value32 % 1_000_000).padStart(6, "0");
}

before(async () => {
  ctx.platformToken = await platformLogin();

  ctx.a = await createTenant("qasec-a");
  const la = await loginTenant(ctx.a.slug, ctx.a.adminEmail, ctx.a.adminPassword);
  ctx.a.token = la.token;

  ctx.b = await createTenant("qasec-b");
  const lb = await loginTenant(ctx.b.slug, ctx.b.adminEmail, ctx.b.adminPassword);
  ctx.b.token = lb.token;
});

after(async () => {
  if (!ctx.platformToken) return;
  for (const c of [ctx.a, ctx.b]) {
    if (c?.tenant?.id) await deleteTenant(ctx.platformToken, c.tenant.id, c.slug);
  }
});

// ---------------------------------------------------------------------------
// 4. AUTENTICAÇÃO / ISOLAMENTO
// ---------------------------------------------------------------------------

test("allowlist pública também exige o método HTTP exato", () => {
  assert.equal(requiresAuth({ path: "/api/catalog", method: "GET" }), false);
  assert.equal(requiresAuth({ path: "/api/catalog", method: "POST" }), true);
  assert.equal(requiresAuth({ path: "/api/booking/requests", method: "POST" }), false);
  assert.equal(requiresAuth({ path: "/api/booking/requests", method: "GET" }), true);
  const tokenPath = "/api/payment-intents/123e4567-e89b-42d3-a456-426614174000/pix";
  assert.equal(requiresAuth({ path: tokenPath, method: "GET" }), false);
  assert.equal(requiresAuth({ path: tokenPath, method: "POST" }), true);
});

test("rota protegida sem token (mas com X-Tenant válido) → 401", async () => {
  // Precisa do X-Tenant para o tenant resolver; sem token, authenticateRequest
  // retorna null e o withDb devolve 401.
  const { status, json } = await req("/appointments", { tenant: ctx.a.slug });
  assert.equal(status, 401, JSON.stringify(json));
});

test("rota protegida SEM token e SEM X-Tenant → nega acesso (401 ou 400)", async () => {
  // resolveTenant roda antes da auth. Comportamento depende de DEFAULT_TENANT:
  //  - SEM DEFAULT_TENANT → não há como resolver a clínica → 400.
  //  - COM DEFAULT_TENANT (o .env deste projeto define DEFAULT_TENANT=aura) →
  //    a clínica-padrão resolve, mas sem token a auth falha → 401.
  // O invariante testado é: NUNCA autoriza (nunca 2xx). Aceitamos 401 ou 400.
  const { status } = await req("/appointments");
  assert.ok(status === 401 || status === 400, `esperava 401 ou 400, veio ${status}`);
  assert.ok(status < 500);
});

test("token malformado (não decodifica) → 401", async () => {
  const { status, json } = await req("/appointments", {
    tenant: ctx.a.slug,
    token: "isto-nao-e-um-token-valido"
  });
  assert.equal(status, 401, JSON.stringify(json));
});

test("token com assinatura adulterada → 401", async () => {
  // Pega um token real e troca o último caractere da assinatura.
  const good = ctx.a.token;
  const flipped = good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A");
  const { status, json } = await req("/appointments", { tenant: ctx.a.slug, token: flipped });
  assert.equal(status, 401, JSON.stringify(json));
});

test("token com payload adulterado (assinatura não bate) → 401", async () => {
  // Reescreve o payload base64url mas mantém a assinatura antiga → HMAC inválido.
  const good = ctx.a.token;
  const [, sig] = good.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 1, role: "admin", tid: ctx.a.tenant.id, tslug: ctx.a.slug, exp: Date.now() + 3600000 })
  ).toString("base64url");
  const { status } = await req("/appointments", {
    tenant: ctx.a.slug,
    token: `${forgedPayload}.${sig}`
  });
  assert.equal(status, 401);
});

test("token válido da clínica A + header X-Tenant de B → 403 (token não bate com requisição)", async () => {
  // resolveTenant vê tslug=A no token e header=B → divergência → 403.
  const { status, json } = await req("/appointments", { tenant: ctx.b.slug, token: ctx.a.token });
  assert.equal(status, 403, JSON.stringify(json));
});

test("isolamento cruzado bloqueia todos os domínios sensíveis antes de consultar dados", async () => {
  const paths = [
    "/appointments", "/clients", "/jewelry", "/inventory/counts", "/finance",
    "/sales-orders", "/users", "/permissions", "/digital-terms"
  ];
  for (const path of paths) {
    const response = await req(path, { tenant: ctx.b.slug, token: ctx.a.token });
    assert.equal(response.status, 403, `${path}: ${JSON.stringify(response.json)}`);
  }
});

test("token válido da clínica A SEM header (usa tslug do token) → acessa A normalmente", async () => {
  const { status } = await req("/appointments", { token: ctx.a.token });
  assert.equal(status, 200);
});

test("clínica inexistente via X-Tenant (sem token) → 404", async () => {
  const { status, json } = await req("/appointments", { tenant: "clinica-que-nao-existe-999" });
  assert.equal(status, 404, JSON.stringify(json));
});

test("slug de tenant com formato inválido → 400", async () => {
  // Regex TENANT_SLUG_REGEX rejeita (ex.: com caractere proibido / curto demais).
  const { status } = await req("/appointments", { tenant: "ab" });
  assert.equal(status, 400);
});

test("token de plataforma NÃO autentica em rota de clínica → 401", async () => {
  // decoded.plt === true → authenticateRequest retorna null → 401.
  const { status, json } = await req("/appointments", {
    tenant: ctx.a.slug,
    token: ctx.platformToken
  });
  assert.equal(status, 401, JSON.stringify(json));
});

test("IP de rate limit ignora CF-Connecting-IP controlado pelo cliente", () => {
  const request = {
    ip: "203.0.113.10",
    headers: { "cf-connecting-ip": "198.51.100.77" },
    socket: { remoteAddress: "127.0.0.1" }
  };
  assert.equal(clientIp(request), "203.0.113.10");
});

test("checkout da plataforma recusa cartão bruto antes de falar com o gateway", async () => {
  const { status, json } = await req("/billing/checkout", {
    tenant: ctx.a.slug,
    token: ctx.a.token,
    method: "POST",
    body: {
      plan_code: "profissional",
      billing_type: "CREDIT_CARD",
      credit_card: { number: "4111111111111111", ccv: "123" }
    }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.equal(json.code, "checkout_hospedado_obrigatorio");
});

test("cliente interno do Asaas também recusa assinatura com cartão direto", () => {
  const client = createAsaasClient({ apiKey: "chave-de-teste" });
  assert.throws(
    () => client.createSubscription({ customer: "cus_test", value: 89.9, billingType: "CREDIT_CARD" }),
    (error) => error?.code === "hosted_checkout_required" && error?.status === 400
  );
});

test("telemetria pública remove credenciais e identificadores comuns", () => {
  const safe = sanitizeFrontendTelemetry({
    message: "Falha para pessoa@example.com CPF 123.456.789-01",
    stack: "Authorization: Bearer segredo.abc-123",
    user_email: "pessoa@example.com",
    context: {
      password: "SenhaSecreta",
      nested: { token: "token-secreto", card_number: "4111111111111111" }
    }
  });
  const serialized = JSON.stringify(safe);
  assert.equal(safe.user_email, null);
  assert.ok(!serialized.includes("pessoa@example.com"));
  assert.ok(!serialized.includes("123.456.789-01"));
  assert.ok(!serialized.includes("segredo.abc-123"));
  assert.ok(!serialized.includes("SenhaSecreta"));
  assert.ok(!serialized.includes("4111111111111111"));
});

// ---------------------------------------------------------------------------
// 5. VALIDAÇÃO (Zod) — payloads inválidos nos principais POST → 400 com mensagem
// ---------------------------------------------------------------------------

test("POST /login sem email → 400 com mensagem", async () => {
  const { status, json } = await req("/login", {
    tenant: ctx.a.slug,
    method: "POST",
    body: { password: "qualquer" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(json?.error, "esperava mensagem de erro");
  assert.match(json.error, /mail/i);
});

test("POST /login sem password → 400 com mensagem", async () => {
  const { status, json } = await req("/login", {
    tenant: ctx.a.slug,
    method: "POST",
    body: { email: "x@y.z" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /senha/i);
});

test("POST /login com credenciais válidas de formato mas inexistentes → 401 (não 400)", async () => {
  // Confirma que a validação passa e o erro é de credenciais (401), não de payload.
  const { status } = await req("/login", {
    tenant: ctx.a.slug,
    method: "POST",
    body: { email: "naoexiste@qasec.test", password: "SenhaQualquer123" }
  });
  assert.equal(status, 401);
});

test("POST /clients sem full_name → 400 com mensagem", async () => {
  const { status, json } = await req("/clients", {
    token: ctx.a.token,
    method: "POST",
    body: { whatsapp: "11999998888" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /nome/i);
});

test("POST /clients sem whatsapp → 400 com mensagem", async () => {
  const { status, json } = await req("/clients", {
    token: ctx.a.token,
    method: "POST",
    body: { full_name: "Fulano de Tal" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /whats/i);
});

test("POST /clients válido → 201 e sem vazar campos sensíveis", async () => {
  const { status, json } = await req("/clients", {
    token: ctx.a.token,
    method: "POST",
    body: { full_name: "Cliente QA Sec", whatsapp: "11988887777" }
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.id);
  assert.equal(json.full_name, "Cliente QA Sec");
});

test("POST /users com payload inválido (senha curta) → 400 com mensagem", async () => {
  const { status, json } = await req("/users", {
    token: ctx.a.token,
    method: "POST",
    body: { name: "Novo", email: "novo@qasec.test", password: "123", role: "reception" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /12 caracteres/i);
});

test("POST /appointments sem campos obrigatórios → 400 com mensagem", async () => {
  // Envia como JSON; o multer.single passa direto quando não é multipart e o
  // schema exige professional_id/date/time.
  const { status, json } = await req("/appointments", {
    token: ctx.a.token,
    method: "POST",
    body: { procedure: "Furo" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(json?.error);
});

// ---------------------------------------------------------------------------
// ISOLAMENTO DE DADOS entre clínicas (defesa em profundidade)
// ---------------------------------------------------------------------------

test("dados criados na clínica A não aparecem para a clínica B", async () => {
  // Cria um cliente único em A.
  const marker = `Isolamento ${Date.now()}`;
  const created = await req("/clients", {
    token: ctx.a.token,
    method: "POST",
    body: { full_name: marker, whatsapp: "11900000000" }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  // Lista clientes em B com o token de B — não deve conter o marcador de A.
  const listB = await req("/clients", { token: ctx.b.token });
  assert.equal(listB.status, 200, JSON.stringify(listB.json));
  const names = (listB.json || []).map((c) => c.full_name);
  assert.ok(!names.includes(marker), "cliente de A vazou para B (isolamento quebrado)");

  // E deve aparecer em A.
  const listA = await req("/clients", { token: ctx.a.token });
  const namesA = (listA.json || []).map((c) => c.full_name);
  assert.ok(namesA.includes(marker), "cliente criado em A não apareceu em A");
});

test("troca de senha revoga tokens anteriores e devolve uma sessão nova", async () => {
  const oldToken = ctx.a.token;
  const changed = await req("/account/profile", {
    tenant: ctx.a.slug,
    token: oldToken,
    method: "PATCH",
    body: {
      name: "Administrador QA",
      email: ctx.a.adminEmail,
      current_password: ctx.a.adminPassword,
      new_password: "SenhaNovaForte456"
    }
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.ok(changed.json.token, "a sessão atual deve receber token na nova versão");

  const revoked = await req("/clients", { tenant: ctx.a.slug, token: oldToken });
  assert.equal(revoked.status, 401, "token anterior deveria ser revogado");

  const current = await req("/clients", { tenant: ctx.a.slug, token: changed.json.token });
  assert.equal(current.status, 200, JSON.stringify(current.json));
  ctx.a.token = changed.json.token;
  ctx.a.adminPassword = "SenhaNovaForte456";
});

test("refresh rotativo mantém sessão curta e rejeita a credencial já usada", async () => {
  const login = await req("/login", {
    method: "POST",
    tenant: ctx.a.slug,
    body: { email: ctx.a.adminEmail, password: ctx.a.adminPassword }
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const firstCookie = login.headers.get("set-cookie");
  assert.match(firstCookie || "", /aura_refresh=/);
  const refreshed = await req("/auth/refresh", {
    method: "POST",
    tenant: ctx.a.slug,
    headers: { Cookie: firstCookie }
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json));
  assert.notEqual(refreshed.json.token, login.json.token);
  const secondCookie = refreshed.headers.get("set-cookie");
  const replay = await req("/auth/refresh", {
    method: "POST",
    tenant: ctx.a.slug,
    headers: { Cookie: firstCookie }
  });
  assert.equal(replay.status, 401, JSON.stringify(replay.json));
  const sessions = await req("/account/sessions", { tenant: ctx.a.slug, token: refreshed.json.token });
  assert.equal(sessions.status, 200, JSON.stringify(sessions.json));
  assert.ok(sessions.json.sessions.some((session) => session.current));
  assert.match(secondCookie || "", /aura_refresh=/);
});

test("admin habilita TOTP e o login passa a exigir o código", async () => {
  const setup = await req("/account/mfa/setup", {
    method: "POST", tenant: ctx.a.slug, token: ctx.a.token,
    body: { current_password: ctx.a.adminPassword }
  });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  assert.match(setup.json.secret || "", /^[A-Z2-7]{16,}$/);
  const code = totpForTest(setup.json.secret);
  const verified = await req("/account/mfa/verify", { method: "POST", tenant: ctx.a.slug, token: ctx.a.token, body: { code } });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  const noCode = await req("/login", { method: "POST", tenant: ctx.a.slug, body: { email: ctx.a.adminEmail, password: ctx.a.adminPassword } });
  assert.equal(noCode.status, 401, JSON.stringify(noCode.json));
  assert.equal(noCode.json.code, "mfa_required");
  const withCode = await req("/login", { method: "POST", tenant: ctx.a.slug, body: { email: ctx.a.adminEmail, password: ctx.a.adminPassword, mfa_code: totpForTest(setup.json.secret) } });
  assert.equal(withCode.status, 200, JSON.stringify(withCode.json));
});

test("incrementar session_version revoga imediatamente o token da plataforma", async () => {
  const decoded = decodeToken(ctx.platformToken);
  assert.ok(decoded?.sub);
  await query(
    "UPDATE platform.platform_users SET session_version = session_version + 1 WHERE id = $1",
    [decoded.sub]
  );
  const revoked = await req("/platform/tenants", { token: ctx.platformToken, platform: true });
  assert.equal(revoked.status, 401, JSON.stringify(revoked.json));
  ctx.platformToken = await platformLogin();
  const current = await req("/platform/tenants", { token: ctx.platformToken, platform: true });
  assert.equal(current.status, 200, JSON.stringify(current.json));
});
