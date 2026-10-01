// Desconto manual em vendas, cotação oficial, cupom com uso gravado e
// devolução pelo líquido (SPEC seções 2.2/2.3 e 9/BE-VENDAS).
//
// Rode (de backend/):
//   node tests/run-suite.mjs tests/salesManualDiscount.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";
import {
  allocateCents,
  percentOfCents,
  proportionalReturnCents,
  salesItemDiscountCents,
  validateCoupon
} from "../src/services/discounts.js";

const PW = "SenhaForte123";
const ctx = { tenant: null, slug: "", token: "", tokens: {}, productId: null, variantId: null, clientId: null };
const api = (path, options = {}) => req(path, { tenant: ctx.slug, token: options.token ?? ctx.token, ...options });
const db = (fn) => withTenantSchema(ctx.tenant.id, fn);
const cents = (value) => Math.round(Number(value) * 100);

const baseSale = (overrides = {}) => ({
  client_id: ctx.clientId,
  full_name: "Cliente QA Desconto",
  whatsapp: "5511988887771",
  status: "concluida",
  payment_method: "Pix",
  ...overrides
});

// Dois itens avulsos (sem produto): bruto 100,00 + 49,90 = 149,90.
const twoItems = () => [
  { item_name: "Item A", quantity: 1, unit_price: 100 },
  { item_name: "Item B", quantity: 1, unit_price: 49.9 }
];

