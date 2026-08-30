// Rotas financeiras: relatório, despesas e exportações (CSV, PDF, XLSX).
import { Router } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { csvEscape, writePdfMetric, formatCurrency } from "../services/utils.js";
import { buildFinanceReport } from "../services/finance.js";
import { ledgerReport, normalizeEntry } from "../services/financeLedger.js";
import { installmentMoneyCents, resolveInstallmentSchedule } from "../services/receivables.js";
import { parsePaging } from "../services/pagination.js";
import { recordPrivacyAudit } from "../services/privacy.js";
import {
  normalizeSupplierInput,
  SUPPLIER_COLUMNS,
  SUPPLIER_JSON_COLUMNS,
  SupplierValidationError
} from "../services/suppliers.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const LEDGER_SORTABLE = {
  due_date: "e.due_date",
  competence_date: "e.competence_date",
  amount: "e.amount",
  status: "e.status",
  entry_type: "e.entry_type",
  description: "e.description",
  category: "e.category"
};

const LIFECYCLE_ACTIONS = new Set(["test", "cancel", "restore"]);

function financeLifecyclePermission(req, res, permission = P.FINANCE_EDIT) {
  return authorizePermission(req, res, permission);
}

async function changeLifecycle(db, entry, action, reason, userId) {
  const target = action === "restore" ? "active" : action;
  if (!LIFECYCLE_ACTIONS.has(action)) throw new Error("Ação financeira inválida.");
  if (!String(reason || "").trim()) throw new Error("A justificativa é obrigatória.");
  if (action === "restore" && (entry.lifecycle_status || "active") === "active") throw new Error("O lançamento já está ativo.");
  if (action !== "restore" && (entry.lifecycle_status || "active") !== "active") throw new Error("O lançamento já foi desconsiderado.");
  if (action === "restore" && entry.status === "refunded") throw new Error("Pagamento estornado não pode ser restaurado automaticamente.");
  const before = { ...entry };
  await db.run(`UPDATE financial_entries SET lifecycle_status=?, lifecycle_reason=?, lifecycle_changed_at=CURRENT_TIMESTAMP,
    lifecycle_changed_by=?, original_status=COALESCE(original_status, status), original_paid_amount=COALESCE(original_paid_amount, paid_amount),
    updated_at=CURRENT_TIMESTAMP WHERE id=?`, [target, String(reason).trim(), userId || null, entry.id]);
  const after = await db.get("SELECT * FROM financial_entries WHERE id=?", [entry.id]);
  await db.run("INSERT INTO financial_entry_audit (entry_id, user_id, action, before_data, after_data) VALUES (?, ?, ?, ?, ?)",
    [entry.id, userId || null, action, JSON.stringify(before), JSON.stringify(after)]);
  return after;
}

router.get("/api/finance", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_VIEW)) return;
  const finance = await buildFinanceReport(db);
  res.json(finance);
}));

