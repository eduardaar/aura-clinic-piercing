import { Router } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { withFeature } from "../middleware/withDb.js";
import {
  buildReport,
  getReportDefinition,
  REPORT_CATALOG,
  REPORT_FEATURE_REQUIREMENTS,
  reportColumns,
  reportExportColumns,
  reportExportValue,
  resolveReportAccess
} from "../services/reports.js";
import { csvEscape } from "../services/utils.js";
import { hasFeature, requireFeature, tenantSubscription } from "../services/subscriptions.js";
import { recordAudit } from "../services/audit.js";

const router = Router();

function title(type) {
  return getReportDefinition(type)?.label || `Relatório ${String(type || "").replaceAll("_", " ")}`;
}

router.get("/api/reports", withFeature("basic_reports", async (req, res) => {
  const subscription = await tenantSubscription(req.tenant.id);
  const hasPlanFeature = (feature) => hasFeature(subscription, feature);
  const reports = REPORT_CATALOG.filter((report) => {
    const access = resolveReportAccess(req.user, report.type, { hasPlanFeature });
    // 409 = permissão existe, falta só vincular o usuário a um profissional: o
    // relatório continua listado para a tela explicar o que fazer.
    if (!access.allowed && access.status !== 409) return false;
    return (REPORT_FEATURE_REQUIREMENTS[report.type] || []).every(hasPlanFeature);
  }).map((report) => {
    // Colunas efetivas para ESTE usuário (comissão/custo podem sair).
    const access = resolveReportAccess(req.user, report.type, { hasPlanFeature });
    const definition = { ...report };
    if (report.columns) definition.columns = reportColumns(report.type, access.context);
    return definition;
  });
  res.json({ reports, formats: ["pdf", "xlsx", "csv", "txt"] });
}));

router.get("/api/reports/:type", withFeature("basic_reports", async (req, res, db) => {
  const type = req.params.type;
  if (!getReportDefinition(type)) return res.status(400).json({ error: "Relatório inválido." });
  for (const feature of REPORT_FEATURE_REQUIREMENTS[type] || []) {
    if (!(await requireFeature(req, res, feature))) return;
  }
  const subscription = await tenantSubscription(req.tenant.id);
  const access = resolveReportAccess(req.user, type, { hasPlanFeature: (feature) => hasFeature(subscription, feature) });
  if (!access.allowed) return res.status(access.status).json({ error: access.error });
  const filters = { ...req.query };
  // Escopo próprio: o profissional é o do usuário, qualquer que seja a query.
  if (access.ownProfessionalId) filters.professional_id = access.ownProfessionalId;
  try {
    const format = String(req.query.format || "json");
    if (!["json", "csv", "xlsx", "pdf", "txt"].includes(format)) return res.status(400).json({ error: "Formato de relatório inválido." });
    filters.paginated = format === "json";
    const report = await buildReport(db, type, filters, access.context);
    if (format === "json") return res.json(report);
    const columns = reportExportColumns(report);
    const auditExport = () => recordAudit(db, {
      req, module: "reports", action: "export", entityType: "report", entityId: type,
      metadata: { format, filters, row_count: report.total_rows, scope: access.ownProfessionalId ? "own" : "all" }
    });
    if (format === "csv" || format === "txt") {
      const separator = format === "csv" ? "," : "\t";
      const content = [columns.map(({ label }) => csvEscape(label)).join(separator), ...report.rows.map((row) => columns.map((column) => csvEscape(reportExportValue(column, row[column.key]))).join(separator))].join("\n");
      res.header("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8");
      res.attachment(`${type}-${report.from}-${report.to}.${format}`);
      await auditExport();
      return res.send(`﻿${content}`);
    }
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Relatório");
      sheet.columns = columns.map(({ key, label }) => ({ header: label, key, width: 22 }));
      sheet.addRows(report.rows.map((row) => Object.fromEntries(columns.map((column) => [column.key, reportExportValue(column, row[column.key])]))));
      res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.attachment(`${type}-${report.from}-${report.to}.xlsx`);
      await auditExport();
      await workbook.xlsx.write(res);
      return res.end();
    }
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: columns.length > 6 ? "landscape" : "portrait" });
    res.header("Content-Type", "application/pdf");
    res.attachment(`${type}-${report.from}-${report.to}.pdf`);
    doc.pipe(res);
    doc.fontSize(18).text(title(type));
    doc.fontSize(9).text(`${report.from} a ${report.to} · ${report.total_rows} registro(s)`).moveDown();
    report.rows.forEach((row) => {
      doc.fontSize(7).text(columns.map((column) => `${column.label}: ${reportExportValue(column, row[column.key])}`).join(" | "));
    });
    await auditExport();
    doc.end();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

export default router;
