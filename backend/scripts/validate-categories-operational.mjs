import assert from "node:assert/strict";

const base = process.env.CATEGORY_VALIDATION_API;
const password = process.env.RBAC_VALIDATION_PASSWORD;
const tenant = "clinica-repetida-988020-2";
if (!base || !password) throw new Error("Defina CATEGORY_VALIDATION_API e RBAC_VALIDATION_PASSWORD.");

async function request(path, { method = "GET", token, selectedTenant = tenant, body } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "X-Tenant": selectedTenant,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

const login = await request("/login", {
  method: "POST",
  body: { email: "admin-rbac@tenant2455.test", password }
});
assert.equal(login.status, 200, JSON.stringify(login.json));
const token = login.json.token;
const suffix = Date.now();

async function category(name) {
  const result = await request("/inventory-categories", {
    method: "POST", token, body: { name, description: "Validação operacional", is_active: true }
  });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json;
}

async function product(body) {
  return request("/jewelry", {
    method: "POST", token,
    body: { name: `Produto categoria ${suffix}`, quantity: 0, ...body }
  });
}

const first = await category(`Categoria Dinâmica ${suffix}`);
const options = await request("/options", { token });
assert.equal(options.status, 200);
assert.ok(options.json.categoryManagement.some((item) => item.id === first.id && item.name === first.name));

const created = await product({ category_id: first.id });
assert.equal(created.status, 201, JSON.stringify(created.json));
assert.equal(created.json.category_id, first.id);
assert.equal(created.json.category, first.name);

const legacy = await product({ name: `Produto legado ${suffix}`, category: "Labret" });
assert.equal(legacy.status, 201, JSON.stringify(legacy.json));
assert.equal(legacy.json.category, "Labret");
assert.ok(Number(legacy.json.category_id) > 0);

const missing = await product({ name: `Produto inválido ${suffix}`, category_id: 99999999 });
assert.equal(missing.status, 400);

const inactive = await category(`Categoria Inativa ${suffix}`);
assert.equal((await request(`/inventory-categories/${inactive.id}`, {
  method: "PATCH", token, body: { is_active: false }
})).status, 200);
assert.equal((await product({ name: `Produto inativo ${suffix}`, category_id: inactive.id })).status, 400);

const second = await category(`Categoria Editada ${suffix}`);
const edited = await request(`/jewelry/${created.json.id}`, {
  method: "PATCH", token, body: { category_id: second.id }
});
assert.equal(edited.status, 200, JSON.stringify(edited.json));
assert.equal(edited.json.category_id, second.id);
assert.equal(edited.json.category, second.name);
const reloaded = await request(`/jewelry?search=${encodeURIComponent(created.json.name)}`, { token });
assert.equal(reloaded.status, 200);
assert.ok(reloaded.json.some((item) => item.id === created.json.id && item.category_id === second.id));

const crossTenant = await request(`/inventory-categories/${first.id}`, {
  method: "PATCH", token, selectedTenant: "studio-lua-piercing-123799", body: { name: "Não deve alterar" }
});
assert.equal(crossTenant.status, 403);

console.log(JSON.stringify({
  tenant,
  immediateOptions: "passed",
  dynamicCategory: "passed",
  legacyCategory: "passed",
  missingCategory: "passed",
  inactiveCategory: "passed",
  editAndReload: "passed",
  tenantIsolation: "passed",
  createdProductIds: [created.json.id, legacy.json.id]
}));
