// Testes de PLATAFORMA (superadmin) e ADMIN destrutivo.
//
// Rode (de backend/):
//   TEST_PORT=4202 node tests/run-suite.mjs tests/admin.test.mjs
//
// Cobre o ciclo de vida do tenant no painel de plataforma (criar/listar/
// suspender/reativar/excluir), as proteções de autorização das rotas de
// plataforma e o reset destrutivo bloqueado em produção.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  req,
  createTenant,
  loginTenant,
  platformLogin,
  deleteTenant,
  testSlug
} from "./helpers.mjs";
import { query } from "../src/database/connection.js";

const ctx = {
  platformToken: null,
  tenantToken: null, // token de um usuário de clínica (NÃO plataforma)
  tenantAdminEmail: null,
  tenantAdminPassword: null,
  managed: [] // tenants criados via painel para limpar no after
};

before(async () => {
  ctx.platformToken = await platformLogin();
  // Um tenant "normal" para provar que seu token não abre rotas de plataforma.
  const t = await createTenant("qasec-tk");
  ctx.tenantSlug = t.slug;
  ctx.tenantId = t.tenant.id;
  ctx.tenantAdminEmail = t.adminEmail;
  ctx.tenantAdminPassword = t.adminPassword;
  const login = await loginTenant(t.slug, t.adminEmail, t.adminPassword);
  ctx.tenantToken = login.token;
  ctx.managed.push({ id: t.tenant.id, slug: t.slug });
});

after(async () => {
  if (!ctx.platformToken) return;
  for (const t of ctx.managed) {
    await deleteTenant(ctx.platformToken, t.id, t.slug);
  }
});

// Helper local para chamar rotas de plataforma com o token de superadmin.
function platformReq(path, opts = {}) {
  return req(path, { token: ctx.platformToken, platform: true, ...opts });
}

// ---------------------------------------------------------------------------
// 1. AUTORIZAÇÃO das rotas de plataforma
// ---------------------------------------------------------------------------

test("GET /platform/tenants sem token → 401", async () => {
  const { status } = await req("/platform/tenants");
  assert.equal(status, 401);
});

test("GET /platform/tenants com token de tenant (não-plataforma) → 401", async () => {
  const { status, json } = await req("/platform/tenants", { token: ctx.tenantToken });
  assert.equal(status, 401, JSON.stringify(json));
});

test("GET /platform/tenants com token de superadmin → 200 e lista", async () => {
  const { status, json } = await platformReq("/platform/tenants");
  assert.equal(status, 200, JSON.stringify(json));
  assert.ok(Array.isArray(json));
  // password_hash nunca deve aparecer na listagem.
  for (const t of json) assert.equal(t.password_hash, undefined);
});

test("POST /platform/login com senha errada → 401", async () => {
  const { status } = await req("/platform/login", {
    method: "POST",
    body: { email: "superadmin@aura.local", password: "senha-errada" }
  });
  assert.equal(status, 401);
});

// ---------------------------------------------------------------------------
// Ciclo de vida do tenant via painel de plataforma
// ---------------------------------------------------------------------------

