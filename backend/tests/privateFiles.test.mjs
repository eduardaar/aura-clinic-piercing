import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

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
  const anonymous = await req(created.json.pdf_url.replace(/^\/api/, ""), { tenant: context.a.slug });
  assert.equal(anonymous.status, 401);
  const foreign = await req(created.json.pdf_url.replace(/^\/api/, ""), { tenant: context.b.slug, token: context.b.token });
  assert.equal(foreign.status, 404);
});
