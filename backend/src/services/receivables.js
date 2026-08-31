import { localDate } from "./utils.js";

const MAX_INSTALLMENTS = 120;

export function installmentMoneyCents(value, label = "Valor") {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`${label} inválido.`);
  const [integer, decimal = ""] = text.split(".");
  const cents = Number(integer) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 999_999_999_999) {
    throw new Error(`${label} fora do limite permitido.`);
  }
  return cents;
}

function isoDate(value, label = "Data do primeiro vencimento") {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} inválida.`);
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} inválida.`);
  }
  return { year, month, day, text };
}

function monthDueDate(first, offset) {
  const monthIndex = first.month - 1 + offset;
  const year = first.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(first.day, lastDay)).padStart(2, "0")}`;
}

export function normalizeReceivableMode(value, fallback = "paid") {
  const mode = String(value || fallback).trim().toLowerCase();
  if (!new Set(["paid", "pending"]).has(mode)) throw new Error("Modo de recebimento inválido.");
  return mode;
}

// Decide se uma payload está tentando usar o subfluxo financeiro de contas a
// receber. Venda simples continua sendo basic_catalog; configurar cobrança
// futura/parcelada exige basic_finance mesmo se a rota principal for de venda
// ou agenda.
export function configuresReceivableSchedule(body = {}) {
  const mode = String(body?.receivable_mode || "").trim().toLowerCase();
  const hasExplicitInstallments = Array.isArray(body?.installments)
    ? body.installments.length > 0
    : body?.installments != null && body.installments !== "";
  return mode === "pending" ||
    hasExplicitInstallments ||
    Boolean(String(body?.first_due_date || "").trim()) ||
    Number(body?.installment_count || 0) > 1;
}

export function requiresBasicFinanceForSale(body = {}, current = {}) {
  const effectiveStatus = String(body?.status || current?.status || "");
  const effectiveMode = String(body?.receivable_mode || current?.receivable_mode || "paid").toLowerCase();
  const total = Number(body?.total_value ?? current?.total_value ?? 0);
  const materializesReceivable = ["concluida", "pago"].includes(effectiveStatus) &&
    effectiveMode === "pending" && total > 0;
  return configuresReceivableSchedule(body) || materializesReceivable;
}

export function normalizeInstallmentCount(value = 1) {
  const count = Number(value ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    throw new Error(`A quantidade de parcelas deve ficar entre 1 e ${MAX_INSTALLMENTS}.`);
  }
  return count;
}

// Trabalha em centavos e entrega o resíduo às primeiras parcelas. Assim 100/3
// vira 33,34 + 33,33 + 33,33, nunca 99,99.
export function buildInstallmentSchedule(total, count = 1, firstDueDate = localDate()) {
  const totalCents = installmentMoneyCents(total, "Valor total");
  const installments = normalizeInstallmentCount(count);
  const first = isoDate(firstDueDate || localDate());
  const base = Math.floor(totalCents / installments);
  const remainder = totalCents % installments;
  return Array.from({ length: installments }, (_, index) => ({
    number: index + 1,
    count: installments,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
    dueDate: monthDueDate(first, index),
    paymentMethod: null
  }));
}

// O array explícito é a fonte de verdade quando informado. O número pode ser
// omitido para formulários que usam a própria ordem visual; se vier informado,
// precisa formar a sequência 1..N sem duplicidade.
export function normalizeExplicitInstallments(rawInstallments, { total, defaultPaymentMethod = "Pix" } = {}) {
  if (rawInstallments === undefined || rawInstallments === null) return null;
  // Formulários compartilham o mesmo shape entre venda à vista e parcelada e
  // enviam `[]` no primeiro caso. Lista vazia significa "sem cronograma
  // explícito"; quando houver parcelas, a validação abaixo continua estrita.
  if (Array.isArray(rawInstallments) && rawInstallments.length === 0) return null;
  if (!Array.isArray(rawInstallments) || rawInstallments.length < 1 || rawInstallments.length > MAX_INSTALLMENTS) {
    throw new Error(`Informe de 1 a ${MAX_INSTALLMENTS} parcelas.`);
  }
  const count = rawInstallments.length;
  const schedule = rawInstallments.map((item, index) => {
    const number = Number(item?.installment_number ?? item?.number ?? index + 1);
    if (!Number.isInteger(number) || number < 1 || number > count) {
      throw new Error(`Número inválido na parcela ${index + 1}.`);
    }
    const amountCents = installmentMoneyCents(item?.amount, `Valor da parcela ${number}`);
    if (amountCents <= 0) throw new Error(`O valor da parcela ${number} deve ser maior que zero.`);
    const dueDate = isoDate(item?.due_date ?? item?.dueDate, `Data de vencimento da parcela ${number}`).text;
    const paymentMethod = String(item?.payment_method ?? item?.paymentMethod ?? defaultPaymentMethod ?? "").trim();
    if (!paymentMethod) throw new Error(`Informe a forma de pagamento da parcela ${number}.`);
    return { number, count, amount: amountCents / 100, amountCents, dueDate, paymentMethod };
  });
  const numbers = schedule.map((item) => item.number).sort((a, b) => a - b);
  if (numbers.some((number, index) => number !== index + 1)) {
    throw new Error("A numeração das parcelas deve ser sequencial, de 1 até a quantidade informada.");
  }
  const expectedCents = installmentMoneyCents(total, "Valor total");
  const scheduledCents = schedule.reduce((sum, item) => sum + item.amountCents, 0);
  if (scheduledCents !== expectedCents) {
    throw new Error("A soma das parcelas deve ser exatamente igual ao valor total.");
  }
  return schedule.sort((a, b) => a.number - b.number);
}

export function serializeInstallments(schedule) {
  return schedule?.map((item) => ({
    installment_number: item.number,
    due_date: item.dueDate,
    amount: item.amount,
    payment_method: item.paymentMethod
  })) || null;
}

export function parseStoredInstallments(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    throw new Error("Cronograma de parcelas armazenado é inválido.");
  }
}

export function resolveInstallmentSchedule({ total, installments, installmentCount = 1, firstDueDate = localDate(), paymentMethod = "Pix" }) {
  const explicit = normalizeExplicitInstallments(installments, { total, defaultPaymentMethod: paymentMethod });
  if (explicit) return explicit;
  return buildInstallmentSchedule(total, installmentCount, firstDueDate).map((item) => ({
    ...item,
    amountCents: installmentMoneyCents(item.amount, `Valor da parcela ${item.number}`),
    paymentMethod: String(paymentMethod || "Pix")
  }));
}

async function syncSourceReceivables(db, {
  sourceType,
  sourceId,
  sourceKeyPrefix,
  category,
  defaultDescription,
  amount,
  installmentCount = 1,
  firstDueDate = localDate(),
  paymentMethod = "Pix",
  description = null,
  installments = null
}) {
  await db.all(
    "SELECT * FROM financial_entries WHERE source_type=? AND source_id=? AND entry_type='receivable' ORDER BY installment_number, id FOR UPDATE",
    [sourceType, sourceId]
  );
  const cents = installmentMoneyCents(amount, "Valor a receber");
  if (cents === 0) {
    await db.run(
      `UPDATE financial_entries SET status='canceled', paid_amount=0,
         lifecycle_reason='Sem saldo pendente na origem', updated_at=CURRENT_TIMESTAMP
       WHERE source_type=? AND source_id=? AND entry_type='receivable'
         AND status NOT IN ('paid','refunded')`,
      [sourceType, sourceId]
    );
    return [];
  }

  const schedule = resolveInstallmentSchedule({
    total: cents / 100,
    installments,
    installmentCount,
    firstDueDate,
    paymentMethod
  });
  for (const installment of schedule) {
    const sourceKey = `${sourceKeyPrefix}:${sourceId}:receivable:${installment.number}`;
    await db.run(
      `INSERT INTO financial_entries
        (entry_type, description, category, amount, paid_amount, due_date, competence_date, status,
         payment_method, installment_number, installment_count, source_type, source_id, source_key)
       VALUES ('receivable', ?, ?, ?, 0, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_key) DO UPDATE SET
         description=EXCLUDED.description, amount=EXCLUDED.amount, due_date=EXCLUDED.due_date,
         competence_date=EXCLUDED.competence_date, payment_method=EXCLUDED.payment_method,
         installment_number=EXCLUDED.installment_number, installment_count=EXCLUDED.installment_count,
         status=CASE WHEN financial_entries.status IN ('paid','refunded') THEN financial_entries.status ELSE 'pending' END,
         updated_at=CURRENT_TIMESTAMP`,
      [
        description || `${defaultDescription} #${sourceId} - parcela ${installment.number}/${installment.count}`,
        category,
        installment.amount,
        installment.dueDate,
        installment.dueDate,
        installment.paymentMethod,
        installment.number,
        installment.count,
        sourceType,
        sourceId,
        sourceKey
      ]
    );
  }

  await db.run(
    `UPDATE financial_entries SET status='canceled', paid_amount=0,
       lifecycle_reason='Parcela removida pela reconfiguração da origem', updated_at=CURRENT_TIMESTAMP
     WHERE source_type=? AND source_id=? AND entry_type='receivable'
       AND installment_number > ? AND status NOT IN ('paid','refunded')`,
    [sourceType, sourceId, schedule.length]
  );
  return db.all(
    "SELECT * FROM financial_entries WHERE source_type=? AND source_id=? AND entry_type='receivable' AND status!='canceled' ORDER BY installment_number, id",
    [sourceType, sourceId]
  );
}

