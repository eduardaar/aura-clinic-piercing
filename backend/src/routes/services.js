// Rotas de servicos oferecidos pela clinica.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";
import { listServices, replaceProfessionalServices } from "../services/appointments.js";
import { validateBody } from "../middleware/validate.js";
import { serviceCreateSchema, serviceUpdateSchema } from "../schemas/index.js";

const router = Router();

router.get("/api/services", withDb(async (_req, res, db) => {
  res.json(await listServices(db));
}));

router.post("/api/services", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(serviceCreateSchema, req, res)) return;
  const result = await db.run(
    "INSERT INTO services (name, description, duration_minutes, price, deposit_value, active_online_booking, pre_service_notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      req.body.name,
      req.body.description || "",
      Number(req.body.duration_minutes || 40),
      Number(req.body.base_price ?? req.body.price ?? 0),
      Number(req.body.deposit_value || 0),
      boolNumber(req.body.is_active ?? req.body.active_online_booking ?? 1),
      req.body.pre_service_notes || ""
    ]
  );
  await replaceProfessionalServices(db, result.lastID, req.body.professional_ids || []);
  res.status(201).json((await listServices(db)).find((item) => item.id === result.lastID));
}));

async function updateService(req, res, db) {
  if (!requireRole(req, res, ["admin", "reception"])) return;
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
  res.json((await listServices(db)).find((item) => item.id === Number(req.params.id)));
}

router.put("/api/services/:id", withDb(updateService));
router.patch("/api/services/:id", withDb(updateService));

router.delete("/api/services/:id", withDb(async (req, res, db) => {
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
