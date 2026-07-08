// Rotas de disponibilidade dos profissionais.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";

const router = Router();

function normalizeAvailabilityBody(body = {}, current = {}) {
  return {
    professional_id: Number(body.professional_id ?? current.professional_id ?? 0),
    weekday: Number(body.weekday ?? current.weekday ?? 0),
    is_active: boolNumber(body.is_active ?? current.is_active ?? 1),
    start_time: body.start_time ?? current.start_time ?? "09:00",
    end_time: body.end_time ?? current.end_time ?? "18:00",
    lunch_start: body.lunch_start ?? current.lunch_start ?? "",
    lunch_end: body.lunch_end ?? current.lunch_end ?? "",
    duration_minutes: Number(body.duration_minutes ?? current.duration_minutes ?? 40),
    buffer_minutes: Number(body.buffer_minutes ?? current.buffer_minutes ?? 10)
  };
}

router.get("/api/availability", withDb(async (_req, res, db) => {
  res.json(await db.all(`
    SELECT a.*, p.name AS professional_name
    FROM professional_availability a
    JOIN professionals p ON p.id = a.professional_id
    ORDER BY p.name, a.weekday
  `));
}));

router.post("/api/availability", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const next = normalizeAvailabilityBody(req.body);
  if (!next.professional_id || next.weekday < 0 || next.weekday > 6) {
    return res.status(400).json({ error: "Profissional e dia da semana sao obrigatorios." });
  }
  const professional = await db.get("SELECT id FROM professionals WHERE id = ?", [next.professional_id]);
  if (!professional) return res.status(404).json({ error: "Profissional nao encontrado." });
  await db.run(
    `INSERT INTO professional_availability
     (professional_id, weekday, is_active, start_time, end_time, lunch_start, lunch_end, duration_minutes, buffer_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (professional_id, weekday) DO UPDATE SET
       is_active = excluded.is_active,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       lunch_start = excluded.lunch_start,
       lunch_end = excluded.lunch_end,
       duration_minutes = excluded.duration_minutes,
       buffer_minutes = excluded.buffer_minutes`,
    [next.professional_id, next.weekday, next.is_active, next.start_time, next.end_time, next.lunch_start, next.lunch_end, next.duration_minutes, next.buffer_minutes]
  );
  res.status(201).json(await db.get(
    "SELECT * FROM professional_availability WHERE professional_id = ? AND weekday = ?",
    [next.professional_id, next.weekday]
  ));
}));

router.post("/api/availability/generate-weekly", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const professionalId = Number(req.body.professional_id || 0);
  if (!professionalId) return res.status(400).json({ error: "Profissional e obrigatorio." });
  const professional = await db.get("SELECT id FROM professionals WHERE id = ? AND active = 1", [professionalId]);
  if (!professional) return res.status(404).json({ error: "Profissional ativo nao encontrado." });
  const weekdays = Array.isArray(req.body.weekdays) && req.body.weekdays.length
    ? req.body.weekdays.map(Number)
    : [1, 2, 3, 4, 5, 6];
  const base = normalizeAvailabilityBody(req.body, {
    professional_id: professionalId,
    is_active: 1,
    start_time: "09:00",
    end_time: "18:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    duration_minutes: 40,
    buffer_minutes: 10
  });
  for (const weekday of weekdays.filter((day) => day >= 0 && day <= 6)) {
    await db.run(
      `INSERT INTO professional_availability
       (professional_id, weekday, is_active, start_time, end_time, lunch_start, lunch_end, duration_minutes, buffer_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (professional_id, weekday) DO UPDATE SET
         is_active = excluded.is_active,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         lunch_start = excluded.lunch_start,
         lunch_end = excluded.lunch_end,
         duration_minutes = excluded.duration_minutes,
         buffer_minutes = excluded.buffer_minutes`,
      [professionalId, weekday, base.is_active, base.start_time, base.end_time, base.lunch_start, base.lunch_end, base.duration_minutes, base.buffer_minutes]
    );
  }
  res.status(201).json(await db.all("SELECT * FROM professional_availability WHERE professional_id = ? ORDER BY weekday", [professionalId]));
}));

router.patch("/api/availability/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const current = await db.get("SELECT * FROM professional_availability WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Disponibilidade nao encontrada." });
  const next = normalizeAvailabilityBody(req.body, current);
  await db.run(
    `UPDATE professional_availability
     SET is_active = ?, start_time = ?, end_time = ?, lunch_start = ?, lunch_end = ?, duration_minutes = ?, buffer_minutes = ?
     WHERE id = ?`,
    [
      next.is_active,
      next.start_time,
      next.end_time,
      next.lunch_start,
      next.lunch_end,
      next.duration_minutes,
      next.buffer_minutes,
      req.params.id
    ]
  );
  res.json(await db.get("SELECT * FROM professional_availability WHERE id = ?", [req.params.id]));
}));

export default router;
