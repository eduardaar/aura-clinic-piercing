import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { fetchPage, pageResponse, parsePaging } from "../services/pagination.js";

const router = Router();

const AUDIT_SORTABLE = {
  created_at: "ae.created_at",
  module: "ae.module",
  action: "ae.action",
  actor: "ae.actor_name",
  severity: "ae.severity"
};

router.get("/api/audit-events", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.AUDIT_VIEW)) return;
  const clauses = [];
  const params = [];
  const exactFilters = [
    ["actor_user_id", "ae.actor_user_id"], ["module", "ae.module"],
    ["action", "ae.action"], ["entity_type", "ae.entity_type"], ["severity", "ae.severity"]
  ];
  for (const [queryKey, column] of exactFilters) {
    if (req.query[queryKey]) {
      clauses.push(`${column} = ?`);
      params.push(req.query[queryKey]);
    }
  }
  if (req.query.from) {
    clauses.push("ae.created_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("ae.created_at < (?::date + INTERVAL '1 day')");
    params.push(req.query.to);
  }
  if (req.query.search) {
    clauses.push("(ae.actor_name ILIKE ? OR ae.actor_email ILIKE ? OR ae.entity_id ILIKE ? OR ae.reason ILIKE ?)");
    params.push(...Array(4).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: AUDIT_SORTABLE,
    tieBreak: "ae.id",
    defaultOrderBy: "ORDER BY ae.created_at DESC, ae.id DESC"
  });
  const { rows, total } = await fetchPage(db, {
    select: "ae.*",
    from: "audit_events ae",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows, total, paging));
}));

router.get("/api/audit-events/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.AUDIT_VIEW)) return;
  const event = await db.get("SELECT * FROM audit_events WHERE id = ?", [req.params.id]);
  if (!event) return res.status(404).json({ error: "Evento de auditoria não encontrado." });
  res.json(event);
}));

export default router;
