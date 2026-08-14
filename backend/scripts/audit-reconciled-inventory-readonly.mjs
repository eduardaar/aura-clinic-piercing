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
  const targetProductIds = [1,2,4,13,15,37,40,45,46,47,48,51,56,61,63,71,167,168,171,176,198,200,201];
  const targetVariantIds = [2,4,18,19,20,21,28,29,30,31,53,63,64,67,72,77,78,79,81,91,272,277,280,283,291,296,299,300,301,312,320,322,323];
  const movements = (await client.query("SELECT * FROM stock_movements WHERE jewelry_id=ANY($1::int[]) OR variant_id=ANY($2::int[]) ORDER BY movement_date,id", [targetProductIds,targetVariantIds])).rows;
  const sales = (await client.query(`SELECT soi.*,so.status order_status,so.source order_source,so.created_at order_created_at
    FROM sales_order_items soi JOIN sales_orders so ON so.id=soi.sales_order_id
    WHERE soi.product_id=ANY($1::int[]) OR soi.product_variant_id=ANY($2::int[]) ORDER BY so.id,soi.id`, [targetProductIds,targetVariantIds])).rows;
  const appointments = (await client.query("SELECT * FROM appointments WHERE jewelry_id=ANY($1::int[]) OR jewelry_variant_id=ANY($2::int[]) ORDER BY id", [targetProductIds,targetVariantIds])).rows;
  const appointmentItems = (await client.query("SELECT * FROM appointment_items WHERE jewelry_id=ANY($1::int[]) OR jewelry_variant_id=ANY($2::int[]) ORDER BY appointment_id,id", [targetProductIds,targetVariantIds])).rows;
  const reservations = (await client.query("SELECT * FROM inventory_reservations WHERE jewelry_id=ANY($1::int[]) OR jewelry_variant_id=ANY($2::int[]) ORDER BY id", [targetProductIds,targetVariantIds])).rows;
  const inventoryAudit = (await client.query("SELECT * FROM inventory_audit_log WHERE jewelry_id=ANY($1::int[]) ORDER BY id", [targetProductIds])).rows;
  const countItems = (await client.query("SELECT * FROM inventory_count_items WHERE jewelry_id=ANY($1::int[]) OR variant_id=ANY($2::int[]) ORDER BY count_id,id", [targetProductIds,targetVariantIds])).rows;
  const inventoryOptions = (await client.query("SELECT * FROM inventory_options ORDER BY type,name,id")).rows;
  const encoding = (await client.query("SELECT current_setting('server_encoding') server_encoding,current_setting('client_encoding') client_encoding")).rows[0];
  await client.query("COMMIT");
  if (products.length !== 123 || variants.length !== 177) throw new Error(`Totais inesperados: ${products.length} produtos / ${variants.length} variações.`);
  await fs.writeFile(output, JSON.stringify({ scope: { tenant: tenant.slug, tenant_id: Number(tenant.id), schema, establishment: tenant.store_short_name || tenant.name, other_tenants_affected: 0, writes_executed: 0 }, encoding, products, variants, images, inventory_options:inventoryOptions, relationships:{ movements,sales,appointments,appointment_items:appointmentItems,reservations,inventory_audit:inventoryAudit,count_items:countItems } }, null, 2), "utf8");
  console.log(JSON.stringify({ products: products.length, variants: variants.length, images: images.length,relationships:{movements:movements.length,sales:sales.length,appointments:appointments.length,appointment_items:appointmentItems.length,reservations:reservations.length,inventory_audit:inventoryAudit.length,count_items:countItems.length}, schema, writes_executed: 0, other_tenants_affected: 0 }));
} finally {
  await client.query("SET search_path TO public").catch(() => {});
  client.release();
  await pool.end();
}
