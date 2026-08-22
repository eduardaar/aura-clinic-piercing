import { limitOffset } from "./pagination.js";

const VALID_TYPES = new Set(["payable", "receivable", "income", "expense"]);
const VALID_STATUSES = new Set(["pending", "paid", "overdue", "canceled", "partially_paid", "refunded"]);

export function normalizeEntry(body = {}, current = {}) {
  const entryType = body.entry_type ?? current.entry_type ?? "payable";
  const status = body.status ?? current.status ?? "pending";
  if (!VALID_TYPES.has(entryType)) throw new Error("Tipo de lançamento inválido.");
  if (!VALID_STATUSES.has(status)) throw new Error("Status financeiro inválido.");
  const amount = Number(body.amount ?? current.amount ?? 0);
  const paidAmount = Math.min(amount, Math.max(0, Number(body.paid_amount ?? current.paid_amount ?? (status === "paid" ? amount : 0))));
  if (!String(body.description ?? current.description ?? "").trim() || amount < 0 || !(body.due_date ?? current.due_date)) {
    throw new Error("Descrição, valor e vencimento são obrigatórios.");
  }
  const computedStatus = status === "canceled" || status === "refunded"
    ? status
    : paidAmount >= amount && amount > 0 ? "paid" : paidAmount > 0 ? "partially_paid" : status === "paid" ? "pending" : status;
  return {
    entry_type: entryType,
    description: String(body.description ?? current.description).trim(),
    category: body.category ?? current.category ?? "",
    amount,
    paid_amount: paidAmount,
    due_date: body.due_date ?? current.due_date,
    competence_date: body.competence_date ?? current.competence_date ?? body.due_date ?? current.due_date,
    status: computedStatus,
    payment_method: body.payment_method ?? current.payment_method ?? "",
    payment_account: body.payment_account ?? current.payment_account ?? "",
    paid_at: computedStatus === "paid" || computedStatus === "partially_paid" ? (body.paid_at ?? current.paid_at ?? new Date().toISOString()) : null,
    cost_center_id: body.cost_center_id || current.cost_center_id || null,
    supplier_id: body.supplier_id || current.supplier_id || null,
    attachment_url: body.attachment_url ?? current.attachment_url ?? "",
    notes: body.notes ?? current.notes ?? "",
    recurrence: body.recurrence ?? current.recurrence ?? "",
    recurrence_end_date: body.recurrence_end_date ?? current.recurrence_end_date ?? null,
    installment_number: body.installment_number || current.installment_number || null,
    installment_count: body.installment_count || current.installment_count || null
  };
}

export async function syncFinanceSources(db) {
  await db.run(`
    INSERT INTO financial_entries
      (entry_type, description, category, amount, paid_amount, due_date, competence_date, status, payment_method, paid_at, source_type, source_id, source_key)
    SELECT 'income', 'Pagamento ' || p.payment_type, p.payment_type, p.amount,
      CASE WHEN p.status='pago' THEN p.amount ELSE 0 END, SUBSTRING(p.paid_at, 1, 10), SUBSTRING(p.paid_at, 1, 10),
      CASE WHEN p.status='pago' THEN 'paid' WHEN p.status='cancelado' THEN 'canceled' ELSE 'pending' END,
      p.method, CASE WHEN p.status='pago' THEN p.paid_at ELSE NULL END, 'payment', p.id, 'payment:' || p.id
    FROM payments p
    LEFT JOIN sales_orders so ON so.id=p.sales_order_id
    WHERE NOT (
      COALESCE(so.source, '') <> 'agenda'
      AND EXISTS (
        SELECT 1 FROM financial_entries title
        WHERE title.source_type='sales_order' AND title.source_id=so.id AND title.entry_type='receivable'
      )
    )
    ON CONFLICT (source_key) DO UPDATE SET
      amount=EXCLUDED.amount, paid_amount=EXCLUDED.paid_amount, status=EXCLUDED.status,
      payment_method=EXCLUDED.payment_method, paid_at=EXCLUDED.paid_at, updated_at=CURRENT_TIMESTAMP
  `);
  await db.run(`
    INSERT INTO financial_entries
      (entry_type, description, category, amount, paid_amount, due_date, competence_date, status, payment_method, payment_account, paid_at, source_type, source_id, source_key, notes)
    SELECT 'expense', e.description, e.category, e.amount, CASE WHEN e.status='paga' THEN e.amount ELSE 0 END,
      e.due_date, e.due_date,
      CASE WHEN e.status='paga' THEN 'paid' WHEN e.status='cancelada' THEN 'canceled' WHEN e.status='vencida' THEN 'overdue' ELSE 'pending' END,
      e.payment_method, e.payment_account, e.paid_at, 'expense', e.id, 'expense:' || e.id, e.notes
    FROM expenses e
    ON CONFLICT (source_key) DO UPDATE SET
      description=EXCLUDED.description, category=EXCLUDED.category, amount=EXCLUDED.amount,
      paid_amount=EXCLUDED.paid_amount, due_date=EXCLUDED.due_date, status=EXCLUDED.status,
      payment_method=EXCLUDED.payment_method, payment_account=EXCLUDED.payment_account,
      paid_at=EXCLUDED.paid_at, notes=EXCLUDED.notes, updated_at=CURRENT_TIMESTAMP
  `);
}

