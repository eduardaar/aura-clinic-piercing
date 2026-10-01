// Serviço de relatório financeiro consolidado (pagamentos + vendas + despesas).
//
// Todos os SUM daqui rodam sobre colunas NUMERIC(12,2) (`payments.amount`,
// `expenses.amount`, `appointments.total_value`), então o somatório é decimal
// exato dentro do Postgres. A camada `db` converte o resultado para Number na
// saída (ver db/postgres.js): cada total individual cabe em Number sem perda; o
// que não pode voltar é somar linha a linha em JavaScript.
import { localDate, localTimestamp } from "./utils.js";

// Único ponto deste arquivo em que dois totais se encontram fora do SQL. Como
// os dois já chegam exatos, arredondar o resultado para centavos elimina o
// resíduo de IEEE-754 da subtração (1234.56 - 789.01 = 445.55000000000007).
function reais(valor) {
  return Math.round(Number(valor || 0) * 100) / 100;
}

// Erro de regra financeira com o status HTTP que a rota deve devolver
// (400 validação, 403 permissão, 404 inexistente, 409 estado/conflito). Os
// serviços de dinheiro do atendimento lançam este erro dentro da transação; a
// rota converte em resposta e o rollback desfaz tudo o que já foi escrito.
export class FinancialRuleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const DISCOUNT_ABOVE_GROSS_MESSAGE = "O desconto não pode ser maior que o valor bruto.";
export const NEGATIVE_NET_MESSAGE = "O abatimento deixaria o valor líquido negativo.";

const toCents = (value) => Math.round(Number(value || 0) * 100);
const fromCents = (value) => value / 100;

// Parser estrito de dinheiro informado pelo usuário (desconto manual, valor de
// ajuste): recusa negativo, texto e mais de 2 casas em vez de arredondar em
// silêncio — o que se grava é exatamente o que a pessoa digitou.
// `undefined` significa "campo não enviado"; null/"" valem zero.
export function parseMoneyInputCents(value, label = "Valor") {
  if (value === undefined) return undefined;
  if (value === null || value === "") return 0;
  const text = typeof value === "number"
    ? (Number.isFinite(value) ? String(value) : "")
    : String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new FinancialRuleError(`${label} deve ser um valor numérico maior ou igual a zero, com no máximo 2 casas decimais.`);
  }
  const [integer, decimal = ""] = text.split(".");
  const cents = Number(integer) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 999_999_999_999) throw new FinancialRuleError(`${label} fora do limite permitido.`);
  return cents;
}

