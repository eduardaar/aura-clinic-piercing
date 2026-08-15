import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
import { query } from "../src/database/connection.js";

const context = {};

before(async () => {
  context.platformToken = await platformLogin();
  context.a = await createTenant("qa-category-a");
  context.b = await createTenant("qa-category-b");
  context.legacy = await createTenant("qa-category-legacy");
  context.tokenA = (await loginTenant(context.a.slug, context.a.adminEmail, context.a.adminPassword)).token;
  context.tokenLegacy = (await loginTenant(context.legacy.slug, context.legacy.adminEmail, context.legacy.adminPassword)).token;
  await query(`ALTER TABLE tenant_${context.legacy.tenant.id}.jewelry_inventory DROP COLUMN IF EXISTS category_id`);
});

after(async () => {
  await deleteTenant(context.platformToken, context.a.tenant.id, context.a.slug);
  await deleteTenant(context.platformToken, context.b.tenant.id, context.b.slug);
  await deleteTenant(context.platformToken, context.legacy.tenant.id, context.legacy.slug);
});

async function createCategory(name, token = context.tokenA) {
  const result = await req("/inventory-categories", {
    token,
    method: "POST",
    body: { name, description: "Categoria dinâmica", is_active: true }
  });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json;
}

async function createProduct(category, suffix) {
  return req("/jewelry", {
    token: context.tokenA,
    method: "POST",
    body: { name: `Produto ${suffix}`, category: category.name, category_id: category.id, quantity: 0 }
  });
}

test("categoria recém-criada cria produto e preserva category_id", async () => {
  const category = await createCategory("Categoria Nova QA");
  const product = await createProduct(category, "novo");
  assert.equal(product.status, 201, JSON.stringify(product.json));
  assert.equal(product.json.category, category.name);
  assert.equal(product.json.category_id, category.id);
  context.product = product.json;
});

test("categoria legada continua funcionando e categoria inexistente é rejeitada", async () => {
  const legacy = await req("/jewelry", {
    token: context.tokenA,
    method: "POST",
    body: { name: "Produto legado", category: "Labret", quantity: 0 }
  });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.json));
  const missing = await req("/jewelry", {
    token: context.tokenA,
    method: "POST",
    body: { name: "Produto inválido", category_id: 99999999, quantity: 0 }
  });
  assert.equal(missing.status, 400);
});

test("categoria inativa é recusada para produto novo", async () => {
  const category = await createCategory("Categoria Inativa QA");
  const disabled = await req(`/inventory-categories/${category.id}`, {
    token: context.tokenA,
    method: "PATCH",
    body: { is_active: false }
  });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.json));
  const product = await createProduct(category, "inativo");
  assert.equal(product.status, 400);
});

test("edição troca para categoria nova e recarga preserva a referência", async () => {
  const category = await createCategory("Categoria Edição QA");
  const updated = await req(`/jewelry/${context.product.id}`, {
    token: context.tokenA,
    method: "PATCH",
    body: { category_id: category.id }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.category_id, category.id);
  const list = await req(`/jewelry?search=${encodeURIComponent(context.product.name)}`, { token: context.tokenA });
  assert.equal(list.status, 200);
  const found = list.json.find((item) => item.id === context.product.id);
  assert.equal(found.category, category.name);
  assert.equal(found.category_id, category.id);
});

test("categoria e token de outro tenant não atravessam schemas", async () => {
  const category = await createCategory("Categoria Isolada QA");
  const crossHeader = await req(`/inventory-categories/${category.id}`, {
    token: context.tokenA,
    tenant: context.b.slug,
    method: "PATCH",
    body: { name: "Tentativa cruzada" }
  });
  assert.equal(crossHeader.status, 403);
});

test("tenant sem 0005 mantém criação e edição pelo contrato category legado", async () => {
  const category = await createCategory("Categoria Legada Sem 0005", context.tokenLegacy);
  const created = await req("/jewelry", {
    token: context.tokenLegacy,
    method: "POST",
    body: { name: "Produto sem coluna category_id", category_id: category.id, quantity: 0 }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.category, category.name);
  assert.equal(created.json.category_id, undefined);

  const updated = await req(`/jewelry/${created.json.id}`, {
    token: context.tokenLegacy,
    method: "PATCH",
    body: { category_id: category.id }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.category, category.name);
});