router.post("/api/expenses", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EXPENSES)) return;
  const { description, expense_type, category, amount, due_date, status, payment_method, payment_account, notes } = req.body;
  if (!description?.trim() || !["fixa", "variavel"].includes(expense_type) || !due_date) {
    return res.status(400).json({ error: "Dados da despesa inválidos." });
  }
  const result = await db.run(
    `INSERT INTO expenses (description, expense_type, category, amount, due_date, status, payment_method, payment_account, paid_at, paid_by_user_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [description.trim(), expense_type, category || "", Number(amount || 0), due_date, status || "pendente", payment_method || "", payment_account || "", status === "paga" ? new Date().toISOString() : null, status === "paga" ? req.user?.id || null : null, notes || ""]
  );
  res.status(201).json(await db.get("SELECT * FROM expenses WHERE id = ?", [result.returnedId]));
}));

router.patch("/api/expenses/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EXPENSES)) return;
  const expense = await db.get("SELECT * FROM expenses WHERE id = ?", [req.params.id]);
  if (!expense) return res.status(404).json({ error: "Despesa nao encontrada." });
  const status = req.body.status ?? expense.status;
  if (!["pendente", "paga", "vencida", "cancelada"].includes(status)) return res.status(400).json({ error: "Status invalido." });
  const paidAt = status === "paga" ? (req.body.paid_at || expense.paid_at || new Date().toISOString()) : null;
  const paidBy = status === "paga" ? (expense.paid_by_user_id || req.user?.id || null) : null;
  await db.run("BEGIN");
  try {
    await db.run(`UPDATE expenses SET description = ?, expense_type = ?, category = ?, amount = ?, due_date = ?, status = ?, payment_method = ?, payment_account = ?, paid_at = ?, paid_by_user_id = ?, notes = ? WHERE id = ?`, [
      req.body.description ?? expense.description, req.body.expense_type ?? expense.expense_type, req.body.category ?? expense.category,
      Number(req.body.amount ?? expense.amount), req.body.due_date ?? expense.due_date, status, req.body.payment_method ?? expense.payment_method,
      req.body.payment_account ?? expense.payment_account, paidAt, paidBy, req.body.notes ?? expense.notes, expense.id
    ]);
    await db.run("INSERT INTO expense_audit_logs (expense_id, user_id, action, previous_status, next_status, details) VALUES (?, ?, ?, ?, ?, ?)", [expense.id, req.user?.id || null, status === "paga" ? "mark_paid" : "update", expense.status, status, req.body.notes || ""]);
    await db.run("COMMIT");
    res.json(await db.get("SELECT * FROM expenses WHERE id = ?", [expense.id]));
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.delete("/api/expenses/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CANCEL)) return;
  await db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

// O ledger é um RELATÓRIO, não uma lista: além dos lançamentos ele devolve
// caixa, DRE e inadimplência. Por isso a paginação recorta só `entries` e
// acrescenta total/limit/offset ao objeto — sem limit/offset a resposta é
// byte a byte a de antes. Os indicadores seguem somando o período inteiro.
router.get("/api/finance/ledger", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_VIEW)) return;
  const filters = [];
  const filterParams = [];
  if (req.query.status) {
    filters.push("e.status = ?");
    filterParams.push(req.query.status);
  }
  if (req.query.entry_type) {
    filters.push("e.entry_type = ?");
    filterParams.push(req.query.entry_type);
  }
  if (req.query.lifecycle_status) {
    filters.push("COALESCE(e.lifecycle_status, 'active') = ?");
    filterParams.push(req.query.lifecycle_status);
  }
  if (req.query.cost_center_id) {
    filters.push("e.cost_center_id = ?");
    filterParams.push(req.query.cost_center_id);
  }
  if (req.query.search) {
    filters.push("(e.description ILIKE ? OR e.category ILIKE ? OR e.notes ILIKE ?)");
    filterParams.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const paging = parsePaging(req.query, {
    sortable: LEDGER_SORTABLE,
    tieBreak: "e.id",
    defaultOrderBy: "ORDER BY e.due_date DESC, e.id DESC"
  });
  const { total, ...report } = await ledgerReport(db, {
    from: req.query.from,
    to: req.query.to,
    filters,
    filterParams,
    paging
  });
  res.json(paging.paginated ? { ...report, total, limit: paging.limit, offset: paging.offset } : report);
}));

router.get("/api/finance/entries/:id/details", withFeature("basic_finance", async (req, res, db) => {
  if (!financeLifecyclePermission(req, res, P.FINANCE_VIEW)) return;
  const entry = await db.get(`SELECT e.*, c.name AS cost_center_name, sup.name AS supplier_name, u.name AS responsible_user_name
    FROM financial_entries e LEFT JOIN financial_cost_centers c ON c.id=e.cost_center_id
    LEFT JOIN suppliers sup ON sup.id=e.supplier_id
    LEFT JOIN users u ON u.id=e.responsible_user_id WHERE e.id=?`, [req.params.id]);
  if (!entry) return res.status(404).json({ error: "Lançamento não encontrado." });
  const audit = await db.all(`SELECT a.*, u.name AS user_name FROM financial_entry_audit a
    LEFT JOIN users u ON u.id=a.user_id WHERE a.entry_id=? ORDER BY a.created_at DESC, a.id DESC`, [entry.id]);
  res.json({ ...entry, audit });
}));

router.post("/api/finance/entries/:id/lifecycle", withFeature("basic_finance", async (req, res, db) => {
  const permission = req.body?.action === "test" ? P.FINANCE_MARK_TEST : P.FINANCE_CANCEL;
  if (!financeLifecyclePermission(req, res, permission)) return;
  const entry = await db.get("SELECT * FROM financial_entries WHERE id=?", [req.params.id]);
  if (!entry) return res.status(404).json({ error: "Lançamento não encontrado." });
  await db.run("BEGIN");
  try {
    const updated = await changeLifecycle(db, entry, req.body?.action, req.body?.reason, req.user?.id);
    await db.run("COMMIT");
    res.json(updated);
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(400).json({ error: error.message });
  }
}));

router.post("/api/finance/entries/bulk-lifecycle", withFeature("basic_finance", async (req, res, db) => {
  const permission = req.body?.action === "test" ? P.FINANCE_MARK_TEST : P.FINANCE_CANCEL;
  if (!financeLifecyclePermission(req, res, permission)) return;
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))];
  if (!ids.length || ids.length > 200) return res.status(400).json({ error: "Selecione de 1 a 200 lançamentos." });
  if (!String(req.body?.reason || "").trim()) return res.status(400).json({ error: "A justificativa é obrigatória." });
  await db.run("BEGIN");
  try {
    const entries = await db.all(`SELECT * FROM financial_entries WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, ids);
    if (entries.length !== ids.length) throw new Error("Um ou mais lançamentos não foram encontrados.");
    const updated = [];
    for (const entry of entries) updated.push(await changeLifecycle(db, entry, req.body?.action || "test", req.body.reason, req.user?.id));
    await db.run("COMMIT");
    res.json({ ok: true, count: updated.length, entries: updated });
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(400).json({ error: error.message });
  }
}));

