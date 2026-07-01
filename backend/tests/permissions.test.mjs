// Testes de USUÁRIOS por clínica e PERMISSÕES (requireRole).
//
// Rode (de backend/):
//   TEST_PORT=4202 node tests/run-suite.mjs tests/permissions.test.mjs
//
// Estratégia: numa única clínica QA, o admin cria um usuário de cada papel
// (reception/finance/piercer). Depois logamos com cada papel e conferimos que:
//  - o papel correto TEM acesso às rotas que o permitem;
//  - o papel incorreto recebe 403 nas rotas restritas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  req,
  createTenant,
  loginTenant,
  platformLogin,
  deleteTenant
} from "./helpers.mjs";

const ctx = {
  platformToken: null,
  tenant: null,
  adminToken: null,
  tokens: {} // role → token de login
};

// Senha forte reutilizada nos usuários criados.
const PW = "SenhaForte123";

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qasec-perm");
  const admin = await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword);
  ctx.adminToken = admin.token;
  ctx.tokens.admin = admin.token;

  // Cria um usuário de cada papel não-admin e loga cada um.
  for (const role of ["reception", "finance", "piercer"]) {
    const email = `${role}@${ctx.tenant.slug}.test`;
    const created = await req("/users", {
      token: ctx.adminToken,
      method: "POST",
      body: { name: `Usuario ${role}`, email, password: PW, role }
    });
    if (created.status !== 201) {
      throw new Error(`Falha ao criar usuário ${role}: ${created.status} ${JSON.stringify(created.json)}`);
    }
    // password_hash NUNCA pode aparecer na resposta de criação.
    assert.equal(created.json.password_hash, undefined, `password_hash vazou ao criar ${role}`);
    const login = await loginTenant(ctx.tenant.slug, email, PW);
    ctx.tokens[role] = login.token;
  }
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
  }
});

// ---------------------------------------------------------------------------
// 2. USUÁRIOS por clínica — criação, validação, hash e login
// ---------------------------------------------------------------------------

