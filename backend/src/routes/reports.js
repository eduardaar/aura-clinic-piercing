import { Router } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { buildReport } from "../services/reports.js";
import { csvEscape } from "../services/utils.js";

const router = Router();

function title(type) {
  return `Relatório ${String(type || "").replaceAll("_", " ")}`;
}

router.get("/api/reports/:type", withFeature("basic_reports", async (req, res, db) => {
  const financialTypes = new Set(["financial", "payments", "commissions"]);
  if (!requireRole(req, res, financialTypes.has(req.params.type) ? ["admin", "finance"] : ["admin", "finance", "reception"])) return;
  try {
    const report = await buildReport(db, req.params.type, req.query);
    const format = String(req.query.format || "json");
    const columns = report.rows.length ? Object.keys(report.rows[0]) : [];
    if (format === "csv") {
      const csv = [columns.join(","), ...report.rows.map((row) => columns.map((key) => csvEscape(row[key])).join(","))].join("\n");
      res.header("Content-Type", "text/csv; charset=utf-8");
      res.attachment(`${req.params.type}-${report.from}-${report.to}.csv`);
      return res.send(csv);
    }
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Relatório");
      sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
      sheet.addRows(report.rows);
      res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.attachment(`${req.params.type}-${report.from}-${report.to}.xlsx`);
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
      report.rows.slice(0, 250).forEach((row) => doc.fontSize(7).text(columns.map((key) => `${key}: ${row[key] ?? ""}`).join(" | ")));
      doc.end();
      return;
    }
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

export default router;
