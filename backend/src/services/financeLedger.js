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

export async function ledgerReport(db, from, to) {
  await syncFinanceSources(db);
  const start = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const end = to || new Date().toISOString().slice(0, 10);
  await db.run("UPDATE financial_entries SET status='overdue', updated_at=CURRENT_TIMESTAMP WHERE status='pending' AND due_date < ?", [new Date().toISOString().slice(0, 10)]);
  const entries = await db.all(`
    SELECT e.*, c.name AS cost_center_name
    FROM financial_entries e LEFT JOIN financial_cost_centers c ON c.id=e.cost_center_id
    WHERE e.competence_date BETWEEN ? AND ? ORDER BY e.due_date DESC, e.id DESC
  `, [start, end]);
  const active = entries.filter((item) => item.status !== "canceled");
  const incomes = active.filter((item) => ["income", "receivable"].includes(item.entry_type));
  const expenses = active.filter((item) => ["expense", "payable"].includes(item.entry_type));
  const received = incomes.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
  const paid = expenses.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
  return {
    from: start, to: end, entries,
    cashflow: { received, paid, balance: received - paid },
    dre: {
      gross_revenue: incomes.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      operating_expenses: expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      result: incomes.reduce((sum, item) => sum + Number(item.amount || 0), 0) - expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    },
    delinquency: incomes.filter((item) => item.status === "overdue").reduce((sum, item) => sum + Math.max(0, Number(item.amount) - Number(item.paid_amount)), 0),
    payable: expenses.filter((item) => ["pending", "overdue", "partially_paid"].includes(item.status)).reduce((sum, item) => sum + Math.max(0, Number(item.amount) - Number(item.paid_amount)), 0),
    receivable: incomes.filter((item) => ["pending", "overdue", "partially_paid"].includes(item.status)).reduce((sum, item) => sum + Math.max(0, Number(item.amount) - Number(item.paid_amount)), 0)
  };
}

export async function processRecurringEntries(db, horizonDays = 60) {
  const horizon = new Date(Date.now() + Math.min(Math.max(Number(horizonDays || 60), 1), 365) * 86_400_000);
  const parents = await db.all("SELECT * FROM financial_entries WHERE recurrence IN ('weekly','monthly','yearly') AND parent_entry_id IS NULL AND status!='canceled'");
  let created = 0;
  for (const parent of parents) {
    let next = new Date(`${parent.due_date}T12:00:00`);
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
