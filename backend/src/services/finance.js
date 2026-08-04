// Serviço de relatório financeiro consolidado (pagamentos + vendas + despesas).
//
// Todos os SUM daqui rodam sobre colunas NUMERIC(12,2) (`payments.amount`,
// `expenses.amount`, `appointments.total_value`), então o somatório é decimal
// exato dentro do Postgres. A camada `db` converte o resultado para Number na
// saída (ver db/postgres.js): cada total individual cabe em Number sem perda; o
// que não pode voltar é somar linha a linha em JavaScript.
import { localDate } from "./utils.js";

// Único ponto deste arquivo em que dois totais se encontram fora do SQL. Como
// os dois já chegam exatos, arredondar o resultado para centavos elimina o
// resíduo de IEEE-754 da subtração (1234.56 - 789.01 = 445.55000000000007).
function reais(valor) {
  return Math.round(Number(valor || 0) * 100) / 100;
}

export async function buildFinanceReport(db) {
  const today = localDate();
  const month = today.slice(0, 7);
  const totals = await db.get(`
    SELECT
      SUM(CASE WHEN substr(paid_at, 1, 10) = ? THEN amount ELSE 0 END) AS day_total,
      SUM(CASE WHEN paid_at >= to_char(CAST(? AS date) - INTERVAL '6 days', 'YYYY-MM-DD') THEN amount ELSE 0 END) AS week_total,
      SUM(CASE WHEN paid_at LIKE ? THEN amount ELSE 0 END) AS month_total
    FROM payments WHERE status = 'pago'
  `, [today, today, `${month}%`]);
  // `payments` já é a fonte completa do dinheiro recebido: createSalesOrder
  // (services/sales.js) grava uma linha de pagamento para cada venda de balcão.
  // Somar `sales_orders` aqui contaria a mesma venda duas vezes.
  const deposits = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type = 'sinal' AND status = 'pago' AND paid_at LIKE ?", [`${month}%`]);
  const forecast = await db.get("SELECT COALESCE(SUM(total_value), 0) AS total, COALESCE(SUM(remaining_value), 0) AS pending FROM appointments WHERE status IN ('pendente', 'awaiting_deposit_proof', 'confirmado')");
  const methods = await db.all("SELECT method, COUNT(*) AS total, COALESCE(SUM(amount), 0) AS amount FROM payments GROUP BY method ORDER BY total DESC");
  const expensesSummary = await db.get(`
    SELECT
      COALESCE(SUM(CASE WHEN expense_type = 'fixa' THEN amount ELSE 0 END), 0) AS fixed_total,
      COALESCE(SUM(CASE WHEN expense_type = 'variavel' THEN amount ELSE 0 END), 0) AS variable_total,
      COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE due_date LIKE ?
  `, [`${month}%`]);
  const expenses = await db.all("SELECT * FROM expenses ORDER BY due_date DESC, id DESC LIMIT 80");
  // Pegamos os 12 meses mais recentes (ORDER BY DESC no subselect) e só depois
  // reordenamos em ordem cronológica, senão o gráfico congelaria no início do histórico.
  const monthlyRevenue = await db.all(`
    SELECT month, total FROM (
      SELECT month, SUM(total) AS total FROM (
        SELECT SUBSTR(paid_at, 1, 7) AS month, amount AS total
        FROM payments
        WHERE status = 'pago'
      ) AS monthly_union
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    ) AS recent_months
    ORDER BY month
  `);
  const dailyRevenue = await db.all(`
    SELECT substr(paid_at, 1, 10) AS label, SUM(amount) AS total
    FROM payments
    WHERE status = 'pago' AND substr(paid_at, 1, 10) >= to_char(CAST(? AS date) - INTERVAL '6 days', 'YYYY-MM-DD')
    GROUP BY label
    ORDER BY label
  `, [today]);
  const weeklyRevenue = await db.all(`
    SELECT to_char(CAST(paid_at AS timestamp), 'IYYY"-W"IW') AS label, SUM(amount) AS total
    FROM payments
    WHERE status = 'pago' AND substr(paid_at, 1, 10) >= to_char(CAST(? AS date) - INTERVAL '42 days', 'YYYY-MM-DD')
    GROUP BY label
    ORDER BY label
  `, [today]);
  const monthRevenue = totals.month_total || 0;
  return {
    totals: {
      day_total: totals.day_total || 0,
      week_total: totals.week_total || 0,
      month_total: monthRevenue
    },
    deposits: { monthTotal: deposits.total || 0 },
    forecast,
    expensesSummary,
    profit: { estimated: reais(Number(monthRevenue || 0) - Number(expensesSummary.total || 0)) },
    mostUsedMethod: methods[0]?.method || "Sem registros",
    methods,
    expenses,
    monthlyRevenue,
    weeklyRevenue,
    dailyRevenue
  };
}
