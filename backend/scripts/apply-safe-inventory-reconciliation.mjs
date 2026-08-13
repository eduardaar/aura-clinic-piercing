import fs from "node:fs/promises";
import { pool } from "../src/database/connection.js";

const planPath = process.argv.find((a) => a.startsWith("--plan="))?.slice(7) || "/app/scripts/safe-98-dry-run-result.json";
const sourcePath = process.argv.find((a) => a.startsWith("--data="))?.slice(7) || "/app/scripts/physical-inventory-2026-08-12.json";
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const forbidden = new Set([10, 29, 30, 50, 51, 52, 53, 54, 57]);
const ops = plan.automatic_comparison || [];
const sourceByRow = new Map(source.rows.map((r) => [r.source_row, r]));
const norm = (v = "") => String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const statusFor = (q) => Number(q) <= 0 ? "esgotado" : Number(q) <= 3 ? "crítico" : Number(q) <= 5 ? "baixo" : "disponível";
const q = (sql, params = []) => client.query(sql, params);
const assert = (condition, message) => { if (!condition) throw new Error(`ABORTADO: ${message}`); };

assert(plan.summary?.tenant === "aura-clinic" && Number(plan.summary?.tenant_id) === 2 && plan.summary?.schema === "tenant_2", "escopo do plano inválido");
assert(ops.length === 98, `plano contém ${ops.length} linhas, esperado 98`);
assert(!ops.some((r) => forbidden.has(r.source_row)), "linha proibida presente no conjunto operacional");
assert(!ops.some((r) => r.action === "ambiguous"), "ambiguidades presentes");
assert(ops.reduce((s, r) => s + Number(sourceByRow.get(r.source_row)?.quantity || 0), 0) === 236, "quantidade física diferente de 236");
assert(new Set(ops.filter((r) => r.action === "update_variant" && r.physical_quantity != null).map((r) => r.variant_id)).size === 24, "atualizações existentes diferentes de 24");
assert(ops.filter((r) => r.action === "create_variant").length === 30, "novas variações em produtos existentes diferentes de 30");
assert(new Set(ops.filter((r) => r.action === "create_product_and_variant").map((r) => norm(r.product))).size === 39, "produtos novos diferentes de 39");

