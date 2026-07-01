// Rotas financeiras: relatório, despesas e exportações (CSV, PDF, XLSX).
import { Router } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { csvEscape, writePdfMetric, formatCurrency } from "../services/utils.js";
import { buildFinanceReport } from "../services/finance.js";

const router = Router();

router.get("/api/finance", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
  const finance = await buildFinanceReport(db);
  res.json(finance);
}));

router.post("/api/expenses", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  const { description, expense_type, category, amount, due_date, status, payment_method, notes } = req.body;
  if (!description?.trim() || !["fixa", "variavel"].includes(expense_type) || !due_date) {
    return res.status(400).json({ error: "Dados da despesa inválidos." });
  }
  const result = await db.run(
    `INSERT INTO expenses (description, expense_type, category, amount, due_date, status, payment_method, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [description.trim(), expense_type, category || "", Number(amount || 0), due_date, status || "paga", payment_method || "", notes || ""]
  );
  res.status(201).json(await db.get("SELECT * FROM expenses WHERE id = ?", [result.lastID]));
}));

router.delete("/api/expenses/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  await db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

router.get("/api/finance/export.csv", withDb(async (_req, res, db) => {
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

router.get("/api/finance/export.pdf", withDb(async (_req, res, db) => {
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

router.get("/api/finance/export.xlsx", withDb(async (_req, res, db) => {
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
