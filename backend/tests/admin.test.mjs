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
});

test("DELETE em tenant inexistente → 404", async () => {
  const { status } = await platformReq("/platform/tenants/99999999", {
    method: "DELETE",
    body: { confirmation: "qualquer" }
  });
  assert.equal(status, 404);
});

// ---------------------------------------------------------------------------
// 6. RESET seguro de dados da clínica
// ---------------------------------------------------------------------------

test("POST /admin/reset-clinic-data exige confirmação literal", async () => {
  const { status, json } = await req("/admin/reset-clinic-data", {
    token: ctx.tenantToken,
    method: "POST",
    body: { confirmation: "RESETAR", reset_type: "operational" }
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(json.error, /RESETAR DADOS/i);
});

test("reset operacional apaga operação e preserva cadastros estruturais", async () => {
  const client = await req("/clients", {
    token: ctx.tenantToken,
    method: "POST",
    body: { full_name: "Cliente Reset", whatsapp: "11999990000" }
  });
  assert.equal(client.status, 201, JSON.stringify(client.json));
  const service = await req("/services", {
    token: ctx.tenantToken,
    method: "POST",
    body: { name: "Servico Reset", price: 80, duration_minutes: 40 }
  });
  assert.equal(service.status, 201, JSON.stringify(service.json));
  const professional = await req("/professionals", {
    token: ctx.tenantToken,
    method: "POST",
    body: { name: "Prof Reset" }
  });
  assert.equal(professional.status, 201, JSON.stringify(professional.json));
  const appointment = await req("/appointments", {
    token: ctx.tenantToken,
    method: "POST",
    body: {
      client_id: client.json.id,
      full_name: "Cliente Reset",
      whatsapp: "11999990000",
      professional_id: professional.json.id,
      service_id: service.json.id,
      procedure: "Servico Reset",
      piercing_region: "Orelha",
      appointment_date: "2026-08-01",
      appointment_time: "10:00",
      deposit_value: 25
    }
  });
  assert.equal(appointment.status, 201, JSON.stringify(appointment.json));

  const reset = await req("/admin/reset-clinic-data", {
    token: ctx.tenantToken,
    method: "POST",
    body: { confirmation: "RESETAR DADOS", reset_type: "operational" }
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  assert.equal(reset.json.type, "operational");
  assert.ok(Number(reset.json.removed.appointments || 0) >= 1);

  const appointments = await req("/appointments", { token: ctx.tenantToken });
  assert.equal(appointments.status, 200);
  assert.equal(appointments.json.length, 0, "agenda deve ficar limpa");
  const services = await req("/services", { token: ctx.tenantToken });
  assert.ok(services.json.some((item) => item.id === service.json.id), "serviços devem ser preservados");
  const clients = await req("/clients", { token: ctx.tenantToken });
  assert.ok(clients.json.some((item) => item.id === client.json.id), "clientes devem ser preservados no reset operacional");
});

test("reset completo preserva login/admin e limpa dados da clínica", async () => {
  const reset = await req("/admin/reset-clinic-data", {
    token: ctx.tenantToken,
    method: "POST",
    body: { confirmation: "RESETAR DADOS", reset_type: "complete" }
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  assert.equal(reset.json.type, "complete");

  const login = await loginTenant(ctx.tenantSlug, ctx.tenantAdminEmail, ctx.tenantAdminPassword);
  assert.equal(login.user.role, "admin");
  ctx.tenantToken = login.token;

  const users = await req("/users", { token: ctx.tenantToken });
  assert.equal(users.status, 200, JSON.stringify(users.json));
  assert.ok(users.json.some((user) => user.email === ctx.tenantAdminEmail && user.role === "admin"));
  const clients = await req("/clients", { token: ctx.tenantToken });
  assert.equal(clients.status, 200);
  assert.equal(clients.json.length, 0);
});

test("POST /admin/reset-demo-data mantém compatibilidade com reset operacional", async () => {
  const { status, json } = await req("/admin/reset-demo-data", {
    token: ctx.tenantToken,
    method: "POST",
    body: { confirmation: "RESETAR" }
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.type, "operational");
});
