// Rotas de procedimentos.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";
import { validateBody } from "../middleware/validate.js";
import { procedureCreateSchema, procedureUpdateSchema } from "../schemas/index.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { normalizePostcareDays } from "../services/serviceRules.js";

const router = Router();

function nullableNumber(value) {
  return value === "" || value === null || value === undefined ? null : Number(value);
}

function nullableBoolean(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "string") return ["1", "true", "sim", "on"].includes(value.toLowerCase());
  return Boolean(value);
}

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const PROCEDURE_SORTABLE = {
  name: "p.name",
  service: "s.name",
  price: "p.price",
  duration: "p.duration_minutes",
  body_area: "p.body_area",
  created_at: "p.created_at"
};

router.get("/api/procedures", withFeature("procedures", async (req, res, db) => {
  const clauses = [];
  const params = [];
  if (req.query.service_id) {
    clauses.push("p.service_id = ?");
    params.push(req.query.service_id);
  }
  // `status` aqui é "active"/"inactive" (a coluna é o booleano is_active).
  if (req.query.status) {
    clauses.push("p.is_active = ?");
    params.push(req.query.status === "active" ? 1 : 0);
  }
  if (req.query.search) {
    clauses.push("(p.name ILIKE ? OR p.body_area ILIKE ? OR p.description ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: PROCEDURE_SORTABLE,
    tieBreak: "p.id",
    defaultOrderBy: "ORDER BY s.name, p.name, p.id"
  });
  const { rows, total } = await fetchPage(db, {
    select: `p.*, s.name AS service_name`,
    from: "procedures p LEFT JOIN services s ON s.id = p.service_id",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows, total, paging));
}));

router.get("/api/procedures/:id", withFeature("procedures", async (req, res, db) => {
  const procedure = await db.get(`
    SELECT p.*, s.name AS service_name
    FROM procedures p LEFT JOIN services s ON s.id = p.service_id
    WHERE p.id = ?
  `, [req.params.id]);
  if (!procedure) return res.status(404).json({ error: "Procedimento não encontrado." });
  res.json(procedure);
}));

router.post("/api/procedures", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(procedureCreateSchema, req, res)) return;
  const b = req.body || {};
  const result = await db.run(
    `INSERT INTO procedures
      (service_id,name,body_area,description,price,duration_minutes,aftercare_instructions,is_active,
       minimum_age_years,requires_guardian,requires_signed_term,return_after_days,scheduling_interval_minutes,
       minimum_advance_minutes,postcare_enabled,postcare_days,available_online)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [Number(b.service_id), b.name.trim(), b.body_area || "", b.description || "", Number(b.price || 0), Number(b.duration_minutes || 40), b.aftercare_instructions || "", boolNumber(b.is_active ?? 1),
      nullableNumber(b.minimum_age_years), nullableBoolean(b.requires_guardian), nullableBoolean(b.requires_signed_term), nullableNumber(b.return_after_days),
      nullableNumber(b.scheduling_interval_minutes), nullableNumber(b.minimum_advance_minutes), nullableBoolean(b.postcare_enabled),
      b.postcare_days === "" || b.postcare_days == null ? null : JSON.stringify(normalizePostcareDays(b.postcare_days)), nullableBoolean(b.available_online)]
  );
  res.status(201).json(await db.get("SELECT * FROM procedures WHERE id = ?", [result.returnedId]));
}));

router.put("/api/procedures/:id", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(procedureUpdateSchema, req, res)) return;
  const existing = await db.get("SELECT * FROM procedures WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Procedimento não encontrado." });
  const b = req.body || {};
  await db.run(
    `UPDATE procedures SET service_id=?,name=?,body_area=?,description=?,price=?,duration_minutes=?,aftercare_instructions=?,is_active=?,
      minimum_age_years=?,requires_guardian=?,requires_signed_term=?,return_after_days=?,scheduling_interval_minutes=?,
      minimum_advance_minutes=?,postcare_enabled=?,postcare_days=?,available_online=?,updated_at=CURRENT_TIMESTAMP
     WHERE id = ?`,
    [Number(b.service_id || existing.service_id), b.name || existing.name, b.body_area ?? existing.body_area, b.description ?? existing.description, Number(b.price ?? existing.price), Number(b.duration_minutes || existing.duration_minutes), b.aftercare_instructions ?? existing.aftercare_instructions, boolNumber(b.is_active ?? existing.is_active),
      b.minimum_age_years === undefined ? existing.minimum_age_years : nullableNumber(b.minimum_age_years),
      b.requires_guardian === undefined ? existing.requires_guardian : nullableBoolean(b.requires_guardian),
      b.requires_signed_term === undefined ? existing.requires_signed_term : nullableBoolean(b.requires_signed_term),
      b.return_after_days === undefined ? existing.return_after_days : nullableNumber(b.return_after_days),
      b.scheduling_interval_minutes === undefined ? existing.scheduling_interval_minutes : nullableNumber(b.scheduling_interval_minutes),
      b.minimum_advance_minutes === undefined ? existing.minimum_advance_minutes : nullableNumber(b.minimum_advance_minutes),
      b.postcare_enabled === undefined ? existing.postcare_enabled : nullableBoolean(b.postcare_enabled),
      b.postcare_days === undefined ? existing.postcare_days : (b.postcare_days === "" || b.postcare_days === null ? null : JSON.stringify(normalizePostcareDays(b.postcare_days))),
      b.available_online === undefined ? existing.available_online : nullableBoolean(b.available_online), req.params.id]
  );
  res.json(await db.get("SELECT * FROM procedures WHERE id = ?", [req.params.id]));
}));

router.delete("/api/procedures/:id", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  await db.run("DELETE FROM procedures WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
