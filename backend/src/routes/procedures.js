// Alias temporário somente para leitura de registros históricos.
// Novos tipos de atendimento são mantidos exclusivamente em /api/services.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";

const router = Router();

router.get("/api/procedures", withFeature("procedures", async (req, res, db) => {
  const clauses = [];
  const params = [];
  if (req.query.service_id) { clauses.push("p.service_id=?"); params.push(req.query.service_id); }
  const paging = parsePaging(req.query, { sortable: { name: "p.name", service: "s.name", created_at: "p.created_at" }, tieBreak: "p.id", defaultOrderBy: "ORDER BY p.id" });
  const { rows, total } = await fetchPage(db, {
    select: "p.*,s.name AS service_name",
    from: "procedures p LEFT JOIN services s ON s.id=p.service_id",
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.set("Deprecation", "true");
  res.json(pageResponse(rows, total, paging));
}));

router.get("/api/procedures/:id", withFeature("procedures", async (req, res, db) => {
  const row = await db.get("SELECT p.*,s.name AS service_name FROM procedures p LEFT JOIN services s ON s.id=p.service_id WHERE p.id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Registro histórico não encontrado." });
  res.set("Deprecation", "true");
  res.json(row);
}));

const retiredMutation = (_req, res) => res.status(410).json({ error: "Cadastro unificado. Use /api/services para tipos de atendimento." });
router.post("/api/procedures", retiredMutation);
router.put("/api/procedures/:id", retiredMutation);
router.patch("/api/procedures/:id", retiredMutation);
router.delete("/api/procedures/:id", retiredMutation);

export default router;
