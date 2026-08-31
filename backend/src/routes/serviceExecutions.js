import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { fetchPage, pageResponse, parsePaging } from "../services/pagination.js";
import { getServiceExecution } from "../services/serviceExecutions.js";

const router = Router();
const SORTABLE = {
  completed_at: "se.completed_at",
  client: "c.full_name",
  professional: "p.name",
  total: "se.total_value",
  status: "se.status"
};

router.get("/api/service-executions", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_VIEW)) return;
  const clauses = [];
  const params = [];
  for (const [key, column] of [["client_id", "se.client_id"], ["professional_id", "se.professional_id"], ["status", "se.status"]]) {
    if (req.query[key]) { clauses.push(`${column}=?`); params.push(req.query[key]); }
  }
  if (req.query.from) { clauses.push("se.completed_at::date>=?::date"); params.push(req.query.from); }
  if (req.query.to) { clauses.push("se.completed_at::date<=?::date"); params.push(req.query.to); }
  if (req.query.search) {
    clauses.push("(c.full_name ILIKE ? OR p.name ILIKE ? OR COALESCE(s.name,se.snapshot->>'procedure') ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, { sortable: SORTABLE, tieBreak: "se.id", defaultOrderBy: "ORDER BY se.completed_at DESC,se.id DESC" });
  const { rows, total } = await fetchPage(db, {
    select: `se.*, c.full_name AS client_name, p.name AS professional_name,
      COALESCE(s.name,se.snapshot->>'procedure') AS service_name`,
    from: "service_executions se JOIN clients c ON c.id=se.client_id JOIN professionals p ON p.id=se.professional_id LEFT JOIN services s ON s.id=se.service_id",
    where, params, orderBy: paging.orderBy, paging
  });
  res.json(pageResponse(rows, total, paging));
}));

router.get("/api/service-executions/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_VIEW)) return;
  const execution = await getServiceExecution(db, req.params.id);
  if (!execution) return res.status(404).json({ error: "Execução de atendimento não encontrada." });
  res.json(execution);
}));

export default router;
