import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { req, testSlug } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { splitInstallmentCents } from "../src/services/purchases.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const context = {};

async function createTenantWithCurrentLegal() {
  const slug = testSlug("purchases");
  const adminEmail = `admin@${slug}.test`;
  const adminPassword = "SenhaForte123";
  const legal = await req("/legal-documents");
  assert.equal(legal.status, 200, JSON.stringify(legal.json));
  const legalAcceptances = Object.fromEntries(
    (legal.json?.documents || [])
      .filter((item) => ["terms_of_use", "privacy_policy"].includes(item.key))
      .map((item) => [item.key, item.version])
  );
  const signup = await req("/signup", {
    method: "POST",
    body: {
      name: `Clinica ${slug}`, slug, admin_name: "Administrador QA", admin_email: adminEmail,
      admin_password: adminPassword, phone: "11999990000", city: "Sao Paulo", state: "SP",
      plan: "profissional", legal_acceptances: legalAcceptances
    }
  });
  if (signup.status !== 201) throw new Error(`Falha ao criar tenant ${slug}: ${signup.status} ${JSON.stringify(signup.json)}`);
  return { slug, adminEmail, adminPassword, tenant: signup.json.tenant, token: signup.json.token };
}

before(async () => {
  Object.assign(context, await createTenantWithCurrentLegal());
  const supplier = await api("/finance/suppliers", {
    method: "POST",
    body: { name: "Fornecedor Compra QA", person_type: "PJ", document: "11222333000181" }
  });
  assert.equal(supplier.status, 201, JSON.stringify(supplier.json));
  context.supplierId = supplier.json.id;

  const product = await api("/jewelry", {
    method: "POST",
    body: {
      name: "Joia Compra QA", category: "Labret", material: "Titânio", color: "Prata",
      quantity: 2, cost_value: 10, sale_value: 50,
      allocated_freight_cents: 200, additional_cost_cents: 100,
      price_manually_overridden: 1
    }
  });
  assert.equal(product.status, 201, JSON.stringify(product.json));
  context.productId = product.json.id;
  context.variantId = product.json.variants[0].id;
});

after(async () => {
  if (context.tenant?.id) await deprovisionTenant(context.tenant.id);
});

function api(path, options = {}) {
  return req(path, { tenant: context.slug, token: context.token, ...options });
}

test("divisão de parcelas preserva cada centavo do total", () => {
  const parts = splitInstallmentCents(10000, 3);
  assert.deepEqual(parts, [3334, 3333, 3333]);
  assert.equal(parts.reduce((sum, value) => sum + value, 0), 10000);
});

test("compra confirmada gera entrada e contas a pagar uma única vez", async () => {
  const body = {
    supplier_id: context.supplierId,
    purchase_date: "2026-08-22",
    first_due_date: "2026-08-31",
    installment_count: 3,
    payment_method: "Pix",
    category: "Fornecedores",
    notes: "Compra integrada de teste",
    items: [{
      product_id: context.productId,
      product_variant_id: context.variantId,
      quantity: 3,
      unit_cost: "33.33"
    }]
  };
  const first = await api("/purchases", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-test-confirmed-1" },
    body
  });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.status, "confirmed");
  assert.equal(first.json.supplier_name, "Fornecedor Compra QA");
  assert.equal(Number(first.json.total_value), 99.99);
  assert.equal(first.json.items.length, 1);
  assert.deepEqual(first.json.payables.map((item) => item.due_date), ["2026-08-31", "2026-09-30", "2026-10-31"]);
  assert.equal(Math.round(first.json.payables.reduce((sum, item) => sum + Number(item.amount), 0) * 100), 9999);

  const stateAfterFirst = await withTenantSchema(context.tenant.id, async (db) => ({
    variant: await db.get(
      `SELECT quantity, cost_value, purchase_cost_cents, allocated_freight_cents,
        additional_cost_cents, total_cost_cents, suggested_price_cents,
        sale_price_cents, price_manually_overridden
       FROM jewelry_variants WHERE id = ?`,
      [context.variantId]
    ),
    product: await db.get(
      "SELECT quantity, cost_value, purchase_cost_cents, total_cost_cents, sale_price_cents FROM jewelry_inventory WHERE id = ?",
      [context.productId]
    ),
    movements: await db.all("SELECT * FROM stock_movements WHERE purchase_order_id = ?", [first.json.id]),
    payables: await db.all("SELECT * FROM financial_entries WHERE source_type='purchase_order' AND source_id = ?", [first.json.id])
  }));
  assert.equal(Number(stateAfterFirst.variant.quantity), 5);
  assert.equal(Number(stateAfterFirst.variant.cost_value), 24);
  assert.equal(Number(stateAfterFirst.variant.purchase_cost_cents), 2400);
  assert.equal(Number(stateAfterFirst.variant.allocated_freight_cents), 200);
  assert.equal(Number(stateAfterFirst.variant.additional_cost_cents), 100);
  assert.equal(Number(stateAfterFirst.variant.total_cost_cents), 2700);
  assert.equal(Number(stateAfterFirst.variant.suggested_price_cents), 8100);
  assert.equal(Number(stateAfterFirst.variant.sale_price_cents), 5000);
  assert.equal(Number(stateAfterFirst.variant.price_manually_overridden), 1);
  assert.equal(Number(stateAfterFirst.product.quantity), 5);
  assert.equal(Number(stateAfterFirst.product.cost_value), 24);
  assert.equal(Number(stateAfterFirst.product.purchase_cost_cents), 2400);
  assert.equal(Number(stateAfterFirst.product.total_cost_cents), 2700);
  assert.equal(Number(stateAfterFirst.product.sale_price_cents), 5000);
  assert.equal(stateAfterFirst.movements.length, 1);
  assert.equal(stateAfterFirst.payables.length, 3);

  const repeated = await api("/purchases", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-test-confirmed-1" },
    body
  });
  assert.equal(repeated.status, 200, JSON.stringify(repeated.json));
  assert.equal(repeated.json.id, first.json.id);
  assert.equal(repeated.json.idempotent, true);

  const stateAfterRepeat = await withTenantSchema(context.tenant.id, async (db) => ({
    variant: await db.get("SELECT quantity FROM jewelry_variants WHERE id = ?", [context.variantId]),
    movements: await db.all("SELECT id FROM stock_movements WHERE purchase_order_id = ?", [first.json.id]),
    payables: await db.all("SELECT id FROM financial_entries WHERE source_type='purchase_order' AND source_id = ?", [first.json.id])
  }));
  assert.equal(Number(stateAfterRepeat.variant.quantity), 5);
  assert.equal(stateAfterRepeat.movements.length, 1);
  assert.equal(stateAfterRepeat.payables.length, 3);

  const deletion = await api(`/purchases/${first.json.id}`, { method: "DELETE" });
  assert.equal(deletion.status, 409, JSON.stringify(deletion.json));
});

