// Rotas de profissionais.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

router.post("/api/professionals", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { name, specialty } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome do profissional é obrigatório." });
  const result = await db.run("INSERT INTO professionals (name, specialty, active) VALUES (?, ?, 1)", [name.trim(), specialty || ""]);
  res.status(201).json(await db.get("SELECT * FROM professionals WHERE id = ?", [result.lastID]));
}));

router.patch("/api/professionals/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [req.params.id]);
  if (!professional) return res.status(404).json({ error: "Profissional não encontrado." });
  await db.run("UPDATE professionals SET name = ?, specialty = ? WHERE id = ?", [req.body.name?.trim() || professional.name, req.body.specialty || professional.specialty, req.params.id]);
  res.json(await db.get("SELECT * FROM professionals WHERE id = ?", [req.params.id]));
}));

router.delete("/api/professionals/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const linked = await db.get("SELECT COUNT(*) AS count FROM appointments WHERE professional_id = ?", [req.params.id]);
  if (linked.count > 0) {
    await db.run("UPDATE professionals SET active = 0 WHERE id = ?", [req.params.id]);
    return res.json({ ok: true, archived: true });
  }
  await db.run("DELETE FROM professionals WHERE id = ?", [req.params.id]);
  res.json({ ok: true, archived: false });
}));

export default router;
