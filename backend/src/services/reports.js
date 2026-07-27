const REPORT_TYPES = new Set([
  "financial", "sales", "stock", "services", "clients", "professionals",
  "appointments", "cancellations", "promotions", "coupons", "commissions", "payments", "catalog_conversion"
]);

export function validReportType(type) {
  return REPORT_TYPES.has(type);
}

function period(filters = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: /^\d{4}-\d{2}-\d{2}$/.test(filters.from) ? filters.from : `${today.slice(0, 7)}-01`,
    to: /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : today
  };
}

export async function buildReport(db, type, filters = {}) {
  if (!validReportType(type)) throw new Error("Relatório inválido.");
  const { from, to } = period(filters);
  const status = String(filters.status || "");
  const professionalId = Number(filters.professional_id || 0);
  const productId = Number(filters.product_id || 0);
  const category = String(filters.category || "");
  let rows = [];
  if (type === "financial") {
    rows = await db.all("SELECT entry_type, description, category, amount, paid_amount, due_date, status, payment_method, source_type FROM financial_entries WHERE competence_date BETWEEN ? AND ? ORDER BY due_date", [from, to]);
  } else if (type === "sales") {
    rows = await db.all(`
      SELECT so.id, c.full_name AS client, so.order_type, so.source, so.status, so.payment_method, so.total_value, so.created_at
      FROM sales_orders so JOIN clients c ON c.id=so.client_id
      WHERE SUBSTRING(so.created_at,1,10) BETWEEN ? AND ? ${status ? "AND so.status=?" : ""}
      ORDER BY so.created_at DESC
    `, status ? [from, to, status] : [from, to]);
  } else if (type === "stock") {
    const clauses = ["j.status!='arquivado'"];
    const params = [];
    if (productId) { clauses.push("j.id=?"); params.push(productId); }
    if (category) { clauses.push("j.category=?"); params.push(category); }
    rows = await db.all(`SELECT j.id, j.name, j.sku, j.category, j.material, j.color, j.quantity, j.cost_value, j.sale_value, j.status, j.supplier FROM jewelry_inventory j WHERE ${clauses.join(" AND ")} ORDER BY j.category,j.name`, params);
  } else if (type === "services") {
    rows = await db.all(`
      SELECT COALESCE(s.name,a.procedure) AS service, COUNT(*) AS appointments,
        COALESCE(SUM(a.total_value),0) AS revenue, COALESCE(AVG(a.total_value),0) AS average_ticket
      FROM appointments a LEFT JOIN services s ON s.id=a.service_id
      WHERE a.appointment_date BETWEEN ? AND ? AND a.status NOT IN ('cancelado','recusado')
      GROUP BY COALESCE(s.name,a.procedure) ORDER BY revenue DESC
    `, [from, to]);
  } else if (type === "clients") {
    rows = await db.all(`
      SELECT c.id, c.full_name, c.whatsapp, c.instagram, c.birth_date, COUNT(a.id) AS appointments,
        COALESCE(SUM(CASE WHEN a.status='atendido' THEN a.total_value ELSE 0 END),0) AS lifetime_value,
        MAX(a.appointment_date) AS last_visit
      FROM clients c LEFT JOIN appointments a ON a.client_id=c.id
      GROUP BY c.id ORDER BY lifetime_value DESC
    `);
  } else if (type === "professionals" || type === "commissions") {
    rows = await db.all(`
      SELECT p.id, p.name AS professional, COUNT(a.id) AS appointments,
        COALESCE(SUM(CASE WHEN a.status='atendido' THEN a.total_value ELSE 0 END),0) AS revenue,
        COALESCE(p.commission_percentage,0) AS commission_percentage,
        COALESCE(SUM(CASE WHEN a.status='atendido' THEN a.total_value ELSE 0 END),0) * COALESCE(p.commission_percentage,0) / 100 AS commission
      FROM professionals p LEFT JOIN appointments a ON a.professional_id=p.id AND a.appointment_date BETWEEN ? AND ?
      ${professionalId ? "WHERE p.id=?" : ""} GROUP BY p.id ORDER BY revenue DESC
    `, professionalId ? [from, to, professionalId] : [from, to]);
  } else if (type === "appointments" || type === "cancellations") {
    const clauses = ["a.appointment_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (type === "cancellations") clauses.push("a.status IN ('cancelado','recusado')");
    else if (status) { clauses.push("a.status=?"); params.push(status); }
    if (professionalId) { clauses.push("a.professional_id=?"); params.push(professionalId); }
    rows = await db.all(`
      SELECT a.id, a.appointment_date, a.appointment_time, c.full_name AS client, p.name AS professional,
        a.procedure, a.status, a.source, a.total_value, a.deposit_value, a.remaining_value
      FROM appointments a JOIN clients c ON c.id=a.client_id JOIN professionals p ON p.id=a.professional_id
      WHERE ${clauses.join(" AND ")} ORDER BY a.appointment_date,a.appointment_time
    `, params);
  } else if (type === "promotions") {
    rows = await db.all(`
      SELECT p.id,p.name,p.discount_type,p.status,p.start_date,p.end_date,p.usage_limit,
        COUNT(u.id) AS uses,COALESCE(SUM(u.discount_amount),0) AS discount_total
      FROM catalog_promotions p LEFT JOIN promotion_usages u ON u.promotion_id=p.id AND SUBSTRING(CAST(u.created_at AS TEXT),1,10) BETWEEN ? AND ?
      GROUP BY p.id ORDER BY uses DESC
    `, [from, to]);
  } else if (type === "coupons") {
    rows = await db.all(`
      SELECT c.id,c.code,c.internal_name AS name,c.status,c.discount_type,c.discount_value,c.usage_limit,
        COUNT(u.id) AS uses,COALESCE(SUM(u.discount_amount),0) AS discount_total
      FROM coupons c LEFT JOIN coupon_usages u ON u.coupon_id=c.id AND SUBSTRING(CAST(u.created_at AS TEXT),1,10) BETWEEN ? AND ?
      GROUP BY c.id ORDER BY uses DESC
    `, [from, to]);
  } else if (type === "payments") {
    rows = await db.all(`
      SELECT p.id,c.full_name AS client,p.amount,p.payment_type,p.method,p.status,p.paid_at
      FROM payments p JOIN clients c ON c.id=p.client_id
      WHERE SUBSTRING(p.paid_at,1,10) BETWEEN ? AND ? ${status ? "AND p.status=?" : ""}
      ORDER BY p.paid_at DESC
    `, status ? [from, to, status] : [from, to]);
  } else if (type === "catalog_conversion") {
    rows = await db.all(`
      SELECT event_type,COUNT(*) AS events,COUNT(DISTINCT session_key) AS unique_sessions
      FROM catalog_events WHERE SUBSTRING(occurred_at,1,10) BETWEEN ? AND ?
      GROUP BY event_type ORDER BY events DESC
    `, [from, to]);
  }
  return { type, from, to, rows, total_rows: rows.length, generated_at: new Date().toISOString() };
}
