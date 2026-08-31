import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { recordAudit } from "../services/audit.js";

const router = Router();
const WAITLIST_STATUSES = new Set(["waiting", "contacted", "scheduled", "closed"]);
const PERIODS = new Set(["manha", "tarde", "noite", "qualquer"]);
const RESOURCE_TYPES = new Set(["room", "chair", "station", "equipment"]);

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function optionalId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeWaitlist(body = {}, current = {}) {
  return {
    client_id: optionalId(body.client_id ?? current.client_id),
    service_id: optionalId(body.service_id ?? current.service_id),
    professional_id: optionalId(body.professional_id ?? current.professional_id),
    client_name: text(body.client_name, current.client_name),
    contact: text(body.contact, current.contact),
    preferred_date_from: body.preferred_date_from || current.preferred_date_from || null,
    preferred_date_to: body.preferred_date_to || current.preferred_date_to || null,
    preferred_period: PERIODS.has(body.preferred_period) ? body.preferred_period : current.preferred_period || "qualquer",
    priority: Math.min(5, Math.max(0, Number(body.priority ?? current.priority ?? 0))),
    status: WAITLIST_STATUSES.has(body.status) ? body.status : current.status || "waiting",
    notes: text(body.notes, current.notes)
  };
}

router.get("/api/agenda/waitlist", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_VIEW)) return;
  const params = [];
  const clauses = [];
  if (req.query.status) { clauses.push("w.status = ?"); params.push(req.query.status); }
  if (req.query.search) {
    clauses.push("(w.client_name ILIKE ? OR w.contact ILIKE ? OR w.notes ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.all(`SELECT w.*, s.name AS service_name, p.name AS professional_name
    FROM appointment_waitlist w
    LEFT JOIN services s ON s.id=w.service_id
    LEFT JOIN professionals p ON p.id=w.professional_id
    ${where}
    ORDER BY CASE w.status WHEN 'waiting' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END,
      w.priority DESC, w.preferred_date_from NULLS LAST, w.created_at`, params);
  res.json(rows);
}));

router.post("/api/agenda/waitlist", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  const next = normalizeWaitlist(req.body);
  if (!next.client_name) return res.status(400).json({ error: "Informe o nome do cliente." });
  if (next.preferred_date_from && next.preferred_date_to && next.preferred_date_from > next.preferred_date_to) {
    return res.status(400).json({ error: "A data final deve ser igual ou posterior à data inicial." });
  }
  const result = await db.run(`INSERT INTO appointment_waitlist
    (client_id, service_id, professional_id, client_name, contact, preferred_date_from, preferred_date_to, preferred_period, priority, status, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  [next.client_id, next.service_id, next.professional_id, next.client_name, next.contact, next.preferred_date_from, next.preferred_date_to, next.preferred_period, next.priority, next.status, next.notes, req.user?.id || null]);
  const created = await db.get("SELECT * FROM appointment_waitlist WHERE id=?", [result.returnedId]);
  await recordAudit(db, { req, module: "appointments", action: "waitlist_create", entityType: "appointment_waitlist", entityId: created.id, reason: "Entrada adicionada à lista de espera", after: { id: created.id, status: created.status, service_id: created.service_id, professional_id: created.professional_id } });
  res.status(201).json(created);
}));

router.patch("/api/agenda/waitlist/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  const current = await db.get("SELECT * FROM appointment_waitlist WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Entrada da lista de espera não encontrada." });
  const next = normalizeWaitlist(req.body, current);
  await db.run(`UPDATE appointment_waitlist SET client_id=?, service_id=?, professional_id=?, client_name=?, contact=?,
    preferred_date_from=?, preferred_date_to=?, preferred_period=?, priority=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
  [next.client_id, next.service_id, next.professional_id, next.client_name, next.contact, next.preferred_date_from, next.preferred_date_to, next.preferred_period, next.priority, next.status, next.notes, current.id]);
  const updated = await db.get("SELECT * FROM appointment_waitlist WHERE id=?", [current.id]);
  await recordAudit(db, { req, module: "appointments", action: "waitlist_update", entityType: "appointment_waitlist", entityId: current.id, reason: text(req.body.reason, "Lista de espera atualizada"), before: { id: current.id, status: current.status }, after: { id: updated.id, status: updated.status } });
  res.json(updated);
}));

router.get("/api/agenda/resources", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_VIEW)) return;
  res.json(await db.all("SELECT * FROM agenda_resources ORDER BY active DESC, resource_type, name"));
}));

router.post("/api/agenda/resources", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  const name = text(req.body.name);
  const resourceType = RESOURCE_TYPES.has(req.body.resource_type) ? req.body.resource_type : "station";
  if (!name) return res.status(400).json({ error: "Informe o nome do recurso." });
  const result = await db.run("INSERT INTO agenda_resources (name, resource_type, capacity, active, notes) VALUES (?, ?, ?, ?, ?) RETURNING id",
    [name, resourceType, Math.min(100, Math.max(1, Number(req.body.capacity || 1))), req.body.active === false ? 0 : 1, text(req.body.notes)]);
  res.status(201).json(await db.get("SELECT * FROM agenda_resources WHERE id=?", [result.returnedId]));
}));

router.patch("/api/agenda/resources/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  const current = await db.get("SELECT * FROM agenda_resources WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Recurso não encontrado." });
  const name = text(req.body.name, current.name);
  const resourceType = RESOURCE_TYPES.has(req.body.resource_type) ? req.body.resource_type : current.resource_type;
  await db.run("UPDATE agenda_resources SET name=?, resource_type=?, capacity=?, active=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [name, resourceType, Math.min(100, Math.max(1, Number(req.body.capacity ?? current.capacity))), req.body.active === undefined ? current.active : req.body.active ? 1 : 0, text(req.body.notes, current.notes), current.id]);
  res.json(await db.get("SELECT * FROM agenda_resources WHERE id=?", [current.id]));
}));

export default router;