// Fonte oficial da camada financeira para o fluxo de agendamento/atendimento.
// O objetivo é receber uma leitura compatível com o modelo atual e devolver um
// único resumo financeiro end-to-end para o mesmo atendimento.
//
// Desconto: quem informa `couponDiscount`/`manualDiscount` recebe a separação
// cupom × manual; quem só conhece `discountTotal` (leitores antigos) continua
// funcionando — o total entra como desconto de cupom/promoção.
// Ajustes: `adjustmentTotal` é ASSINADO (acréscimos − abatimentos ativos) e
// só existe no atendimento. Fórmula (SPEC 2.2):
//   bruto = serviços + produtos; desconto = min(cupom + manual, bruto)
//   líquido = max(0, bruto − desconto + ajustes)
//   restante = max(0, líquido − pago); excedente = max(0, pago − líquido)
export function calculateOperationTotals(input = {}) {
  const serviceCents = Math.max(0, toCents(input.serviceSubtotal ?? input.service_value ?? input.serviceValue));
  const productCents = Math.max(0, toCents(input.productSubtotal ?? input.product_value ?? input.productValue));
  const grossCents = serviceCents + productCents;
  const splitDiscount = [input.couponDiscount, input.coupon_discount, input.manualDiscount, input.manual_discount_value]
    .some((value) => value !== undefined && value !== null);
  const requestedCouponCents = Math.max(0, toCents(splitDiscount
    ? input.couponDiscount ?? input.coupon_discount
    : input.discountTotal ?? input.discount_value ?? input.discount));
  const requestedManualCents = splitDiscount ? Math.max(0, toCents(input.manualDiscount ?? input.manual_discount_value)) : 0;
  // O cupom é aplicado primeiro e o manual completa até o bruto: o total
  // nunca passa do bruto, e a parcela que excedeu é sinalizada para a
  // validação (a gravação recusa; a prévia mostra o aviso).
  const couponCents = Math.min(requestedCouponCents, grossCents);
  const manualCents = Math.min(requestedManualCents, grossCents - couponCents);
  const discountCents = couponCents + manualCents;
  const adjustmentCents = toCents(input.adjustmentTotal ?? input.adjustment_total);
  const netBeforeAdjustmentsCents = grossCents - discountCents;
  const unclampedNetCents = netBeforeAdjustmentsCents + adjustmentCents;
  const netCents = Math.max(0, unclampedNetCents);

  const payments = Array.isArray(input.payments) ? input.payments : [];
  const confirmedPayments = payments.filter((payment) => ["pago", "confirmado", "credito_aplicado"].includes(String(payment?.status || "").toLowerCase()));
  const depositRows = confirmedPayments.filter((payment) => String(payment?.payment_type || payment?.type || "").toLowerCase() === "sinal" || String(payment?.payment_type || payment?.type || "").toLowerCase() === "deposit");
  const otherRows = confirmedPayments.filter((payment) => !depositRows.includes(payment));
  const creditRows = otherRows.filter((payment) => String(payment?.status || "").toLowerCase() === "credito_aplicado");
  const depositCents = depositRows.reduce((sum, item) => sum + Math.max(0, toCents(item.amount ?? item.value)), 0);
  const otherCents = otherRows.reduce((sum, item) => sum + Math.max(0, toCents(item.amount ?? item.value)), 0);
  const creditCents = creditRows.reduce((sum, item) => sum + Math.max(0, toCents(item.amount ?? item.value)), 0);
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
    couponDiscount: fromCents(couponCents),
    manualDiscount: fromCents(manualCents),
    discountTotal: fromCents(discountCents),
    netBeforeAdjustments: fromCents(netBeforeAdjustmentsCents),
    adjustmentTotal: fromCents(adjustmentCents),
    netTotal: fromCents(netCents),
    depositPaid: fromCents(depositCents),
    otherPayments: fromCents(otherCents),
    creditApplied: fromCents(creditCents),
    totalPaid: fromCents(totalPaidCents),
    outstandingBalance: fromCents(outstandingCents),
    overpaymentAmount: fromCents(overpaymentCents),
    balance: fromCents(balanceCents),
    paymentStatus,
    closed: outstandingCents === 0,
    // Sinais para a validação: desconto pedido acima do bruto e ajustes que
    // levariam o líquido abaixo de zero (o líquido devolvido já vem limitado).
    discountExceedsGross: requestedCouponCents + requestedManualCents > grossCents,
    negativeNet: unclampedNetCents < 0
  };
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Desconto de cupom/promoção gravado no agendamento. Não há coluna própria:
// com cupom, vale o valor calculado na aplicação (`coupon_snapshot`); sem
// cupom, o que exceder o manual em `discount_value` é desconto legado (ex.:
// promoção do agendamento público) e continua valendo.
export function storedCouponDiscount(appointment = {}) {
  if (appointment.coupon_id || appointment.coupon_code) {
    const amount = Number(parseJsonObject(appointment.coupon_snapshot)?.discount_amount);
    if (Number.isFinite(amount) && amount >= 0) return amount;
  }
  return Math.max(0, fromCents(toCents(appointment.discount_value) - toCents(appointment.manual_discount_value)));
}

export async function listActiveAppointmentAdjustments(db, appointmentId) {
  return db.all(`SELECT a.id, a.adjustment_type, a.amount, a.reason, a.created_by_user_id,
      u.name AS created_by_name, a.created_at
    FROM appointment_value_adjustments a
    LEFT JOIN users u ON u.id = a.created_by_user_id
    WHERE a.appointment_id = ? AND a.status = 'ativo'
    ORDER BY a.created_at, a.id`, [appointmentId]);
}

function signedAdjustmentCents(adjustments = []) {
  return adjustments.reduce((sum, item) => {
    const cents = Math.max(0, toCents(item.amount));
    return sum + (item.adjustment_type === "abatimento" ? -cents : cents);
  }, 0);
}

