import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
const context = {};
before(async () => { Object.assign(context, await createTenant("boutique-options")); context.platform = await platformLogin(); context.token = (await loginTenant(context.slug, context.adminEmail, context.adminPassword)).token; });
after(async () => { if (context.tenant?.id) await deleteTenant(context.platform, context.tenant.id, context.slug); });
const api = (path, options = {}) => req(path, { tenant: context.slug, token: context.token, ...options });

test("configuração Boutique passa por rascunho e publicação, com isolamento e validação transacional", async () => {
  const initial = await api("/catalog-customization");
  const beforePublic = await req("/catalog", { tenant: context.slug });
  const value = { announcement_text: "Conteúdo exclusivo desta clínica", navigation_background: "#123456", products_mobile_columns: 1, benefits: [], sections: [{ id: "products", type: "products", enabled: true }, { id: "footer", type: "footer", enabled: false }] };
  const save = await api("/catalog-customization", { method: "PATCH", body: { expected_draft_version: initial.json.version.draft, theme: { theme: "boutique" }, settings: { boutique_config: value } } });
  assert.equal(save.status, 200, JSON.stringify(save.json));
  assert.equal(JSON.parse(save.json.settings.boutique_config).announcement_text, value.announcement_text);
  const stillPublic = await req("/catalog", { tenant: context.slug });
  assert.equal(stillPublic.json.boutique_config, beforePublic.json.boutique_config);
  const invalid = await api("/catalog-customization", { method: "PATCH", body: { settings: { boutique_config: { announcement_link_url: "javascript:alert(1)" } } } });
  assert.equal(invalid.status, 422, JSON.stringify(invalid.json));
  assert.equal(invalid.json.code, "boutique_config_invalid");
  const afterInvalid = await api("/catalog-customization");
  assert.equal(afterInvalid.json.version.draft, save.json.version.draft);
  assert.equal(afterInvalid.json.settings.boutique_config, save.json.settings.boutique_config);
  const publish = await api("/catalog-customization/publish", { method: "POST", body: { expected_draft_version: save.json.version.draft } });
  assert.equal(publish.status, 200, JSON.stringify(publish.json));
  const publicData = await req("/catalog", { tenant: context.slug });
  assert.equal(publicData.json.theme.theme, "boutique");
  assert.equal(JSON.parse(publicData.json.boutique_config).products_mobile_columns, 1);
  assert.deepEqual(JSON.parse(publicData.json.boutique_config).benefits, []);
  const unauthenticated = await req("/catalog-customization", { tenant: context.slug, method: "PATCH", body: { settings: { boutique_config: value } } });
  assert.equal(unauthenticated.status, 401);
  const other = await createTenant("boutique-other");
  try { const data = await req("/catalog", { tenant: other.slug }); assert.notEqual(JSON.parse(data.json.boutique_config).announcement_text, value.announcement_text); }
  finally { await deleteTenant(context.platform, other.tenant.id, other.slug); }
});
