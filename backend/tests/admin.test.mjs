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
import {
  req,
  createTenant,
  loginTenant,
  platformLogin,
  deleteTenant,
  testSlug
} from "./helpers.mjs";

const ctx = {
  platformToken: null,
  tenantToken: null, // token de um usuário de clínica (NÃO plataforma)
  managed: [] // tenants criados via painel para limpar no after
};

before(async () => {
  ctx.platformToken = await platformLogin();
  // Um tenant "normal" para provar que seu token não abre rotas de plataforma.
  const t = await createTenant("qasec-tk");
  ctx.tenantSlug = t.slug;
  ctx.tenantId = t.tenant.id;
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
});

test("DELETE em tenant inexistente → 404", async () => {
  const { status } = await platformReq("/platform/tenants/99999999", {
    method: "DELETE",
    body: { confirmation: "qualquer" }
  });
  assert.equal(status, 404);
});

// ---------------------------------------------------------------------------
// 6. RESET DESTRUTIVO em produção (o runner NÃO define ALLOW_DEMO_RESET)
// ---------------------------------------------------------------------------

test("POST /admin/reset-demo-data em produção sem ALLOW_DEMO_RESET → 403", async () => {
  const { status, json } = await req("/admin/reset-demo-data", {
    token: ctx.tenantToken,
    method: "POST",
    body: { confirmation: "RESETAR" }
  });
  assert.equal(status, 403, JSON.stringify(json));
  assert.match(json.error, /produção|ALLOW_DEMO_RESET/i);
});

test("POST /admin/reset-demo-data continua exigindo papel admin (com reception seria 403 de papel)", async () => {
  // Aqui o admin é usado; o bloqueio de produção (403) precede a confirmação,
  // então mesmo admin recebe 403 do gate de produção. Documenta a ordem real.
  const { status } = await req("/admin/reset-demo-data", {
    token: ctx.tenantToken,
    method: "POST",
    body: {}
  });
  assert.equal(status, 403);
});
