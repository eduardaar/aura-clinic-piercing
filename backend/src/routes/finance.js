// Rotas financeiras: relatório, despesas e exportações (CSV, PDF, XLSX).
import { Router } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { csvEscape, writePdfMetric, formatCurrency } from "../services/utils.js";
import { buildFinanceReport } from "../services/finance.js";
import { ledgerReport, normalizeEntry, processRecurringEntries } from "../services/financeLedger.js";
import { parsePaging } from "../services/pagination.js";

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

router.get("/api/finance", withFeature("basic_finance", async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
  const finance = await buildFinanceReport(db);
  res.json(finance);
}));

router.post("/api/expenses", withFeature("basic_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
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
  if (!requireRole(req, res, ["admin", "finance"])) return;
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
  if (!requireRole(req, res, ["admin", "finance"])) return;
  await db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

// O ledger é um RELATÓRIO, não uma lista: além dos lançamentos ele devolve
// caixa, DRE e inadimplência. Por isso a paginação recorta só `entries` e
// acrescenta total/limit/offset ao objeto — sem limit/offset a resposta é
// byte a byte a de antes. Os indicadores seguem somando o período inteiro.
router.get("/api/finance/ledger", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
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

router.post("/api/finance/entries", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  let entry;
  try { entry = normalizeEntry(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  const installmentCount = Math.min(Math.max(Number(req.body?.installment_count || 1), 1), 120);
  await db.run("BEGIN");
  try {
    let parentId = null;
    const created = [];
    for (let installment = 1; installment <= installmentCount; installment += 1) {
      const date = new Date(`${entry.due_date}T12:00:00`);
      date.setMonth(date.getMonth() + installment - 1);
      const amount = installmentCount === 1 ? entry.amount : Number((entry.amount / installmentCount).toFixed(2));
      const result = await db.run(`
        INSERT INTO financial_entries
          (entry_type, description, category, amount, paid_amount, due_date, competence_date, status,
           payment_method, payment_account, paid_at, cost_center_id, responsible_user_id, attachment_url,
           notes, recurrence, recurrence_end_date, installment_number, installment_count, parent_entry_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
      `, [
        entry.entry_type, entry.description, entry.category, amount, installment === 1 ? entry.paid_amount : 0,
        date.toISOString().slice(0, 10), installment === 1 ? entry.competence_date : date.toISOString().slice(0, 10),
        installment === 1 ? entry.status : "pending", entry.payment_method, entry.payment_account,
        installment === 1 ? entry.paid_at : null, entry.cost_center_id, req.user?.id || null, entry.attachment_url,
        entry.notes, entry.recurrence, entry.recurrence_end_date, installment, installmentCount, parentId
      ]);
      if (!parentId) parentId = result.returnedId;
      created.push(result.returnedId);
    }
    await db.run("COMMIT");
    res.status(201).json(await db.all(`SELECT * FROM financial_entries WHERE id IN (${created.map(() => "?").join(",")}) ORDER BY id`, created));
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.patch("/api/finance/entries/:id", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  const current = await db.get("SELECT * FROM financial_entries WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Lançamento não encontrado." });
  if (current.source_key && !["paid_amount", "status", "payment_method", "payment_account", "notes", "attachment_url"].some((key) => req.body?.[key] !== undefined)) {
    return res.status(400).json({ error: "Lançamentos integrados devem ser alterados no módulo de origem." });
  }
  let entry;
  try { entry = normalizeEntry(req.body, current); } catch (error) { return res.status(400).json({ error: error.message }); }
  await db.run("BEGIN");
  try {
    await db.run(`
      UPDATE financial_entries SET entry_type=?, description=?, category=?, amount=?, paid_amount=?, due_date=?,
        competence_date=?, status=?, payment_method=?, payment_account=?, paid_at=?, cost_center_id=?,
        attachment_url=?, notes=?, recurrence=?, recurrence_end_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `, [
      entry.entry_type, entry.description, entry.category, entry.amount, entry.paid_amount, entry.due_date,
      entry.competence_date, entry.status, entry.payment_method, entry.payment_account, entry.paid_at,
      entry.cost_center_id, entry.attachment_url, entry.notes, entry.recurrence, entry.recurrence_end_date, current.id
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

router.get("/api/finance/cost-centers", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  res.json(await db.all("SELECT * FROM financial_cost_centers ORDER BY name"));
}));

router.post("/api/finance/cost-centers", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Informe o centro de custo." });
  // Devolve o próprio centro de custo (antes vazava o resultado cru do driver).
  const result = await db.run("INSERT INTO financial_cost_centers (name, description) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description RETURNING id", [name, req.body?.description || ""]);
  res.status(201).json(await db.get("SELECT * FROM financial_cost_centers WHERE id = ?", [result.returnedId]));
}));

router.post("/api/finance/entries/:id/reconcile", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  const entry = await db.get("SELECT * FROM financial_entries WHERE id=?", [req.params.id]);
  if (!entry) return res.status(404).json({ error: "Lançamento não encontrado." });
  const statementAmount = Number(req.body?.statement_amount);
  const status = Math.abs(statementAmount - Number(entry.paid_amount || entry.amount)) < 0.01 ? "matched" : "divergent";
  await db.run(`
    INSERT INTO financial_reconciliations (entry_id, external_reference, statement_amount, statement_date, status, reconciled_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (entry_id, external_reference) DO UPDATE SET statement_amount=EXCLUDED.statement_amount,
      statement_date=EXCLUDED.statement_date, status=EXCLUDED.status, reconciled_by=EXCLUDED.reconciled_by, reconciled_at=CURRENT_TIMESTAMP
  `, [entry.id, req.body?.external_reference || "", statementAmount, req.body?.statement_date || new Date().toISOString().slice(0, 10), status, req.user?.id || null]);
  res.json({ ok: true, status });
}));

router.post("/api/finance/recurrences/process", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  res.json({ ok: true, created: await processRecurringEntries(db, req.body?.horizon_days) });
}));

router.get("/api/finance/goals", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  res.json(await db.all("SELECT * FROM financial_goals ORDER BY period_start DESC, id DESC"));
}));

