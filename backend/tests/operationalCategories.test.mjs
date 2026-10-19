import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";
import { pool } from "../src/database/connection.js";
import { applyMigrationsForTarget } from "../src/db/migrations.js";

const clinics = [];
const api = (clinic, path, options = {}) => req(path, { tenant: clinic.slug, token: clinic.token, ...options });
before(async () => {
  for (const prefix of ["qa-ops-cat-a", "qa-ops-cat-b"]) {
    const clinic = await createTenant(prefix);
    clinics.push(clinic);
    clinic.token = (await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword)).token;
  }
});
after(async () => { for (const clinic of clinics) await deprovisionTenant(clinic.tenant.id); });

test("categorias são persistidas no primeiro acesso e independentes do catálogo", async () => {
  for (const clinic of clinics) {
    // Consultar diretamente antes de GET /categories: as opções já devem existir no banco.
    await withTenantSchema(clinic.tenant.id, async (db) => {
      const finance = await db.all("SELECT * FROM financial_categories");
      for (const name of ["Aluguel", "Água", "Energia elétrica", "Materiais de consumo", "Compras de joias para revenda", "Outros", "Outras despesas"]) {
        assert.equal(finance.filter((item) => item.name === name).length, 1, name);
      }
      assert.equal(finance.find((item) => item.name === "Materiais de consumo").usage_scope, "purchase");
      assert.equal(finance.find((item) => item.name === "Água").usage_scope, "expense");
      assert.equal(await db.get("SELECT id FROM inventory_options WHERE type='category' AND name='Aluguel'"), undefined);
      assert.equal((await db.get("SELECT usage_scope FROM inventory_options WHERE type='category' AND name='Materiais de consumo'")).usage_scope, "material");
    });
  }
});

test("aluguel, água e luz sem produto aparecem nos relatórios e não movimentam estoque", async () => {
  const clinic = clinics[0];
  const snapshot = () => withTenantSchema(clinic.tenant.id, async (db) => ({
    items: await db.all("SELECT id,quantity,cost_value FROM jewelry_inventory ORDER BY id"),
    movements: await db.all("SELECT id FROM stock_movements ORDER BY id")
  }));
  const beforeStock = await snapshot();
  for (const [category, amount] of [["Aluguel", 1500], ["Água", 100], ["Energia elétrica", 250]]) {
    const body = { description: `${category} do estúdio`, category, amount, due_date: "2026-10-19", status: "paid", paid_at: "2026-10-18", payment_method: "Pix", idempotency_key: `${clinic.slug}-${category}` };
    const created = await api(clinic, "/finance/entries", { method: "POST", body });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(Number(created.json[0].paid_amount), amount);
    assert.equal(created.json[0].paid_at, "2026-10-18");
    assert.equal(created.json[0].supplier_id, null);
    const repeated = await api(clinic, "/finance/entries", { method: "POST", body });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.json[0].id, created.json[0].id);
    for (const report of ["payables", "financial"]) {
      const result = await api(clinic, `/reports/${report}?from=2026-10-01&to=2026-10-31&category=${encodeURIComponent(category)}`);
      assert.equal(result.status, 200, JSON.stringify(result.json));
      assert.equal(result.json.rows.length, 1);
      assert.equal(result.json.rows[0].category, category);
      assert.equal(Number(result.json.rows[0].amount), amount);
    }
  }
  const other = await api(clinic, "/finance/entries", { method: "POST", body: { description: "Serviço avulso", amount: 50, due_date: "2026-10-19" } });
  assert.equal(other.status, 201);
  assert.equal(other.json[0].category, "Outras despesas");
  const ledger = await api(clinic, `/finance/ledger?from=2026-10-01&to=2026-10-31&category=${encodeURIComponent("Água")}`);
  assert.equal(ledger.json.entries.length, 1);
  assert.equal(Number(ledger.json.cashflow.paid), 100);
  assert.deepEqual(await snapshot(), beforeStock);
});

