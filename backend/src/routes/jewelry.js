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
  syncProductInventory,
  SkuConflictError
} from "../services/inventory.js";
import { validateBody } from "../middleware/validate.js";
import { jewelryCreateSchema, jewelryUpdateSchema } from "../schemas/index.js";

const router = Router();

function skuConflict(res, message = "SKU já cadastrado.") {
  return res.status(409).json({ success: false, message });
}

function logSkuError(error, context) {
  console.error(`[jewelry-sku] ${context}`, error);
}

function jewelryPayload(body, sku) {
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
    boolNumber(body.virtual_store_active),
    Number(body.preparation_days || 1),
    body.shipping_info || "",
    body.seo_title || "",
    body.seo_description || "",
    body.freight_notes || "",
    Number(body.quantity || 0),
    Number(body.cost_value || 0),
    Number(body.sale_value || 0),
    body.supplier,
    body.physical_location || "",
    sku,
    boolNumber(body.is_catalog_active),
    boolNumber(body.is_featured),
    boolNumber(body.is_new),
    boolNumber(body.is_most_wanted),
    boolNumber(body.is_promotion),
    boolNumber(body.is_last_units),
    body.notes,
    body.status || "disponível",
    Number(body.low_stock_threshold || 5),
    Number(body.critical_stock_threshold || 3),
    body.image_url || "",
    boolNumber(body.is_published)
  ];
}

function updateValue(field, body) {
  if (["quantity", "cost_value", "sale_value", "low_stock_threshold", "critical_stock_threshold", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "preparation_days", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "virtual_store_active", "is_published"].includes(field)) {
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

  const manualSku = String(req.body.sku || "").trim();
  if (manualSku && await jewelrySkuExists(db, manualSku)) {
    return skuConflict(res, "Já existe uma joia com este SKU.");
  }

  await db.run("BEGIN");
  try {
    const sku = manualSku || await generateSku(db, req.body);
    const result = await db.run(
      `INSERT INTO jewelry_inventory
      (name, description, photo_url, gallery_urls, category, subcategory, variant_group, variation_label, material, color, stone, size, thickness, stem_length, thread_type, piercing_type, weight_grams, package_length_cm, package_width_cm, package_height_cm, package_type, virtual_store_active, preparation_days, shipping_info, seo_title, seo_description, freight_notes, quantity, cost_value, sale_value, supplier, physical_location, sku, is_catalog_active, is_featured, is_new, is_most_wanted, is_promotion, is_last_units, notes, status, low_stock_threshold, critical_stock_threshold, image_url, is_published)
      VALUES (${Array(45).fill("?").join(", ")})`,
      jewelryPayload(req.body, sku)
    );
    await replaceJewelryVariants(db, result.lastID, req.body.variants || [variantFromLegacy({ ...req.body, sku: "" })]);
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

  const nextSku = req.body.sku !== undefined ? String(req.body.sku || "").trim() : "";
  if (nextSku && await jewelrySkuExists(db, nextSku, jewelry.id)) {
    return skuConflict(res, "Já existe uma joia com este SKU.");
  }

  const fields = ["name", "description", "photo_url", "image_url", "gallery_urls", "category", "subcategory", "variant_group", "variation_label", "material", "color", "stone", "size", "thickness", "stem_length", "thread_type", "piercing_type", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "package_type", "virtual_store_active", "preparation_days", "shipping_info", "seo_title", "seo_description", "freight_notes", "quantity", "cost_value", "sale_value", "supplier", "physical_location", "sku", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "is_published", "notes", "status", "low_stock_threshold", "critical_stock_threshold"];
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