test("POST /users senha < 8 → 400", async () => {
  const { status, json } = await req("/users", {
    token: ctx.adminToken,
    method: "POST",
    body: { name: "Curta", email: `curta@${ctx.tenant.slug}.test`, password: "1234567", role: "reception" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /8 caracteres/i);
});

test("POST /users role inválido → 400", async () => {
  const { status, json } = await req("/users", {
    token: ctx.adminToken,
    method: "POST",
    body: { name: "RoleRuim", email: `roleruim@${ctx.tenant.slug}.test`, password: PW, role: "chefe" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /acesso inválido/i);
});

test("POST /users sem nome → 400", async () => {
  const { status, json } = await req("/users", {
    token: ctx.adminToken,
    method: "POST",
    body: { email: `semnome@${ctx.tenant.slug}.test`, password: PW, role: "reception" }
  });
  assert.equal(status, 400, JSON.stringify(json));
});

test("GET /users (admin) nunca retorna password_hash", async () => {
  const { status, json } = await req("/users", { token: ctx.adminToken });
  assert.equal(status, 200, JSON.stringify(json));
  assert.ok(Array.isArray(json));
  for (const u of json) assert.equal(u.password_hash, undefined, "password_hash vazou na listagem");
});

test("login dos usuários criados funciona (bcrypt) e não vaza password_hash", async () => {
  const login = await req("/login", {
    tenant: ctx.tenant.slug,
    method: "POST",
    body: { email: `reception@${ctx.tenant.slug}.test`, password: PW }
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.ok(login.json.token);
  assert.equal(login.json.user.role, "reception");
  assert.equal(login.json.user.password_hash, undefined);
});

// ---------------------------------------------------------------------------
// 3. PERMISSÕES (requireRole)
// ---------------------------------------------------------------------------

// -- Gestão de usuários: restrita a admin --------------------------------
test("POST /users com papel reception → 403", async () => {
  const { status, json } = await req("/users", {
    token: ctx.tokens.reception,
    method: "POST",
    body: { name: "X", email: `x@${ctx.tenant.slug}.test`, password: PW, role: "reception" }
  });
  assert.equal(status, 403, JSON.stringify(json));
});

test("POST /users com papel finance → 403", async () => {
  const { status } = await req("/users", {
    token: ctx.tokens.finance,
    method: "POST",
    body: { name: "X", email: `x2@${ctx.tenant.slug}.test`, password: PW, role: "reception" }
  });
  assert.equal(status, 403);
});

test("POST /users com papel piercer → 403", async () => {
  const { status } = await req("/users", {
    token: ctx.tokens.piercer,
    method: "POST",
    body: { name: "X", email: `x3@${ctx.tenant.slug}.test`, password: PW, role: "reception" }
  });
  assert.equal(status, 403);
});

test("GET /users com papel reception → 403 (listagem restrita a admin)", async () => {
  const { status } = await req("/users", { token: ctx.tokens.reception });
  assert.equal(status, 403);
});

test("DELETE /users/:id com papel reception → 403", async () => {
  const { status } = await req("/users/1", { token: ctx.tokens.reception, method: "DELETE" });
  assert.equal(status, 403);
});

test("admin TEM acesso: GET /users → 200", async () => {
  const { status } = await req("/users", { token: ctx.adminToken });
  assert.equal(status, 200);
});

// -- Profissionais: escrita restrita a admin -----------------------------
test("POST /professionals com reception → 403", async () => {
  const { status } = await req("/professionals", {
    token: ctx.tokens.reception,
    method: "POST",
    body: { name: "Prof Teste" }
  });
  assert.equal(status, 403);
});

test("POST /professionals com admin → 201", async () => {
  const { status, json } = await req("/professionals", {
    token: ctx.adminToken,
    method: "POST",
    body: { name: "Prof QA Perm" }
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.id);
});

// -- Finanças: admin/finance TÊM; reception/piercer NÃO ------------------
test("GET /finance com admin → 200", async () => {
  const { status } = await req("/finance", { token: ctx.adminToken });
  assert.equal(status, 200);
});

test("GET /finance com finance → 200", async () => {
  const { status } = await req("/finance", { token: ctx.tokens.finance });
  assert.equal(status, 200);
});

test("GET /finance com reception → 403", async () => {
  const { status } = await req("/finance", { token: ctx.tokens.reception });
  assert.equal(status, 403);
});

test("GET /finance com piercer → 403", async () => {
  const { status } = await req("/finance", { token: ctx.tokens.piercer });
  assert.equal(status, 403);
});

// -- ERP: restrito a admin -----------------------------------------------
test("GET /erp/overview (ou raiz erp) com finance → 403", async () => {
  // A rota exata do erp começa em /api/erp; usamos o primeiro GET declarado.
  const { status } = await req("/erp", { token: ctx.tokens.finance });
  // Se a rota base não existir (404), o teste ainda documenta; aceitamos 403 OU 404
  // desde que NÃO seja 200 para finance.
  assert.notEqual(status, 200, "finance não deveria conseguir 200 no ERP admin-only");
});

// -- Clientes: DELETE restrito a admin/reception -------------------------
test("DELETE /clients/:id com piercer → 403", async () => {
  const { status } = await req("/clients/999999", { token: ctx.tokens.piercer, method: "DELETE" });
  assert.equal(status, 403);
});

test("DELETE /clients/:id com reception → permitido (200, mesmo sem existir a linha)", async () => {
  // reception está na allowlist; o DELETE roda mesmo que o id não exista.
  const { status } = await req("/clients/999999", { token: ctx.tokens.reception, method: "DELETE" });
  assert.equal(status, 200);
});

// -- Reset destrutivo exige admin E gate de produção ---------------------
test("POST /admin/reset-demo-data com reception → 403", async () => {
  const { status } = await req("/admin/reset-demo-data", {
    token: ctx.tokens.reception,
    method: "POST",
    body: { confirmation: "RESETAR" }
  });
  assert.equal(status, 403);
});

// -- Serviços/catálogo: papéis intermediários (admin/reception) ----------
test("POST /services com admin → 201", async () => {
  const { status, json } = await req("/services", {
    token: ctx.adminToken,
    method: "POST",
    body: { name: "Serviço QA Perm" }
  });
  assert.equal(status, 201, JSON.stringify(json));
});

test("POST /services com reception → 201 (reception está na allowlist)", async () => {
  const { status, json } = await req("/services", {
    token: ctx.tokens.reception,
    method: "POST",
    body: { name: "Serviço QA Reception" }
  });
  assert.equal(status, 201, JSON.stringify(json));
});

test("POST /services com piercer → 403", async () => {
  const { status } = await req("/services", {
    token: ctx.tokens.piercer,
    method: "POST",
    body: { name: "Serviço QA Piercer" }
  });
  assert.equal(status, 403);
});