test("rascunho não movimenta nada até a confirmação", async () => {
  const draft = await api("/purchases", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-test-draft-1" },
    body: {
      status: "draft",
      supplier_id: context.supplierId,
      purchase_date: "2026-08-23",
      first_due_date: "2026-09-05",
      installment_count: 1,
      payment_method: "Boleto",
      items: [{ product_id: context.productId, product_variant_id: context.variantId, quantity: 1, unit_cost: 20 }]
    }
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  assert.equal(draft.json.status, "draft");
  assert.equal(draft.json.payables.length, 0);

  const confirmed = await api(`/purchases/${draft.json.id}/confirm`, { method: "POST", body: {} });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  assert.equal(confirmed.json.status, "confirmed");
  assert.equal(confirmed.json.payables.length, 1);
});

test("fornecedor aceita PF e cadastros financeiros possuem PATCH", async () => {
  const supplier = await api("/finance/suppliers", {
    method: "POST",
    body: {
      name: "Fornecedor Pessoa Física", person_type: "PF", document: "529.982.247-25",
      contact_name: "Representante QA", whatsapp: "(11) 99999-8888", email: " COMERCIAL@EXEMPLO.COM ",
      website: "@fornecedor.qa", postal_code: "01310-100", city: "São Paulo", state: "sp",
      categories: ["Joias", "Materiais descartáveis"], brands: "Marca A, Marca B",
      certifications: ["ASTM F-136"], material_references: ["Titânio"], lot_references: ["Lote obrigatório"],
      payment_days: 30, lead_time_days: 7, minimum_order_value: 250, freight_terms: "CIF"
    }
  });
  assert.equal(supplier.status, 201, JSON.stringify(supplier.json));
  assert.equal(supplier.json.person_type, "PF");
  assert.equal(supplier.json.document, "52998224725");
  assert.equal(supplier.json.whatsapp, "+5511999998888");
  assert.equal(supplier.json.email, "comercial@exemplo.com");
  assert.deepEqual(supplier.json.categories, ["Joias", "Materiais descartáveis"]);
  assert.equal(supplier.json.state, "SP");
  const found = await api("/finance/suppliers?include_inactive=1&search=Titânio");
  assert.equal(found.status, 200, JSON.stringify(found.json));
  assert.ok(found.json.some((item) => item.id === supplier.json.id));
  const duplicate = await api("/finance/suppliers", { method: "POST", body: { name: "Duplicado QA", person_type: "PF", document: "52998224725" } });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.json));
  const updatedSupplier = await api(`/finance/suppliers/${supplier.json.id}`, {
    method: "PATCH",
    body: { phone: "11999998888", is_active: 0 }
  });
  assert.equal(updatedSupplier.status, 200, JSON.stringify(updatedSupplier.json));
  assert.equal(Number(updatedSupplier.json.is_active), 0);

  const category = await api("/finance/categories", { method: "POST", body: { name: "Compra QA" } });
  const categoryPatch = await api(`/finance/categories/${category.json.id}`, { method: "PATCH", body: { name: "Compras QA" } });
  assert.equal(categoryPatch.status, 200, JSON.stringify(categoryPatch.json));
  assert.equal(categoryPatch.json.name, "Compras QA");

  const center = await api("/finance/cost-centers", { method: "POST", body: { name: "Estoque QA" } });
  const centerPatch = await api(`/finance/cost-centers/${center.json.id}`, { method: "PATCH", body: { description: "Entradas de mercadoria" } });
  assert.equal(centerPatch.status, 200, JSON.stringify(centerPatch.json));
  assert.equal(centerPatch.json.description, "Entradas de mercadoria");
});
