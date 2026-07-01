// Rotas de disponibilidade dos profissionais.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";

const router = Router();

router.get("/api/availability", withDb(async (_req, res, db) => {
  res.json(await db.all(`
    SELECT a.*, p.name AS professional_name
    FROM professional_availability a
    JOIN professionals p ON p.id = a.professional_id
    ORDER BY p.name, a.weekday
  `));
}));

router.patch("/api/availability/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const current = await db.get("SELECT * FROM professional_availability WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Disponibilidade não encontrada." });
  await db.run(
    `UPDATE professional_availability
     SET is_active = ?, start_time = ?, end_time = ?, lunch_start = ?, lunch_end = ?, duration_minutes = ?, buffer_minutes = ?
     WHERE id = ?`,
    [
      boolNumber(req.body.is_active || current.is_active),
      req.body.start_time || current.start_time,
      req.body.end_time || current.end_time,
      req.body.lunch_start || current.lunch_start,
      req.body.lunch_end || current.lunch_end,
      Number(req.body.duration_minutes || current.duration_minutes),
      Number(req.body.buffer_minutes || current.buffer_minutes),
      req.params.id
    ]
  );
  res.json(await db.get("SELECT * FROM professional_availability WHERE id = ?", [req.params.id]));
}));

export default router;