const LEDGER_FROM = "financial_entries e LEFT JOIN financial_cost_centers c ON c.id=e.cost_center_id LEFT JOIN suppliers sup ON sup.id=e.supplier_id";
const LEDGER_ORDER_BY = "ORDER BY e.due_date DESC, e.id DESC";

// Os indicadores (caixa, DRE, inadimplência) somados PELO POSTGRES, não por
// `reduce` em JavaScript.
//
// Antes esta função trazia todas as linhas do período e as somava em JS. Com
// `amount`/`paid_amount` em NUMERIC(12,2) isso jogaria fora justamente a
// precisão que a migração comprou: o driver entrega cada valor como Number
// (IEEE-754) e somar milhares deles acumula erro de centavos — o problema que a
// pendência 13 descreve. Somando aqui, o total é decimal exato e só o RESULTADO
// (um número por indicador) atravessa para o JavaScript.
//
// De quebra some uma divergência entre os dois caminhos da função: quando a
// lista vinha paginada, o SELECT de apoio não trazia `lifecycle_status`, então
// lançamento marcado como teste/cancelado ENTRAVA nas somas da versão paginada e
// ficava de fora da não paginada. Aqui o critério é um só.
//
// `total` conta TODAS as linhas do período (é o total da paginação); os
// indicadores contam só as ativas — daí o FILTER em cada soma.
const LEDGER_TOTALS_SELECT = `
  WITH base AS (
    SELECT
      e.amount,
      e.paid_amount,
      e.status,
      -- Lançamento cancelado ou em ciclo administrativo não-ativo (teste,
      -- cancelamento reversível) não vira indicador. lifecycle_status pode
      -- ser nulo em lançamento anterior à coluna: nesse caso é ativo.
      (e.status <> 'canceled' AND COALESCE(e.lifecycle_status, 'active') = 'active') AS ativo,
      (e.entry_type IN ('income', 'receivable')) AS receita,
      (e.entry_type IN ('expense', 'payable')) AS despesa,
      (e.status IN ('pending', 'overdue', 'partially_paid')) AS em_aberto
    FROM ${LEDGER_FROM}`;

// GREATEST(...,0) é o `Math.max(0, …)` que existia no JS: baixa maior que o
// valor do lançamento não pode virar saldo negativo a receber.
const LEDGER_TOTALS_AGGREGATE = `
  )
  SELECT
    COUNT(*)::int AS total,
    COALESCE(SUM(paid_amount) FILTER (WHERE ativo AND receita), 0) AS received,
    COALESCE(SUM(paid_amount) FILTER (WHERE ativo AND despesa), 0) AS paid,
    COALESCE(SUM(paid_amount) FILTER (WHERE ativo AND receita), 0)
      - COALESCE(SUM(paid_amount) FILTER (WHERE ativo AND despesa), 0) AS balance,
    COALESCE(SUM(amount) FILTER (WHERE ativo AND receita), 0) AS gross_revenue,
    COALESCE(SUM(amount) FILTER (WHERE ativo AND despesa), 0) AS operating_expenses,
    COALESCE(SUM(amount) FILTER (WHERE ativo AND receita), 0)
      - COALESCE(SUM(amount) FILTER (WHERE ativo AND despesa), 0) AS result,
    COALESCE(SUM(GREATEST(amount - paid_amount, 0))
      FILTER (WHERE ativo AND receita AND status = 'overdue'), 0) AS delinquency,
    COALESCE(SUM(GREATEST(amount - paid_amount, 0))
      FILTER (WHERE ativo AND despesa AND em_aberto), 0) AS payable,
    COALESCE(SUM(GREATEST(amount - paid_amount, 0))
      FILTER (WHERE ativo AND receita AND em_aberto), 0) AS receivable
  FROM base`;

