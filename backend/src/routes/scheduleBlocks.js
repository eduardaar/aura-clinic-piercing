// Rotas de bloqueios de agenda dos profissionais.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { boolNumber } from "../services/utils.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";

const router = Router();

const BLOCK_TYPES = new Set(["block", "unavailable", "special_hours"]);

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const BLOCK_SORTABLE = {
  start: "b.start_datetime",
  end: "b.end_datetime",
  professional: "p.name",
  block_type: "b.block_type"
};

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

router.get("/api/schedule-blocks", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_VIEW)) return;
  const clauses = [];
  const params = [];
  if (req.query.professional_id) {
    clauses.push("b.professional_id = ?");
    params.push(req.query.professional_id);
  }
  if (req.query.block_type) {
    clauses.push("b.block_type = ?");
    params.push(req.query.block_type);
  }
  // Período: pega os bloqueios que se sobrepõem ao intervalo pedido.
  if (req.query.from) {
    clauses.push("b.end_datetime >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("b.start_datetime <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  if (req.query.search) {
    clauses.push("(b.reason ILIKE ? OR b.notes ILIKE ? OR p.name ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: BLOCK_SORTABLE,
    tieBreak: "b.id",
    defaultOrderBy: "ORDER BY b.start_datetime DESC, b.id DESC"
  });
  const { rows, total } = await fetchPage(db, {
    select: "b.*, p.name AS professional_name",
    from: "schedule_blocks b JOIN professionals p ON p.id = b.professional_id",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows, total, paging));
}));

router.post("/api/schedule-blocks", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  const next = normalizeBlock(req.body);
  if (!next.professional_id || !next.start_datetime || !next.end_datetime) {
    return res.status(400).json({ error: "Profissional, inicio e final sao obrigatorios." });
  }
  const professional = await db.get("SELECT id FROM professionals WHERE id = ?", [next.professional_id]);
  if (!professional) return res.status(404).json({ error: "Profissional nao encontrado." });
  const result = await db.run(
    `INSERT INTO schedule_blocks
      (professional_id, start_datetime, end_datetime, block_type, reason, notes, is_full_day, is_recurring, lunch_start, lunch_end, duration_minutes, buffer_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [next.professional_id, next.start_datetime, next.end_datetime, next.block_type, next.reason, next.notes, next.is_full_day, next.is_recurring, next.lunch_start, next.lunch_end, next.duration_minutes, next.buffer_minutes]
  );
  res.status(201).json(await db.get("SELECT * FROM schedule_blocks WHERE id = ?", [result.returnedId]));
}));

router.patch("/api/schedule-blocks/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
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

router.delete("/api/schedule-blocks/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  await db.run("DELETE FROM schedule_blocks WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
