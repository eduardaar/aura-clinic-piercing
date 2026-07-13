// Rotas de estoque de joalherias: produtos, variacoes e movimentacoes.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber, elegantProductName, variantStatus, variantFromLegacy } from "../services/utils.js";
import {
  attachVariants,
  generateSku,
  isUniqueViolation,
  jewelrySkuExists,
  replaceJewelryVariants,
  syncProductImages,
  syncProductInventory,
  SkuConflictError
} from "../services/inventory.js";
import { validateBody } from "../middleware/validate.js";
import { jewelryCreateSchema, jewelryUpdateSchema } from "../schemas/index.js";
import { calculatePricing, getPricingSettings } from "../services/pricing.js";

const router = Router();

function skuConflict(res, message = "SKU já cadastrado.") {
  return res.status(409).json({ success: false, message });
}

function logSkuError(error, context) {
  console.error(`[jewelry-sku] ${context}`, error);
}

function jewelryPayload(body, sku, pricing) {
  return [
    elegantProductName(body.name),
    body.description || "",
    body.photo_url,
    JSON.stringify(body.gallery_urls || []),
    body.category,
    body.subcategory || "",
    body.variant_group || "",
    body.variation_label || "",
    body.material || "",
    body.color || "",
    body.stone,
    body.size,
    body.thickness,
    body.stem_length,
    body.thread_type,
    body.piercing_type || "",
    Number(body.weight_grams || 0),
    Number(body.package_length_cm || 0),
    Number(body.package_width_cm || 0),
    Number(body.package_height_cm || 0),
    body.package_type || "",
    boolNumber(body.virtual_store_active ?? 1),
    Number(body.preparation_days || 1),
    body.shipping_info || "",
    body.seo_title || "",
    body.seo_description || "",
    body.freight_notes || "",
    Number(body.quantity || 0),
    pricing.cost_value,
    pricing.sale_value,
    pricing.purchase_cost_cents,
    pricing.allocated_freight_cents,
    pricing.additional_cost_cents,
    pricing.total_cost_cents,
    pricing.price_multiplier,
    pricing.price_rounding_mode,
    pricing.suggested_price_cents,
    pricing.sale_price_cents,
    pricing.price_manually_overridden,
    pricing.cost_estimated,
    body.supplier,
    body.physical_location || "",
    sku,
    boolNumber(body.is_catalog_active ?? 1),
    boolNumber(body.is_featured ?? 0),
    boolNumber(body.is_new ?? 0),
    boolNumber(body.is_most_wanted ?? 0),
    boolNumber(body.is_promotion ?? 0),
    boolNumber(body.is_last_units ?? 0),
    body.notes,
    body.status || "disponível",
    Number(body.low_stock_threshold || 5),
    Number(body.critical_stock_threshold || 3),
    body.image_url || "",
    boolNumber(body.is_published ?? 1)
  ];
}

function updateValue(field, body) {
  if (["quantity", "cost_value", "sale_value", "purchase_cost_cents", "allocated_freight_cents", "additional_cost_cents", "total_cost_cents", "price_multiplier", "suggested_price_cents", "sale_price_cents", "price_manually_overridden", "cost_estimated", "low_stock_threshold", "critical_stock_threshold", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "preparation_days", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "virtual_store_active", "is_published"].includes(field)) {
    return Number(body[field] || 0);
  }
  if (field === "gallery_urls") {
    return typeof body.gallery_urls === "string" ? body.gallery_urls : JSON.stringify(body.gallery_urls || []);
  }
  return field === "name" ? elegantProductName(body[field]) : body[field];
}

