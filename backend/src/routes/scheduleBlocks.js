// Rotas de bloqueios de agenda dos profissionais.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";

const router = Router();

router.get("/api/schedule-blocks", withDb(async (_req, res, db) => {
  res.json(await db.all(`
    SELECT b.*, p.name AS professional_name
    FROM schedule_blocks b
    JOIN professionals p ON p.id = b.professional_id
    ORDER BY b.start_datetime DESC
  `));
}));

router.post("/api/schedule-blocks", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const result = await db.run(
    "INSERT INTO schedule_blocks (professional_id, start_datetime, end_datetime, reason, notes, is_full_day, is_recurring) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.body.professional_id, req.body.start_datetime, req.body.end_datetime, req.body.reason || "Bloqueio", req.body.notes || "", boolNumber(req.body.is_full_day), boolNumber(req.body.is_recurring)]
  );
  res.status(201).json(await db.get("SELECT * FROM schedule_blocks WHERE id = ?", [result.lastID]));
}));

router.delete("/api/schedule-blocks/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await db.run("DELETE FROM schedule_blocks WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