// Entradas do cálculo a partir do que está gravado. `overrides` permite à
// prévia e às validações simular itens/cupom/manual/ajustes sem gravar,
// passando pela MESMA conta usada na gravação.
export function appointmentFinancialInput(appointment = {}, { items = [], payments = [], adjustments = [] } = {}, overrides = {}) {
  const sourceItems = overrides.items ?? items;
  const itemServiceCents = sourceItems.reduce((sum, item) => sum + Math.max(0, toCents(item.procedure_price)), 0);
  const itemProductCents = sourceItems.reduce((sum, item) => sum + Math.max(0, toCents(item.jewelry_unit_price)) * Math.max(1, Number(item.quantity || 1)), 0);
  const hasPricedItems = sourceItems.length > 0 && itemServiceCents + itemProductCents > 0;
  let serviceCents = hasPricedItems ? itemServiceCents : Math.max(0, toCents(appointment.service_value));
  const productCents = hasPricedItems ? itemProductCents : Math.max(0, toCents(appointment.jewelry_value));
  if (!hasPricedItems && serviceCents + productCents === 0) {
    // Agendamento sem preço nos itens: o bruto gravado é a única fonte.
    serviceCents = Math.max(0, toCents(appointment.subtotal_value) || toCents(appointment.total_value) + toCents(appointment.discount_value) - toCents(appointment.adjustment_total));
  }
  let couponDiscount = overrides.couponDiscount ?? storedCouponDiscount(appointment);
  const manualDiscount = overrides.manualDiscount ?? Number(appointment.manual_discount_value || 0);
  // O agendamento público grava só `total_value` (já com promoção/cupom) e
  // nenhum bruto/desconto. Sem esta leitura, o primeiro recálculo apagaria o
  // desconto concedido ao cliente e cobraria o preço cheio no fechamento.
  if (overrides.couponDiscount === undefined && !appointment.coupon_id && !appointment.coupon_code &&
      toCents(appointment.subtotal_value) === 0 && toCents(appointment.discount_value) === 0 &&
      toCents(appointment.manual_discount_value) === 0 && toCents(appointment.adjustment_total) === 0 &&
      toCents(appointment.total_value) > 0 && serviceCents + productCents > toCents(appointment.total_value)) {
    couponDiscount = fromCents(serviceCents + productCents - toCents(appointment.total_value));
  }
  const adjustmentCents = overrides.adjustmentTotal !== undefined
    ? toCents(overrides.adjustmentTotal)
    : signedAdjustmentCents(adjustments);
  const sourcePayments = overrides.payments ?? payments;
  return {
    serviceSubtotal: fromCents(serviceCents),
    productSubtotal: fromCents(productCents),
    couponDiscount,
    manualDiscount,
    adjustmentTotal: fromCents(adjustmentCents),
    payments: sourcePayments.map((entry) => ({ status: entry.status, payment_type: entry.payment_type, amount: entry.amount }))
  };
}

async function loadAppointmentFinancialSources(db, appointmentId) {
  const [payments, items, adjustments] = await Promise.all([
    db.all("SELECT * FROM payments WHERE appointment_id = ? AND status IN ('pago', 'confirmado', 'credito_aplicado') ORDER BY id", [appointmentId]),
    db.all("SELECT * FROM appointment_items WHERE appointment_id = ? ORDER BY id", [appointmentId]),
    listActiveAppointmentAdjustments(db, appointmentId)
  ]);
  return { payments, items, adjustments };
}

function snapshotFromTotals(appointment, sources, totals) {
  return {
    appointmentId: appointment.id,
    appointmentTotal: Number(appointment.total_value || 0),
    appointmentNetTotal: totals.netTotal,
    couponCode: appointment.coupon_code || null,
    serviceSubtotal: totals.serviceSubtotal,
    productSubtotal: totals.productSubtotal,
    grossTotal: totals.grossTotal,
    couponDiscount: totals.couponDiscount,
    manualDiscount: totals.manualDiscount,
    manualDiscountReason: appointment.manual_discount_reason || null,
    discountTotal: totals.discountTotal,
    netBeforeAdjustments: totals.netBeforeAdjustments,
    adjustmentTotal: totals.adjustmentTotal,
    adjustments: sources.adjustments,
    netTotal: totals.netTotal,
    depositPaid: totals.depositPaid,
    otherPayments: totals.otherPayments,
    creditApplied: totals.creditApplied,
    totalPaid: totals.totalPaid,
    outstandingBalance: totals.outstandingBalance,
    overpaymentAmount: totals.overpaymentAmount,
    balance: totals.balance,
    paymentStatus: totals.paymentStatus,
    items: sources.items
  };
}

