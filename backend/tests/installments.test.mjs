import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { req, testSlug } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const context = {};

async function createTenantWithCurrentLegal() {
  const slug = testSlug("installments");
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
      name: `Clinica ${slug}`, slug, admin_name: "Administrador Parcelas", admin_email: adminEmail,
      admin_password: adminPassword, phone: "11999990000", city: "Salvador", state: "BA",
      plan: "profissional", legal_acceptances: legalAcceptances
    }
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  return { slug, tenant: signup.json.tenant, token: signup.json.token };
}

function api(path, options = {}) {
  return req(path, { tenant: context.slug, token: context.token, ...options });
}

function explicitInstallments() {
  return [
    { amount: 10, due_date: "2026-09-05", payment_method: "Pix" },
    { amount: 30, due_date: "2026-10-20", payment_method: "Boleto" },
    { amount: 60, due_date: "2027-01-15", payment_method: "Cartão de crédito" }
  ];
}

function installmentSnapshot(rows) {
  return rows.map((item) => ({
    number: Number(item.installment_number),
    count: Number(item.installment_count),
    amount: Number(item.amount),
    due_date: item.due_date,
    payment_method: item.payment_method
  }));
}

before(async () => {
  Object.assign(context, await createTenantWithCurrentLegal());
  const supplier = await api("/finance/suppliers", {
    method: "POST",
    body: { name: "Fornecedor Parcelas QA", person_type: "PJ", document: "12345678000190" }
  });
  assert.equal(supplier.status, 201, JSON.stringify(supplier.json));
  context.supplierId = supplier.json.id;

  const product = await api("/jewelry", {
    method: "POST",
    body: {
      name: "Joia Parcelas QA", category: "Labret", material: "Titânio", color: "Prata",
      quantity: 30, cost_value: 10, sale_value: 100
    }
  });
  assert.equal(product.status, 201, JSON.stringify(product.json));
  context.productId = product.json.id;
  context.variantId = product.json.variants[0].id;
});

after(async () => {
  if (context.tenant?.id) await deprovisionTenant(context.tenant.id);
});

function purchaseBody(overrides = {}) {
  return {
    supplier_id: context.supplierId,
    purchase_date: "2026-08-22",
    first_due_date: "2026-08-31",
    installment_count: 1,
    payment_method: "Pix",
    items: [{ product_id: context.productId, product_variant_id: context.variantId, quantity: 1, unit_cost: 100 }],
    ...overrides
  };
}

test("compra respeita quantidade, valores, vencimentos e métodos das parcelas explícitas", async () => {
  const created = await api("/purchases", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-explicit-installments" },
    body: purchaseBody({ installments: explicitInstallments() })
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(installmentSnapshot(created.json.payables), [
    { number: 1, count: 3, amount: 10, due_date: "2026-09-05", payment_method: "Pix" },
    { number: 2, count: 3, amount: 30, due_date: "2026-10-20", payment_method: "Boleto" },
    { number: 3, count: 3, amount: 60, due_date: "2027-01-15", payment_method: "Cartão de crédito" }
  ]);
});

test("compra rejeita parcelas explícitas cuja soma difere do total", async () => {
  const created = await api("/purchases", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-invalid-installment-sum" },
    body: purchaseBody({
      installments: [
        { amount: 49.99, due_date: "2026-09-05", payment_method: "Pix" },
        { amount: 50, due_date: "2026-10-05", payment_method: "Boleto" }
      ]
    })
  });
  assert.equal(created.status, 400, "a compra e a entrada de estoque não podem existir com soma inválida");
});

test("compra sem lista explícita usa fallback mensal exato e não duplica na repetição", async () => {
  const request = {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-fallback-idempotent" },
    body: purchaseBody({ first_due_date: "2026-08-31", installment_count: 3, items: [
      { product_id: context.productId, product_variant_id: context.variantId, quantity: 3, unit_cost: 33.33 }
    ] })
  };
  const first = await api("/purchases", request);
  const repeated = await api("/purchases", request);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(repeated.status, 200, JSON.stringify(repeated.json));
  assert.equal(repeated.json.id, first.json.id);
  assert.deepEqual(first.json.payables.map((item) => Number(item.amount)), [33.33, 33.33, 33.33]);
  assert.deepEqual(first.json.payables.map((item) => item.due_date), ["2026-08-31", "2026-09-30", "2026-10-31"]);
  const state = await withTenantSchema(context.tenant.id, (db) => db.all(
    "SELECT id FROM financial_entries WHERE source_type='purchase_order' AND source_id=? AND entry_type='payable'",
    [first.json.id]
  ));
  assert.equal(state.length, 3);
});

function saleBody(overrides = {}) {
  return {
    full_name: "Cliente Parcelas QA", whatsapp: "11988887777", status: "aberta",
    receivable_mode: "pending", installment_count: 1, first_due_date: "2026-08-31", payment_method: "Pix",
    items: [{ item_name: "Joia Parcelas QA", product_id: context.productId, product_variant_id: context.variantId, quantity: 1, unit_price: 100 }],
    ...overrides
  };
}