test("materiais e reposição de joias atualizam quantidade e custo médio uma única vez", async () => {
  const clinic = clinics[0];
  const supplier = await api(clinic, "/finance/suppliers", { method: "POST", body: { name: "Fornecedor QA", person_type: "PJ", document: "11222333000181" } });
  assert.equal(supplier.status, 201);
  for (const material of [true, false]) {
    const category = material ? "Materiais de consumo" : "Compras de joias para revenda";
    const created = await api(clinic, "/jewelry", { method: "POST", body: {
      name: material ? "Gaze de reposição" : "Joia de revenda", category: material ? "Materiais de consumo" : "Labret",
      can_sell: !material, can_use_in_service: material, can_publish: false, track_stock: true,
      variants: [{ variation_name: "Padrão", quantity: 2, cost_value: 10, sale_value: material ? 0 : 50 }]
    } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const body = { supplier_id: supplier.json.id, category, description: `Reposição: ${category}`, notes: "Conferido", purchase_date: "2026-10-19", first_due_date: "2026-10-20", payment_method: "Pix", idempotency_key: `${clinic.slug}-${material}`, items: [{ product_id: created.json.id, product_variant_id: created.json.variants[0].id, quantity: 3, unit_cost: 20 }] };
    const purchase = await api(clinic, "/purchases", { method: "POST", body });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.json));
    assert.equal(purchase.json.description, body.description);
    assert.equal(purchase.json.notes, "Conferido");
    assert.equal((await api(clinic, "/purchases", { method: "POST", body })).status, 200);
    await withTenantSchema(clinic.tenant.id, async (db) => {
      const item = await db.get("SELECT quantity,cost_value FROM jewelry_inventory WHERE id=?", [created.json.id]);
      assert.equal(Number(item.quantity), 5);
      assert.equal(Number(item.cost_value), 16);
      const entries = await db.all("SELECT category,amount,description FROM financial_entries WHERE source_type='purchase_order' AND source_id=?", [purchase.json.id]);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].category, category);
      assert.equal(entries[0].description, body.description);
      assert.equal(Number(entries[0].amount), 60);
    });
  }
});

test("renomear e desativar preservam histórico; reaplicar migrations não recria nem reativa", async () => {
  const clinic = clinics[0];
  const categories = (await api(clinic, "/finance/categories")).json;
  const rent = categories.find((item) => item.name === "Aluguel");
  const changed = await api(clinic, `/finance/categories/${rent.id}`, { method: "PATCH", body: { name: "Aluguel da sede", is_active: 0 } });
  assert.equal(changed.status, 200);
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT schema_name FROM platform.tenants WHERE id=$1", [clinic.tenant.id]);
    await applyMigrationsForTarget(client, { scope: "tenant", targetSchema: rows[0].schema_name });
  } finally { client.release(); }
  const all = (await api(clinic, "/finance/categories?include_inactive=1")).json;
  assert.equal(all.filter((item) => item.id === rent.id).length, 1);
  assert.equal(all.find((item) => item.id === rent.id).is_active, 0);
  assert.equal(all.some((item) => item.name === "Aluguel"), false);
  const report = await api(clinic, `/reports/payables?from=2026-10-01&to=2026-10-31&category=Aluguel`);
  assert.equal(report.json.rows.length, 1);
  const other = (await api(clinics[1], "/finance/categories")).json;
  assert.equal(other.find((item) => item.name === "Aluguel").is_active, 1);
  const custom = await api(clinic, "/finance/categories", { method: "POST", body: { name: "Condomínio", usage_scope: "expense" } });
  assert.equal(custom.status, 201);
  assert.equal(custom.json.usage_scope, "expense");
  const duplicate = await api(clinic, `/finance/categories/${custom.json.id}`, { method: "PATCH", body: { name: "Água" } });
  assert.equal(duplicate.status, 409);
});

test("upgrade de clínica anterior preserva categorias personalizadas, inativas e histórico", async () => {
  const clinic = clinics[1];
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT schema_name FROM platform.tenants WHERE id=$1", [clinic.tenant.id]);
    const schema = rows[0].schema_name;
    assert.match(schema, /^tenant_[a-z0-9_]+$/);
    await client.query(`SET search_path TO "${schema}"`);
    // Reconstituir apenas a estrutura anterior no tenant descartável.
    await client.query("ALTER TABLE financial_categories DROP COLUMN usage_scope");
    await client.query("ALTER TABLE inventory_options DROP COLUMN usage_scope");
    await client.query("ALTER TABLE purchase_orders DROP COLUMN description");
    await client.query("DELETE FROM financial_categories WHERE name='Materiais de consumo'");
    await client.query("UPDATE financial_categories SET is_active=0 WHERE name='Aluguel'");
    await client.query("INSERT INTO financial_categories (name,is_active) VALUES ('Categoria antiga personalizada',0)");
    await client.query("DELETE FROM platform.schema_migrations WHERE scope='tenant' AND target_schema=$1 AND version='0045'", [schema]);
    await applyMigrationsForTarget(client, { scope: "tenant", targetSchema: schema });
    const { rows: categories } = await client.query(`SELECT * FROM "${schema}".financial_categories`);
    assert.equal(categories.find((item) => item.name === "Aluguel").is_active, 0);
    assert.equal(categories.find((item) => item.name === "Categoria antiga personalizada").is_active, 0);
    assert.equal(categories.filter((item) => item.name === "Materiais de consumo").length, 1);
  } finally { await client.query("RESET search_path"); client.release(); }
});