async function createUser(role, overrides = []) {
  const email = `${role}-${overrides.length ? "restrito" : "padrao"}@${ctx.slug}.test`;
  const created = await api("/users", {
    method: "POST",
    body: { name: `QA ${role}`, email, password: PW, role, permission_overrides: overrides }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return (await loginTenant(ctx.slug, email, PW)).token;
}

async function createProduct(name, salePrice, quantity = 30) {
  const product = await api("/jewelry", { method: "POST", body: {
    name, category_id: ctx.categoryId, category: "QA Descontos",
    material: "Titanio", color: "Natural", is_catalog_active: true,
    variants: [{ sku: `QA-DESC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, variation_name: "8 mm", material: "Titanio", color: "Natural", quantity, cost_value: 10, sale_value: salePrice }]
  } });
  assert.equal(product.status, 201, JSON.stringify(product.json));
  return { productId: product.json.id, variantId: product.json.variants[0].id };
}

test.before(async () => {
  const created = await createTenant("qa-sales-discount");
  ctx.tenant = created.tenant;
  ctx.slug = created.slug;
  ctx.token = (await loginTenant(created.slug, created.adminEmail, created.adminPassword)).token;

  const category = await api("/inventory-categories", { method: "POST", body: { name: "QA Descontos" } });
  assert.equal(category.status, 201, JSON.stringify(category.json));
  ctx.categoryId = category.json.id;

  const client = await api("/clients", { method: "POST", body: { full_name: "Cliente QA Desconto", whatsapp: "5511988887771" } });
  assert.equal(client.status, 201, JSON.stringify(client.json));
  ctx.clientId = client.json.id;

  ctx.tokens.reception = await createUser("reception");
  ctx.tokens.restricted = await createUser("reception", [
    { permission: "sales.apply_discount", allowed: false },
    { permission: "coupons.apply", allowed: false }
  ]);
});

test.after(async () => {
  if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id);
});

// ---------------------------------------------------------------------------
// Aritmética pura (centavos inteiros)
// ---------------------------------------------------------------------------

test("rateio pelo maior resto soma exatamente e respeita o bruto de cada item", () => {
  // R$ 10,00 entre A = 100,00 e B = 49,90: cotas 667,11 e 332,89 → 667 + 333.
  assert.deepEqual(allocateCents(1000, [10000, 4990]), [667, 333]);
  // Empate de restos: o primeiro item leva o centavo.
  assert.deepEqual(allocateCents(1, [100, 100]), [1, 0]);
  assert.deepEqual(allocateCents(0, [100, 200]), [0, 0]);
  // Desconto total = bruto: cada item fica 100% descontado.
  assert.deepEqual(allocateCents(300, [100, 200]), [100, 200]);
  for (const [total, weights] of [[997, [333, 333, 334]], [12345, [1, 99999, 7, 3]], [5, [1, 1, 1, 1, 1, 1, 1]]]) {
    const parts = allocateCents(total, weights);
    assert.equal(parts.reduce((sum, value) => sum + value, 0), total);
    for (const [index, value] of parts.entries()) assert.ok(value <= weights[index]);
  }
  assert.throws(() => allocateCents(1, [0, 0]));
});

test("percentual vira centavos com meio para cima e devolução acumulada fecha o líquido", () => {
  assert.equal(percentOfCents(14990, 1000), 1499); // 10% de 149,90
  assert.equal(percentOfCents(14990, 1250), 1874); // 12,5% de 149,90 = 18,7375 → 18,74
  assert.equal(percentOfCents(5, 5000), 3); // 2,5 centavos → 3 (meio para cima)
  // 3 unidades com líquido 10.001 centavos, devolvidas uma a uma.
  const steps = [0, 1, 2].map((before) => proportionalReturnCents(10001, 3, before, 1));
  assert.deepEqual(steps, [3334, 3333, 3334]);
  assert.equal(steps.reduce((sum, value) => sum + value, 0), 10001);
  // Em lote, o mesmo total.
  assert.equal(proportionalReturnCents(10001, 3, 0, 2) + proportionalReturnCents(10001, 3, 2, 1), 10001);
  assert.throws(() => proportionalReturnCents(100, 2, 1, 2));
  // Venda antiga: desconto só no pedido → rateio calculado na hora.
  assert.deepEqual(salesItemDiscountCents(10, [{ unit_price: 100, quantity: 1 }, { unit_price: 49.9, quantity: 1 }]), [667, 333]);
  // Venda nova: vale o rateio gravado.
  assert.deepEqual(salesItemDiscountCents(10, [{ unit_price: 100, quantity: 1, discount_value: 6 }, { unit_price: 49.9, quantity: 1, discount_value: 4 }]), [600, 400]);
});

test("validateCoupon tira o próprio agendamento/venda da contagem de usos", async () => {
  const calls = [];
  const fakeDb = {
    get: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM coupons")) {
        return { id: 7, code: "UNICO", internal_name: "Único", status: "active", discount_type: "fixed", discount_value: 5, minimum_amount: 0, usage_limit: 1, usage_limit_per_client: null, is_stackable: 0 };
      }
      // O único uso existente pertence ao agendamento 42 / venda 9.
      const excluded = /appointment_id IS DISTINCT FROM/.test(sql) && params.includes(42)
        || /sale_id IS DISTINCT FROM/.test(sql) && params.includes(9);
      return { count: excluded ? 0 : 1 };
    }
  };
  assert.equal((await validateCoupon(fakeDb, "unico", { amount: 50 })).valid, false);
  assert.equal((await validateCoupon(fakeDb, "unico", { amount: 50 }, { excludeAppointmentId: 42 })).valid, true);
  assert.equal((await validateCoupon(fakeDb, "unico", { amount: 50 }, { excludeSalesOrderId: 9 })).valid, true);
  // A exclusão só vale pelo 4º argumento: no contexto (que pode vir do corpo
  // de uma rota pública) ela é ignorada e o limite continua contando.
  assert.equal((await validateCoupon(fakeDb, "unico", { amount: 50, excludeSalesOrderId: 9 })).valid, false);
  assert.equal((await validateCoupon(fakeDb, "unico", { amount: 50, excludeAppointmentId: 42 })).valid, false);
  // Valor malformado nunca desliga a contagem.
  assert.equal((await validateCoupon(fakeDb, "unico", { amount: 50 }, { excludeAppointmentId: "abc" })).valid, false);
  await validateCoupon(fakeDb, "unico", { amount: 50 }, { forUpdate: true });
  assert.match(calls.filter((call) => call.sql.includes("FROM coupons")).at(-1).sql, /FOR UPDATE/);
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

test("desconto manual: 149,90 − 10,00 = 139,90, rateio gravado por item e auditoria na venda", async () => {
  const sale = await api("/sales-orders", { method: "POST", body: baseSale({
    items: twoItems(), manual_discount_value: 10, manual_discount_reason: "Cliente fidelidade"
  }) });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(Number(sale.json.subtotal_value), 149.9);
  assert.equal(Number(sale.json.discount_value), 10);
  assert.equal(Number(sale.json.manual_discount_value), 10);
  assert.equal(Number(sale.json.total_value), 139.9);
  assert.equal(sale.json.manual_discount_reason, "Cliente fidelidade");
  assert.ok(sale.json.manual_discount_updated_by, "autor do desconto gravado");
  assert.ok(sale.json.manual_discount_updated_at, "data do desconto gravada");
  assert.deepEqual(sale.json.items.map((item) => Number(item.discount_value)), [6.67, 3.33]);
  assert.deepEqual(sale.json.items.map((item) => Number(item.net_value)), [93.33, 46.57]);

  const stored = await db(async (tx) => ({
    items: await tx.all("SELECT discount_value FROM sales_order_items WHERE sales_order_id=? ORDER BY id", [sale.json.id]),
    payment: await tx.get("SELECT amount FROM payments WHERE sales_order_id=?", [sale.json.id]),
    audit: await tx.get("SELECT before_data, after_data, actor_user_id, reason FROM audit_events WHERE module='sales' AND action='discount' AND entity_id=?", [String(sale.json.id)]),
    create: await tx.get("SELECT COUNT(*) AS count FROM audit_events WHERE module='sales' AND action='create' AND entity_id=?", [String(sale.json.id)])
  }));
  assert.equal(stored.items.reduce((sum, item) => sum + cents(item.discount_value), 0), 1000, "rateio soma exatamente o desconto");
  assert.equal(Number(stored.payment.amount), 139.9, "pagamento pelo líquido");
  assert.ok(stored.audit, "auditoria do desconto manual gravada");
  assert.equal(Number(stored.audit.before_data.manual_discount_value), 0);
  assert.equal(Number(stored.audit.after_data.manual_discount_value), 10);
  assert.equal(stored.audit.after_data.manual_discount_reason, "Cliente fidelidade");
  assert.equal(stored.audit.reason, "Cliente fidelidade");
  assert.ok(stored.audit.actor_user_id);
  assert.equal(Number(stored.create.count), 1, "auditoria da criação gravada uma vez");
});

test("percentual é convertido em R$ sobre o bruto e o que se grava é o valor", async () => {
  const sale = await api("/sales-orders", { method: "POST", body: baseSale({ items: twoItems(), manual_discount_percent: 12.5 }) });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(Number(sale.json.manual_discount_value), 18.74);
  assert.equal(Number(sale.json.total_value), 131.16);
  assert.equal(sale.json.items.reduce((sum, item) => sum + cents(item.discount_value), 0), 1874);
});

test("teto: cupom + manual acima do bruto e valores malformados são recusados", async () => {
  const above = await api("/sales-orders", { method: "POST", body: baseSale({ items: twoItems(), manual_discount_value: 149.91 }) });
  assert.equal(above.status, 400, JSON.stringify(above.json));
  assert.equal(above.json.error, "O desconto não pode ser maior que o valor bruto.");
  for (const value of [-1, "abc", 1.234]) {
    const invalid = await api("/sales-orders", { method: "POST", body: baseSale({ items: twoItems(), manual_discount_value: value }) });
    assert.equal(invalid.status, 400, `${value}: ${JSON.stringify(invalid.json)}`);
  }
  const percent = await api("/sales-orders", { method: "POST", body: baseSale({ items: twoItems(), manual_discount_percent: 101 }) });
  assert.equal(percent.status, 400, JSON.stringify(percent.json));
  // Desconto igual ao bruto é permitido (venda de R$ 0,00).
  const full = await api("/sales-orders/quote", { method: "POST", body: baseSale({ items: twoItems(), manual_discount_value: 149.9 }) });
  assert.equal(full.status, 200, JSON.stringify(full.json));
  assert.equal(Number(full.json.total_value), 0);
});

test("sem sales.apply_discount: 403 na criação e na cotação; sem desconto a venda segue", async () => {
  const token = ctx.tokens.restricted;
  const denied = await api("/sales-orders", { token, method: "POST", body: baseSale({ items: twoItems(), manual_discount_value: 5 }) });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  assert.equal(denied.json.error, "Você não tem permissão para aplicar desconto.");
  const deniedQuote = await api("/sales-orders/quote", { token, method: "POST", body: baseSale({ items: twoItems(), manual_discount_percent: 5 }) });
  assert.equal(deniedQuote.status, 403, JSON.stringify(deniedQuote.json));
  // Zero não é desconto: a tela pode mandar o campo zerado.
  const plain = await api("/sales-orders", { token, method: "POST", body: baseSale({ items: twoItems(), manual_discount_value: 0 }) });
  assert.equal(plain.status, 201, JSON.stringify(plain.json));
  assert.equal(Number(plain.json.total_value), 149.9);
  // Recepção padrão tem a permissão pelo cargo.
  const allowed = await api("/sales-orders", { token: ctx.tokens.reception, method: "POST", body: baseSale({ items: twoItems(), manual_discount_value: 5 }) });
  assert.equal(allowed.status, 201, JSON.stringify(allowed.json));
  assert.equal(Number(allowed.json.total_value), 144.9);
});

test("cotação oficial devolve exatamente o que a criação grava", async () => {
  const body = baseSale({ items: twoItems(), manual_discount_value: 10, manual_discount_reason: "Conferência" });
  const quote = await api("/sales-orders/quote", { method: "POST", body });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));
  assert.equal(quote.json.summary.grossTotal, 149.9);
  assert.equal(quote.json.summary.discountTotal, 10);
  assert.equal(quote.json.summary.netTotal, 139.9);
  assert.equal(quote.json.summary.manualDiscount, 10);
  const salesBefore = await db((tx) => tx.get("SELECT COUNT(*) AS count FROM sales_orders"));
  const sale = await api("/sales-orders", { method: "POST", body });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(Number((await db((tx) => tx.get("SELECT COUNT(*) AS count FROM sales_orders"))).count), Number(salesBefore.count) + 1, "a cotação não grava venda");
  for (const key of ["subtotal_value", "discount_value", "manual_discount_value", "total_value"]) {
    assert.equal(Number(sale.json[key]), Number(quote.json[key]), key);
  }
  assert.deepEqual(
    sale.json.items.map((item) => Number(item.discount_value)),
    quote.json.items.map((item) => Number(item.discount_value))
  );
});

test("unit_price e quantity inválidos na venda interna → 400", async () => {
  const cases = [
    { item_name: "Negativo", quantity: 1, unit_price: -10 },
    { item_name: "Texto", quantity: 1, unit_price: "abc" },
    { item_name: "Três casas", quantity: 1, unit_price: 10.005 },
    { item_name: "Sem preço", quantity: 1 },
    { item_name: "Fracionado", quantity: 1.5, unit_price: 10 },
    { item_name: "Zero", quantity: 0, unit_price: 10 }
  ];
  for (const item of cases) {
    const response = await api("/sales-orders", { method: "POST", body: baseSale({ items: [item] }) });
    assert.equal(response.status, 400, `${item.item_name}: ${JSON.stringify(response.json)}`);
    const quote = await api("/sales-orders/quote", { method: "POST", body: baseSale({ items: [item] }) });
    assert.equal(quote.status, 400, `cotação ${item.item_name}: ${JSON.stringify(quote.json)}`);
  }
});

test("venda pública recusa manual_discount_*", async () => {
  for (const extra of [{ manual_discount_value: 5 }, { manual_discount_percent: 10 }, { manual_discount_value: 0 }]) {
    const response = await req("/sales-orders/public", { method: "POST", tenant: ctx.slug, body: {
      full_name: "Cliente Catálogo", whatsapp: "5511900001234", accepted_policies: true,
      items: [{ item_name: "Qualquer", product_id: 1, quantity: 1, unit_price: 10 }], ...extra
    } });
    assert.equal(response.status, 400, JSON.stringify(response.json));
    assert.match(response.json.error, /Desconto manual não é permitido/);
  }
});

test("cupom exige coupons.apply, grava coupon_usages com sale_id e a devolução usa o líquido", async () => {
  const product = await createProduct("Labret QA cupom", 60);
  await db((tx) => tx.run(
    "INSERT INTO coupons (code, internal_name, discount_type, discount_value, status) VALUES ('QADEZ', 'QA 10%', 'percent', 10, 'active')"
  ));
  const items = [{ item_name: "Labret QA cupom", product_id: product.productId, product_variant_id: product.variantId, quantity: 2, unit_price: 60 }];

  const denied = await api("/sales-orders", { token: ctx.tokens.restricted, method: "POST", body: baseSale({ items, coupon_code: "QADEZ" }) });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  assert.equal(denied.json.error, "Você não tem permissão para aplicar cupom.");

  const sale = await api("/sales-orders", { method: "POST", body: baseSale({ items, coupon_code: "qadez" }) });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(Number(sale.json.subtotal_value), 120);
  assert.equal(Number(sale.json.discount_value), 12);
  assert.equal(Number(sale.json.manual_discount_value), 0);
  assert.equal(Number(sale.json.total_value), 108);
  assert.equal(Number(sale.json.items[0].discount_value), 12);

  const usage = await db((tx) => tx.all("SELECT * FROM coupon_usages WHERE sale_id=?", [sale.json.id]));
  assert.equal(usage.length, 1, "uso do cupom gravado com sale_id");
  assert.equal(Number(usage[0].client_id), ctx.clientId);
  assert.equal(Number(usage[0].original_amount), 120);
  assert.equal(Number(usage[0].discount_amount), 12);
  assert.equal(Number(usage[0].final_amount), 108);

  // Devolver 1 de 2 unidades devolve R$ 54,00 (o que foi pago), não R$ 60,00.
  const returned = await api(`/sales-orders/${sale.json.id}/returns`, { method: "POST", body: {
    reason: "Troca QA cupom", financial_action: "client_credit",
    items: [{ sales_order_item_id: sale.json.items[0].id, quantity: 1, condition: "sellable", return_to_stock: true }]
  } });
  assert.equal(returned.status, 201, JSON.stringify(returned.json));
  assert.equal(Number(returned.json.total_value), 54);
  assert.equal(Number(returned.json.financial_value), 54);
  assert.equal(Number(returned.json.gross_value), 60);
  assert.equal(Number(returned.json.discount_value), 6);
  assert.equal(Number(returned.json.items[0].net_value), 54);
  assert.equal(Number(returned.json.items[0].unit_price), 60);
  const credit = await db((tx) => tx.get("SELECT amount FROM client_credits WHERE sales_return_id=?", [returned.json.id]));
  assert.equal(Number(credit.amount), 54);
});

test("devolução parcial com arredondamento acumulado fecha exatamente o líquido do item", async () => {
  const product = await createProduct("Argola QA acumulado", 33.34);
  const sale = await api("/sales-orders", { method: "POST", body: baseSale({
    items: [{ item_name: "Argola QA acumulado", product_id: product.productId, product_variant_id: product.variantId, quantity: 3, unit_price: 33.34 }],
    manual_discount_value: 0.01, manual_discount_reason: "Arredondamento"
  }) });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(Number(sale.json.total_value), 100.01);
  const itemId = sale.json.items[0].id;
  const values = [];
  for (let step = 0; step < 3; step += 1) {
    const returned = await api(`/sales-orders/${sale.json.id}/returns`, { method: "POST", body: {
      reason: `Devolução ${step + 1}`, financial_action: "client_credit",
      items: [{ sales_order_item_id: itemId, quantity: 1, condition: "sellable", return_to_stock: true }]
    } });
    assert.equal(returned.status, 201, JSON.stringify(returned.json));
    values.push(cents(returned.json.total_value));
  }
  assert.deepEqual(values, [3334, 3333, 3334]);
  assert.equal(values.reduce((sum, value) => sum + value, 0), 10001);
  const order = await db((tx) => tx.get("SELECT status FROM sales_orders WHERE id=?", [sale.json.id]));
  assert.equal(order.status, "devolvida");
});

test("item 100% descontado pode ser devolvido: volta o estoque, sem valor financeiro", async () => {
  const product = await createProduct("Brinde QA", 50);
  const sale = await api("/sales-orders", { method: "POST", body: baseSale({
    items: [{ item_name: "Brinde QA", product_id: product.productId, product_variant_id: product.variantId, quantity: 1, unit_price: 50 }],
    manual_discount_value: 50, manual_discount_reason: "Brinde"
  }) });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(Number(sale.json.total_value), 0);
  const stockBefore = await db((tx) => tx.get("SELECT quantity FROM jewelry_variants WHERE id=?", [product.variantId]));
  const returned = await api(`/sales-orders/${sale.json.id}/returns`, { method: "POST", body: {
    reason: "Devolução do brinde", financial_action: "none",
    items: [{ sales_order_item_id: sale.json.items[0].id, quantity: 1, condition: "sellable", return_to_stock: true }]
  } });
  assert.equal(returned.status, 201, JSON.stringify(returned.json));
  assert.equal(Number(returned.json.total_value), 0);
  assert.equal(Number(returned.json.financial_value), 0);
  assert.equal(returned.json.financial_action, "none");
  const after = await db(async (tx) => ({
    stock: await tx.get("SELECT quantity FROM jewelry_variants WHERE id=?", [product.variantId]),
    credits: await tx.get("SELECT COUNT(*) AS count FROM client_credits WHERE sales_return_id=?", [returned.json.id])
  }));
  assert.equal(Number(after.stock.quantity), Number(stockBefore.quantity) + 1);
  assert.equal(Number(after.credits.count), 0);
});

// ---------------------------------------------------------------------------
// Casos achados na verificação adversarial
// ---------------------------------------------------------------------------

test("cupom + desconto manual: % convertido sobre bruto − cupom e teto conjunto", async () => {
  await db((tx) => tx.run(
    "INSERT INTO coupons (code, internal_name, discount_type, discount_value, status) VALUES ('QACOMBO', 'QA combo 10%', 'percent', 10, 'active')"
  ));
  // Bruto 149,90; cupom 10% = 14,99; manual 10% sobre 134,91 = 13,491 → 13,49.
  const quote = await api("/sales-orders/quote", { method: "POST", body: baseSale({
    items: twoItems(), coupon_code: "QACOMBO", manual_discount_percent: 10
  }) });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));
  assert.equal(Number(quote.json.coupon_discount_value), 14.99);
  assert.equal(Number(quote.json.manual_discount_value), 13.49);
  assert.equal(Number(quote.json.discount_value), 28.48);
  assert.equal(Number(quote.json.total_value), 121.42);
  assert.equal(quote.json.items.reduce((sum, item) => sum + cents(item.discount_value), 0), 2848);
  // Cupom 14,99 + manual 134,92 passa do bruto por 1 centavo.
  const above = await api("/sales-orders/quote", { method: "POST", body: baseSale({
    items: twoItems(), coupon_code: "QACOMBO", manual_discount_value: 134.92
  }) });
  assert.equal(above.status, 400, JSON.stringify(above.json));
  assert.equal(above.json.error, "O desconto não pode ser maior que o valor bruto.");
  const exact = await api("/sales-orders/quote", { method: "POST", body: baseSale({
    items: twoItems(), coupon_code: "QACOMBO", manual_discount_value: 134.91
  }) });
  assert.equal(exact.status, 200, JSON.stringify(exact.json));
  assert.equal(Number(exact.json.total_value), 0);
});

test("uso de cupom em venda conta no limite de usos", async () => {
  await db((tx) => tx.run(
    "INSERT INTO coupons (code, internal_name, discount_type, discount_value, status, usage_limit) VALUES ('QAUNICO', 'QA único', 'fixed', 5, 'active', 1)"
  ));
  const first = await api("/sales-orders", { method: "POST", body: baseSale({ items: twoItems(), coupon_code: "QAUNICO" }) });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(Number(first.json.total_value), 144.9);
  for (const path of ["/sales-orders", "/sales-orders/quote"]) {
    const again = await api(path, { method: "POST", body: baseSale({ items: twoItems(), coupon_code: "QAUNICO" }) });
    assert.equal(again.status, 400, `${path}: ${JSON.stringify(again.json)}`);
    assert.equal(again.json.error, "Limite de usos atingido.");
  }
});

test("cotação recusa o mesmo carrinho que a criação recusa (serviço, quantidade/valor fora do limite)", async () => {
  const cases = [
    [{ item_name: "Serviço avulso", item_type: "servico", quantity: 1, unit_price: 10 }],
    [{ item_name: "Enorme", quantity: 3_000_000_000, unit_price: 1 }],
    [{ item_name: "Caro", quantity: 2, unit_price: 9_999_999_999.99 }]
  ];
  for (const items of cases) {
    for (const path of ["/sales-orders", "/sales-orders/quote"]) {
      const response = await api(path, { method: "POST", body: baseSale({ items }) });
      assert.equal(response.status, 400, `${path} ${items[0].item_name}: ${JSON.stringify(response.json)}`);
    }
  }
});

test("devolução nunca passa do líquido do item quando já houve devolução antiga pelo bruto", async () => {
  const product = await createProduct("Labret QA legado", 60);
  await db((tx) => tx.run(
    "INSERT INTO coupons (code, internal_name, discount_type, discount_value, status) VALUES ('QALEGADO', 'QA legado 10%', 'percent', 10, 'active')"
  ));
  const sale = await api("/sales-orders", { method: "POST", body: baseSale({
    items: [{ item_name: "Labret QA legado", product_id: product.productId, product_variant_id: product.variantId, quantity: 2, unit_price: 60 }],
    coupon_code: "QALEGADO"
  }) });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(Number(sale.json.total_value), 108);
  const itemId = sale.json.items[0].id;
  // Devolução registrada pelo código antigo: 1 unidade pelo bruto (R$ 60,00),
  // sem `net_value`.
  await db(async (tx) => {
    const legacy = await tx.run(
      `INSERT INTO sales_returns (sales_order_id, client_id, financial_action, total_value, financial_value, reason)
       VALUES (?, ?, 'client_credit', 60, 60, 'Devolução antiga') RETURNING id`,
      [sale.json.id, sale.json.client_id]
    );
    await tx.run(
      `INSERT INTO sales_return_items (sales_return_id, sales_order_item_id, quantity, unit_price, return_to_stock, condition)
       VALUES (?, ?, 1, 60, false, 'sellable')`,
      [legacy.returnedId, itemId]
    );
  });
  const returned = await api(`/sales-orders/${sale.json.id}/returns`, { method: "POST", body: {
    reason: "Última unidade", financial_action: "client_credit",
    items: [{ sales_order_item_id: itemId, quantity: 1, condition: "sellable", return_to_stock: true }]
  } });
  assert.equal(returned.status, 201, JSON.stringify(returned.json));
  // Líquido do item 108,00 − 60,00 já devolvidos = 48,00 (e não 54,00).
  assert.equal(Number(returned.json.total_value), 48);
});

test("pedido público com cupom grava o uso e não devolve o cadastro de quem tem o mesmo WhatsApp", async () => {
  const product = await api("/jewelry", { method: "POST", body: {
    name: "Joia QA pública", category_id: ctx.categoryId, category: "QA Descontos", material: "Titanio", color: "Natural",
    is_catalog_active: true, is_published: true, virtual_store_active: true,
    variants: [{ sku: `QA-PUB-${Date.now()}`, variation_name: "6 mm", material: "Titanio", color: "Natural", quantity: 5, cost_value: 10, sale_value: 80 }]
  } });
  assert.equal(product.status, 201, JSON.stringify(product.json));
  await db((tx) => tx.run(
    "INSERT INTO coupons (code, internal_name, discount_type, discount_value, status) VALUES ('QAPUB', 'QA público', 'fixed', 8, 'active')"
  ));
  const response = await req("/sales-orders/public", { method: "POST", tenant: ctx.slug, body: {
    full_name: "Outra Pessoa", whatsapp: "5511988887771", accepted_policies: true, coupon_code: "QAPUB",
    client_id: ctx.clientId, appointment_id: 1, source: "agenda",
    items: [{ item_name: "Joia QA pública", product_id: product.json.id, product_variant_id: product.json.variants[0].id, quantity: 1, unit_price: 1 }]
  } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  assert.equal(Number(response.json.subtotal_value), 80);
  assert.equal(Number(response.json.total_value), 72);
  assert.equal(response.json.source, "site");
  assert.equal(response.json.appointment_id, null);
  assert.equal(response.json.full_name, "Outra Pessoa", "nome digitado, não o da ficha existente");
  const usage = await db((tx) => tx.get("SELECT sale_id, discount_amount FROM coupon_usages WHERE sale_id=?", [response.json.id]));
  assert.ok(usage, "uso do cupom gravado no pedido público");
  assert.equal(Number(usage.discount_amount), 8);
});
