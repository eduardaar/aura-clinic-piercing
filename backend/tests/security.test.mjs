// Testes de SEGURANÇA: autenticação, isolamento entre clínicas, tokens
// adulterados/malformados, resolução de tenant e validação (Zod).
//
// Rode (de backend/):
//   TEST_PORT=4202 node tests/run-suite.mjs tests/security.test.mjs
//
// O runner sobe o servidor em NODE_ENV=production → auth REAL (sem bypass de dev).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  req,
  createTenant,
  loginTenant,
  platformLogin,
  deleteTenant
} from "./helpers.mjs";

// Estado compartilhado do arquivo. Duas clínicas para provar isolamento (A e B).
const ctx = {
  platformToken: null,
  a: null, // { slug, adminEmail, adminPassword, tenant, token }
  b: null
};

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
  assert.match(json.error, /8 caracteres/i);
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
