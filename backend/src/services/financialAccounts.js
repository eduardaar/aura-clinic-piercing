import { FinancialRuleError, parseMoneyInputCents } from "./finance.js";
import { validBookingDate } from "./publicBookingAvailability.js";
import { localDate } from "./utils.js";
import { recordAudit } from "./audit.js";
import { syncFinanceSources } from "./financeLedger.js";

// Abrange também despesas registradas pelas telas antigas. O título não é um
// segundo movimento: só a diferença ainda sem histórico de pagamento é criada.
export async function syncAccountSources(db) {
  await db.transaction(async (tx) => {
    await syncFinanceSources(tx);
    const rows = await tx.all(`SELECT e.* FROM financial_entries e
      WHERE COALESCE(e.source_type,'') NOT IN ('payment','card_fee','card_surcharge','appointment_cancellation')
        AND (e.paid_amount>0 OR EXISTS (SELECT 1 FROM financial_entry_payments p WHERE p.entry_id=e.id))
      ORDER BY e.id FOR UPDATE OF e`);
    for (const entry of rows) {
      const history = await tx.get("SELECT COALESCE(SUM(amount),0) AS paid,COALESCE(SUM(fee_amount),0) AS fee,COALESCE(SUM(card_surcharge_amount),0) AS surcharge FROM financial_entry_payments WHERE entry_id=?", [entry.id]);
      const integrated = ["income","receivable"].includes(entry.entry_type) && ["sales_order","service_execution"].includes(entry.source_type);
      const receipts = integrated ? await tx.get("SELECT COALESCE(SUM(amount),0) AS paid,COALESCE(SUM(fee_amount),0) AS fee,COALESCE(SUM(card_surcharge_amount),0) AS surcharge FROM payments WHERE financial_entry_id=? AND status IN ('pago','confirmado')", [entry.id]) : null;
      const delta = Math.round((Number(receipts?.paid ?? entry.paid_amount) - Number(history.paid)) * 100) / 100;
      if (!delta) continue;
      await tx.run(`INSERT INTO financial_entry_payments
        (entry_id,amount,paid_at,payment_method,notes,financial_account_id,fee_amount,card_surcharge_amount)
        VALUES (?,?,?,?,?,?,?,?)`, [entry.id,delta,entry.paid_at || entry.due_date,entry.payment_method || "Pix",
        "Sincronização do pagamento de origem",entry.financial_account_id || null,
        receipts ? Math.round((Number(receipts.fee)-Number(history.fee))*100)/100 : 0,
        receipts ? Math.round((Number(receipts.surcharge)-Number(history.surcharge))*100)/100 : 0]);
    }
  });
}

export async function accountSelection(db, value, current = null) {
  if (value === undefined) return current || null;
  if (value === "" || value === null) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new FinancialRuleError("Conta financeira inválida.");
  const account = await db.get("SELECT * FROM financial_accounts WHERE id=?", [id]);
  if (!account || (!account.is_active && id !== Number(current)))
    throw new FinancialRuleError("Selecione uma conta financeira ativa.");
  return id;
}

export async function financialAccounts(db) {
  return db.all(`SELECT a.*,
    a.opening_balance + COALESCE(SUM(CASE WHEN m.to_account_id=a.id THEN m.amount ELSE -m.amount END)
      FILTER (WHERE m.movement_date>=a.opening_date AND m.movement_date<=?::date),0) AS balance
    FROM financial_accounts a LEFT JOIN financial_account_movements m
      ON m.from_account_id=a.id OR m.to_account_id=a.id
    GROUP BY a.id ORDER BY a.is_active DESC,lower(a.name),a.id`, [localDate()]);
}

export async function createFinancialAccount(db, body, req) {
  const name = String(body.name || "").trim();
  const kind = String(body.kind || "bank");
  const openingDate = String(body.opening_date || localDate());
  const raw = String(body.opening_balance ?? 0).trim();
  const sign = raw.startsWith("-") ? -1 : 1;
  const balance = (sign * parseMoneyInputCents(sign < 0 ? raw.slice(1) : raw, "O saldo inicial")) / 100;
  if (
    !name ||
    name.length > 120 ||
    !["bank", "cash", "wallet", "card"].includes(kind) ||
    !validBookingDate(openingDate) ||
    openingDate > localDate()
  )
    throw new FinancialRuleError("Informe nome, tipo e uma data de saldo inicial válida, até hoje.");
  return db.transaction(async (tx) => {
    if (await tx.get("SELECT id FROM financial_accounts WHERE lower(trim(name))=lower(?)", [name]))
      throw new FinancialRuleError("Já existe uma conta com esse nome.", 409);
    const created = await tx.run(
      `INSERT INTO financial_accounts
      (name,kind,opening_balance,opening_date,created_by_user_id) VALUES (?,?,?,?,?) RETURNING id`,
      [name, kind, balance, openingDate, req.user.id],
    );
    const account = await tx.get("SELECT * FROM financial_accounts WHERE id=?", [created.returnedId]);
    await recordAudit(tx, {
      req,
      module: "finance",
      action: "create",
      entityType: "financial_account",
      entityId: account.id,
      reason: "Conta financeira cadastrada com saldo inicial",
      after: account,
    });
    return account;
  });
}