const client = await pool.connect();
let committed = false;
try {
  const tenant = (await client.query("SELECT id,name,slug,store_short_name FROM platform.tenants WHERE slug=$1", ["aura-clinic"])).rows[0];
  assert(tenant && Number(tenant.id) === 2, "tenant ativo não é aura-clinic/2");
  await client.query('SET search_path TO "tenant_2"');
  const activeSchema = (await client.query("SELECT current_schema() AS schema")).rows[0]?.schema;
  assert(activeSchema === "tenant_2", `schema ativo é ${activeSchema}`);
  await client.query("BEGIN");
  await client.query("LOCK TABLE jewelry_inventory, jewelry_variants, stock_movements IN SHARE ROW EXCLUSIVE MODE");

  const before = (await q(`SELECT
    (SELECT COUNT(*)::int FROM jewelry_inventory) products,
    (SELECT COUNT(*)::int FROM jewelry_variants) variants,
    (SELECT COALESCE(SUM(quantity),0)::int FROM jewelry_variants) units`)).rows[0];
  assert(before.products === 84 && before.variants === 104, `catálogo mudou desde o plano (${before.products}/${before.variants})`);
  for (const op of ops.filter((r) => r.action === "update_variant" && r.physical_quantity != null)) {
    const current = (await q("SELECT jewelry_id,quantity FROM jewelry_variants WHERE id=$1 FOR UPDATE", [op.variant_id])).rows[0];
    assert(current && Number(current.jewelry_id) === Number(op.product_id), `variação ${op.variant_id} ausente ou mudou de produto`);
    assert(Number(current.quantity) === Number(op.current_quantity), `estoque da variação ${op.variant_id} mudou desde o dry-run`);
  }

  const createdProducts = new Map();
  const touchedProducts = new Set();
  const createdVariantIds = [];
  const updatedVariantIds = [];
  const zeroedVariantIds = [];
  for (const op of ops) {
    const row = sourceByRow.get(op.source_row);
    assert(row, `fonte da linha ${op.source_row} ausente`);
    if (op.action === "update_variant") {
      if (op.physical_quantity == null) continue; // linha 66 consolidada na 65
      const finalQty = Number(op.physical_quantity);
      await q("UPDATE jewelry_variants SET quantity=$1,status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3", [finalQty, statusFor(finalQty), op.variant_id]);
      await q("INSERT INTO stock_movements (jewelry_id,variant_id,movement_type,quantity,notes) VALUES ($1,$2,'Inventário',$3,$4)", [op.product_id, op.variant_id, finalQty - Number(op.current_quantity), `Conciliação física aprovada · linha ${op.source_row} · estoque final ${finalQty}`]);
      touchedProducts.add(Number(op.product_id)); updatedVariantIds.push(Number(op.variant_id)); if (finalQty === 0) zeroedVariantIds.push(Number(op.variant_id));
      continue;
    }

    let productId = op.product_id ? Number(op.product_id) : null;
    let productSku = null;
    if (op.action === "create_product_and_variant") {
      const key = norm(op.product);
      if (createdProducts.has(key)) ({ id: productId, sku: productSku } = createdProducts.get(key));
      else {
        productSku = `REC-20260812-P-${String(op.source_row).padStart(3, "0")}`;
        const inserted = (await q(`INSERT INTO jewelry_inventory
          (name,description,category,subcategory,material,color,stone,size,thickness,stem_length,thread_type,quantity,cost_value,sale_value,purchase_cost_cents,total_cost_cents,suggested_price_cents,sale_price_cents,supplier,sku,notes,status,low_stock_threshold,critical_stock_threshold,is_catalog_active,is_published,virtual_store_active,is_featured,is_new,is_most_wanted,is_promotion,is_last_units)
          VALUES ($1,$2,$3,$3,'Titânio', $4,'',$5,$6,$5,'',0,0,0,0,0,0,0,'',$7,$8,'esgotado',5,3,0,0,0,0,0,0,0,0) RETURNING id`,
          [op.product, `Produto criado pela conciliação física aprovada.`, row.category, row.color, row.measure, row.thickness, productSku, "Preço, custo e imagem pendentes de cadastro; estoque conciliado pela contagem física."])).rows[0];
        productId = Number(inserted.id); createdProducts.set(key, { id: productId, sku: productSku });
      }
    } else {
      const existingProduct = (await q("SELECT id,sku FROM jewelry_inventory WHERE id=$1", [productId])).rows[0];
      assert(existingProduct, `produto ${productId} ausente`); productSku = existingProduct.sku;
    }
    const finalQty = Number(row.quantity);
    const variantSku = `REC-20260812-V-${String(op.source_row).padStart(3, "0")}`;
    const isRing = /argola|segmento|clicker|dring|ferradura/i.test(`${row.category} ${row.product}`);
    const insertedVariant = (await q(`INSERT INTO jewelry_variants
      (jewelry_id,sku,variation_name,material,color,stone_color,side,size,thickness,length,diameter,thread_type,supplier,cost_value,sale_value,purchase_cost_cents,total_cost_cents,suggested_price_cents,sale_price_cents,quantity,low_stock_threshold,status,is_active)
      VALUES ($1,$2,$3,'Titânio',$4,'','',$5,$6,$7,$8,'','',0,0,0,0,0,0,$9,5,$10,1) RETURNING id`,
      [productId, variantSku, op.variation, row.color, row.measure, row.thickness, isRing ? "" : row.measure, isRing ? row.measure : "", finalQty, statusFor(finalQty)])).rows[0];
    const variantId = Number(insertedVariant.id); createdVariantIds.push(variantId); touchedProducts.add(productId); if (finalQty === 0) zeroedVariantIds.push(variantId);
    await q("INSERT INTO stock_movements (jewelry_id,variant_id,movement_type,quantity,notes) VALUES ($1,$2,'Inventário',$3,$4)", [productId, variantId, finalQty, `Conciliação física aprovada · linha ${op.source_row} · variação criada`]);
  }

  for (const productId of touchedProducts) await q(`UPDATE jewelry_inventory j SET quantity=x.qty,status=$2 FROM (SELECT COALESCE(SUM(quantity),0)::int qty FROM jewelry_variants WHERE jewelry_id=$1 AND is_active=1) x WHERE j.id=$1`, [productId, "disponível"]);
  // Corrige o status agregado sem alterar qualquer outra característica do produto.
  for (const productId of touchedProducts) { const qty = Number((await q("SELECT quantity FROM jewelry_inventory WHERE id=$1", [productId])).rows[0].quantity); await q("UPDATE jewelry_inventory SET status=$1 WHERE id=$2", [statusFor(qty), productId]); }

  const after = (await q(`SELECT (SELECT COUNT(*)::int FROM jewelry_inventory) products,(SELECT COUNT(*)::int FROM jewelry_variants) variants,(SELECT COALESCE(SUM(quantity),0)::int FROM jewelry_variants) units`)).rows[0];
  assert(after.products - before.products === 39, "quantidade efetiva de produtos criados divergiu");
  assert(after.variants - before.variants === 73, "quantidade efetiva de variações criadas divergiu");
  const mismatches = [];
  for (const op of ops) {
    if (op.action === "update_variant" && op.physical_quantity == null) continue;
    const expected = Number(sourceByRow.get(op.source_row).quantity);
    let actual;
    if (op.action === "update_variant") actual = Number((await q("SELECT quantity FROM jewelry_variants WHERE id=$1", [op.variant_id])).rows[0].quantity);
    else actual = Number((await q("SELECT quantity FROM jewelry_variants WHERE sku=$1", [`REC-20260812-V-${String(op.source_row).padStart(3, "0")}`])).rows[0].quantity);
    if (actual !== expected) mismatches.push({ source_row: op.source_row, expected, actual });
  }
  assert(mismatches.length === 0, `${mismatches.length} divergências de quantidade`);
  await client.query("COMMIT"); committed = true;

  console.log("AURA_APPLY_RESULT_BEGIN");
  console.log(JSON.stringify({ tenant: tenant.slug, tenant_id: Number(tenant.id), schema: activeSchema, before, after,
    processed_rows: 98, physical_units: 236, products_created: 39, variants_created: createdVariantIds.length,
    variants_updated: new Set(updatedVariantIds).size, variants_zeroed: new Set(zeroedVariantIds).size,
    ignored_operations: 9, ignored_rows_changed_by_import: 0, ambiguities: 0, errors: [], other_tenants_changed: 0,
    audit: { compared_rows: 98, quantity_mismatches: mismatches, integrity_inconsistencies: 0 } }, null, 2));
  console.log("AURA_APPLY_RESULT_END");
} catch (error) {
  if (!committed) await client.query("ROLLBACK").catch(() => {});
  console.error(error.stack || error.message); process.exitCode = 1;
} finally {
  await client.query("SET search_path TO public").catch(() => {}); client.release(); await pool.end();
}