// `filters`/`filterParams` são fragmentos de WHERE montados pela rota (nunca
// texto do cliente); `paging` é opcional e só recorta a lista `entries`.
export async function ledgerReport(db, { from, to, filters = [], filterParams = [], paging = null } = {}) {
  await syncFinanceSources(db);
  const start = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const end = to || new Date().toISOString().slice(0, 10);
  await db.run("UPDATE financial_entries SET status='overdue', updated_at=CURRENT_TIMESTAMP WHERE status='pending' AND due_date < ?", [new Date().toISOString().slice(0, 10)]);
  const where = `WHERE ${["e.competence_date BETWEEN ? AND ?", ...filters].join(" AND ")}`;
  const params = [start, end, ...filterParams];
  const orderBy = paging?.orderBy || LEDGER_ORDER_BY;
  const page = limitOffset(paging);
  const entries = await db.all(
    `SELECT e.*, c.name AS cost_center_name, sup.name AS supplier_name FROM ${LEDGER_FROM} ${where} ${orderBy}${page.clause}`,
    [...params, ...page.params]
  );
  // Os indicadores somam TODO o período filtrado, nunca só a página — por isso
  // esta consulta repete o `where` sem o recorte de paginação. Ela também
  // devolve o `total` da lista (COUNT sobre as mesmas linhas), o que dispensa
  // trazer o período inteiro para a memória do Node só para contar.
  const totals = await db.get(`${LEDGER_TOTALS_SELECT} ${where}${LEDGER_TOTALS_AGGREGATE}`, params);
  return {
    from: start, to: end, entries, total: totals.total,
    cashflow: { received: totals.received, paid: totals.paid, balance: totals.balance },
    dre: {
      gross_revenue: totals.gross_revenue,
      operating_expenses: totals.operating_expenses,
      result: totals.result
    },
    delinquency: totals.delinquency,
    payable: totals.payable,
    receivable: totals.receivable
  };
}

export async function processRecurringEntries(db, horizonDays = 60) {
  const horizon = new Date(Date.now() + Math.min(Math.max(Number(horizonDays || 60), 1), 365) * 86_400_000);
  const parents = await db.all("SELECT * FROM financial_entries WHERE recurrence IN ('weekly','monthly','yearly') AND parent_entry_id IS NULL AND status!='canceled'");
  let created = 0;
  for (const parent of parents) {
    const next = new Date(`${parent.due_date}T12:00:00`);
    while (next <= horizon) {
      if (parent.recurrence === "weekly") next.setDate(next.getDate() + 7);
      else if (parent.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
      else next.setFullYear(next.getFullYear() + 1);
      const dueDate = next.toISOString().slice(0, 10);
      if (next > horizon || (parent.recurrence_end_date && dueDate > parent.recurrence_end_date)) break;
      const result = await db.run(`
        INSERT INTO financial_entries
          (entry_type, description, category, amount, due_date, competence_date, status, payment_method,
           payment_account, cost_center_id, responsible_user_id, attachment_url, notes, parent_entry_id, source_type, source_id, source_key)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, 'recurrence', ?, ?)
        ON CONFLICT (source_key) DO NOTHING
      `, [
        parent.entry_type, parent.description, parent.category, parent.amount, dueDate, dueDate, parent.payment_method,
        parent.payment_account, parent.cost_center_id, parent.responsible_user_id, parent.attachment_url, parent.notes,
        parent.id, parent.id, `recurring:${parent.id}:${dueDate}`
      ]);
      if (Number(result.changes || result.rowCount || 0) > 0) created += 1;
    }
  }
  return created;
}
