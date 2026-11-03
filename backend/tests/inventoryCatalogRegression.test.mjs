import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const ctx = {};
const api = (path, options = {}) => req(path, { tenant: ctx.slug, token: ctx.token, ...options });
const inDb = (fn) => withTenantSchema(ctx.tenant.id, fn);
const patch = (id, body) => api(`/jewelry/${id}`, { method: "PATCH", body });
const stored = (id) => inDb(async (db) => ({
  product: await db.get("SELECT * FROM jewelry_inventory WHERE id=?", [id]),
  variants: await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id=? ORDER BY id", [id]),
  images: await db.all("SELECT * FROM product_images WHERE product_id=? ORDER BY id", [id])
}));
const catalogItem = async (id, tenant = ctx.slug) => {
  const response = await req("/catalog", { tenant });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.items.find((item) => item.id === id);
};
const createProduct = async (extra = {}) => {
  const response = await api("/jewelry", { method: "POST", body: {
    name: "Argola de teste", category: "Argolas", quantity: 6, low_stock_threshold: 5,
    cost_value: 17, sale_value: 79, can_sell: true, can_publish: true,
    is_catalog_active: true, is_published: true, virtual_store_active: true,
    ...extra
  } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json;
};
const move = (id, quantity, movement_type = "Entrada", variantId) => api(
  `/jewelry/${id}${variantId ? `/variants/${variantId}` : ""}/movements`,
  { method: "POST", body: { quantity, movement_type, notes: "Regressão de estoque e catálogo" } }
);

before(async () => {
  Object.assign(ctx, await createTenant("qa-stock-catalog"));
  ctx.token = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
});
after(async () => { if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id); });

for (const [quantity, expected] of [[0, "esgotado"], [1, "crítico"], [4, "crítico"], [5, "crítico"], [6, "baixo estoque"], [10, "baixo estoque"], [11, "disponível"]]) {
  test(`mínimo 5: quantidade ${quantity} resulta em ${expected} e não impede publicação`, async () => {
    const product = await createProduct({ quantity });
    assert.equal(product.status, expected);
    assert.equal(product.variants[0].status, expected);
    const visible = await catalogItem(product.id);
    assert.ok(visible, "alerta de estoque não deve esconder produto publicado");
    assert.equal(Number(visible.quantity), quantity);
  });
}

test("mínimo zero permanece zero no cadastro, na edição e após movimentação", async () => {
  const product = await createProduct({ quantity: 1, low_stock_threshold: 0 });
  assert.equal(Number(product.low_stock_threshold), 0);
  assert.equal(Number(product.variants[0].low_stock_threshold), 0);
  assert.equal(product.status, "disponível");
  const updated = await patch(product.id, { notes: "Não restaurar mínimo padrão" });
  assert.equal(updated.status, 200);
  assert.equal(Number(updated.json.low_stock_threshold), 0);
  assert.equal((await move(product.id, 1)).status, 200);
  assert.equal((await catalogItem(product.id)).status, "disponível");
});

test("editar apenas selo, nome ou observação preserva preços, custos, estoque, SKU, fotos e variantes no banco", async () => {
  const product = await createProduct({ images: ["https://cdn.test/argola.webp"], description: "Descrição pública", notes: "Privado" });
  const initial = await stored(product.id);
  for (const body of [{ is_new: true }, { name: "Argola Renomeada" }, { notes: "Anotação atualizada" }, { is_featured: true }, { is_new: false }]) {
    const updated = await patch(product.id, body);
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    const current = await stored(product.id);
    for (const field of ["quantity", "cost_value", "sale_value", "purchase_cost_cents", "total_cost_cents", "sale_price_cents", "sku", "description", "is_catalog_active", "is_published", "virtual_store_active"]) {
      assert.deepEqual(current.product[field], initial.product[field], `PATCH ${JSON.stringify(body)} alterou ${field}`);
    }
    assert.deepEqual(current.variants, initial.variants);
    assert.deepEqual(current.images, initial.images);
    assert.equal(Number((await catalogItem(product.id)).sale_value), 79);
  }
});

test("cada marca de publicação oculta e republica sem perder o produto ou suas fotos", async () => {
  const product = await createProduct({ is_new: true, images: ["https://cdn.test/joia.webp"] });
  const initial = await stored(product.id);
  for (const field of ["can_publish", "is_catalog_active", "is_published", "virtual_store_active"]) {
    assert.equal((await patch(product.id, { [field]: false })).status, 200);
    assert.equal(await catalogItem(product.id), undefined, field);
    const order = await req("/sales-orders/public", { method: "POST", tenant: ctx.slug, body: {
      full_name: "Cliente QA", whatsapp: "11966660101", accepted_policies: true,
      payment_method: "Pix", idempotency_key: `hidden-${product.id}-${field}`,
      items: [{ product_id: product.id, item_name: product.name, quantity: 1, unit_price: 79 }]
    } });
    assert.equal(order.status, 409, `checkout deve recusar ${field}: ${JSON.stringify(order.json)}`);
    assert.equal((await patch(product.id, { [field]: true })).status, 200);
    const visible = await catalogItem(product.id);
    assert.ok(visible, field);
    assert.equal(Number(visible.is_new), 1);
    const current = await stored(product.id);
    assert.deepEqual(current.variants, initial.variants);
    assert.deepEqual(current.images, initial.images);
    assert.equal(Number(current.product.sale_price_cents), 7900);
  }
});

test("entrada, saída, perda, esgotamento e reposição mantêm pai, variação e vitrine conciliados", async () => {
  const product = await createProduct({ is_new: true });
  for (const [type, amount, balance] of [["Entrada", 4, 10], ["Saída", 5, 5], ["Perda", 2, 3], ["Venda", 3, 0], ["Entrada", 6, 6]]) {
    const result = await move(product.id, amount, type);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const current = await stored(product.id);
    const visible = await catalogItem(product.id);
    assert.equal(Number(current.product.quantity), balance);
    assert.equal(Number(current.variants[0].quantity), balance);
    assert.equal(Number(visible.quantity), balance);
    assert.equal(Number(visible.is_new), 1);
    assert.equal(Number(visible.sale_value), 79);
  }
  const movements = await api(`/jewelry/${product.id}/movements`);
  assert.equal(movements.json.length, 5);
});

test("saídas concorrentes nunca gastam duas vezes a última unidade", async () => {
  const product = await createProduct({ quantity: 1 });
  const responses = await Promise.all([move(product.id, 1, "Saída"), move(product.id, 1, "Saída")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(Number((await stored(product.id)).product.quantity), 0);
  assert.equal((await api(`/jewelry/${product.id}/movements`)).json.length, 1);
});

test("movimentações inválidas ou acima do saldo não deixam baixas nem registros parciais", async () => {
  const product = await createProduct({ quantity: 3 });
  const initial = await stored(product.id);
  for (const amount of [-1, 0, 1.5, "inválido", 4]) {
    const response = await move(product.id, amount, "Saída");
    assert.equal(response.status, amount === 4 ? 409 : 400, JSON.stringify(response.json));
    assert.deepEqual(await stored(product.id), initial);
  }
  assert.equal((await api(`/jewelry/${product.id}/movements`)).json.length, 0);
});

test("variação zerada não herda saldo, variação inativa não vai à vitrine e baixa exige a medida correta", async () => {
  const product = await createProduct({ variants: [
    { variation_name: "6 mm", quantity: 0, sale_value: 79, low_stock_threshold: 0 },
    { variation_name: "8 mm", quantity: 8, sale_value: 89 },
    { variation_name: "10 mm", quantity: 50, sale_value: 99, is_active: false }
  ] });
  let visible = await catalogItem(product.id);
  assert.equal(Number(visible.quantity), 8);
  assert.deepEqual(visible.variants.map((variant) => Number(variant.quantity)), [0, 8]);
  assert.equal((await move(product.id, 1, "Saída")).status, 409);
  assert.equal((await move(product.id, 1, "Saída", visible.variants[0].id)).status, 409);
  assert.equal((await move(product.id, 2, "Saída", visible.variants[1].id)).status, 200);
  visible = await catalogItem(product.id);
  assert.equal(Number(visible.quantity), 6);
  assert.equal(Number((await stored(product.id)).product.quantity), 6);
});

test("SKU duplicado e saldo negativo desfazem edição inteira, incluindo imagens e publicação", async () => {
  const product = await createProduct({ images: ["https://cdn.test/original.webp"] });
  const other = await createProduct();
  const initial = await stored(product.id);
  for (const [variants, status] of [
    [[{ ...product.variants[0], quantity: -1 }], 400],
    [[{ ...product.variants[0], sku: other.variants[0].sku, sku_manually_edited: true }], 409]
  ]) {
    const result = await patch(product.id, { name: "Não salvar", is_published: false, images: [], variants });
    assert.equal(result.status, status, JSON.stringify(result.json));
    assert.deepEqual(await stored(product.id), initial);
    assert.ok(await catalogItem(product.id));
  }
});

test("desativar e movimentar não reativa; reativar restaura publicação e preserva cadastro", async () => {
  const product = await createProduct({ is_new: true });
  assert.equal((await api(`/jewelry/${product.id}/status`, { method: "PATCH", body: { is_active: false } })).status, 200);
  assert.equal(await catalogItem(product.id), undefined);
  assert.equal((await move(product.id, 2)).status, 200);
  assert.equal((await patch(product.id, { notes: "Continua inativo" })).status, 200);
  assert.equal((await stored(product.id)).product.status, "arquivado");
  assert.equal(await catalogItem(product.id), undefined);
  assert.equal((await api(`/jewelry/${product.id}/status`, { method: "PATCH", body: { is_active: true } })).status, 200);
  const visible = await catalogItem(product.id);
  assert.equal(Number(visible.quantity), 8);
  assert.equal(Number(visible.is_new), 1);
  assert.equal(Number(visible.sale_value), 79);
});

test("regravar variantes mantém IDs, imagens e selos e permite remover uma variação sem histórico", async () => {
  const product = await createProduct({ is_new: true, variants: [
    { variation_name: "Prata", quantity: 6, cost_value: 17, sale_value: 79, images: ["https://cdn.test/prata.webp"] },
    { variation_name: "Dourada", quantity: 2, cost_value: 20, sale_value: 89 }
  ] });
  const saved = await patch(product.id, { description: "Descrição revisada", variants: product.variants });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.variants.map((variant) => variant.id), product.variants.map((variant) => variant.id));
  assert.equal(saved.json.variants[0].images[0].image_url, "https://cdn.test/prata.webp");
  const removed = await patch(product.id, { variants: [saved.json.variants[0]] });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const visible = await catalogItem(product.id);
  assert.equal(visible.variants.length, 1);
  assert.equal(Number(visible.quantity), 6);
  assert.equal(Number(visible.is_new), 1);
});

test("regravar uma variação inativa com o zero retornado pelo banco não a reativa", async () => {
  const product = await createProduct({ variants: [
    { variation_name: "Ativa", quantity: 6, sale_value: 79 },
    { variation_name: "Inativa", quantity: 50, sale_value: 89, is_active: false }
  ] });
  const initial = await stored(product.id);
  assert.equal(initial.variants[1].is_active, 0);
  const response = await patch(product.id, { variants: initial.variants });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(Number(response.json.quantity), 6);
  assert.equal(response.json.variants.length, 1);
  assert.equal((await stored(product.id)).variants[1].is_active, 0);
});

test("catálogo de outra clínica não recebe produtos nem alterações desta clínica", async () => {
  const other = await createTenant("qa-stock-other");
  try {
    const product = await createProduct({ is_new: true });
    assert.equal(await catalogItem(product.id, other.slug), undefined);
    await patch(product.id, { is_published: false });
    assert.equal(await catalogItem(product.id, other.slug), undefined);
  } finally {
    await deprovisionTenant(other.tenant.id);
  }
});
