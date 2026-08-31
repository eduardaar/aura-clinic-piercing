import { Router } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { withFeature } from "../middleware/withDb.js";
import { buildReport, getReportDefinition, REPORT_CATALOG, REPORT_FEATURE_REQUIREMENTS } from "../services/reports.js";
import { csvEscape } from "../services/utils.js";
import { P } from "../config/permissions.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { hasPermission } from "../services/permissionService.js";
import { hasFeature, requireFeature, tenantSubscription } from "../services/subscriptions.js";
import { recordAudit } from "../services/audit.js";

const router = Router();

function title(type) {
  return getReportDefinition(type)?.label || `Relatório ${String(type || "").replaceAll("_", " ")}`;
}

const FINANCIAL_TYPES = new Set(["financial", "payables", "receivables", "purchases", "payments", "commissions"]);
const OWN_REPORT_TYPES = new Set(["appointments", "cancellations", "services", "professionals", "commissions"]);

const VALUE_LABELS = Object.freeze({
  active: "Ativo", inactive: "Inativo", approved: "Aprovado", review: "Em análise", blocked: "Bloqueado",
  draft: "Rascunho", confirmed: "Confirmada", cancelled: "Cancelada", pending: "Pendente", paid: "Pago",
  partially_paid: "Parcialmente pago", overdue: "Vencido", canceled: "Cancelado", refunded: "Estornado",
  product: "Produto/joia", consumable: "Material de consumo", expired: "Vencido", expiring: "Próximo do vencimento",
  exhausted: "Esgotado", available: "Disponível", info: "Informativa", warning: "Atenção", critical: "Crítica",
  payable: "A pagar", receivable: "A receber", income: "Receita", expense: "Despesa"
});

function exportColumns(report, definition) {
  const available = report.rows.length ? Object.keys(report.rows[0]) : (definition?.columns || []).map(({ key }) => key);
  const declared = new Map((definition?.columns || []).map((column) => [column.key, column]));
  return available.map((key) => ({ key, label: declared.get(key)?.label || String(key).replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()), kind: declared.get(key)?.kind }));
}

function exportValue(column, value) {
  if (value === null || value === undefined || value === "") return "";
  if (column.kind === "boolean" || typeof value === "boolean") return value === true || value === 1 ? "Sim" : "Não";
  if (column.kind === "date") {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("pt-BR");
  }
  return VALUE_LABELS[String(value)] || value;
}

function reportPermission(req, type) {
  return FINANCIAL_TYPES.has(type)
    ? P.REPORTS_VIEW_FINANCIAL
    : (hasPermission(req.user, P.REPORTS_VIEW_ALL) ? P.REPORTS_VIEW_ALL : P.REPORTS_VIEW_OWN);
}

router.get("/api/reports", withFeature("basic_reports", async (req, res) => {
  const subscription = await tenantSubscription(req.tenant.id);
  const reports = REPORT_CATALOG.filter((report) => {
    const permission = reportPermission(req, report.type);
    if (!hasPermission(req.user, permission)) return false;
    if (permission === P.REPORTS_VIEW_OWN && !OWN_REPORT_TYPES.has(report.type)) return false;
    return (REPORT_FEATURE_REQUIREMENTS[report.type] || []).every((feature) => hasFeature(subscription, feature));
  });
  res.json({ reports, formats: ["pdf", "xlsx", "csv", "txt"] });
}));

router.get("/api/reports/:type", withFeature("basic_reports", async (req, res, db) => {
  for (const feature of REPORT_FEATURE_REQUIREMENTS[req.params.type] || []) {
    if (!(await requireFeature(req, res, feature))) return;
  }
  const permission = reportPermission(req, req.params.type);
  if (!authorizePermission(req, res, permission)) return;
  const filters = { ...req.query };
  if (permission === P.REPORTS_VIEW_OWN) {
    if (!req.user.professional_id) return res.status(409).json({ error: "Vincule este usuário a um profissional antes de habilitar relatórios próprios." });
    if (!OWN_REPORT_TYPES.has(req.params.type)) return res.status(403).json({ error: "Este relatório exige permissão para visualizar dados de toda a clínica." });
    filters.professional_id = req.user.professional_id;
  }
  try {
    const format = String(req.query.format || "json");
    if (!["json", "csv", "xlsx", "pdf", "txt"].includes(format)) return res.status(400).json({ error: "Formato de relatório inválido." });
    filters.paginated = format === "json";
    const report = await buildReport(db, req.params.type, filters);
    const definition = getReportDefinition(req.params.type);
    const columns = exportColumns(report, definition);
    if (format === "csv" || format === "txt") {
      const separator = format === "csv" ? "," : "\t";
      const content = [columns.map(({ label }) => csvEscape(label)).join(separator), ...report.rows.map((row) => columns.map((column) => csvEscape(exportValue(column, row[column.key]))).join(separator))].join("\n");
      res.header("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8");
      res.attachment(`${req.params.type}-${report.from}-${report.to}.${format}`);
      await recordAudit(db, { req, module: "reports", action: "export", entityType: "report", entityId: req.params.type, metadata: { format, filters, row_count: report.total_rows } });
      return res.send(`\uFEFF${content}`);
    }
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Relatório");
      sheet.columns = columns.map(({ key, label }) => ({ header: label, key, width: 22 }));
      sheet.addRows(report.rows.map((row) => Object.fromEntries(columns.map((column) => [column.key, exportValue(column, row[column.key])]))));
      res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.attachment(`${req.params.type}-${report.from}-${report.to}.xlsx`);
      await recordAudit(db, { req, module: "reports", action: "export", entityType: "report", entityId: req.params.type, metadata: { format, filters, row_count: report.total_rows } });
      await workbook.xlsx.write(res);
      return res.end();
    }
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 36, size: "A4", layout: columns.length > 6 ? "landscape" : "portrait" });
      res.header("Content-Type", "application/pdf");
      res.attachment(`${req.params.type}-${report.from}-${report.to}.pdf`);
      doc.pipe(res);
      doc.fontSize(18).text(title(req.params.type));
      doc.fontSize(9).text(`${report.from} a ${report.to} · ${report.total_rows} registro(s)`).moveDown();
      report.rows.forEach((row) => {
        doc.fontSize(7).text(columns.map((column) => `${column.label}: ${exportValue(column, row[column.key])}`).join(" | "));
      });
      await recordAudit(db, { req, module: "reports", action: "export", entityType: "report", entityId: req.params.type, metadata: { format, filters, row_count: report.total_rows } });
      doc.end();
      return;
    }
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

export default router;
