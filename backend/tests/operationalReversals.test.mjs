import test from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const context = { tenant: null, token: "", productId: null, variantId: null, clientId: null };
const api = (path, options = {}) => req(path, { tenant: context.tenant.slug, token: context.token, ...options });

test.before(async () => {
  const created = await createTenant("qa-reversals");
  context.tenant = created.tenant;
  context.tenant.slug = created.slug;
  context.token = (await loginTenant(created.slug, created.adminEmail, created.adminPassword)).token;

  const category = await api("/inventory-categories", { method: "POST", body: { name: "QA Reversoes" } });
  assert.equal(category.status, 201);
  const product = await api("/jewelry", { method: "POST", body: {
    name: "Labret QA reversoes", category_id: category.json.id, category: "QA Reversoes",
    material: "Titanio", color: "Natural", is_catalog_active: true,
    variants: [{ sku: `QA-REV-${Date.now()}`, variation_name: "8 mm", material: "Titanio", color: "Natural", quantity: 8, cost_value: 20, sale_value: 60 }],
  }});
  assert.equal(product.status, 201);
  context.productId = product.json.id;
  context.variantId = product.json.variants[0].id;

  const client = await api("/clients", { method: "POST", body: { full_name: "Cliente QA Reversoes", whatsapp: "5577999999911" } });
  assert.equal(client.status, 201);
  context.clientId = client.json.id;
});

test.after(async () => {
  if (context.tenant?.id) await deprovisionTenant(context.tenant.id);
});

test("devolucao parcial preserva quantidade, credito e estoque", async () => {
  const sale = await api("/sales-orders", { method: "POST", body: {
    client_id: context.clientId, full_name: "Cliente QA Reversoes", whatsapp: "5577999999911",
    status: "concluida", payment_method: "Pix",
    items: [{ item_name: "Labret QA reversoes", product_id: context.productId, product_variant_id: context.variantId, quantity: 2, unit_price: 60 }],
  }});
  assert.equal(sale.status, 201);
  const saleItemId = sale.json.items[0].id;

  const returned = await api(`/sales-orders/${sale.json.id}/returns`, { method: "POST", body: {
    reason: "Troca parcial QA", financial_action: "client_credit",
    items: [{ sales_order_item_id: saleItemId, quantity: 1, condition: "sellable", return_to_stock: true }],
  }});
  assert.equal(returned.status, 201, returned.json?.error);
  assert.equal(Number(returned.json.total_value), 60);
  assert.equal(Number(returned.json.financial_value), 60);
  assert.equal(Number(returned.json.items[0].quantity), 1);

  const state = await withTenantSchema(context.tenant.id, async (db) => ({
    variant: await db.get("SELECT quantity FROM jewelry_variants WHERE id=?", [context.variantId]),
    credit: await db.get("SELECT amount, remaining_amount FROM client_credits WHERE sales_return_id=?", [returned.json.id]),
    order: await db.get("SELECT status FROM sales_orders WHERE id=?", [sale.json.id]),
  }));
  assert.equal(Number(state.variant.quantity), 7);
  assert.equal(Number(state.credit.amount), 60);
  assert.equal(Number(state.credit.remaining_amount), 60);
  assert.notEqual(state.order.status, "devolvida");

  const excessive = await api(`/sales-orders/${sale.json.id}/returns`, { method: "POST", body: {
    reason: "Excesso QA", financial_action: "client_credit",
    items: [{ sales_order_item_id: saleItemId, quantity: 2, condition: "sellable", return_to_stock: true }],
  }});
  assert.equal(excessive.status, 409);
});

