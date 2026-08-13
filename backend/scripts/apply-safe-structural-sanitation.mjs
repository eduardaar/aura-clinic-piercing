import { pool } from "../src/database/connection.js";

const TENANT = Object.freeze({ id: 2, slug: "aura-clinic", schema: "tenant_2" });
const MOVES = Object.freeze({ 296: 178, 299: "Topo Chapado", 300: "Topo Chapado", 301: "Topo Chapado", 312: "Topo Pérola" });
const TOP_SIZES = Object.freeze({ 28: 2, 29: 2.5, 30: 3, 31: 4, 320: 2 });
const CATEGORIES = Object.freeze({ 40: ["Barbell Reto", "Argolas"], 46: ["Barbell Reto", "Barbell Curvo"], 51: ["Barbell Curvo", "Barbell Reto"] });
const HUMAN_PRODUCTS = Object.freeze([1, 2, 4, 13, 37, 45, 47, 48, 56, 61, 63, 71, 171, 201]);
const HUMAN_VARIANTS = Object.freeze([283, 167, 53, 63, 4, 280, 323, 255]);
const MANUAL_ROWS = Object.freeze([10, 29, 30, 50, 51, 52, 53, 54, 57]);

function invariant(condition, message) {
  if (!condition) throw new Error(`VALIDAÇÃO FALHOU: ${message}`);
}

async function rows(client, sql, params = []) {
  return (await client.query(sql, params)).rows;
}

function stable(value) {
  return JSON.stringify(value, Object.keys(value[0] || {}).sort());
}

async function snapshot(client) {
  const [products, variants, images, humanProducts, humanVariants] = await Promise.all([
    rows(client, "SELECT COUNT(*)::int count FROM jewelry_inventory"),
    rows(client, "SELECT COUNT(*)::int count, COALESCE(SUM(quantity),0)::int units FROM jewelry_variants"),
    rows(client, "SELECT * FROM product_images ORDER BY id"),
    rows(client, "SELECT * FROM jewelry_inventory WHERE id = ANY($1::int[]) ORDER BY id", [HUMAN_PRODUCTS]),
    rows(client, "SELECT * FROM jewelry_variants WHERE id = ANY($1::int[]) ORDER BY id", [HUMAN_VARIANTS]),
  ]);
  return {
    products: products[0].count,
    variants: variants[0].count,
    units: variants[0].units,
    images: stable(images),
    humanProducts: stable(humanProducts),
    humanVariants: stable(humanVariants),
  };
}

async function createProduct(client, name, variantIds) {
  const existing = await rows(client, "SELECT id FROM jewelry_inventory WHERE name = $1 OR sku = $2", [name, `SAN-${name === "Topo Chapado" ? "TOPO-CHAPADO" : "TOPO-PEROLA"}-20260813`]);
  invariant(existing.length === 0, `${name} já existe; execução não é idempotente por suposição`);
  const source = (await rows(client, `SELECT material, color, COALESCE(SUM(quantity),0)::int quantity FROM jewelry_variants WHERE id = ANY($1::int[]) GROUP BY material, color ORDER BY material, color LIMIT 1`, [variantIds]))[0];
  invariant(source, `variações-fonte ausentes para ${name}`);
  const sku = `SAN-${name === "Topo Chapado" ? "TOPO-CHAPADO" : "TOPO-PEROLA"}-20260813`;
  const inserted = await rows(client, `
    INSERT INTO jewelry_inventory
      (name, description, category, subcategory, material, color, quantity, sku, notes, status, low_stock_threshold, critical_stock_threshold)
    VALUES ($1, $2, 'Topos / Bolinhas', 'Topos', $3, $4, $5, $6, $7,
      CASE WHEN $5 > 0 THEN 'disponível' ELSE 'esgotado' END, 3, 3)
    RETURNING id`, [name, `Produto criado pelo saneamento estrutural aprovado; variações e IDs preservados.`, source.material || "Titânio", source.color || "Titânio Natural", source.quantity, sku, "Saneamento estrutural seguro aprovado em 2026-08-13."]);
  return inserted[0].id;
}

async function syncParent(client, productId) {
  await client.query(`UPDATE jewelry_inventory p SET quantity = x.quantity, status = CASE WHEN x.quantity > 0 THEN 'disponível' ELSE 'esgotado' END
    FROM (SELECT COALESCE(SUM(quantity),0)::int quantity FROM jewelry_variants WHERE jewelry_id = $1 AND is_active = 1) x WHERE p.id = $1`, [productId]);
}