router.post("/api/finance/entries", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CREATE)) return;
  let entry;
  try { entry = normalizeEntry(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  let schedule;
  try {
    schedule = resolveInstallmentSchedule({
      total: entry.amount,
      installments: req.body?.installments,
      installmentCount: req.body?.installment_count ?? 1,
      firstDueDate: entry.due_date,
      paymentMethod: entry.payment_method || "Pix"
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const installmentCount = schedule.length;
  const idempotencyKey = String(req.get("Idempotency-Key") || req.body?.idempotency_key || "").trim();
  if (idempotencyKey.length > 120) return res.status(400).json({ error: "Idempotency-Key deve ter no máximo 120 caracteres." });
  const firstSourceKey = idempotencyKey ? `manual-entry:${idempotencyKey}:1` : null;
  const getExistingGroup = async () => {
    if (!firstSourceKey) return [];
    const first = await db.get(
      "SELECT id, source_id FROM financial_entries WHERE source_type='manual_entry' AND source_key=?",
      [firstSourceKey]
    );
    if (!first) return [];
    return db.all(
      "SELECT * FROM financial_entries WHERE source_type='manual_entry' AND source_id=? ORDER BY installment_number, id",
      [first.source_id || first.id]
    );
  };
  const sameIdempotentRequest = (rows) => rows.length === schedule.length && rows.every((row, index) => {
    const installment = schedule[index];
    return Number(row.installment_number) === installment.number &&
      Number(row.installment_count) === installment.count &&
      installmentMoneyCents(row.amount, "Valor armazenado") === installment.amountCents &&
      row.due_date === installment.dueDate && row.payment_method === installment.paymentMethod &&
      row.entry_type === entry.entry_type && row.description === entry.description &&
      String(row.category || "") === String(entry.category || "") &&
      String(row.payment_account || "") === String(entry.payment_account || "") &&
      Number(row.cost_center_id || 0) === Number(entry.cost_center_id || 0) &&
      Number(row.supplier_id || 0) === Number(entry.supplier_id || 0) &&
      String(row.attachment_url || "") === String(entry.attachment_url || "") &&
      String(row.notes || "") === String(entry.notes || "") &&
      String(row.recurrence || "") === String(entry.recurrence || "") &&
      String(row.recurrence_end_date || "") === String(entry.recurrence_end_date || "");
  });
  const existing = await getExistingGroup();
  if (existing.length) {
    if (!sameIdempotentRequest(existing)) {
      return res.status(409).json({ error: "Idempotency-Key já foi usada com outro lançamento." });
    }
    return res.status(200).json(existing);
  }

  await db.run("BEGIN");
  try {
    let parentId = null;
    const created = [];
    let remainingPaidCents = installmentMoneyCents(entry.paid_amount, "Valor pago");
    for (const installment of schedule) {
      const paidCents = Math.min(installment.amountCents, remainingPaidCents);
      remainingPaidCents -= paidCents;
      const installmentStatus = ["canceled", "refunded"].includes(entry.status)
        ? entry.status
        : paidCents >= installment.amountCents
          ? "paid"
          : paidCents > 0
            ? "partially_paid"
            : entry.status === "overdue" ? "overdue" : "pending";
      const sourceKey = idempotencyKey ? `manual-entry:${idempotencyKey}:${installment.number}` : null;
      const result = await db.run(`
        INSERT INTO financial_entries
          (entry_type, description, category, amount, paid_amount, due_date, competence_date, status,
           payment_method, payment_account, paid_at, cost_center_id, supplier_id, responsible_user_id, attachment_url,
           notes, recurrence, recurrence_end_date, installment_number, installment_count, parent_entry_id,
           source_type, source_id, source_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
      `, [
        entry.entry_type, entry.description, entry.category, installment.amount, paidCents / 100,
        installment.dueDate, installment.number === 1 ? entry.competence_date : installment.dueDate,
        installmentStatus, installment.paymentMethod, entry.payment_account,
        paidCents > 0 ? entry.paid_at : null, entry.cost_center_id, entry.supplier_id, req.user?.id || null, entry.attachment_url,
        entry.notes, entry.recurrence, entry.recurrence_end_date, installment.number, installmentCount, parentId,
        idempotencyKey ? "manual_entry" : null, parentId, sourceKey
      ]);
      if (!parentId) {
        parentId = result.returnedId;
        if (idempotencyKey) {
          await db.run("UPDATE financial_entries SET source_id=? WHERE id=?", [parentId, parentId]);
        }
      }
      created.push(result.returnedId);
    }
    await db.run("COMMIT");
    res.status(201).json(await db.all(`SELECT * FROM financial_entries WHERE id IN (${created.map(() => "?").join(",")}) ORDER BY id`, created));
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    if (idempotencyKey && error?.code === "23505") {
      const repeated = await getExistingGroup();
      if (repeated.length && sameIdempotentRequest(repeated)) return res.status(200).json(repeated);
    }
    throw error;
  }
}));

router.patch("/api/finance/entries/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  const current = await db.get("SELECT * FROM financial_entries WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Lançamento não encontrado." });
  if (current.source_key && current.source_type !== "manual_entry" && !["paid_amount", "status", "payment_method", "payment_account", "notes", "attachment_url"].some((key) => req.body?.[key] !== undefined)) {
    return res.status(400).json({ error: "Lançamentos integrados devem ser alterados no módulo de origem." });
  }
  let entry;
  try { entry = normalizeEntry(req.body, current); } catch (error) { return res.status(400).json({ error: error.message }); }
  await db.run("BEGIN");
  try {
    await db.run(`
      UPDATE financial_entries SET entry_type=?, description=?, category=?, amount=?, paid_amount=?, due_date=?,
        competence_date=?, status=?, payment_method=?, payment_account=?, paid_at=?, cost_center_id=?, supplier_id=?,
        attachment_url=?, notes=?, recurrence=?, recurrence_end_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `, [
      entry.entry_type, entry.description, entry.category, entry.amount, entry.paid_amount, entry.due_date,
      entry.competence_date, entry.status, entry.payment_method, entry.payment_account, entry.paid_at,
      entry.cost_center_id, entry.supplier_id, entry.attachment_url, entry.notes, entry.recurrence, entry.recurrence_end_date, current.id
    ]);
    const updated = await db.get("SELECT * FROM financial_entries WHERE id=?", [current.id]);
    await db.run("INSERT INTO financial_entry_audit (entry_id, user_id, action, before_data, after_data) VALUES (?, ?, 'update', ?, ?)", [
      current.id, req.user?.id || null, JSON.stringify(current), JSON.stringify(updated)
    ]);
    await db.run("COMMIT");
    res.json(updated);
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.get("/api/finance/cost-centers", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_VIEW)) return;
  const includeInactive = String(req.query?.include_inactive || "") === "1";
  res.json(await db.all(`SELECT * FROM financial_cost_centers ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`));
}));

