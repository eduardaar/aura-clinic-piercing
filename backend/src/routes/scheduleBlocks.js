// Rotas de bloqueios de agenda dos profissionais.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";

const router = Router();

const BLOCK_TYPES = new Set(["block", "unavailable", "special_hours"]);

function normalizeBlock(body = {}, current = {}) {
  const blockType = BLOCK_TYPES.has(String(body.block_type || current.block_type || "block"))
    ? String(body.block_type || current.block_type || "block")
    : "block";
  return {
    professional_id: Number(body.professional_id ?? current.professional_id ?? 0),
    start_datetime: body.start_datetime ?? current.start_datetime ?? "",
    end_datetime: body.end_datetime ?? current.end_datetime ?? "",
    block_type: blockType,
    reason: body.reason || current.reason || (blockType === "special_hours" ? "Horario especial" : "Bloqueio"),
    notes: body.notes ?? current.notes ?? "",
    is_full_day: blockType === "unavailable" ? 1 : boolNumber(body.is_full_day ?? current.is_full_day),
    is_recurring: boolNumber(body.is_recurring ?? current.is_recurring),
    lunch_start: body.lunch_start ?? current.lunch_start ?? "",
    lunch_end: body.lunch_end ?? current.lunch_end ?? "",
    duration_minutes: body.duration_minutes === "" || body.duration_minutes === undefined ? null : Number(body.duration_minutes),
    buffer_minutes: body.buffer_minutes === "" || body.buffer_minutes === undefined ? null : Number(body.buffer_minutes)
  };
}

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
  const next = normalizeBlock(req.body);
  if (!next.professional_id || !next.start_datetime || !next.end_datetime) {
    return res.status(400).json({ error: "Profissional, inicio e final sao obrigatorios." });
  }
  const professional = await db.get("SELECT id FROM professionals WHERE id = ?", [next.professional_id]);
  if (!professional) return res.status(404).json({ error: "Profissional nao encontrado." });
  const result = await db.run(
    `INSERT INTO schedule_blocks
      (professional_id, start_datetime, end_datetime, block_type, reason, notes, is_full_day, is_recurring, lunch_start, lunch_end, duration_minutes, buffer_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [next.professional_id, next.start_datetime, next.end_datetime, next.block_type, next.reason, next.notes, next.is_full_day, next.is_recurring, next.lunch_start, next.lunch_end, next.duration_minutes, next.buffer_minutes]
  );
  res.status(201).json(await db.get("SELECT * FROM schedule_blocks WHERE id = ?", [result.lastID]));
}));

router.patch("/api/schedule-blocks/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const current = await db.get("SELECT * FROM schedule_blocks WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Regra de disponibilidade nao encontrada." });
  const next = normalizeBlock(req.body, current);
  await db.run(
    `UPDATE schedule_blocks
     SET professional_id = ?, start_datetime = ?, end_datetime = ?, block_type = ?, reason = ?, notes = ?,
       is_full_day = ?, is_recurring = ?, lunch_start = ?, lunch_end = ?, duration_minutes = ?, buffer_minutes = ?
     WHERE id = ?`,
    [next.professional_id, next.start_datetime, next.end_datetime, next.block_type, next.reason, next.notes, next.is_full_day, next.is_recurring, next.lunch_start, next.lunch_end, next.duration_minutes, next.buffer_minutes, req.params.id]
  );
  res.json(await db.get("SELECT * FROM schedule_blocks WHERE id = ?", [req.params.id]));
}));

router.delete("/api/schedule-blocks/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await db.run("DELETE FROM schedule_blocks WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