const UNALLOCATED = `
  SELECT 'payments' AS source_type,p.id AS source_id,'Recebimento #'||p.id AS description,
    CASE WHEN p.status IN ('pago','confirmado') THEN p.amount+p.card_surcharge_amount-p.fee_amount ELSE -p.fee_amount END AS amount,
    substring(p.paid_at,1,10) AS movement_date,p.method AS payment_method
  FROM payments p WHERE p.financial_entry_id IS NULL AND p.financial_account_id IS NULL AND p.status IN ('pago','confirmado','refunded','estornado')
    AND CASE WHEN p.status IN ('pago','confirmado') THEN p.amount+p.card_surcharge_amount-p.fee_amount ELSE -p.fee_amount END <> 0
  UNION ALL
  SELECT 'financial_entry_payments',p.id,e.description,
    CASE WHEN e.entry_type IN ('income','receivable') THEN p.amount+p.card_surcharge_amount-p.fee_amount ELSE -p.amount END,
    substring(p.paid_at,1,10),p.payment_method
  FROM financial_entry_payments p JOIN financial_entries e ON e.id=p.entry_id
  WHERE p.financial_account_id IS NULL AND p.amount<>0`;

export async function accountUnallocated(db, query = {}) {
  const offset = Math.max(0, Math.min(10000000, Number(query.offset) || 0));
  const limit = 30;
  const total = await db.get(`SELECT COUNT(*)::int AS total FROM (${UNALLOCATED}) unallocated`);
  const items = await db.all(
    `SELECT *,source_type||'/'||source_id AS id FROM (${UNALLOCATED}) unallocated
    ORDER BY movement_date DESC,source_type,source_id DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return { items, total: total.total, offset, limit };
}

export async function allocateAccountSource(db, body, req) {
  const source = String(body.source_type || "");
  const id = Number(body.source_id);
  if (
    !["payments", "financial_entry_payments"].includes(source) ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    throw new FinancialRuleError("Origem financeira inválida.");
  return db.transaction(async (tx) => {
    const accountId = await accountSelection(tx, body.financial_account_id);
    if (!accountId) throw new FinancialRuleError("Selecione a conta que movimentou o dinheiro.");
    const before = await tx.get(`SELECT * FROM ${source} WHERE id=? FOR UPDATE`, [id]);
    if (!before) throw new FinancialRuleError("Origem financeira não encontrada.", 404);
    if (
      source === "payments" && before.financial_entry_id
    )
      throw new FinancialRuleError("Associe a conta no pagamento de origem.");
    await tx.run(`UPDATE ${source} SET financial_account_id=? WHERE id=?`, [accountId, id]);
    await recordAudit(tx, {
      req,
      module: "finance",
      action: "allocate",
      entityType: source,
      entityId: id,
      reason: "Origem ou destino do dinheiro identificado",
      before: { financial_account_id: before.financial_account_id },
      after: { financial_account_id: accountId },
    });
    return { ok: true };
  });
}

export async function accountMovements(db, query = {}) {
  const params = [];
  const where = [];
  if (query.account_id) {
    const id = Number(query.account_id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new FinancialRuleError("Conta inválida.");
    where.push("(m.from_account_id=? OR m.to_account_id=?)");
    params.push(id, id);
  }
  for (const [key, op] of [
    ["from", ">="],
    ["to", "<="],
  ]) {
    if (!query[key]) continue;
    if (!validBookingDate(query[key])) throw new FinancialRuleError("Período inválido.");
    where.push(`m.movement_date ${op} ?::date`);
    params.push(query[key]);
  }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const offset = Math.max(0, Math.min(10000000, Number(query.offset) || 0));
  const total = await db.get(`SELECT COUNT(*)::int AS total FROM financial_account_movements m ${filter}`, params);
  const items = await db.all(
    `SELECT m.*,fa.name AS from_account,ta.name AS to_account,
    EXISTS(SELECT 1 FROM financial_account_movements r WHERE r.reversal_of_id=m.id) AS reversed,
    (SELECT COALESCE(SUM(p.amount),0) FROM financial_account_movements p
      WHERE p.to_account_id=? AND p.movement_date>=(SELECT opening_date FROM financial_accounts WHERE id=?)
        AND (p.movement_date<m.movement_date OR (p.movement_date=m.movement_date AND p.id<=m.id))) -
    (SELECT COALESCE(SUM(p.amount),0) FROM financial_account_movements p
      WHERE p.from_account_id=? AND p.movement_date>=(SELECT opening_date FROM financial_accounts WHERE id=?)
        AND (p.movement_date<m.movement_date OR (p.movement_date=m.movement_date AND p.id<=m.id))) +
    (SELECT opening_balance FROM financial_accounts WHERE id=?) AS running_balance
    FROM financial_account_movements m LEFT JOIN financial_accounts fa ON fa.id=m.from_account_id
    LEFT JOIN financial_accounts ta ON ta.id=m.to_account_id ${filter}
    ORDER BY m.movement_date DESC,m.id DESC LIMIT 30 OFFSET ?`,
    [
      query.account_id || null,
      query.account_id || null,
      query.account_id || null,
      query.account_id || null,
      query.account_id || null,
      ...params,
      offset,
    ],
  );
  return { items, total: total.total, offset, limit: 30 };
}

export async function createAccountMovement(db, body, req) {
  const amount = parseMoneyInputCents(body.amount, "O valor da movimentação") / 100;
  const date = String(body.movement_date || localDate());
  const description = String(body.description || "").trim();
  const key = String(body.idempotency_key || "").trim();
  const kind = body.kind === "transfer" ? "transfer" : body.kind === "adjustment" ? "adjustment" : null;
  if (
    !(amount > 0) ||
    !validBookingDate(date) ||
    !description ||
    description.length > 500 ||
    !key ||
    key.length > 120 ||
    !kind
  )
    throw new FinancialRuleError("Informe valor, data, motivo e identificação da movimentação.");
  return db.transaction(async (tx) => {
    const from = await accountSelection(tx, body.from_account_id);
    const to = await accountSelection(tx, body.to_account_id);
    if (
      (!from && !to) ||
      from === to ||
      (kind === "transfer" && (!from || !to)) ||
      (kind === "adjustment" && from && to)
    )
      throw new FinancialRuleError("Confira a origem e o destino. Transferências exigem duas contas diferentes.");
    const previous = await tx.get("SELECT * FROM financial_account_movements WHERE idempotency_key=?", [key]);
    if (previous) {
      if (
        Number(previous.amount) !== amount ||
        previous.from_account_id !== from ||
        previous.to_account_id !== to ||
        previous.description !== description ||
        (previous.movement_date instanceof Date ? previous.movement_date.toISOString().slice(0, 10) : String(previous.movement_date).slice(0, 10)) !== date ||
        previous.source_type !== kind
      )
        throw new FinancialRuleError("Esta identificação já foi usada em outra movimentação.", 409);
      return { ...previous, idempotent: true };
    }
    const created = await tx.run(
      `INSERT INTO financial_account_movements
      (from_account_id,to_account_id,amount,movement_date,description,source_type,idempotency_key,created_by_user_id)
      VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
      [from, to, amount, date, description, kind, key, req.user.id],
    );
    const after = await tx.get("SELECT * FROM financial_account_movements WHERE id=?", [created.returnedId]);
    await recordAudit(tx, {
      req,
      module: "finance",
      action: kind,
      entityType: "financial_account_movement",
      entityId: after.id,
      reason: description,
      after,
    });
    return after;
  });
}

