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
      WITH calendar AS (
        SELECT d::date AS work_date, EXTRACT(DOW FROM d)::integer AS weekday
        FROM generate_series(?::date, ?::date, interval '1 day') d
      ), availability AS (
        SELECT pa.professional_id,
          COUNT(DISTINCT c.work_date) AS availability_days,
          COALESCE(SUM(EXTRACT(EPOCH FROM (pa.end_time::time-pa.start_time::time))/3600
            - CASE WHEN pa.lunch_start IS NOT NULL AND pa.lunch_end IS NOT NULL
              THEN EXTRACT(EPOCH FROM (pa.lunch_end::time-pa.lunch_start::time))/3600 ELSE 0 END),0) AS available_hours
        FROM professional_availability pa JOIN calendar c ON c.weekday=pa.weekday
        WHERE pa.is_active=1 GROUP BY pa.professional_id
      ), production AS (
        SELECT a.professional_id,
          COUNT(*) AS appointments,
          COUNT(*) FILTER (WHERE a.status='atendido') AS completed_appointments,
          COUNT(*) FILTER (WHERE a.status IN ('cancelado','recusado')) AS cancellations,
          COUNT(*) FILTER (WHERE a.status IN ('falta','nao_compareceu')) AS no_shows,
          COUNT(DISTINCT a.appointment_date) AS appointment_days,
          COALESCE(SUM(a.duration_minutes) FILTER (WHERE a.status='atendido'),0)/60.0 AS occupied_hours,
          COALESCE(SUM(a.service_value) FILTER (WHERE a.status='atendido'),0) AS service_revenue,
          COALESCE(SUM(a.jewelry_value) FILTER (WHERE a.status='atendido'),0) AS jewelry_revenue,
          COALESCE(SUM(a.total_value) FILTER (WHERE a.status='atendido'),0) AS revenue
        FROM appointments a WHERE a.appointment_date BETWEEN ? AND ? GROUP BY a.professional_id
      ), sold AS (
        SELECT a.professional_id,
          COALESCE(SUM(soi.quantity) FILTER (WHERE soi.item_type='produto'),0) AS products_sold,
          COALESCE(SUM(soi.quantity) FILTER (WHERE soi.product_id IS NOT NULL),0) AS jewelry_sold
        FROM sales_orders so JOIN appointments a ON a.id=so.appointment_id
        JOIN sales_order_items soi ON soi.sales_order_id=so.id
        WHERE SUBSTRING(so.created_at,1,10) BETWEEN ? AND ? AND so.status IN ('concluida','pago')
        GROUP BY a.professional_id
      )
      SELECT p.id, p.name AS professional,
        GREATEST(COALESCE(av.availability_days,0),COALESCE(pr.appointment_days,0)) AS worked_days,
        -- O ::numeric aqui NÃO é sobra da migração de dinheiro: estas duas
        -- colunas são HORAS, não reais, e continuam vindo de EXTRACT(EPOCH...),
        -- que devolve double precision no Postgres 13 e numeric a partir do 14.
        -- Como round(double precision, int) não existe, o cast é o que impede
        -- a query de quebrar conforme a versão do servidor. Mantê-lo.
        ROUND(COALESCE(av.available_hours,0)::numeric,2) AS available_hours,
        ROUND(COALESCE(pr.occupied_hours,0)::numeric,2) AS occupied_hours,
        COALESCE(pr.appointments,0) AS appointments,
        COALESCE(pr.completed_appointments,0) AS completed_appointments,
        COALESCE(pr.cancellations,0) AS cancellations, COALESCE(pr.no_shows,0) AS no_shows,
        COALESCE(s.jewelry_sold,0) AS jewelry_sold, COALESCE(s.products_sold,0) AS products_sold,
        COALESCE(pr.service_revenue,0) AS service_revenue, COALESCE(pr.jewelry_revenue,0) AS jewelry_revenue,
        COALESCE(pr.revenue,0) AS revenue,
        -- Ticket médio e comissão são DINHEIRO derivado de dinheiro. Com
        -- total_value e commission_percentage em NUMERIC, a divisão e o
        -- produto acontecem em decimal exato e o ROUND(...,2) -- que só existe
        -- para numeric, nunca para double precision -- fecha o valor em centavos
        -- aqui, em vez de deixar dízima viajar até a tela.
        CASE WHEN COALESCE(pr.completed_appointments,0)>0 THEN ROUND(pr.revenue/pr.completed_appointments,2) ELSE 0 END AS average_ticket,
        COALESCE(p.commission_percentage,0) AS commission_percentage,
        ROUND(COALESCE(pr.revenue,0)*COALESCE(p.commission_percentage,0)/100,2) AS commission,
        CASE WHEN COALESCE(av.available_hours,0)>0 THEN LEAST(100,pr.occupied_hours*100/av.available_hours) ELSE 0 END AS occupancy_rate,
        CASE WHEN COALESCE(pr.appointments,0)>0 THEN pr.completed_appointments*100.0/pr.appointments ELSE 0 END AS attendance_rate
      FROM professionals p LEFT JOIN availability av ON av.professional_id=p.id
      LEFT JOIN production pr ON pr.professional_id=p.id LEFT JOIN sold s ON s.professional_id=p.id
      ${professionalId ? "WHERE p.id=?" : ""} ORDER BY revenue DESC, p.name
    `, professionalId ? [from, to, from, to, from, to, professionalId] : [from, to, from, to, from, to]);
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
