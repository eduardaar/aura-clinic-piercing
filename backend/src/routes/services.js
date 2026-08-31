// Rotas de servicos oferecidos pela clinica.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";
import { listServices, countServices, getService, replaceCompatibleServiceItems, replaceProfessionalServices } from "../services/appointments.js";
import { validateBody } from "../middleware/validate.js";
import { serviceCreateSchema, serviceUpdateSchema } from "../schemas/index.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import { replaceServiceRecipe, serviceRecipe } from "../services/consumableUsage.js";
import { normalizePostcareDays } from "../services/serviceRules.js";
import { getClinicOperationalSettings, normalizeBiosafetyConfig, normalizeChecklistConfig } from "../services/operationalRequirements.js";

const router = Router();

function nullableConfig(value, normalizer) {
  return value === null || value === undefined ? null : JSON.stringify(normalizer(value));
}

router.get("/api/service-operational-settings", withFeature("procedures", async (_req, res, db) => {
  res.json(await getClinicOperationalSettings(db));
}));

router.put("/api/service-operational-settings", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const checklist = normalizeChecklistConfig(req.body?.checklist);
  const biosafety = normalizeBiosafetyConfig(req.body?.biosafety);
  await db.run(`UPDATE service_operational_settings SET checklist_config=?,biosafety_config=?,updated_at=now(),updated_by_user_id=? WHERE id=1`,
    [JSON.stringify(checklist), JSON.stringify(biosafety), req.user?.id || null]);
  res.json({ checklist, biosafety });
}));

router.get("/api/service-catalog-options", withFeature("procedures", async (_req, res, db) => {
  const [professionals, inventoryItems] = await Promise.all([
    db.all("SELECT id,name FROM professionals WHERE active=1 ORDER BY name"),
    db.all(`SELECT id,name,category,stock_unit,can_sell,can_use_in_service
      FROM jewelry_inventory WHERE status!='arquivado' AND can_use_in_service=true ORDER BY name`)
  ]);
  res.json({ professionals, inventoryItems });
}));

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const SERVICE_SORTABLE = {
  name: "name",
  price: "price",
  duration: "duration_minutes",
  active: "is_active",
  created_at: "created_at"
};

router.get("/api/services", withFeature("procedures", async (req, res, db) => {
  const clauses = [];
  const params = [];
  // Status interno e disponibilidade online são decisões independentes.
  if (req.query.status) {
    clauses.push("is_active = ?");
    params.push(req.query.status === "active");
  }
  if (req.query.search) {
    clauses.push("(name ILIKE ? OR description ILIKE ?)");
    params.push(...Array(2).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: SERVICE_SORTABLE,
    tieBreak: "id",
    defaultOrderBy: "ORDER BY is_active DESC, name, id"
  });
  const items = await listServices(db, { where, params, paging });
  const total = paging.paginated ? await countServices(db, { where, params }) : items.length;
  res.json(pageResponse(items, total, paging));
}));

