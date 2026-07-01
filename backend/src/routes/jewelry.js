// Rotas de estoque de joalherias (produtos, variações e movimentações).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { JEWELRY_CATEGORIES } from "../config/index.js";
import { boolNumber, elegantProductName, variantStatus, variantFromLegacy } from "../services/utils.js";
import {
  attachVariants,
  generateSku,
  replaceJewelryVariants,
  syncProductInventory
} from "../services/inventory.js";

const router = Router();

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
  if (!JEWELRY_CATEGORIES.includes(req.body.category)) {
    return res.status(400).json({ error: "Selecione uma categoria principal válida." });
  }
  if (!req.body.name?.trim()) return res.status(400).json({ error: "Informe o nome do produto." });
  const result = await db.run(
    `INSERT INTO jewelry_inventory
    (name, description, photo_url, gallery_urls, category, subcategory, variant_group, variation_label, material, color, stone, size, thickness, stem_length, thread_type, piercing_type, weight_grams, package_length_cm, package_width_cm, package_height_cm, package_type, virtual_store_active, preparation_days, shipping_info, seo_title, seo_description, freight_notes, quantity, cost_value, sale_value, supplier, physical_location, sku, is_catalog_active, is_featured, is_new, is_most_wanted, is_promotion, is_last_units, notes, status, low_stock_threshold, critical_stock_threshold)
    VALUES (${Array(43).fill("?").join(", ")})`,
    [
      elegantProductName(req.body.name),
      req.body.description || "",
      req.body.photo_url,
      JSON.stringify(req.body.gallery_urls || []),
      req.body.category,
      req.body.subcategory || "",
      req.body.variant_group || "",
      req.body.variation_label || "",
      req.body.material || "",
      req.body.color || "",
      req.body.stone,
      req.body.size,
      req.body.thickness,
      req.body.stem_length,
      req.body.thread_type,
      req.body.piercing_type || "",
      Number(req.body.weight_grams || 0),
      Number(req.body.package_length_cm || 0),
      Number(req.body.package_width_cm || 0),
      Number(req.body.package_height_cm || 0),
      req.body.package_type || "",
      boolNumber(req.body.virtual_store_active),
      Number(req.body.preparation_days || 1),
      req.body.shipping_info || "",
      req.body.seo_title || "",
      req.body.seo_description || "",
      req.body.freight_notes || "",
      Number(req.body.quantity || 0),
      Number(req.body.cost_value || 0),
      Number(req.body.sale_value || 0),
      req.body.supplier,
      req.body.physical_location || "",
      req.body.sku || await generateSku(db, req.body),
      boolNumber(req.body.is_catalog_active),
      boolNumber(req.body.is_featured),
      boolNumber(req.body.is_new),
      boolNumber(req.body.is_most_wanted),
      boolNumber(req.body.is_promotion),
      boolNumber(req.body.is_last_units),
      req.body.notes,
      req.body.status || "disponível",
      Number(req.body.low_stock_threshold || 5),
      Number(req.body.critical_stock_threshold || 3)
    ]
  );
  await replaceJewelryVariants(db, result.lastID, req.body.variants || [variantFromLegacy(req.body)]);
  res.status(201).json((await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [result.lastID])]))[0]);
}));

router.patch("/api/jewelry/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const jewelry = await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  if (!jewelry) return res.status(404).json({ error: "Joia não encontrada." });
  const fields = ["name", "description", "photo_url", "image_url", "gallery_urls", "category", "subcategory", "variant_group", "variation_label", "material", "color", "stone", "size", "thickness", "stem_length", "thread_type", "piercing_type", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "package_type", "virtual_store_active", "preparation_days", "shipping_info", "seo_title", "seo_description", "freight_notes", "quantity", "cost_value", "sale_value", "supplier", "physical_location", "sku", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "is_published", "notes", "status", "low_stock_threshold", "critical_stock_threshold"];
  const updates = fields.filter((field) => req.body[field] !== undefined);
  if (updates.length) {
    await db.run(
      `UPDATE jewelry_inventory SET ${updates.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`,
      [...updates.map((field) => {
        if (["quantity", "cost_value", "sale_value", "low_stock_threshold", "critical_stock_threshold", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "preparation_days", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "virtual_store_active", "is_published"].includes(field)) return Number(req.body[field] || 0);
        if (field === "gallery_urls") return typeof req.body.gallery_urls === "string" ? req.body.gallery_urls : JSON.stringify(req.body.gallery_urls || []);
        return field === "name" ? elegantProductName(req.body[field]) : req.body[field];
      }), req.params.id]
    );
  }
  if (Array.isArray(req.body.variants)) await replaceJewelryVariants(db, jewelry.id, req.body.variants);
  res.json((await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id])]))[0]);
}));

router.post("/api/jewelry/:id/variants/:variantId/movements", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const variant = await db.get(
    "SELECT * FROM jewelry_variants WHERE id = ? AND jewelry_id = ?",
    [req.params.variantId, req.params.id]
  );
  if (!variant) return res.status(404).json({ error: "Variação não encontrada." });
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
    `SELECT * FROM stock_movements WHERE jewelry_id = ? ORDER BY movement_date DESC, id DESC LIMIT 20`,
    [req.params.id]
  );
  res.json(movements);
}));

router.post("/api/jewelry/:id/movements", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const jewelry = await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  if (!jewelry) return res.status(404).json({ error: "Joia não encontrada." });
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const movementType = req.body.movement_type || "Ajuste";
  const notes = req.body.notes || "";
  const decreaseTypes = new Set(["Saída", "Venda", "Perda"]);
  const delta = decreaseTypes.has(movementType) ? -quantity : quantity;
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
