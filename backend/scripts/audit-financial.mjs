// Auditoria financeira multi-tenant, estritamente somente leitura.
import { pool } from "../src/database/connection.js";

if (process.argv.includes("--fix-safe")) {
  console.error("--fix-safe não é suportado: esta auditoria nunca altera dados.");
  process.exit(2);
}

const report = { mode: "dry-run", generatedAt: new Date().toISOString(), tenants: [], totals: {} };

function addTotal(type, count) {
  report.totals[type] = (report.totals[type] || 0) + count;
}

async function check(client, type, sql) {
  const result = await client.query(sql);
  const rows = result.rows.map((row) => ({
    ...row,
    id: row.id === undefined ? undefined : Number(row.id)
  }));
  addTotal(type, rows.length);
  return { type, count: rows.length, affected: rows };
}

const checks = [
  ["duplicate_payments", `
    SELECT MIN(id) AS id, appointment_id, amount, payment_type, method, status, paid_at,
           COUNT(*)::int AS occurrences
    FROM payments
    GROUP BY appointment_id, client_id, amount, payment_type, method, status, paid_at
    HAVING COUNT(*) > 1 ORDER BY occurrences DESC, id LIMIT 200`],
  ["payment_without_operation", `
    SELECT p.id, p.amount, p.payment_type, p.status
    FROM payments p
    WHERE p.appointment_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM sales_orders so WHERE so.client_id=p.client_id AND so.total_value=p.amount AND so.created_at=p.paid_at)
    ORDER BY p.id LIMIT 200`],
  ["appointment_total_divergent", `
    SELECT a.id, a.total_value AS stored_total,
           ROUND(COALESCE(SUM(COALESCE(ai.procedure_price,0) + COALESCE(ai.jewelry_unit_price,0) * COALESCE(ai.quantity,1)),0) - a.discount_value,2) AS calculated_total
    FROM appointments a LEFT JOIN appointment_items ai ON ai.appointment_id=a.id
    GROUP BY a.id
    HAVING a.total_value <> ROUND(COALESCE(SUM(COALESCE(ai.procedure_price,0) + COALESCE(ai.jewelry_unit_price,0) * COALESCE(ai.quantity,1)),0) - a.discount_value,2)
    ORDER BY a.id LIMIT 200`],
  ["remaining_value_divergent", `
    SELECT a.id, a.remaining_value AS stored_remaining,
           GREATEST(a.total_value - COALESCE(SUM(p.amount) FILTER (WHERE p.status IN ('pago','confirmado')),0),0) AS calculated_remaining
    FROM appointments a LEFT JOIN payments p ON p.appointment_id=a.id
    GROUP BY a.id
    HAVING a.remaining_value <> GREATEST(a.total_value - COALESCE(SUM(p.amount) FILTER (WHERE p.status IN ('pago','confirmado')),0),0)
    ORDER BY a.id LIMIT 200`],
  ["payments_greater_than_total", `
    SELECT a.id, a.total_value, COALESCE(SUM(p.amount),0) AS total_paid,
           COALESCE(SUM(p.amount),0)-a.total_value AS excess
    FROM appointments a JOIN payments p ON p.appointment_id=a.id AND p.status IN ('pago','confirmado')
    GROUP BY a.id HAVING COALESCE(SUM(p.amount),0) > a.total_value
    ORDER BY excess DESC, a.id LIMIT 200`],
  ["coupon_without_discount", `
    SELECT id, coupon_code, discount_value FROM appointments
    WHERE coupon_code IS NOT NULL AND BTRIM(coupon_code) <> '' AND discount_value <= 0
    ORDER BY id LIMIT 200`],
  ["discount_without_origin", `
    SELECT id, discount_value FROM appointments
    WHERE discount_value > 0 AND coupon_id IS NULL AND coupon_snapshot IS NULL
    ORDER BY id LIMIT 200`],
  ["completed_without_payment", `
    SELECT a.id, a.total_value FROM appointments a
    WHERE a.status='atendido' AND a.total_value > 0
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id=a.id AND p.status IN ('pago','confirmado'))
    ORDER BY a.id LIMIT 200`],
  ["linked_sale_may_duplicate_revenue", `
    SELECT so.id, so.appointment_id, so.total_value, so.order_type, so.status
    FROM sales_orders so JOIN appointments a ON a.id=so.appointment_id
    WHERE so.status NOT IN ('cancelada','cancelado') AND so.total_value > 0
    ORDER BY so.id LIMIT 200`],
  ["payment_after_cancellation", `
    SELECT p.id, p.appointment_id, p.amount, p.status
    FROM payments p JOIN appointments a ON a.id=p.appointment_id
    WHERE a.status IN ('cancelado','recusado') AND p.status IN ('pago','confirmado')
    ORDER BY p.id LIMIT 200`]
];

const client = await pool.connect();
try {
  const tenants = await client.query("SELECT id, slug FROM platform.tenants ORDER BY id");
  for (const tenant of tenants.rows) {
    const schema = `tenant_${Number(tenant.id)}`;
    await client.query(`SET search_path TO "${schema}"`);
    const findings = [];
    for (const [type, sql] of checks) findings.push(await check(client, type, sql));
    report.tenants.push({ tenant: tenant.slug, schema, findings });
  }
} finally {
  await client.query("SET search_path TO public").catch(() => {});
  client.release();
  await pool.end();
}

report.status = Object.values(report.totals).some((count) => count > 0) ? "INCONSISTENCIES_FOUND" : "OK";
console.log(JSON.stringify(report, null, 2));