test("saida manual acima do saldo nao altera produto nem auditoria", async () => {
  const before = await withTenantSchema(context.tenant.id, async (db) => ({
    variant: await db.get("SELECT quantity FROM jewelry_variants WHERE id=?", [context.variantId]),
    movements: await db.get("SELECT COUNT(*) AS count FROM stock_movements WHERE variant_id=?", [context.variantId]),
  }));
  const response = await api(`/jewelry/${context.productId}/variants/${context.variantId}/movements`, { method: "POST", body: {
    movement_type: "Saida", quantity: Number(before.variant.quantity) + 1, notes: "Excesso QA",
  }});
  assert.equal(response.status, 409);
  const after = await withTenantSchema(context.tenant.id, async (db) => ({
    variant: await db.get("SELECT quantity FROM jewelry_variants WHERE id=?", [context.variantId]),
    product: await db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [context.productId]),
    movements: await db.get("SELECT COUNT(*) AS count FROM stock_movements WHERE variant_id=?", [context.variantId]),
  }));
  assert.equal(Number(after.variant.quantity), Number(before.variant.quantity));
  assert.equal(Number(after.product.quantity), Number(before.variant.quantity));
  assert.equal(Number(after.movements.count), Number(before.movements.count));
});

// Materiais de consumo deixaram de ter tabela e rota próprias: a unificação do
// estoque (migration 0025) os trouxe para `jewelry_inventory`, com os lotes em
// `inventory_item_lots` e as rotas em /api/jewelry. O que este teste garante
// continua o mesmo: a soma dos lotes nunca passa do saldo, e a saída consome
// pelo lote que vence primeiro.
test("lotes nao excedem saldo e acompanham saida FEFO", async () => {
  const material = await api("/jewelry", { method: "POST", body: {
    name: "Agulha QA lotes", category: "QA Reversoes", unit: "unidade",
    quantity: 10, low_stock_threshold: 2, cost_value: 3,
    track_stock: true, track_lots: true, can_sell: false, can_use_in_service: true,
  } });
  assert.equal(material.status, 201, JSON.stringify(material.json));
  const materialId = material.json.id;

  const firstLot = await api(`/jewelry/${materialId}/lots`, { method: "POST", body: { batch_code: "QA-A", quantity: 6, expiry_date: "2027-01-01", increase_stock: false } });
  assert.equal(firstLot.status, 201, JSON.stringify(firstLot.json));
  // 6 + 5 passaria dos 10 de saldo: o excesso é recusado.
  const excessiveLot = await api(`/jewelry/${materialId}/lots`, { method: "POST", body: { batch_code: "QA-B", quantity: 5, expiry_date: "2028-01-01", increase_stock: false } });
  assert.equal(excessiveLot.status, 400, JSON.stringify(excessiveLot.json));

  const output = await api(`/jewelry/${materialId}/movements`, { method: "POST", body: { movement_type: "Saida", quantity: 4, notes: "Consumo QA" } });
  assert.equal(output.status, 200, JSON.stringify(output.json));
  const afterOutput = await withTenantSchema(context.tenant.id, async (db) => ({
    material: await db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [materialId]),
    lots: await db.get("SELECT COALESCE(SUM(remaining_quantity),0) AS quantity FROM inventory_item_lots WHERE inventory_item_id=?", [materialId]),
    first: await db.get("SELECT remaining_quantity FROM inventory_item_lots WHERE id=?", [firstLot.json.id]),
  }));
  assert.equal(Number(afterOutput.material.quantity), 6);
  assert.equal(Number(afterOutput.lots.quantity), 2);
  assert.equal(Number(afterOutput.first.remaining_quantity), 2);

  const remainingLot = await api(`/jewelry/${materialId}/lots`, { method: "POST", body: { batch_code: "QA-B", quantity: 4, expiry_date: "2028-01-01", increase_stock: false } });
  assert.equal(remainingLot.status, 201, JSON.stringify(remainingLot.json));
  const reconciled = await withTenantSchema(context.tenant.id, async (db) => db.get(`
    SELECT i.quantity, COALESCE(SUM(l.remaining_quantity),0) AS lot_quantity
      FROM jewelry_inventory i LEFT JOIN inventory_item_lots l ON l.inventory_item_id=i.id
     WHERE i.id=? GROUP BY i.id`, [materialId]));
  assert.equal(Number(reconciled.lot_quantity), Number(reconciled.quantity));
});