router.post("/api/finance/cost-centers", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Informe o centro de custo." });
  // Devolve o próprio centro de custo (antes vazava o resultado cru do driver).
  const result = await db.run(
    `INSERT INTO financial_cost_centers (name, description) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE
       SET description=COALESCE(EXCLUDED.description, financial_cost_centers.description), is_active=1
     RETURNING id`,
    [name, req.body?.description ?? null]
  );
  res.status(201).json(await db.get("SELECT * FROM financial_cost_centers WHERE id = ?", [result.returnedId]));
}));

router.patch("/api/finance/cost-centers/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  const current = await db.get("SELECT * FROM financial_cost_centers WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Centro de custo não encontrado." });
  const name = String(req.body?.name ?? current.name).trim();
  if (!name) return res.status(400).json({ error: "Informe o centro de custo." });
  await db.run(
    "UPDATE financial_cost_centers SET name=?, description=?, is_active=? WHERE id=?",
    [name, req.body?.description ?? current.description, req.body?.is_active ?? current.is_active, current.id]
  );
  res.json(await db.get("SELECT * FROM financial_cost_centers WHERE id = ?", [current.id]));
}));

router.get("/api/finance/categories", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_VIEW)) return;
  const includeInactive = String(req.query?.include_inactive || "") === "1";
  res.json(await db.all(`SELECT * FROM financial_categories ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`));
}));