router.post("/api/services", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  if (!validateBody(serviceCreateSchema, req, res)) return;
  const result = await db.run(
    `INSERT INTO services
      (name,category,body_area,description,duration_minutes,price,deposit_value,is_active,active_online_booking,pre_service_notes,
       minimum_age_years,requires_guardian,requires_signed_term,return_after_days,scheduling_interval_minutes,
       minimum_advance_minutes,postcare_enabled,postcare_days,aftercare_instructions,checklist_config,biosafety_config)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [
      req.body.name,
      String(req.body.category || "Piercing").trim(),
      String(req.body.body_area || "").trim(),
      req.body.description || "",
      Number(req.body.duration_minutes || 40),
      Number(req.body.base_price ?? req.body.price ?? 0),
      Number(req.body.deposit_value ?? 25),
      Boolean(boolNumber(req.body.is_active ?? true)),
      boolNumber(req.body.active_online_booking ?? req.body.online_booking_enabled ?? req.body.is_active ?? 1),
      req.body.pre_service_notes || "",
      req.body.minimum_age_years === "" || req.body.minimum_age_years == null ? null : Number(req.body.minimum_age_years),
      Boolean(boolNumber(req.body.requires_guardian ?? false)),
      Boolean(boolNumber(req.body.requires_signed_term ?? false)),
      req.body.return_after_days === "" || req.body.return_after_days == null ? null : Number(req.body.return_after_days),
      Number(req.body.scheduling_interval_minutes || 0),
      Number(req.body.minimum_advance_minutes || 0),
      Boolean(boolNumber(req.body.postcare_enabled ?? false)),
      JSON.stringify(normalizePostcareDays(req.body.postcare_days)),
      req.body.aftercare_instructions || "",
      nullableConfig(req.body.checklist_config, normalizeChecklistConfig),
      nullableConfig(req.body.biosafety_config, normalizeBiosafetyConfig)
    ]
  );
  await replaceProfessionalServices(db, result.returnedId, req.body.professional_ids || []);
  if (req.body.inventory_items) await replaceServiceRecipe(db, result.returnedId, req.body.inventory_items);
  await replaceCompatibleServiceItems(db, result.returnedId, req.body.compatible_jewelry_ids || []);
  res.status(201).json(await getService(db, result.returnedId));
}));

async function updateService(req, res, db) {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  if (!validateBody(serviceUpdateSchema, req, res)) return;
  const service = await db.get("SELECT * FROM services WHERE id = ?", [req.params.id]);
  if (!service) return res.status(404).json({ error: "Servico nao encontrado." });
  await db.run(
    `UPDATE services SET name=?,category=?,body_area=?,description=?,duration_minutes=?,price=?,deposit_value=?,is_active=?,active_online_booking=?,pre_service_notes=?,
      minimum_age_years=?,requires_guardian=?,requires_signed_term=?,return_after_days=?,scheduling_interval_minutes=?,
      minimum_advance_minutes=?,postcare_enabled=?,postcare_days=?,aftercare_instructions=?,checklist_config=?,biosafety_config=? WHERE id=?`,
    [
      req.body.name ?? service.name,
      String(req.body.category ?? service.category ?? "Piercing").trim(),
      String(req.body.body_area ?? service.body_area ?? "").trim(),
      req.body.description ?? service.description,
      Number(req.body.duration_minutes ?? service.duration_minutes),
      Number(req.body.base_price ?? req.body.price ?? service.price),
      Number(req.body.deposit_value ?? service.deposit_value),
      Boolean(boolNumber(req.body.is_active ?? service.is_active)),
      boolNumber(req.body.active_online_booking ?? req.body.online_booking_enabled ?? service.active_online_booking),
      req.body.pre_service_notes ?? service.pre_service_notes,
      req.body.minimum_age_years === undefined ? service.minimum_age_years : (req.body.minimum_age_years === "" || req.body.minimum_age_years === null ? null : Number(req.body.minimum_age_years)),
      Boolean(boolNumber(req.body.requires_guardian ?? service.requires_guardian)),
      Boolean(boolNumber(req.body.requires_signed_term ?? service.requires_signed_term)),
      req.body.return_after_days === undefined ? service.return_after_days : (req.body.return_after_days === "" || req.body.return_after_days === null ? null : Number(req.body.return_after_days)),
      Number(req.body.scheduling_interval_minutes ?? service.scheduling_interval_minutes ?? 0),
      Number(req.body.minimum_advance_minutes ?? service.minimum_advance_minutes ?? 0),
      Boolean(boolNumber(req.body.postcare_enabled ?? service.postcare_enabled)),
      JSON.stringify(normalizePostcareDays(req.body.postcare_days ?? service.postcare_days)),
      req.body.aftercare_instructions ?? service.aftercare_instructions,
      req.body.checklist_config === undefined ? service.checklist_config : nullableConfig(req.body.checklist_config, normalizeChecklistConfig),
      req.body.biosafety_config === undefined ? service.biosafety_config : nullableConfig(req.body.biosafety_config, normalizeBiosafetyConfig),
      req.params.id
    ]
  );
  if (req.body.professional_ids) await replaceProfessionalServices(db, req.params.id, req.body.professional_ids);
  if (req.body.inventory_items) await replaceServiceRecipe(db, req.params.id, req.body.inventory_items);
  if (req.body.compatible_jewelry_ids) await replaceCompatibleServiceItems(db, req.params.id, req.body.compatible_jewelry_ids);
  res.json(await getService(db, req.params.id));
}

router.put("/api/services/:id", withFeature("procedures", updateService));
router.patch("/api/services/:id", withFeature("procedures", updateService));

// Ficha técnica usa a mesma origem central do estoque. A rota antiga é mantida
// somente como alias de compatibilidade durante o corte pré-produção.
const getInventoryRecipe = withFeature("basic_inventory", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  const service = await db.get("SELECT id FROM services WHERE id=?", [req.params.id]);
  if (!service) return res.status(404).json({ error: "Serviço não encontrado." });
  res.json(await serviceRecipe(db, req.params.id));
});

const putInventoryRecipe = withFeature("basic_inventory", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    res.json(await replaceServiceRecipe(db, req.params.id, req.body?.items));
  } catch (error) {
    res.status(/não encontrado/i.test(error.message) ? 404 : 400).json({ error: error.message || "Não foi possível salvar a ficha técnica." });
  }
});

router.get("/api/services/:id/inventory-items", getInventoryRecipe);
router.put("/api/services/:id/inventory-items", putInventoryRecipe);
router.get("/api/services/:id/consumables", getInventoryRecipe);
router.put("/api/services/:id/consumables", putInventoryRecipe);

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
  await db.run("UPDATE services SET is_active=false, active_online_booking=0 WHERE id = ?", [req.params.id]);
  res.json({ ok: true, archived: true });
}));

export default router;