test("POST /platform/tenants cria clínica (201)", async () => {
  const slug = testSlug("qasec-mng");
  const { status, json } = await platformReq("/platform/tenants", {
    method: "POST",
    body: {
      name: `Clinica ${slug}`,
      slug,
      admin_email: `admin@${slug}.test`,
      admin_password: "SenhaForte123"
    }
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.tenant?.id);
  ctx.managed.push({ id: json.tenant.id, slug });
  ctx.lifecycle = { id: json.tenant.id, slug, adminEmail: `admin@${slug}.test`, adminPassword: "SenhaForte123" };
});

test("clínica recém-criada consegue logar", async () => {
  const l = ctx.lifecycle;
  const login = await loginTenant(l.slug, l.adminEmail, l.adminPassword);
  assert.ok(login.token);
});

test("PATCH /platform/tenants/:id suspende a clínica (status=suspenso)", async () => {
  const l = ctx.lifecycle;
  const { status, json } = await platformReq(`/platform/tenants/${l.id}`, {
    method: "PATCH",
    body: { status: "suspenso" }
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.status, "suspenso");
});

test("clínica suspensa → login retorna 403 'suspensa'", async () => {
  const l = ctx.lifecycle;
  const { status, json } = await req("/login", {
    tenant: l.slug,
    method: "POST",
    body: { email: l.adminEmail, password: l.adminPassword }
  });
  assert.equal(status, 403, JSON.stringify(json));
  assert.match(json.error, /suspens/i);
});

test("clínica suspensa → uso de rota protegida (X-Tenant) retorna 403", async () => {
  const l = ctx.lifecycle;
  // /appointments é GET protegido e existe; com clínica suspensa o resolveTenant
  // lança 403 antes mesmo de chegar na autenticação.
  const { status, json } = await req("/appointments", { tenant: l.slug });
  assert.equal(status, 403, JSON.stringify(json));
  assert.match(json.error, /suspens/i);
});

test("PATCH /platform/tenants/:id reativa a clínica (status=ativo)", async () => {
  const l = ctx.lifecycle;
  const { status, json } = await platformReq(`/platform/tenants/${l.id}`, {
    method: "PATCH",
    body: { status: "ativo" }
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.status, "ativo");
});

test("após reativar, a clínica volta a logar", async () => {
  const l = ctx.lifecycle;
  const login = await loginTenant(l.slug, l.adminEmail, l.adminPassword);
  assert.ok(login.token);
});

test("PATCH com status inválido → 400 (Zod)", async () => {
  const l = ctx.lifecycle;
  const { status, json } = await platformReq(`/platform/tenants/${l.id}`, {
    method: "PATCH",
    body: { status: "banido" }
  });
  assert.equal(status, 400, JSON.stringify(json));
});

test("PATCH em tenant inexistente → 404", async () => {
  const { status } = await platformReq("/platform/tenants/99999999", {
    method: "PATCH",
    body: { status: "ativo" }
  });
  assert.equal(status, 404);
});

test("DELETE com confirmation errada → 400", async () => {
  const l = ctx.lifecycle;
  const { status, json } = await platformReq(`/platform/tenants/${l.id}`, {
    method: "DELETE",
    body: { confirmation: "slug-errado" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /confirma/i);
});

test("DELETE sem confirmation → 400", async () => {
  const l = ctx.lifecycle;
  const { status } = await platformReq(`/platform/tenants/${l.id}`, { method: "DELETE", body: {} });
  assert.equal(status, 400);
});

test("DELETE com confirmation correta (slug) → 200 e clínica some da listagem", async () => {
  const l = ctx.lifecycle;
  const del = await platformReq(`/platform/tenants/${l.id}`, {
    method: "DELETE",
    body: { confirmation: l.slug }
  });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.ok, true);
  // Remove do managed (já excluída) para não excluir de novo no after.
  ctx.managed = ctx.managed.filter((t) => t.id !== l.id);

  const list = await platformReq("/platform/tenants");
  const ids = list.json.map((t) => t.id);
  assert.ok(!ids.includes(l.id), "clínica excluída ainda aparece na listagem");

  // O DROP SCHEMA some com as tabelas, mas o ledger de migrations é uma
  // tabela à parte (platform.schema_migrations) — se a exclusão não limpar
  // essa linha, fica um resíduo que colide se o id do tenant for reaproveitado.
  const ledger = await query(
    "SELECT 1 FROM platform.schema_migrations WHERE scope = 'tenant' AND target_schema = $1",
    [`tenant_${l.id}`]
  );
  assert.equal(ledger.rows.length, 0, "ledger de migrations do tenant excluído não foi limpo");
});

test("DELETE em tenant inexistente → 404", async () => {
  const { status } = await platformReq("/platform/tenants/99999999", {
    method: "DELETE",
    body: { confirmation: "qualquer" }
  });
  assert.equal(status, 404);
});

test("script restore-admin restaura conta existente sem duplicar usuário", async () => {
  const reserveEmail = `admin-reserva@${ctx.tenantSlug}.test`;
  const reservePassword = "SenhaForte123";

  const reserve = await req("/users", {
    token: ctx.tenantToken,
    method: "POST",
    body: { name: "Admin Reserva", email: reserveEmail, password: reservePassword, role: "admin" }
  });
  assert.equal(reserve.status, 201, JSON.stringify(reserve.json));

  const reserveLogin = await loginTenant(ctx.tenantSlug, reserveEmail, reservePassword);
  const usersBefore = await req("/users", { token: reserveLogin.token });
  const mainAdmin = usersBefore.json.find((user) => user.email === ctx.tenantAdminEmail);
  assert.ok(mainAdmin?.id, "admin principal deve existir");

  const demote = await req(`/users/${mainAdmin.id}`, {
    token: reserveLogin.token,
    method: "PATCH",
    body: { role: "finance" }
  });
  assert.equal(demote.status, 200, JSON.stringify(demote.json));
  assert.equal(demote.json.role, "finance");

  const output = execFileSync(
    process.execPath,
    ["scripts/restore-admin.mjs", "--tenant", ctx.tenantSlug, "--email", ctx.tenantAdminEmail],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" }
  );
  assert.match(output, /Acesso administrativo restaurado com sucesso/);

  const restoredLogin = await loginTenant(ctx.tenantSlug, ctx.tenantAdminEmail, ctx.tenantAdminPassword);
  assert.equal(restoredLogin.user.role, "admin");
  ctx.tenantToken = restoredLogin.token;

  const usersAfter = await req("/users", { token: ctx.tenantToken });
  assert.equal(usersAfter.status, 200, JSON.stringify(usersAfter.json));
  assert.equal(usersAfter.json.filter((user) => user.email === ctx.tenantAdminEmail).length, 1);
  assert.ok(usersAfter.json.some((user) => user.email === ctx.tenantAdminEmail && user.role === "admin"));

  const removeReserve = await req(`/users/${reserve.json.id}`, {
    token: ctx.tenantToken,
    method: "DELETE"
  });
  assert.equal(removeReserve.status, 200, JSON.stringify(removeReserve.json));
});