router.post("/api/finance/goals", withFeature("advanced_finance", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  const name = String(req.body?.name || "").trim();
  if (!name || !req.body?.period_start || !req.body?.period_end || Number(req.body?.target_amount) < 0) {
    return res.status(400).json({ error: "Dados da meta inválidos." });
  }
  const result = await db.run(
    "INSERT INTO financial_goals (name, period_start, period_end, target_amount, goal_type) VALUES (?, ?, ?, ?, ?) RETURNING id",
    [name, req.body.period_start, req.body.period_end, Number(req.body.target_amount), req.body.goal_type || "revenue"]
  );
  res.status(201).json(await db.get("SELECT * FROM financial_goals WHERE id=?", [result.returnedId]));
}));

router.get("/api/finance/export.csv", withFeature("basic_finance", async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
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
  res.send(csv);
}));

router.get("/api/finance/export.pdf", withFeature("basic_finance", async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
  const report = await buildFinanceReport(db);
  const doc = new PDFDocument({ margin: 42, size: "A4" });
  res.header("Content-Type", "application/pdf");
  res.attachment("relatorio-financeiro-aura.pdf");
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
  report.methods.forEach((item) => doc.fontSize(10).text(`${item.method}: ${item.total} registro(s) - ${formatCurrency(item.amount)}`));
  doc.moveDown().fontSize(13).text("Despesas recentes");
  report.expenses.slice(0, 18).forEach((item) => doc.fontSize(10).text(`${item.due_date} | ${item.expense_type} | ${item.description} | ${formatCurrency(item.amount)} | ${item.status}`));
  doc.end();
}));

router.get("/api/finance/export.xlsx", withFeature("basic_finance", async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
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
  await workbook.xlsx.write(res);
  res.end();
}));

export default router;