router.get("/api/jewelry", withDb(async (req, res, db) => {
  const clauses = [];
  const params = [];
  if (req.query.search) {
    clauses.push(`(
      j.name LIKE ? OR j.description LIKE ? OR j.category LIKE ? OR j.subcategory LIKE ?
      OR EXISTS (
        SELECT 1 FROM jewelry_variants v
        WHERE v.jewelry_id = j.id
          AND (v.sku LIKE ? OR v.material LIKE ? OR v.color LIKE ? OR v.size LIKE ? OR v.thickness LIKE ? OR v.length LIKE ? OR v.diameter LIKE ? OR v.thread_type LIKE ? OR v.supplier LIKE ?)
      )
    )`);
    params.push(...Array(13).fill(`%${req.query.search}%`));
  }
  for (const field of ["category", "subcategory", "status", "physical_location"]) {
    if (req.query[field]) {
      clauses.push(`j.${field} = ?`);
      params.push(req.query[field]);
    }
  }
  for (const field of ["material", "color", "size", "thickness", "length", "diameter", "thread_type", "supplier"]) {
    if (req.query[field]) {
      clauses.push(`EXISTS (SELECT 1 FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.${field} LIKE ?)`);
      params.push(`%${req.query[field]}%`);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.all(`SELECT j.* FROM jewelry_inventory j ${where} ORDER BY j.category, j.name`, params);
  res.json(await attachVariants(db, rows));
}));

router.post("/api/jewelry", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(jewelryCreateSchema, req, res)) return;

  const requestedSku = String(req.body.sku || "").trim();
  const manualSku = requestedSku;
  if (manualSku && await jewelrySkuExists(db, manualSku)) {
    return skuConflict(res, "Já existe uma joia com este SKU.");
  }

  await db.run("BEGIN");
  try {
    const sku = manualSku || (requestedSku && !(await jewelrySkuExists(db, requestedSku)) ? requestedSku : await generateSku(db, req.body));
    const pricingSettings = await getPricingSettings(db);
    const pricing = calculatePricing(req.body, pricingSettings);
    const result = await db.run(
      `INSERT INTO jewelry_inventory
      (name, description, photo_url, gallery_urls, category, subcategory, variant_group, variation_label, material, color, stone, size, thickness, stem_length, thread_type, piercing_type, weight_grams, package_length_cm, package_width_cm, package_height_cm, package_type, virtual_store_active, preparation_days, shipping_info, seo_title, seo_description, freight_notes, quantity, cost_value, sale_value, purchase_cost_cents, allocated_freight_cents, additional_cost_cents, total_cost_cents, price_multiplier, price_rounding_mode, suggested_price_cents, sale_price_cents, price_manually_overridden, cost_estimated, supplier, physical_location, sku, is_catalog_active, is_featured, is_new, is_most_wanted, is_promotion, is_last_units, notes, status, low_stock_threshold, critical_stock_threshold, image_url, is_published)
      VALUES (${Array(55).fill("?").join(", ")})`,
      jewelryPayload(req.body, sku, pricing)
    );
    await replaceJewelryVariants(db, result.lastID, req.body.variants || [variantFromLegacy({ ...req.body, sku: "" })]);
    await syncProductImages(db, result.lastID, req.body.images || req.body.gallery_urls || [req.body.image_url || req.body.photo_url].filter(Boolean));
    const product = (await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [result.lastID])]))[0];
    await db.run("COMMIT");
    return res.status(201).json(product);
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    if (error instanceof SkuConflictError || isUniqueViolation(error)) {
      logSkuError(error, "POST /api/jewelry");
      return skuConflict(res);
    }
    throw error;
  }
}));

router.patch("/api/jewelry/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(jewelryUpdateSchema, req, res)) return;

  const jewelry = await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  if (!jewelry) return res.status(404).json({ error: "Joia não encontrada." });

  let nextSku = req.body.sku !== undefined ? String(req.body.sku || "").trim() : "";
  if (nextSku && await jewelrySkuExists(db, nextSku, jewelry.id)) {
    if (req.body.sku_manually_edited === true) return skuConflict(res, "Já existe uma joia com este SKU.");
    nextSku = await generateSku(db, req.body);
    req.body.sku = nextSku;
  }

  const pricingSettings = await getPricingSettings(db);
  const pricing = calculatePricing(req.body, pricingSettings);
  Object.assign(req.body, pricing);

  const fields = ["name", "description", "photo_url", "image_url", "gallery_urls", "category", "subcategory", "variant_group", "variation_label", "material", "color", "stone", "size", "thickness", "stem_length", "thread_type", "piercing_type", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "package_type", "virtual_store_active", "preparation_days", "shipping_info", "seo_title", "seo_description", "freight_notes", "quantity", "cost_value", "sale_value", "purchase_cost_cents", "allocated_freight_cents", "additional_cost_cents", "total_cost_cents", "price_multiplier", "price_rounding_mode", "suggested_price_cents", "sale_price_cents", "price_manually_overridden", "cost_estimated", "supplier", "physical_location", "sku", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "is_published", "notes", "status", "low_stock_threshold", "critical_stock_threshold"];
  const updates = fields.filter((field) => req.body[field] !== undefined);

  await db.run("BEGIN");
  try {
    if (updates.length) {
      await db.run(
        `UPDATE jewelry_inventory SET ${updates.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`,
        [...updates.map((field) => updateValue(field, req.body)), req.params.id]
      );
    }
    if (Array.isArray(req.body.variants)) await replaceJewelryVariants(db, jewelry.id, req.body.variants);
    if (req.body.images !== undefined || req.body.gallery_urls !== undefined || req.body.image_url !== undefined || req.body.photo_url !== undefined) {
      await syncProductImages(db, jewelry.id, req.body.images || req.body.gallery_urls || [req.body.image_url || req.body.photo_url].filter(Boolean));
    }
    const product = (await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id])]))[0];
    await db.run("COMMIT");
    return res.json(product);
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    if (error instanceof SkuConflictError || isUniqueViolation(error)) {
      logSkuError(error, `PATCH /api/jewelry/${req.params.id}`);
      return skuConflict(res);
    }
    throw error;
  }
}));

