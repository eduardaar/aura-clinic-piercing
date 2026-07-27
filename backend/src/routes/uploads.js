// Rota de upload genérico de arquivos.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import path from "path";
import { upload, parseUpload } from "../middleware/upload.js";
import { privateUploadsDir } from "../config/index.js";

const router = Router();

router.post("/api/uploads", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await parseUpload(upload.single("file"), req, res);
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
}));

router.get("/api/private-files/:filename", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  const filename = String(req.params.filename || "");
  if (!/^[a-zA-Z0-9_-]+(?:\.pdf)?$/.test(filename)) return res.status(400).json({ error: "Arquivo inválido." });
  const file = await db.get("SELECT id, purpose FROM private_files WHERE filename=?", [filename]);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (req.user?.role === "reception" && !["appointment_reference", "public_booking"].includes(file.purpose)) {
    return res.status(403).json({ error: "Acesso negado." });
  }
  res.sendFile(path.join(privateUploadsDir, filename), (error) => {
    if (error && !res.headersSent) res.status(error.statusCode || 404).json({ error: "Arquivo não encontrado." });
  });
}));

export default router;
