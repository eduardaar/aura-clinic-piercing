// Rotas de procedimentos.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";
import { validateBody } from "../middleware/validate.js";
import { procedureCreateSchema, procedureUpdateSchema } from "../schemas/index.js";

const router = Router();

router.get("/api/procedures", withDb(async (_req, res, db) => {
  res.json(await db.all(`
    SELECT p.id, p.service_id, p.name, p.body_area, p.description, p.price, p.duration_minutes,
      p.aftercare_instructions, p.is_active, p.created_at, p.updated_at, s.name AS service_name
    FROM procedures p
    LEFT JOIN services s ON s.id = p.service_id
    ORDER BY s.name, p.name
  `));
}));

router.get("/api/procedures/:id", withDb(async (req, res, db) => {
  const procedure = await db.get(`
    SELECT p.*, s.name AS service_name
    FROM procedures p LEFT JOIN services s ON s.id = p.service_id
    WHERE p.id = ?
  `, [req.params.id]);
  if (!procedure) return res.status(404).json({ error: "Procedimento não encontrado." });
  res.json(procedure);
}));

router.post("/api/procedures", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(procedureCreateSchema, req, res)) return;
  const b = req.body || {};
  const result = await db.run(
    `INSERT INTO procedures (service_id, name, body_area, description, price, duration_minutes, aftercare_instructions, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(b.service_id), b.name.trim(), b.body_area || "", b.description || "", Number(b.price || 0), Number(b.duration_minutes || 40), b.aftercare_instructions || "", boolNumber(b.is_active ?? 1)]
  );
  res.status(201).json(await db.get("SELECT * FROM procedures WHERE id = ?", [result.lastID]));
}));

router.put("/api/procedures/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(procedureUpdateSchema, req, res)) return;
  const existing = await db.get("SELECT * FROM procedures WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Procedimento não encontrado." });
  const b = req.body || {};
  await db.run(
    `UPDATE procedures SET service_id = ?, name = ?, body_area = ?, description = ?, price = ?,
      duration_minutes = ?, aftercare_instructions = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [Number(b.service_id || existing.service_id), b.name || existing.name, b.body_area ?? existing.body_area, b.description ?? existing.description, Number(b.price ?? existing.price), Number(b.duration_minutes || existing.duration_minutes), b.aftercare_instructions ?? existing.aftercare_instructions, boolNumber(b.is_active ?? existing.is_active), req.params.id]
  );
  res.json(await db.get("SELECT * FROM procedures WHERE id = ?", [req.params.id]));
}));

router.delete("/api/procedures/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  await db.run("DELETE FROM procedures WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