export async function getAppointmentFinancialSnapshot(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment) return null;
  const sources = await loadAppointmentFinancialSources(db, appointment.id);
  const totals = calculateOperationTotals(appointmentFinancialInput(appointment, sources));
  return snapshotFromTotals(appointment, sources, totals);
}

// PONTO ÚNICO DE RECÁLCULO do dinheiro do agendamento (SPEC 9, item 1).
// Trava o agendamento, lê itens, pagamentos confirmados (inclusive crédito
// aplicado), cupom, desconto manual e ajustes ativos e grava as colunas que
// relatórios, dashboard, execução e recebível leem. Todo escritor (criação,
// PATCH, ajuste, crédito, finalização) chama esta função na própria transação,
// de modo que `total_value`/`remaining_value` nunca divergem do snapshot.
// Linha do agendamento como ficaria após o recálculo, sem gravar. A prévia usa
// esta mesma linha como base, para enxergar o que a gravação enxerga (inclusive
// o desconto implícito do agendamento público ainda não recalculado).
export function recalculatedAppointmentRow(appointment, sources) {
  const totals = calculateOperationTotals(appointmentFinancialInput(appointment, sources));
  // Cancelado/ausente já teve o saldo resolvido pelo fluxo de cancelamento:
  // nada mais fica "a receber" deste agendamento.
  const settledOutcome = ["cancelado", "nao_compareceu"].includes(appointment.status);
  const remaining = settledOutcome ? 0 : totals.outstandingBalance;
  const row = {
    ...appointment,
    service_value: totals.serviceSubtotal, jewelry_value: totals.productSubtotal, subtotal_value: totals.grossTotal,
    discount_value: totals.discountTotal, adjustment_total: totals.adjustmentTotal, total_value: totals.netTotal,
    remaining_value: remaining
  };
  return { row, totals };
}

export async function recalculateAppointmentFinancials(tx, appointmentId) {
  const appointment = await tx.get("SELECT * FROM appointments WHERE id = ? FOR UPDATE", [appointmentId]);
  if (!appointment) return null;
  const sources = await loadAppointmentFinancialSources(tx, appointment.id);
  const { row: after, totals } = recalculatedAppointmentRow(appointment, sources);
  await tx.run(`UPDATE appointments SET service_value = ?, jewelry_value = ?, subtotal_value = ?, discount_value = ?,
      adjustment_total = ?, total_value = ?, remaining_value = ?, updated_at = ?
    WHERE id = ?`, [
    after.service_value, after.jewelry_value, after.subtotal_value, after.discount_value,
    after.adjustment_total, after.total_value, after.remaining_value, localTimestamp(), appointment.id
  ]);
  return { before: appointment, appointment: after, totals, snapshot: snapshotFromTotals(after, sources, totals) };
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
  // `payments` é a fonte completa do dinheiro recebido — balcão, catálogo e
  // agenda gravam uma linha aqui na confirmação (ver services/sales.js e
  // services/tenantCharges.js), cada uma ligada ao seu título por
  // `sales_order_id`. Somar `sales_orders.total_value` aqui contaria a mesma
  // venda duas vezes.
  const deposits = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type = 'sinal' AND status = 'pago' AND paid_at LIKE ?", [`${month}%`]);
  // "A receber" soma as duas frentes: agenda e vendas de produtos. A execução
  // do serviço não cria uma segunda venda, evitando receita duplicada.
  const forecast = await db.get(`
    SELECT
      COALESCE((SELECT SUM(total_value) FROM appointments WHERE status IN ('pendente', 'awaiting_deposit_proof', 'confirmado')), 0)
        + COALESCE((SELECT SUM(total_value) FROM sales_orders WHERE status IN ('pendente', 'aberta')), 0) AS total,
      COALESCE((SELECT SUM(remaining_value) FROM appointments WHERE status IN ('pendente', 'awaiting_deposit_proof', 'confirmado')), 0)
        + COALESCE((SELECT SUM(total_value) FROM sales_orders WHERE status IN ('pendente', 'aberta')), 0) AS pending
  `);
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
