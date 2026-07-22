// Testa o enforcement de planos (Epic A): recursos fora do plano retornam 403
// (plan_upgrade_required) e, ao trocar para um plano que os inclui, passam a
// funcionar. Também cobre a troca self-service e a troca/ativação pela plataforma.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { platformToken: null, slug: null, tenantId: null, token: null, email: null, password: null };

before(async () => {
  ctx.platformToken = await platformLogin();
  // Cria uma clínica no plano ESSENCIAL (não tem finance/booking/terms).
  const suffix = Math.floor(performance.now() * 1000) % 1000000;
  ctx.slug = `gate-${suffix}`;
  ctx.email = `admin@${ctx.slug}.test`;
  ctx.password = "SenhaForte123";
  const signup = await req("/signup", {
    method: "POST",
    body: { name: `Clinica Gate ${suffix}`, slug: ctx.slug, admin_email: ctx.email, admin_password: ctx.password, plan_code: "essencial" },
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  ctx.tenantId = signup.json.tenant.id;
  ctx.token = signup.json.token;
});

after(async () => {
  if (ctx.tenantId) await deleteTenant(ctx.platformToken, ctx.tenantId, ctx.slug);
});

function api(path, opts = {}) {
  return req(path, { token: ctx.token, tenant: ctx.slug, ...opts });
}

test("plano essencial NÃO acessa financeiro/agendamento/termos → 403 plan_upgrade_required", async () => {
  const finance = await api("/finance");
  assert.equal(finance.status, 403, JSON.stringify(finance.json));
  assert.equal(finance.json.code, "plan_upgrade_required");

  const booking = await req("/booking/config", { tenant: ctx.slug });
  assert.equal(booking.status, 403, JSON.stringify(booking.json));
  assert.equal(booking.json.code, "plan_upgrade_required");

  const terms = await api("/digital-terms");
  assert.equal(terms.status, 403);
});

test("recursos-base continuam liberados no essencial (clientes)", async () => {
  const clients = await api("/clients");
  assert.equal(clients.status, 200, JSON.stringify(clients.json));
});

test("troca self-service para profissional libera financeiro/agendamento/termos", async () => {
  const change = await api("/subscription", { method: "PATCH", body: { plan_code: "profissional" } });
  assert.equal(change.status, 200, JSON.stringify(change.json));
  assert.equal(change.json.subscription.plan_code, "profissional");

  // O cache de assinatura expira em 30s; para o teste, uma nova requisição
  // após a troca já invalida o cache (invalidateSubscriptionCache no PATCH).
  const finance = await api("/finance");
  assert.equal(finance.status, 200, JSON.stringify(finance.json));
  const booking = await req("/booking/config", { tenant: ctx.slug });
  assert.equal(booking.status, 200, JSON.stringify(booking.json));
});

test("plano inválido na troca → 400", async () => {
  const bad = await api("/subscription", { method: "PATCH", body: { plan_code: "inexistente" } });
  assert.equal(bad.status, 400);
});

test("super-admin troca plano e ativa a assinatura (PATCH /platform/tenants/:id/plan)", async () => {
  const change = await req(`/platform/tenants/${ctx.tenantId}/plan`, {
    method: "PATCH",
    token: ctx.platformToken,
    body: { plan_code: "studio" },
  });
  assert.equal(change.status, 200, JSON.stringify(change.json));
  assert.equal(change.json.plan, "studio");
  assert.equal(change.json.status, "active");

  // Studio inclui multi_user; a identidade agora reflete o plano studio.
  const identity = await api("/store-identity");
  assert.equal(identity.status, 200);
  assert.equal(identity.json.subscription.plan_code, "studio");
  assert.equal(identity.json.subscription.status, "active");
});