export async function reverseAccountMovement(db, id, body, req) {
  const reason = String(body.reason || "").trim();
  if (!reason || reason.length > 500) throw new FinancialRuleError("Informe o motivo do estorno.");
  return db.transaction(async (tx) => {
    const before = await tx.get("SELECT * FROM financial_account_movements WHERE id=? FOR UPDATE", [id]);
    if (!before || !["transfer", "adjustment"].includes(before.source_type))
      throw new FinancialRuleError("Movimentos integrados devem ser corrigidos na origem.", 409);
    const previous = await tx.get("SELECT * FROM financial_account_movements WHERE reversal_of_id=?", [id]);
    if (previous) return { ...previous, idempotent: true };
    const created = await tx.run(
      `INSERT INTO financial_account_movements
      (from_account_id,to_account_id,amount,movement_date,description,source_type,reversal_of_id,created_by_user_id)
        VALUES (?,?,?, ?,?,'reversal',?,?) RETURNING id`,
      [before.to_account_id, before.from_account_id, before.amount, localDate(), reason, id, req.user.id],
    );
    const after = await tx.get("SELECT * FROM financial_account_movements WHERE id=?", [created.returnedId]);
    await recordAudit(tx, {
      req,
      module: "finance",
      action: "reverse",
      entityType: "financial_account_movement",
      entityId: after.id,
      reason,
      before,
      after,
    });
    return after;
  });
}
