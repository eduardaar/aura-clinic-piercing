// Rotas de servicos oferecidos pela clinica.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";
import { listServices, countServices, getService, replaceProfessionalServices } from "../services/appointments.js";
import { validateBody } from "../middleware/validate.js";
import { serviceCreateSchema, serviceUpdateSchema } from "../schemas/index.js";
import { parsePaging, pageResponse } from "../services/pagination.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const SERVICE_SORTABLE = {
  name: "name",
  price: "price",
  duration: "duration_minutes",
  active: "active_online_booking",
  created_at: "created_at"
};

router.get("/api/services", withFeature("procedures", async (req, res, db) => {
  const clauses = [];
  const params = [];
  // `status` aqui é "active"/"inactive" (a coluna é active_online_booking).
  if (req.query.status) {
    clauses.push("active_online_booking = ?");
    params.push(req.query.status === "active" ? 1 : 0);
  }
  if (req.query.search) {
    clauses.push("(name ILIKE ? OR description ILIKE ?)");
    params.push(...Array(2).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: SERVICE_SORTABLE,
    tieBreak: "id",
    defaultOrderBy: "ORDER BY active_online_booking DESC, name, id"
  });
  const items = await listServices(db, { where, params, paging });
  const total = paging.paginated ? await countServices(db, { where, params }) : items.length;
  res.json(pageResponse(items, total, paging));
}));

router.post("/api/services", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  if (!validateBody(serviceCreateSchema, req, res)) return;
  const result = await db.run(
    "INSERT INTO services (name, description, duration_minutes, price, deposit_value, active_online_booking, pre_service_notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [
      req.body.name,
      req.body.description || "",
      Number(req.body.duration_minutes || 40),
      Number(req.body.base_price ?? req.body.price ?? 0),
      Number(req.body.deposit_value ?? 25),
      boolNumber(req.body.is_active ?? req.body.active_online_booking ?? 1),
      req.body.pre_service_notes || ""
    ]
  );
  await replaceProfessionalServices(db, result.returnedId, req.body.professional_ids || []);
  res.status(201).json(await getService(db, result.returnedId));
}));

async function updateService(req, res, db) {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  if (!validateBody(serviceUpdateSchema, req, res)) return;
  const service = await db.get("SELECT * FROM services WHERE id = ?", [req.params.id]);
  if (!service) return res.status(404).json({ error: "Servico nao encontrado." });
  await db.run(
    `UPDATE services SET name = ?, description = ?, duration_minutes = ?, price = ?, deposit_value = ?, active_online_booking = ?, pre_service_notes = ? WHERE id = ?`,
    [
      req.body.name ?? service.name,
      req.body.description ?? service.description,
      Number(req.body.duration_minutes ?? service.duration_minutes),
      Number(req.body.base_price ?? req.body.price ?? service.price),
      Number(req.body.deposit_value ?? service.deposit_value),
      boolNumber(req.body.is_active ?? req.body.active_online_booking ?? service.active_online_booking),
      req.body.pre_service_notes ?? service.pre_service_notes,
      req.params.id
    ]
  );
  if (req.body.professional_ids) await replaceProfessionalServices(db, req.params.id, req.body.professional_ids);
  res.json(await getService(db, req.params.id));
}

router.put("/api/services/:id", withFeature("procedures", updateService));
router.patch("/api/services/:id", withFeature("procedures", updateService));

router.delete("/api/services/:id", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const linked = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM appointments WHERE service_id = ?) +
      (SELECT COUNT(*) FROM procedures WHERE service_id = ?) +
      (SELECT COUNT(*) FROM sales_order_items WHERE service_id = ?) AS total
  `, [req.params.id, req.params.id, req.params.id]);
  await db.run("DELETE FROM professional_services WHERE service_id = ?", [req.params.id]);
  if (Number(linked?.total || 0) === 0) {
    await db.run("DELETE FROM services WHERE id = ?", [req.params.id]);
    return res.json({ ok: true, deleted: true });
  }
  await db.run("UPDATE services SET active_online_booking = 0 WHERE id = ?", [req.params.id]);
  res.json({ ok: true, archived: true });
}));

export default router;
