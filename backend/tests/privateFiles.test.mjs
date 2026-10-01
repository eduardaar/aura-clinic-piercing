import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";

const context = {};

before(async () => {
  context.platformToken = await platformLogin();
  context.a = await createTenant("private-a");
  context.b = await createTenant("private-b");
  context.a.token = (await loginTenant(context.a.slug, context.a.adminEmail, context.a.adminPassword)).token;
  context.b.token = (await loginTenant(context.b.slug, context.b.adminEmail, context.b.adminPassword)).token;
});

after(async () => {
  for (const tenant of [context.a, context.b]) {
    if (tenant?.tenant?.id) await deleteTenant(context.platformToken, tenant.tenant.id, tenant.slug);
  }
});

test("PDF clínico exige autenticação e não pode ser lido por outro tenant", async () => {
  const created = await req("/digital-terms", {
    method: "POST", tenant: context.a.slug, token: context.a.token,
    body: {
      full_name: "Cliente Privada", whatsapp: "11999999999", orientations_confirmed: true,
      signature_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.match(created.json.pdf_url, /^\/api\/private-files\//);

  const own = await req(created.json.pdf_url.replace(/^\/api/, ""), { tenant: context.a.slug, token: context.a.token });
  assert.equal(own.status, 200);
  assert.match(own.headers.get("content-type") || "", /^application\/pdf\b/);
  assert.match(own.headers.get("content-disposition") || "", /^inline;/);
  assert.equal(own.headers.get("cache-control"), "private, no-store");
  const anonymous = await req(created.json.pdf_url.replace(/^\/api/, ""), { tenant: context.a.slug });
  assert.equal(anonymous.status, 401);
  const foreign = await req(created.json.pdf_url.replace(/^\/api/, ""), { tenant: context.b.slug, token: context.b.token });
  assert.equal(foreign.status, 404);
});

test("arquivo clínico segue clinical_files.view, não só o cargo", async () => {
  const tenant = context.a;
  const api = (path, options = {}) => req(path, { tenant: tenant.slug, token: tenant.token, ...options });
  const plan = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  const password = "SenhaForte123";
  const users = [
    { key: "piercerNegado", role: "piercer", permission_overrides: [{ permission: "clinical_files.view", allowed: false }] },
    { key: "recepcaoLiberada", role: "reception", permission_overrides: [{ permission: "clinical_files.view", allowed: true }] },
    { key: "recepcao", role: "reception" }
  ];
  const tokens = {};
  for (const user of users) {
    const email = `${user.key.toLowerCase()}@${tenant.slug}.test`;
    const created = await api("/users", {
      method: "POST",
      body: { name: user.key, email, password, role: user.role, permission_overrides: user.permission_overrides }
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    tokens[user.key] = (await loginTenant(tenant.slug, email, password)).token;
  }
  // Só o registro: a checagem de acesso acontece antes da leitura do bucket,
  // então quem passa recebe 404 (objeto ausente) e quem não passa, 403.
  await withTenantSchema(tenant.tenant.id, (db) => db.run(
    "INSERT INTO private_files (filename, original_name, mime_type, purpose) VALUES ('qa-indicador-clinico.webp', 'indicador.webp', 'image/webp', 'chemical_indicator')"
  ));
  const path = "/private-files/qa-indicador-clinico.webp";
  const as = (token) => req(path, { tenant: tenant.slug, token });
  assert.equal((await as(tokens.piercerNegado)).status, 403, "piercer com a permissão negada não baixa");
  assert.equal((await as(tokens.recepcao)).status, 403, "recepção sem a permissão não baixa");
  assert.equal((await as(tokens.recepcaoLiberada)).status, 404, "recepção com a permissão passa da checagem");
  assert.equal((await as(tenant.token)).status, 404, "admin passa da checagem");
});
