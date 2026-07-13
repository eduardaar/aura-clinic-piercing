import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/database/connection.js";
import { createDbAdapter } from "../src/db/sqliteCompat.js";
import { importAuraJewelry } from "../src/services/auraJewelryImport.js";
import { createTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { platformToken: null, tenant: null, otherTenant: null };

async function tenantDb(tenant) {
  const client = await pool.connect();
  await client.query(`SET search_path TO "tenant_${tenant.tenant.id}", public`);
  return {
    db: createDbAdapter(client),
    release: async () => {
      try {
        await client.query("SET search_path TO public");
        client.release();
      } catch {
        client.release(true);
      }
    }
  };
}

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qajewel");
  ctx.otherTenant = await createTenant("qajewel-other");
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
  if (ctx.platformToken && ctx.otherTenant?.tenant?.id) await deleteTenant(ctx.platformToken, ctx.otherTenant.tenant.id, ctx.otherTenant.slug);
});

test("importação inicial de joalherias é idempotente, segura e isolada por tenant", async () => {
  const firstConnection = await tenantDb(ctx.tenant);
  try {
    const first = await importAuraJewelry(firstConnection.db, { logger: { log() {} } });
    assert.equal(first.duplicatesIgnored, 1);
    assert.equal(first.variantsCreated, 59);
    assert.ok(first.productsCreated > 0);
    assert.ok(first.categoriesCreated >= 9);
    assert.ok(first.pendingPrice > 0);
    assert.ok(first.pendingImage > 0);

    const products = await firstConnection.db.all("SELECT * FROM jewelry_inventory ORDER BY category, name");
    const variants = await firstConnection.db.all("SELECT * FROM jewelry_variants ORDER BY sku");
    assert.equal(variants.length, 59);
    assert.ok(products.every((item) => Number(item.is_catalog_active) === 0));
    assert.ok(products.every((item) => Number(item.is_published) === 0));
    assert.ok(products.every((item) => Number(item.sale_value || 0) === 0));
    assert.ok(products.every((item) => Number(item.cost_value || 0) === 0));

    const labret = products.find((item) => item.name === "Labret Básico" && item.category === "Labret");
    assert.ok(labret);
    await firstConnection.db.run("UPDATE jewelry_inventory SET sale_value = 199, image_url = '/uploads/manual.png', description = 'Descrição manual' WHERE id = ?", [labret.id]);

    const second = await importAuraJewelry(firstConnection.db, { logger: { log() {} } });
    assert.equal(second.productsCreated, 0);
    assert.equal(second.variantsCreated, 0);
    assert.equal(second.variantsExisting, 59);
    assert.equal(second.duplicatesIgnored, 1);

    const preserved = await firstConnection.db.get("SELECT sale_value, image_url, description FROM jewelry_inventory WHERE id = ?", [labret.id]);
    assert.equal(Number(preserved.sale_value), 199);
    assert.equal(preserved.image_url, "/uploads/manual.png");
    assert.equal(preserved.description, "Descrição manual");

    const triplo = await firstConnection.db.get(`
      SELECT COUNT(*)::int AS total
      FROM jewelry_variants v
      JOIN jewelry_inventory j ON j.id = v.jewelry_id
      WHERE j.name = 'Segmento Triplo Cravejado'
    `);
    assert.equal(triplo.total, 1);

    const critical = await firstConnection.db.get("SELECT status FROM jewelry_variants WHERE quantity = 1 AND low_stock_threshold = 3 LIMIT 1");
    assert.equal(critical.status, "crítico");

    const conector = await firstConnection.db.get("SELECT thread_type FROM jewelry_variants WHERE variation_name LIKE 'Conector Push Pin%' LIMIT 1");
    assert.equal(conector.thread_type, "Push Pin");
  } finally {
    await firstConnection.release();
  }

  const secondConnection = await tenantDb(ctx.otherTenant);
  try {
    const isolated = await secondConnection.db.get("SELECT COUNT(*)::int AS total FROM jewelry_inventory");
    assert.equal(isolated.total, 0);
  } finally {
    await secondConnection.release();
  }
});