test("venda respeita parcelas explícitas e PATCH repetido não duplica recebíveis", async () => {
  const sale = await api("/sales-orders", {
    method: "POST",
    body: saleBody({ installments: explicitInstallments() })
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const selectReceivables = () => withTenantSchema(context.tenant.id, (db) => db.all(
    `SELECT amount,due_date,payment_method,installment_number,installment_count
     FROM financial_entries
     WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable' AND status!='canceled'
     ORDER BY installment_number,id`,
    [sale.json.id]
  ));
  const openState = await withTenantSchema(context.tenant.id, (db) => db.get(
    "SELECT installments_json FROM sales_orders WHERE id=?",
    [sale.json.id]
  ));
  assert.equal(openState.installments_json.length, 3, "a venda aberta preserva o cronograma sem gerar título");
  assert.equal((await selectReceivables()).length, 0, "venda aberta ainda não materializa recebíveis");
  const patch = { method: "PATCH", body: { status: "concluida", installments: explicitInstallments() } };
  const first = await api(`/sales-orders/${sale.json.id}`, patch);
  const repeated = await api(`/sales-orders/${sale.json.id}`, patch);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(repeated.status, 200, JSON.stringify(repeated.json));
  const receivables = await selectReceivables();
  assert.deepEqual(installmentSnapshot(receivables), [
    { number: 1, count: 3, amount: 10, due_date: "2026-09-05", payment_method: "Pix" },
    { number: 2, count: 3, amount: 30, due_date: "2026-10-20", payment_method: "Boleto" },
    { number: 3, count: 3, amount: 60, due_date: "2027-01-15", payment_method: "Cartão de crédito" }
  ]);
});

test("venda rejeita soma explícita inválida antes de baixar estoque", async () => {
  const before = await withTenantSchema(context.tenant.id, (db) => db.get(
    "SELECT quantity FROM jewelry_variants WHERE id=?",
    [context.variantId]
  ));
  const completed = await api("/sales-orders", {
    method: "POST",
    body: saleBody({
      whatsapp: "11988887776", status: "concluida",
      installments: [
        { amount: 40, due_date: "2026-09-05", payment_method: "Pix" },
        { amount: 59.99, due_date: "2026-10-05", payment_method: "Boleto" }
      ]
    })
  });
  assert.equal(completed.status, 400);
  const after = await withTenantSchema(context.tenant.id, (db) => db.get(
    "SELECT quantity FROM jewelry_variants WHERE id=?",
    [context.variantId]
  ));
  assert.equal(Number(after.quantity), Number(before.quantity));
});

test("venda sem lista explícita mantém fallback mensal com soma exata", async () => {
  const sale = await api("/sales-orders", {
    method: "POST",
    body: saleBody({
      full_name: "Cliente Fallback Venda", whatsapp: "11988887775", status: "concluida",
      installment_count: 3, first_due_date: "2026-01-31"
    })
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const receivables = await withTenantSchema(context.tenant.id, (db) => db.all(
    `SELECT amount,due_date,payment_method FROM financial_entries
     WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable' AND status!='canceled'
     ORDER BY installment_number,id`,
    [sale.json.id]
  ));
  assert.deepEqual(receivables.map((item) => Number(item.amount)), [33.34, 33.33, 33.33]);
  assert.deepEqual(receivables.map((item) => item.due_date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.ok(receivables.every((item) => item.payment_method === "Pix"));
});

test("lançamento financeiro respeita parcelas explícitas distintas", async () => {
  const created = await api("/finance/entries", {
    method: "POST",
    headers: { "Idempotency-Key": "finance-explicit-installments" },
    body: {
      entry_type: "payable", description: "Parcelas financeiras explícitas", amount: 100,
      due_date: "2026-08-31", payment_method: "Pix", installments: explicitInstallments()
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(installmentSnapshot(created.json), [
    { number: 1, count: 3, amount: 10, due_date: "2026-09-05", payment_method: "Pix" },
    { number: 2, count: 3, amount: 30, due_date: "2026-10-20", payment_method: "Boleto" },
    { number: 3, count: 3, amount: 60, due_date: "2027-01-15", payment_method: "Cartão de crédito" }
  ]);
});

test("lançamento financeiro rejeita soma explícita inválida", async () => {
  const created = await api("/finance/entries", {
    method: "POST",
    body: {
      entry_type: "receivable", description: "Soma inválida", amount: 100, due_date: "2026-09-05",
      installments: [
        { amount: 25, due_date: "2026-09-05", payment_method: "Pix" },
        { amount: 74.99, due_date: "2026-10-05", payment_method: "Pix" }
      ]
    }
  });
  assert.equal(created.status, 400);
});

test("lançamento financeiro automático preserva centavos, datas mensais e idempotência", async () => {
  const request = {
    method: "POST",
    headers: { "Idempotency-Key": "finance-fallback-idempotent" },
    body: {
      entry_type: "receivable", description: "Fallback financeiro idempotente", amount: 100,
      due_date: "2026-01-31", payment_method: "Pix", installment_count: 3
    }
  };
  const first = await api("/finance/entries", request);
  const repeated = await api("/finance/entries", request);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(repeated.status, 200, JSON.stringify(repeated.json));
  assert.deepEqual(first.json.map((item) => Number(item.amount)), [33.34, 33.33, 33.33]);
  assert.deepEqual(first.json.map((item) => item.due_date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.deepEqual(repeated.json.map((item) => item.id), first.json.map((item) => item.id));
});
