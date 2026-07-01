// Serviço de relatório financeiro consolidado (pagamentos + vendas + despesas).
export async function buildFinanceReport(db) {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const totals = await db.get(`
    SELECT
      SUM(CASE WHEN substr(paid_at, 1, 10) = ? THEN amount ELSE 0 END) AS day_total,
      SUM(CASE WHEN paid_at >= to_char(CAST(? AS date) - INTERVAL '6 days', 'YYYY-MM-DD') THEN amount ELSE 0 END) AS week_total,
      SUM(CASE WHEN paid_at LIKE ? THEN amount ELSE 0 END) AS month_total
    FROM payments WHERE status = 'pago'
  `, [today, today, `${month}%`]);
  const salesTotals = await db.get(`
    SELECT
      SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN total_value ELSE 0 END) AS day_total,
      SUM(CASE WHEN created_at >= to_char(CAST(? AS date) - INTERVAL '6 days', 'YYYY-MM-DD') THEN total_value ELSE 0 END) AS week_total,
      SUM(CASE WHEN created_at LIKE ? THEN total_value ELSE 0 END) AS month_total
    FROM sales_orders
    WHERE status != 'cancelada' AND appointment_id IS NULL
  `, [today, today, `${month}%`]);
  const deposits = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type = 'sinal' AND status = 'pago' AND paid_at LIKE ?", [`${month}%`]);
  const forecast = await db.get("SELECT COALESCE(SUM(total_value), 0) AS total, COALESCE(SUM(remaining_value), 0) AS pending FROM appointments WHERE status IN ('pendente', 'confirmado')");
  const methods = await db.all("SELECT method, COUNT(*) AS total, COALESCE(SUM(amount), 0) AS amount FROM payments GROUP BY method ORDER BY total DESC");
  const orderMethods = await db.all("SELECT payment_method AS method, COUNT(*) AS total, COALESCE(SUM(total_value), 0) AS amount FROM sales_orders WHERE status != 'cancelada' AND appointment_id IS NULL GROUP BY payment_method ORDER BY total DESC");
  const expensesSummary = await db.get(`
    SELECT
      COALESCE(SUM(CASE WHEN expense_type = 'fixa' THEN amount ELSE 0 END), 0) AS fixed_total,
      COALESCE(SUM(CASE WHEN expense_type = 'variavel' THEN amount ELSE 0 END), 0) AS variable_total,
      COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE due_date LIKE ?
  `, [`${month}%`]);
  const expenses = await db.all("SELECT * FROM expenses ORDER BY due_date DESC, id DESC LIMIT 80");
  const monthlyRevenue = await db.all(`
    SELECT month, SUM(total) AS total FROM (
      SELECT SUBSTR(paid_at, 1, 7) AS month, amount AS total
      FROM payments
      WHERE status = 'pago'
      UNION ALL
      SELECT SUBSTR(created_at, 1, 7) AS month, total_value AS total
      FROM sales_orders
      WHERE status != 'cancelada' AND appointment_id IS NULL
    ) AS monthly_union
    GROUP BY month
    ORDER BY month
    LIMIT 12
  `);
  const dailyRevenue = await db.all(`
    SELECT label, SUM(total) AS total FROM (
      SELECT substr(paid_at, 1, 10) AS label, amount AS total
      FROM payments
      WHERE status = 'pago' AND substr(paid_at, 1, 10) >= to_char(CAST(? AS date) - INTERVAL '6 days', 'YYYY-MM-DD')
      UNION ALL
      SELECT substr(created_at, 1, 10) AS label, total_value AS total
      FROM sales_orders
      WHERE status != 'cancelada' AND appointment_id IS NULL AND substr(created_at, 1, 10) >= to_char(CAST(? AS date) - INTERVAL '6 days', 'YYYY-MM-DD')
    ) AS daily_union
    GROUP BY label
    ORDER BY label
  `, [today, today]);
  const weeklyRevenue = await db.all(`
    SELECT label, SUM(total) AS total FROM (
      SELECT to_char(CAST(paid_at AS timestamp), 'IYYY"-W"IW') AS label, amount AS total
      FROM payments
      WHERE status = 'pago' AND substr(paid_at, 1, 10) >= to_char(CAST(? AS date) - INTERVAL '42 days', 'YYYY-MM-DD')
      UNION ALL
      SELECT to_char(CAST(created_at AS timestamp), 'IYYY"-W"IW') AS label, total_value AS total
      FROM sales_orders
      WHERE status != 'cancelada' AND appointment_id IS NULL AND substr(created_at, 1, 10) >= to_char(CAST(? AS date) - INTERVAL '42 days', 'YYYY-MM-DD')
    ) AS weekly_union
    GROUP BY label
    ORDER BY label
  `, [today, today]);
  const monthRevenue = (totals.month_total || 0) + (salesTotals.month_total || 0);
  return {
    totals: {
      day_total: (totals.day_total || 0) + (salesTotals.day_total || 0),
      week_total: (totals.week_total || 0) + (salesTotals.week_total || 0),
      month_total: monthRevenue
    },
    deposits: { monthTotal: deposits.total || 0 },
    forecast,
    expensesSummary,
    profit: { estimated: monthRevenue - (expensesSummary.total || 0) },
    mostUsedMethod: [...methods, ...orderMethods].sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0]?.method || "Sem registros",
    methods: [...methods, ...orderMethods],
    expenses,
    monthlyRevenue,
    weeklyRevenue,
    dailyRevenue
  };
}