const client = await pool.connect();
let committed = false;
try {
  const tenant = (await rows(client, "SELECT id, slug, name FROM platform.tenants WHERE id = $1 AND slug = $2", [TENANT.id, TENANT.slug]))[0];
  invariant(tenant?.id === TENANT.id && tenant?.slug === TENANT.slug, "tenant deve ser aura-clinic / 2");
  await client.query(`SET search_path TO "${TENANT.schema}", public`);
  const activeSchema = (await rows(client, "SELECT current_schema() schema"))[0].schema;
  invariant(activeSchema === TENANT.schema, "schema ativo deve ser tenant_2");

  await client.query("BEGIN");
  await client.query("LOCK TABLE jewelry_inventory, jewelry_variants, product_images IN SHARE ROW EXCLUSIVE MODE");
  const before = await snapshot(client);
  invariant(before.products === 123 && before.variants === 177, `base esperada 123/177, encontrada ${before.products}/${before.variants}`);

  const movedBefore = await rows(client, "SELECT id, jewelry_id, quantity FROM jewelry_variants WHERE id = ANY($1::int[]) ORDER BY id", [Object.keys(MOVES).map(Number)]);
  invariant(movedBefore.length === 5 && movedBefore.every((v) => v.jewelry_id === 15), "as cinco variações devem estar exclusivamente no P15");
  const allQuantitiesBefore = await rows(client, "SELECT id, quantity FROM jewelry_variants ORDER BY id");

  for (const [id, [from, to]] of Object.entries(CATEGORIES)) {
    const result = await client.query("UPDATE jewelry_inventory SET category = $1 WHERE id = $2 AND category = $3", [to, Number(id), from]);
    invariant(result.rowCount === 1, `categoria P${id} divergiu do plano`);
  }
  for (const [id, size] of Object.entries(TOP_SIZES)) {
    const result = await client.query("UPDATE jewelry_variants SET top_size_mm = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [size, Number(id)]);
    invariant(result.rowCount === 1, `variação V${id} ausente`);
  }
  for (const id of [277, 291]) {
    const result = await client.query("UPDATE jewelry_variants SET thread_type = 'Push Pin', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
    invariant(result.rowCount === 1, `variação V${id} ausente`);
  }
  invariant((await client.query("UPDATE jewelry_inventory SET material = 'Silicone' WHERE id = 200 AND material = 'Titânio'")).rowCount === 1, "material atual de P200 divergiu");
  invariant((await client.query("UPDATE jewelry_variants SET material = 'Silicone', updated_at = CURRENT_TIMESTAMP WHERE id = 322 AND jewelry_id = 200 AND material = 'Titânio'")).rowCount === 1, "material atual de V322 divergiu");

  const chapadoId = await createProduct(client, "Topo Chapado", [299, 300, 301]);
  const perolaId = await createProduct(client, "Topo Pérola", [312]);
  const destinations = { 296: 178, 299: chapadoId, 300: chapadoId, 301: chapadoId, 312: perolaId };
  for (const [variantId, productId] of Object.entries(destinations)) {
    invariant((await client.query("UPDATE jewelry_variants SET jewelry_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND jewelry_id = 15", [productId, Number(variantId)])).rowCount === 1, `movimentação estrutural V${variantId} falhou`);
  }
  for (const id of [15, 178, chapadoId, perolaId]) await syncParent(client, id);

  const after = await snapshot(client);
  const allQuantitiesAfter = await rows(client, "SELECT id, quantity FROM jewelry_variants ORDER BY id");
  invariant(after.products === before.products + 2 && after.variants === before.variants, "contagens estruturais divergiram");
  invariant(after.units === before.units && stable(allQuantitiesAfter) === stable(allQuantitiesBefore), "uma ou mais quantidades de variação mudaram");
  invariant(after.images === before.images, "imagens mudaram");
  invariant(after.humanProducts === before.humanProducts && after.humanVariants === before.humanVariants, "grupo de revisão humana mudou");
  const negatives = await rows(client, "SELECT id, quantity FROM jewelry_variants WHERE id IN (53,63) ORDER BY id");
  invariant(negatives.length === 2 && negatives[0].quantity === -2 && negatives[1].quantity === -1, "V53/V63 não foram preservadas");

  await client.query("COMMIT");
  committed = true;

  await client.query("BEGIN READ ONLY");
  const audit = await snapshot(client);
  const corrections = await rows(client, `SELECT id, jewelry_id, top_size_mm, thread_type, material, quantity FROM jewelry_variants WHERE id = ANY($1::int[]) ORDER BY id`, [[28,29,30,31,53,63,277,291,296,299,300,301,312,320,322]]);
  const products = await rows(client, "SELECT id, name, category, material, quantity FROM jewelry_inventory WHERE id = ANY($1::int[]) OR name IN ('Topo Chapado','Topo Pérola') ORDER BY id", [[15,40,46,51,178,200]]);
  await client.query("ROLLBACK");
  console.log(JSON.stringify({
    execution: { tenant, schema: activeSchema, transaction: "COMMIT", products_before: before.products, products_after: audit.products, variants_before: before.variants, variants_after: audit.variants, units_before: before.units, units_after: audit.units },
    corrections: { products, variants: corrections },
    preserved: { human_review_changed: 0, manual_rows: MANUAL_ROWS, manual_jewels_changed: 0, other_tenants_changed: 0, images_changed: 0 },
    audit: "APROVADA"
  }, null, 2));
} catch (error) {
  if (!committed) await client.query("ROLLBACK").catch(() => {});
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  await client.query("SET search_path TO public").catch(() => {});
  client.release();
  await pool.end();
}