router.post("/api/finance/categories", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Informe a categoria." });
  const result = await db.run(
    `INSERT INTO financial_categories (name, description) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE
       SET description=COALESCE(EXCLUDED.description, financial_categories.description), is_active=1
     RETURNING id`,
    [name, req.body?.description ?? null]
  );
  res.status(201).json(await db.get("SELECT * FROM financial_categories WHERE id = ?", [result.returnedId]));
}));

router.patch("/api/finance/categories/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  const current = await db.get("SELECT * FROM financial_categories WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Categoria não encontrada." });
  const name = String(req.body?.name ?? current.name).trim();
  if (!name) return res.status(400).json({ error: "Informe a categoria." });
  await db.run(
    "UPDATE financial_categories SET name=?, description=?, is_active=? WHERE id=?",
    [name, req.body?.description ?? current.description, req.body?.is_active ?? current.is_active, current.id]
  );
  res.json(await db.get("SELECT * FROM financial_categories WHERE id = ?", [current.id]));
}));

router.get("/api/finance/suppliers", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_VIEW)) return;
  const search = String(req.query?.search || "").trim();
  const includeInactive = String(req.query?.include_inactive || "") === "1";
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push("s.is_active = 1 AND s.quality_status <> 'blocked'");
  if (search) {
    clauses.push(`(s.name ILIKE ? OR s.legal_name ILIKE ? OR s.trade_name ILIKE ? OR s.document ILIKE ?
      OR s.contact_name ILIKE ? OR s.phone ILIKE ? OR s.whatsapp ILIKE ? OR s.email ILIKE ?
      OR s.website ILIKE ? OR s.categories::text ILIKE ? OR s.brands::text ILIKE ?
      OR s.material_references::text ILIKE ? OR s.certifications::text ILIKE ? OR s.lot_references::text ILIKE ?
      OR s.city ILIKE ?)`);
    params.push(...Array(15).fill(`%${search}%`));
  }
  res.json(await db.all(`
    SELECT s.*,
      (SELECT MAX(po.purchase_date) FROM purchase_orders po WHERE po.supplier_id=s.id AND po.status='confirmed') AS last_purchase_date,
      COALESCE((SELECT SUM(po.total_value) FROM purchase_orders po WHERE po.supplier_id=s.id AND po.status='confirmed'), 0) AS total_purchased,
      COALESCE((SELECT SUM(GREATEST(fe.amount-fe.paid_amount, 0)) FROM financial_entries fe
        WHERE fe.supplier_id=s.id AND fe.entry_type='payable' AND fe.lifecycle_status='active'
          AND fe.status IN ('pending', 'overdue', 'partially_paid')), 0) AS pending_payables
    FROM suppliers s ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY s.name`, params));
}));