router.post("/api/jewelry/:id/variants/:variantId/movements", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const variant = await db.get(
    "SELECT * FROM jewelry_variants WHERE id = ? AND jewelry_id = ?",
    [req.params.variantId, req.params.id]
  );
  if (!variant) return res.status(404).json({ error: "Variacao nao encontrada." });
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const movementType = req.body.movement_type || "Ajuste";
  const normalizedMovement = String(movementType).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const nextQuantity = Math.max(0, Number(variant.quantity || 0) + (["saida", "venda", "perda"].includes(normalizedMovement) ? -quantity : quantity));
  const status = variantStatus(nextQuantity, variant.low_stock_threshold);
  await db.run(
    "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes, movement_date) VALUES (?, ?, ?, ?, ?, ?)",
    [req.params.id, variant.id, movementType, quantity, req.body.notes || "", req.body.movement_date || new Date().toISOString().slice(0, 10)]
  );
  await db.run(
    "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nextQuantity, status, variant.id]
  );
  await syncProductInventory(db, req.params.id);
  res.json({ ok: true, product: (await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id])]))[0] });
}));

router.get("/api/jewelry/:id/movements", withDb(async (req, res, db) => {
  const movements = await db.all(
    "SELECT * FROM stock_movements WHERE jewelry_id = ? ORDER BY movement_date DESC, id DESC LIMIT 20",
    [req.params.id]
  );
  res.json(movements);
}));

router.post("/api/jewelry/:id/movements", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const jewelry = await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  if (!jewelry) return res.status(404).json({ error: "Joia nao encontrada." });
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const movementType = req.body.movement_type || "Ajuste";
  const notes = req.body.notes || "";
  const normalizedMovement = String(movementType).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const delta = ["saida", "venda", "perda"].includes(normalizedMovement) ? -quantity : quantity;
  const nextQuantity = Math.max(0, Number(jewelry.quantity || 0) + delta);
  const criticalThreshold = Number(jewelry.critical_stock_threshold || 3);
  const lowThreshold = Number(jewelry.low_stock_threshold || 5);
  const status = nextQuantity <= 0 ? "esgotado" : nextQuantity <= criticalThreshold ? "crítico" : nextQuantity <= lowThreshold ? "baixo estoque" : "disponível";
  await db.run("INSERT INTO stock_movements (jewelry_id, movement_type, quantity, notes, movement_date) VALUES (?, ?, ?, ?, ?)", [
    jewelry.id,
    movementType,
    quantity,
    notes,
    req.body.movement_date || new Date().toISOString().slice(0, 10)
  ]);
  await db.run("UPDATE jewelry_inventory SET quantity = ?, status = ? WHERE id = ?", [nextQuantity, status, req.params.id]);
  res.json({
    ok: true,
    jewelry: await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]),
    movements: await db.all("SELECT * FROM stock_movements WHERE jewelry_id = ? ORDER BY movement_date DESC, id DESC LIMIT 20", [req.params.id])
  });
}));

router.delete("/api/jewelry/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const linked = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM appointments WHERE jewelry_id = ?) +
      (SELECT COUNT(*) FROM stock_movements WHERE jewelry_id = ?) +
      (SELECT COUNT(*) FROM sales_order_items WHERE product_id = ?) AS count
  `, [req.params.id, req.params.id, req.params.id]);
  if (linked.count > 0) {
    await db.run("UPDATE jewelry_inventory SET status = 'arquivado', is_catalog_active = 0 WHERE id = ?", [req.params.id]);
    return res.json({ ok: true, archived: true });
  }
  await db.run("DELETE FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  res.json({ ok: true, archived: false });
}));

export default router;
