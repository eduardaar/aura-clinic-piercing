import fs from "node:fs/promises";
import { pool } from "../src/database/connection.js";

const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) || "/tmp/aura-inventory-audit-snapshot.json";
const client = await pool.connect();
try {
  const tenant = (await client.query("SELECT id,name,slug,store_short_name FROM platform.tenants WHERE slug=$1", ["aura-clinic"])).rows[0];
  if (!tenant || Number(tenant.id) !== 2) throw new Error("Escopo recusado: tenant aura-clinic/2 não confirmado.");
  await client.query('SET search_path TO "tenant_2"');
  const schema = (await client.query("SELECT current_schema() schema")).rows[0]?.schema;
  if (schema !== "tenant_2") throw new Error(`Escopo recusado: schema ativo ${schema}.`);
  await client.query("BEGIN READ ONLY");
  const products = (await client.query("SELECT * FROM jewelry_inventory ORDER BY id")).rows;
  const variants = (await client.query("SELECT * FROM jewelry_variants ORDER BY jewelry_id,id")).rows;
  const images = (await client.query("SELECT id,product_id,variation_id,image_url,alt_text,sort_order,is_primary FROM product_images ORDER BY product_id,variation_id NULLS FIRST,sort_order,id")).rows;
  const encoding = (await client.query("SELECT current_setting('server_encoding') server_encoding,current_setting('client_encoding') client_encoding,current_setting('lc_collate') lc_collate")).rows[0];
  await client.query("COMMIT");
  if (products.length !== 123 || variants.length !== 177) throw new Error(`Totais inesperados: ${products.length} produtos / ${variants.length} variações.`);
  await fs.writeFile(output, JSON.stringify({ scope: { tenant: tenant.slug, tenant_id: Number(tenant.id), schema, establishment: tenant.store_short_name || tenant.name, other_tenants_affected: 0, writes_executed: 0 }, encoding, products, variants, images }, null, 2), "utf8");
  console.log(JSON.stringify({ products: products.length, variants: variants.length, images: images.length, schema, writes_executed: 0, other_tenants_affected: 0 }));
} finally {
  await client.query("SET search_path TO public").catch(() => {});
  client.release();
  await pool.end();
}
