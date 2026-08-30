// Testa o cadastro público "enxuto": sem slug digitado, o backend deriva o
// código a partir do nome (generateUniqueSlug) e devolve um token que já
// autentica o admin recém-criado (login automático — Epic C).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { platformToken: null, tenantId: null, slug: null, email: null, name: null };

before(async () => {
  ctx.platformToken = await platformLogin();
});

after(async () => {
  if (ctx.tenantId) await deleteTenant(ctx.platformToken, ctx.tenantId, ctx.slug);
});

test("não cria clínica antes do aceite jurídico e da escolha de plano válida", async () => {
  const suffix = Math.floor(performance.now() * 1000) % 1000000;
  const email = `incompleto${suffix}@signup.test`;
  const base = { name: `Clinica Incompleta ${suffix}`, admin_email: email, admin_password: "SenhaForte123" };
  const semAceite = await req("/signup", { method: "POST", body: { ...base, plan_code: "profissional" } });
  assert.equal(semAceite.status, 400, JSON.stringify(semAceite.json));
  assert.equal(semAceite.json.code, "legal_acceptance_required");

  const legal = await req("/legal-documents");
  const legalAcceptances = Object.fromEntries(legal.json.documents.map((item) => [item.key, item.version]));
  const planoInvalido = await req("/signup", {
    method: "POST",
    body: { ...base, plan_code: "plano-inexistente", legal_acceptances: legalAcceptances }
  });
  assert.equal(planoInvalido.status, 400, JSON.stringify(planoInvalido.json));
  assert.equal(planoInvalido.json.code, "plano_obrigatorio");

  const availability = await req(`/signup/availability?email=${encodeURIComponent(email)}`);
  assert.equal(availability.status, 200);
  assert.equal(availability.json.email.available, true, "nenhuma tentativa incompleta pode criar a clínica");
});

test("signup sem slug deriva o código do nome e retorna token que autentica", async () => {
  const suffix = Math.floor(performance.now() * 1000) % 1000000;
  const name = `Studio Lua Piercing ${suffix}`;
  const adminEmail = `dono${suffix}@studio-lua.test`;
  const adminPassword = "SenhaForte123";

  // Cadastro SEM enviar slug.
  const signup = await req("/signup", {
    method: "POST",
    body: { name, admin_email: adminEmail, admin_password: adminPassword, plan_code: "profissional", legal_acceptances: { terms_of_use: 1, privacy_policy: 1 } },
  });
  assert.equal(signup.status, 201, `esperava 201, veio ${signup.status} ${JSON.stringify(signup.json)}`);

  const { tenant, token, user } = signup.json;
  ctx.tenantId = tenant.id;
  ctx.slug = tenant.slug;
  ctx.email = adminEmail;
  ctx.name = name;

  // Slug derivado do nome (começa com "studio-lua").
  assert.match(tenant.slug, /^studio-lua/, `slug derivado inesperado: ${tenant.slug}`);
  assert.ok(token, "signup deveria retornar um token para login automático");
  assert.equal(user.role, "admin");
  assert.equal(user.email, adminEmail.toLowerCase());

  // O token retornado deve autenticar uma rota protegida da clínica, sem re-login.
  const me = await req("/clients", { token, tenant: tenant.slug });
  assert.equal(me.status, 200, `token do signup deveria acessar /clients, veio ${me.status}`);
});

test("consulta de disponibilidade mostra nome existente, novo endereço e e-mail ocupado", async () => {
  const availability = await req(
    `/signup/availability?name=${encodeURIComponent(ctx.name)}&email=${encodeURIComponent(ctx.email)}`
  );
  assert.equal(availability.status, 200, JSON.stringify(availability.json));
  assert.equal(availability.json.name.exists, true);
  assert.match(availability.json.name.suggested_slug, /^studio-lua-piercing/);
  assert.equal(availability.json.email.available, false);
});

test("o mesmo e-mail não cria uma segunda clínica", async () => {
  const duplicate = await req("/signup", {
    method: "POST",
    body: {
      name: `Outra Clinica ${Math.floor(performance.now() * 1000) % 1000000}`,
      admin_email: ctx.email,
      admin_password: "SenhaForte123",
      plan_code: "start",
      legal_acceptances: { terms_of_use: 1, privacy_policy: 1 }
    }
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.json));
  assert.match(duplicate.json.error, /e-mail já possui uma clínica/i);
});

test("dois cadastros com o mesmo nome geram slugs distintos", async () => {
  const suffix = Math.floor(performance.now() * 1000) % 1000000;
  const name = `Clinica Repetida ${suffix}`;
  const base = { admin_password: "SenhaForte123", plan_code: "start", legal_acceptances: { terms_of_use: 1, privacy_policy: 1 } };

  const a = await req("/signup", { method: "POST", body: { ...base, name, admin_email: `a${suffix}@rep.test` } });
  const b = await req("/signup", { method: "POST", body: { ...base, name, admin_email: `b${suffix}@rep.test` } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.json.tenant.slug, b.json.tenant.slug, "slugs deveriam ser únicos");

  await deleteTenant(ctx.platformToken, a.json.tenant.id, a.json.tenant.slug);
  await deleteTenant(ctx.platformToken, b.json.tenant.id, b.json.tenant.slug);
});
