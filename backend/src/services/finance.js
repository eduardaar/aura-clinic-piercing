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

// Fonte oficial da camada financeira para o fluxo de agendamento/atendimento.
// O objetivo é receber uma leitura compatível com o modelo atual e devolver um
// único resumo financeiro end-to-end para o mesmo atendimento.
export function calculateOperationTotals(input = {}) {
  const toCents = (value) => Math.round(Number(value || 0) * 100);
  const fromCents = (value) => value / 100;
  const serviceCents = Math.max(0, toCents(input.serviceSubtotal ?? input.service_value ?? input.serviceValue));
  const productCents = Math.max(0, toCents(input.productSubtotal ?? input.product_value ?? input.productValue));
  const grossCents = serviceCents + productCents;
  const discountCents = Math.min(Math.max(0, toCents(input.discountTotal ?? input.discount_value ?? input.discount)), grossCents);
  const netCents = grossCents - discountCents;

  const payments = Array.isArray(input.payments) ? input.payments : [];
  const confirmedPayments = payments.filter((payment) => String(payment?.status || "").toLowerCase() === "pago" || String(payment?.status || "").toLowerCase() === "confirmado");
  const depositRows = confirmedPayments.filter((payment) => String(payment?.payment_type || payment?.type || "").toLowerCase() === "sinal" || String(payment?.payment_type || payment?.type || "").toLowerCase() === "deposit");
  const otherRows = confirmedPayments.filter((payment) => !depositRows.includes(payment));
  const depositCents = depositRows.reduce((sum, item) => sum + Math.max(0, toCents(item.amount ?? item.value)), 0);
  const otherCents = otherRows.reduce((sum, item) => sum + Math.max(0, toCents(item.amount ?? item.value)), 0);
  const totalPaidCents = depositCents + otherCents;
  const balanceCents = netCents - totalPaidCents;
  const outstandingCents = Math.max(0, balanceCents);
  const overpaymentCents = Math.max(0, -balanceCents);
  const paymentStatus = overpaymentCents > 0
    ? "excedente"
    : outstandingCents === 0
      ? "liquidado"
      : totalPaidCents > 0 ? "parcial" : "nao_pago";

  return {
    serviceSubtotal: fromCents(serviceCents),
    productSubtotal: fromCents(productCents),
    grossTotal: fromCents(grossCents),
    discountTotal: fromCents(discountCents),
    netTotal: fromCents(netCents),
    depositPaid: fromCents(depositCents),
    otherPayments: fromCents(otherCents),
    totalPaid: fromCents(totalPaidCents),
    outstandingBalance: fromCents(outstandingCents),
    overpaymentAmount: fromCents(overpaymentCents),
    balance: fromCents(balanceCents),
    paymentStatus,
    closed: outstandingCents === 0
  };
}

export async function getAppointmentFinancialSnapshot(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment) return null;
  const payments = await db.all("SELECT * FROM payments WHERE appointment_id = ? AND status IN ('pago', 'confirmado')", [appointmentId]);
  const items = await db.all("SELECT * FROM appointment_items WHERE appointment_id = ?", [appointmentId]);
  const itemServiceSubtotal = items.reduce((sum, item) => sum + Number(item.procedure_price || 0), 0);
  const itemProductSubtotal = items.reduce((sum, item) => sum + Number(item.jewelry_unit_price || 0) * Number(item.quantity || 1), 0);
  const hasPricedItems = items.length > 0 && itemServiceSubtotal + itemProductSubtotal > 0;
  const serviceSubtotal = hasPricedItems
    ? itemServiceSubtotal
    : Number(appointment.service_value || 0);
  const productSubtotal = hasPricedItems
    ? itemProductSubtotal
    : Number(appointment.jewelry_value || 0);
  const discountTotal = Number(appointment.discount_value || 0);
  const storedGross = Number(appointment.subtotal_value || 0) || Number(appointment.total_value || 0) + discountTotal;
  const snapshot = calculateOperationTotals({
    serviceSubtotal: serviceSubtotal + productSubtotal > 0 ? serviceSubtotal : storedGross,
    productSubtotal,
    discountTotal,
    payments: payments.map((entry) => ({
      status: entry.status,
      payment_type: entry.payment_type,
      amount: entry.amount
    }))
  });
  return {
    appointmentId,
    appointmentTotal: Number(appointment.total_value || 0),
    appointmentNetTotal: Number(snapshot.netTotal || appointment.total_value || 0),
    couponCode: appointment.coupon_code || null,
    discountTotal: snapshot.discountTotal,
    grossTotal: snapshot.grossTotal,
    netTotal: snapshot.netTotal,
    depositPaid: snapshot.depositPaid,
    otherPayments: snapshot.otherPayments,
    totalPaid: snapshot.totalPaid,
    outstandingBalance: snapshot.outstandingBalance,
    overpaymentAmount: snapshot.overpaymentAmount,
    balance: snapshot.balance,
    paymentStatus: snapshot.paymentStatus,
    items
  };
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