function supplierWriteValues(supplier) {
  return SUPPLIER_COLUMNS.map((column) => {
    if (SUPPLIER_JSON_COLUMNS.has(column)) return JSON.stringify(supplier[column] || []);
    if (column === "is_active") return supplier[column] ? 1 : 0;
    return supplier[column];
  });
}

async function ensureUniqueSupplierDocument(db, document, excludedId = null) {
  if (!document) return;
  const duplicate = await db.get(
    `SELECT id FROM suppliers WHERE document=?${excludedId ? " AND id<>?" : ""}`,
    excludedId ? [document, excludedId] : [document]
  );
  if (duplicate) throw new SupplierValidationError("Já existe um fornecedor com este CPF/CNPJ.", 409);
}

function sendSupplierError(res, error) {
  if (error instanceof SupplierValidationError) return res.status(error.status).json({ error: error.message });
  if (error?.code === "23505") return res.status(409).json({ error: "Já existe um fornecedor com este CPF/CNPJ." });
  throw error;
}

router.post("/api/finance/suppliers", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  try {
    const supplier = normalizeSupplierInput(req.body);
    await ensureUniqueSupplierDocument(db, supplier.document);
    const placeholders = SUPPLIER_COLUMNS.map((column) => SUPPLIER_JSON_COLUMNS.has(column) ? "?::jsonb" : "?");
    const result = await db.run(
      `INSERT INTO suppliers (${SUPPLIER_COLUMNS.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
      supplierWriteValues(supplier)
    );
    res.status(201).json(await db.get("SELECT * FROM suppliers WHERE id = ?", [result.returnedId]));
  } catch (error) {
    return sendSupplierError(res, error);
  }
}));

router.patch("/api/finance/suppliers/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  const current = await db.get("SELECT * FROM suppliers WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Fornecedor não encontrado." });
  try {
    const supplier = normalizeSupplierInput(req.body, current);
    await ensureUniqueSupplierDocument(db, supplier.document, current.id);
    const assignments = SUPPLIER_COLUMNS.map((column) => `${column}=${SUPPLIER_JSON_COLUMNS.has(column) ? "?::jsonb" : "?"}`);
    await db.run(
      `UPDATE suppliers SET ${assignments.join(", ")}, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id=?`,
      [...supplierWriteValues(supplier), current.id]
    );
    res.json(await db.get("SELECT * FROM suppliers WHERE id = ?", [current.id]));
  } catch (error) {
    return sendSupplierError(res, error);
  }
}));

router.get("/api/finance/export.csv", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.REPORTS_VIEW_FINANCIAL)) return;
  const rows = await db.all(`
    SELECT p.id, c.full_name AS cliente, p.amount AS valor, p.payment_type AS tipo, p.method AS metodo, p.status, p.paid_at AS data, 'pagamento' AS origem
    FROM payments p JOIN clients c ON c.id = p.client_id
    UNION ALL
    SELECT so.id, c.full_name AS cliente, so.total_value AS valor, so.order_type AS tipo, so.payment_method AS metodo, so.status, so.created_at AS data, 'venda' AS origem
    FROM sales_orders so JOIN clients c ON c.id = so.client_id
    ORDER BY data DESC
  `);
  const header = "id,cliente,valor,tipo,metodo,status,data,origem";
  const csv = [header, ...rows.map((row) => Object.values(row).map(csvEscape).join(","))].join("\n");
  res.header("Content-Type", "text/csv; charset=utf-8");
  res.attachment("relatorio-aura-clinic.csv");
  await recordPrivacyAudit(db, { req, action: "financial_export", resourceType: "financial_report", detail: { format: "csv", row_count: rows.length } });
  res.send(csv);
}));

router.get("/api/finance/export.pdf", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.REPORTS_VIEW_FINANCIAL)) return;
  const report = await buildFinanceReport(db);
  const doc = new PDFDocument({ margin: 42, size: "A4" });
  res.header("Content-Type", "application/pdf");
  res.attachment("relatorio-financeiro-aura.pdf");
  await recordPrivacyAudit(db, { req, action: "financial_export", resourceType: "financial_report", detail: { format: "pdf" } });
  doc.pipe(res);
  doc.fontSize(20).text("Aura Clinic Piercing", { align: "center" });
  doc.fontSize(14).text("Relatorio financeiro administrativo", { align: "center" });
  doc.moveDown();
  writePdfMetric(doc, "Faturamento diario", report.totals.day_total);
  writePdfMetric(doc, "Faturamento semanal", report.totals.week_total);
  writePdfMetric(doc, "Faturamento mensal", report.totals.month_total);
  writePdfMetric(doc, "Sinais recebidos no mes", report.deposits.monthTotal);
  writePdfMetric(doc, "Valores pendentes", report.forecast.pending);
  writePdfMetric(doc, "Despesas fixas", report.expensesSummary.fixed_total);
  writePdfMetric(doc, "Despesas variaveis", report.expensesSummary.variable_total);
  writePdfMetric(doc, "Lucro estimado", report.profit.estimated);
  doc.moveDown().fontSize(13).text("Formas de pagamento mais usadas");
  report.methods.forEach((item) => {
    doc.fontSize(10).text(`${item.method}: ${item.total} registro(s) - ${formatCurrency(item.amount)}`);
  });
  doc.moveDown().fontSize(13).text("Despesas recentes");
  report.expenses.slice(0, 18).forEach((item) => {
    doc.fontSize(10).text(`${item.due_date} | ${item.expense_type} | ${item.description} | ${formatCurrency(item.amount)} | ${item.status}`);
  });
  doc.end();
}));

router.get("/api/finance/export.xlsx", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.REPORTS_VIEW_FINANCIAL)) return;
  const report = await buildFinanceReport(db);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aura Clinic Piercing";

  const summary = workbook.addWorksheet("Resumo");
  summary.columns = [{ header: "Indicador", key: "label", width: 32 }, { header: "Valor", key: "value", width: 18 }];
  summary.addRows([
    { label: "Faturamento diario", value: report.totals.day_total || 0 },
    { label: "Faturamento semanal", value: report.totals.week_total || 0 },
    { label: "Faturamento mensal", value: report.totals.month_total || 0 },
    { label: "Sinais recebidos no mes", value: report.deposits.monthTotal || 0 },
    { label: "Valores pendentes", value: report.forecast.pending || 0 },
    { label: "Despesas fixas", value: report.expensesSummary.fixed_total || 0 },
    { label: "Despesas variaveis", value: report.expensesSummary.variable_total || 0 },
    { label: "Lucro estimado", value: report.profit.estimated || 0 }
  ]);

  const expensesSheet = workbook.addWorksheet("Despesas");
  expensesSheet.columns = [
    { header: "Descricao", key: "description", width: 30 },
    { header: "Tipo", key: "expense_type", width: 14 },
    { header: "Categoria", key: "category", width: 18 },
    { header: "Valor", key: "amount", width: 14 },
    { header: "Vencimento", key: "due_date", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Pagamento", key: "payment_method", width: 18 }
  ];
  expensesSheet.addRows(report.expenses);

  const monthlySheet = workbook.addWorksheet("Faturamento mensal");
  monthlySheet.columns = [{ header: "Mes", key: "month", width: 14 }, { header: "Total", key: "total", width: 16 }];
  monthlySheet.addRows(report.monthlyRevenue);

  res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.attachment("relatorio-financeiro-aura.xlsx");
  await recordPrivacyAudit(db, { req, action: "financial_export", resourceType: "financial_report", detail: { format: "xlsx" } });
  await workbook.xlsx.write(res);
  res.end();
}));

export default router;
