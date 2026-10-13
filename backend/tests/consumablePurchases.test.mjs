import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const clinics = [];
const api = (clinic, path, options = {}) => req(path, { tenant: clinic.slug, token: clinic.token, ...options });
before(async () => {
  for (const prefix of ["qa-materials-a", "qa-materials-b"]) {
    const clinic = await createTenant(prefix);
    clinics.push(clinic);
    clinic.token = (await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword)).token;
    const supplier = await api(clinic, "/finance/suppliers", { method: "POST", body: { name: "Fornecedor materiais", person_type: "PJ", document: "11222333000181" } });
    assert.equal(supplier.status, 201, JSON.stringify(supplier.json));
    clinic.supplierId = supplier.json.id;
  }
});
after(async () => { for (const clinic of clinics) await deprovisionTenant(clinic.tenant.id); });

test("material unificado com variação recebe compra convertida uma vez, custo médio e fornecedor corretos", async () => {
  const clinic = clinics[0];
  const created = await api(clinic, "/jewelry", { method: "POST", body: {
    name: "Gaze de procedimento", category: "Labret", can_sell: true, can_use_in_service: true,
    can_publish: false, track_stock: true, stock_unit: "pacote", purchase_unit: "caixa", consumption_unit: "pacote",
    purchase_to_stock_factor: 2, supplier_id: clinic.supplierId, low_stock_threshold: 2,
    variants: [{ variation_name: "Estéril", quantity: 4, cost_value: 2.5, sale_value: 10 }]
  } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  clinic.material = created.json;
  const options = await api(clinic, "/options");
  assert.equal(options.status, 200);
  assert.ok(options.json.serviceItems.some((item) => item.id === clinic.material.id));
  assert.ok(options.json.suppliers.some((item) => item.id === clinic.supplierId));
  const body = { supplier_id: clinic.supplierId, purchase_date: "2026-10-13", first_due_date: "2026-10-13", installment_count: 1,
    idempotency_key: `material-${clinic.slug}`, items: [{ item_type: "consumable", product_id: clinic.material.id, product_variant_id: clinic.material.variants[0].id, quantity: 2, unit_cost: 8 }] };
  const first = await api(clinic, "/purchases", { method: "POST", body });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const repeated = await api(clinic, "/purchases", { method: "POST", body });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.id, first.json.id);
  const reconfirmed = await api(clinic, `/purchases/${first.json.id}/confirm`, { method: "POST", body: {} });
  assert.equal(reconfirmed.status, 200);
  await withTenantSchema(clinic.tenant.id, async (db) => {
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id=?", [clinic.material.variants[0].id]);
    assert.equal(Number(variant.quantity), 8);
    assert.equal(Number(variant.cost_value), 3.25);
    const item = await db.get("SELECT * FROM jewelry_inventory WHERE id=?", [clinic.material.id]);
    assert.equal(Number(item.quantity), 8);
    assert.equal(Number(item.cost_value), 3.25);
    assert.equal(Number(item.supplier_id), clinic.supplierId);
    const movement = await db.get("SELECT COUNT(*)::int AS n, SUM(quantity) AS quantity FROM stock_movements WHERE purchase_order_id=?", [first.json.id]);
    assert.equal(movement.n, 1);
    assert.equal(Number(movement.quantity), 4);
    const payable = await db.get("SELECT COUNT(*)::int AS n, SUM(amount) AS value FROM financial_entries WHERE source_type='purchase_order' AND source_id=?", [first.json.id]);
    assert.equal(payable.n, 1);
    assert.equal(Number(payable.value), 16);
  });
});

test("token cruzado é recusado e outro tenant não recebe materiais nem estoque da compra", async () => {
  const [a, b] = clinics;
  const cross = await req("/jewelry", { token: a.token, tenant: b.slug });
  assert.equal(cross.status, 403);
  const other = await api(b, "/jewelry");
  assert.equal(other.status, 200);
  assert.deepEqual(other.json, []);
  const invalid = await api(b, "/purchases", { method: "POST", body: {
    supplier_id: b.supplierId, purchase_date: "2026-10-13", first_due_date: "2026-10-13", installment_count: 1,
    idempotency_key: `foreign-material-${b.slug}`, items: [{ product_id: a.material.id, product_variant_id: a.material.variants[0].id, quantity: 1, unit_cost: 8 }]
  } });
  assert.equal(invalid.status, 409, JSON.stringify(invalid.json));
  await withTenantSchema(b.tenant.id, async (db) => {
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM purchase_orders")).n), 0);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM stock_movements")).n), 0);
  });
});

test("material arquivado não pode receber nova compra e cadastro exige autenticação", async () => {
  const a = clinics[0];
  assert.equal((await req("/jewelry", { tenant: a.slug, method: "POST", body: { name: "Sem acesso" } })).status, 401);
  const archived = await api(a, `/jewelry/${a.material.id}`, { method: "PATCH", body: { status: "arquivado" } });
  assert.equal(archived.status, 200);
  const purchase = await api(a, "/purchases", { method: "POST", body: {
    supplier_id: a.supplierId, purchase_date: "2026-10-13", first_due_date: "2026-10-13", installment_count: 1,
    idempotency_key: `archived-${a.slug}`, items: [{ product_id: a.material.id, product_variant_id: a.material.variants[0].id, quantity: 1, unit_cost: 8 }]
  } });
  assert.equal(purchase.status, 409);
});
