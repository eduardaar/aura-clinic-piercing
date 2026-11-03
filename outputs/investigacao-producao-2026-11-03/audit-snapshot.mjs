// Consulta a fotografia local em transação somente leitura. Não imprime clientes.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../backend/package.json", import.meta.url));
const { Client } = require("pg");
require("dotenv").config({ path: fileURLToPath(new URL("../../backend/.env", import.meta.url)), quiet: true });
const connection = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)) throw new Error("Use apenas a cópia local.");
connection.pathname = `/${process.env.AURA_SNAPSHOT_DATABASE || "aura_prod_snapshot_20261103_090109"}`;
const client = new Client({ connectionString: connection.toString() });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET search_path TO tenant_aura_clinic,public");
  const scalar = async (sql) => (await client.query(sql)).rows[0];
  const summary = {
    capturedAt: "2026-11-03T12:01:09Z",
    sourceCommit: "38240ca142a90accb01312b5540e35a43e0b8d90",
    inventory: await scalar(`SELECT count(*)::int AS products,sum(quantity)::int AS units,
      count(*) FILTER(WHERE quantity<0)::int AS negative_products,
      count(*) FILTER(WHERE status!='arquivado')::int AS active_products,
      count(*) FILTER(WHERE can_publish AND is_catalog_active=1 AND is_published=1 AND virtual_store_active=1 AND status!='arquivado')::int AS published_products
      FROM jewelry_inventory`),
    variants: await scalar(`SELECT count(*)::int AS total,count(*) FILTER(WHERE is_active=1)::int AS active,
      sum(quantity) FILTER(WHERE is_active=1)::int AS active_units,count(*) FILTER(WHERE quantity<0)::int AS negative,
      count(*) FILTER(WHERE is_active=0 AND quantity>0)::int AS inactive_with_stock FROM jewelry_variants`),
    issues: await scalar(`WITH v AS(SELECT jewelry_id,COALESCE(sum(quantity) FILTER(WHERE is_active=1),0) AS units,
      min(sale_value) FILTER(WHERE is_active=1 AND sale_value>0) AS price FROM jewelry_variants GROUP BY jewelry_id)
      SELECT count(*) FILTER(WHERE j.quantity<>COALESCE(v.units,0))::int AS quantity_mismatches,
      count(*) FILTER(WHERE v.price>0 AND j.sale_value<>v.price AND j.status='arquivado')::int AS archived_price_mismatches,
      count(*) FILTER(WHERE j.status!='arquivado' AND (is_catalog_active=1 OR is_published=1 OR virtual_store_active=1) AND NOT(can_publish AND is_catalog_active=1 AND is_published=1 AND virtual_store_active=1))::int AS active_partial_publication,
      count(*) FILTER(WHERE j.status!='arquivado' AND can_sell AND EXISTS(SELECT 1 FROM jewelry_variants x WHERE x.jewelry_id=j.id AND x.is_active=1 AND x.sale_value<=0))::int AS sellable_products_missing_price,
      count(*) FILTER(WHERE j.status!='arquivado' AND can_publish AND is_catalog_active=1 AND is_published=1 AND virtual_store_active=1 AND EXISTS(SELECT 1 FROM jewelry_variants x WHERE x.jewelry_id=j.id AND x.is_active=1 AND x.sale_value<=0))::int AS published_products_with_zero_price
      FROM jewelry_inventory j LEFT JOIN v ON v.jewelry_id=j.id`),
    booking: await scalar(`SELECT count(*) FILTER(WHERE is_active AND active_online_booking=1)::int AS online_services,
      count(*) FILTER(WHERE is_active AND active_online_booking=1 AND NOT EXISTS(SELECT 1 FROM professional_services ps JOIN professionals p ON p.id=ps.professional_id AND p.active=1 WHERE ps.service_id=s.id))::int AS online_services_without_professional
      FROM services s`),
    historicalOverlaps: await scalar(`WITH a AS(SELECT id,professional_id,appointment_date,appointment_time,
      COALESCE(NULLIF(end_time,''),to_char(appointment_time::time+make_interval(mins=>COALESCE(duration_minutes,40)),'HH24:MI')) AS end_time
      FROM appointments WHERE appointment_time ~ '^[0-2][0-9]:[0-5][0-9]$' AND status NOT IN('cancelado','recusado','remarcado','nao_compareceu'))
      SELECT count(*)::int AS pairs FROM a JOIN a b ON a.id<b.id AND a.professional_id=b.professional_id AND a.appointment_date=b.appointment_date AND a.appointment_time<b.end_time AND b.appointment_time<a.end_time`)
  };
  await client.query("ROLLBACK");
  await writeFile(new URL("audit-summary.json", import.meta.url), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  await client.end();
}
