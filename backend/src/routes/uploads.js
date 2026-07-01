// Rota de upload genérico de arquivos.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = Router();

router.post("/api/uploads", upload.single("file"), withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
}));

export default router;
