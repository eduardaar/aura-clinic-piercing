import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const ctx = {};
const api = (path, options = {}) => req(path, { token: ctx.token, tenant: ctx.slug, ...options });
before(async () => {
  Object.assign(ctx, await createTenant("qa-catalog-visible"));
  ctx.token = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
});
after(async () => { if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id); });

test("catálogo público mostra esgotado publicado sem expor custo nem permitir compra", async () => {
  const product = await api("/jewelry", { method: "POST", body: {
    name: "Joia esgotada publicada", category: "Labret", material: "Titânio", color: "Prata", quantity: 0,
    cost_value: 15, sale_value: 60, is_catalog_active: true, is_published: true, virtual_store_active: true,
    can_sell: true, can_publish: true
  } });
  assert.equal(product.status, 201, JSON.stringify(product.json));
  const catalog = await req("/catalog", { tenant: ctx.slug });
  assert.equal(catalog.status, 200);
  const items = catalog.json.items;
  assert.ok(Array.isArray(items), JSON.stringify(catalog.json).slice(0, 300));
  const visible = items.find((item) => item.id === product.json.id);
  assert.ok(visible);
  assert.equal(Number(visible.quantity), 0);
  assert.equal("cost_value" in visible, false);
  const order = await req("/sales-orders/public", { method: "POST", tenant: ctx.slug, body: {
    full_name: "Cliente público estoque", whatsapp: "11966660101", accepted_policies: true,
    payment_method: "Pix", idempotency_key: `soldout-${ctx.slug}`,
    items: [{ product_id: product.json.id, item_name: visible.name, quantity: 1, unit_price: 60 }]
  } });
  assert.ok([400, 409].includes(order.status), JSON.stringify(order.json));
  await withTenantSchema(ctx.tenant.id, async (db) => {
    assert.equal(Number((await db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [product.json.id])).quantity), 0);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM sales_orders")).n), 0);
  });
  await api(`/jewelry/${product.json.id}`, { method: "PATCH", body: { is_published: false } });
  const hidden = await req("/catalog", { tenant: ctx.slug });
  assert.equal(hidden.json.items.some((item) => item.id === product.json.id), false);
});
