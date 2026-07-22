// Testa o cadastro público "enxuto": sem slug digitado, o backend deriva o
// código a partir do nome (generateUniqueSlug) e devolve um token que já
// autentica o admin recém-criado (login automático — Epic C).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { platformToken: null, tenantId: null, slug: null };

before(async () => {
  ctx.platformToken = await platformLogin();
});

after(async () => {
  if (ctx.tenantId) await deleteTenant(ctx.platformToken, ctx.tenantId, ctx.slug);
});

test("signup sem slug deriva o código do nome e retorna token que autentica", async () => {
  const suffix = Math.floor(performance.now() * 1000) % 1000000;
  const name = `Studio Lua Piercing ${suffix}`;
  const adminEmail = `dono${suffix}@studio-lua.test`;
  const adminPassword = "SenhaForte123";

  // Cadastro SEM enviar slug.
  const signup = await req("/signup", {
    method: "POST",
    body: { name, admin_email: adminEmail, admin_password: adminPassword, plan_code: "profissional" },
  });
  assert.equal(signup.status, 201, `esperava 201, veio ${signup.status} ${JSON.stringify(signup.json)}`);

  const { tenant, token, user } = signup.json;
  ctx.tenantId = tenant.id;
  ctx.slug = tenant.slug;

  // Slug derivado do nome (começa com "studio-lua").
  assert.match(tenant.slug, /^studio-lua/, `slug derivado inesperado: ${tenant.slug}`);
  assert.ok(token, "signup deveria retornar um token para login automático");
  assert.equal(user.role, "admin");
  assert.equal(user.email, adminEmail.toLowerCase());

  // O token retornado deve autenticar uma rota protegida da clínica, sem re-login.
  const me = await req("/clients", { token, tenant: tenant.slug });
  assert.equal(me.status, 200, `token do signup deveria acessar /clients, veio ${me.status}`);
});

test("dois cadastros com o mesmo nome geram slugs distintos", async () => {
  const suffix = Math.floor(performance.now() * 1000) % 1000000;
  const name = `Clinica Repetida ${suffix}`;
  const base = { admin_password: "SenhaForte123", plan_code: "essencial" };

  const a = await req("/signup", { method: "POST", body: { ...base, name, admin_email: `a${suffix}@rep.test` } });
  const b = await req("/signup", { method: "POST", body: { ...base, name, admin_email: `b${suffix}@rep.test` } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.json.tenant.slug, b.json.tenant.slug, "slugs deveriam ser únicos");

  await deleteTenant(ctx.platformToken, a.json.tenant.id, a.json.tenant.slug);
  await deleteTenant(ctx.platformToken, b.json.tenant.id, b.json.tenant.slug);
});