export async function syncSalesOrderReceivables(db, options) {
  return syncSourceReceivables(db, {
    ...options,
    sourceType: "sales_order",
    sourceId: options.salesOrderId,
    sourceKeyPrefix: "sales-order",
    category: "Vendas",
    defaultDescription: "Venda"
  });
}

export async function syncServiceExecutionReceivables(db, options) {
  return syncSourceReceivables(db, {
    ...options,
    sourceType: "service_execution",
    sourceId: options.serviceExecutionId,
    sourceKeyPrefix: "service-execution",
    category: "Atendimentos",
    defaultDescription: "Atendimento"
  });
}

export async function settleSalesOrderReceivables(db, salesOrderId, { paymentMethod = "Pix", paidAt = null } = {}) {
  await db.run(
    `UPDATE financial_entries SET paid_amount=amount, status='paid', payment_method=?,
       paid_at=COALESCE(?, paid_at, CURRENT_TIMESTAMP::text), updated_at=CURRENT_TIMESTAMP
     WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable'
       AND status NOT IN ('paid','refunded','canceled')`,
    [paymentMethod || "Pix", paidAt, salesOrderId]
  );
}

export async function cancelSalesOrderReceivables(db, salesOrderId) {
  await db.run(
    `UPDATE financial_entries SET status='canceled', updated_at=CURRENT_TIMESTAMP
     WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable'
       AND status NOT IN ('paid','refunded','canceled')`,
    [salesOrderId]
  );
}

export async function cancelServiceExecutionReceivables(db, serviceExecutionId) {
  await db.run(
    `UPDATE financial_entries SET status='canceled', updated_at=CURRENT_TIMESTAMP
     WHERE source_type='service_execution' AND source_id=? AND entry_type='receivable'
       AND status NOT IN ('paid','refunded','canceled')`,
    [serviceExecutionId]
  );
}
