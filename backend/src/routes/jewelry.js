// Rotas de estoque de joalherias: produtos, variacoes e movimentacoes.
import { Router } from "express";
import multer from "multer";
import bwipjs from "bwip-js";
import QRCode from "qrcode";
import { withDb, withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { boolNumber, elegantProductName, variantStatus, variantFromLegacy } from "../services/utils.js";
import {
  attachVariants,
  generateSku,
  isUniqueViolation,
  jewelrySkuExists,
  replaceJewelryVariants,
  assertNonNegativeStockQuantity,
  syncProductImages,
  syncProductInventory,
  SkuConflictError,
  InvalidStockQuantityError
} from "../services/inventory.js";
import { validateBody } from "../middleware/validate.js";
import { jewelryCreateSchema, jewelryUpdateSchema } from "../schemas/index.js";
import { calculatePricing, getPricingSettings } from "../services/pricing.js";
import { visualSearch } from "../services/visualSearch.js";
import { inventoryIntelligence, refreshInventorySuggestions } from "../services/inventoryIntelligence.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { invalidateUsageCache, requireWithinLimit } from "../services/planLimits.js";
import { JEWELRY_CATEGORIES } from "../config/index.js";

const router = Router();

function validateStockPayload(body) {
  if (body.quantity !== undefined) assertNonNegativeStockQuantity(body.quantity);
  if (Array.isArray(body.variants)) {
    body.variants.forEach((variant) => { assertNonNegativeStockQuantity(variant?.quantity); });
  }
}

function rejectInvalidStockPayload(req, res) {
  try {
    validateStockPayload(req.body);
    return false;
  } catch (error) {
    if (error instanceof InvalidStockQuantityError) {
      res.status(error.statusCode).json({ error: error.message });
      return true;
    }
    throw error;
  }
}

async function resolveActiveCategory(db, body) {
  const categoryId = Number(body.category_id || 0);
  let category = categoryId
    ? await db.get("SELECT id, name FROM inventory_options WHERE id=? AND type='category' AND is_active=1", [categoryId])
    : null;
  const categoryName = String(body.category || "").trim();
  if (!category && categoryName) {
    category = await db.get("SELECT id, name FROM inventory_options WHERE type='category' AND name=? AND is_active=1", [categoryName]);
    if (!category && JEWELRY_CATEGORIES.includes(categoryName)) {
      await db.run("INSERT INTO inventory_options(type,name,is_active) VALUES('category',?,1) ON CONFLICT(type,name) DO NOTHING", [categoryName]);
      category = await db.get("SELECT id, name FROM inventory_options WHERE type='category' AND name=? AND is_active=1", [categoryName]);
    }
  }
  return category;
}

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const JEWELRY_SORTABLE = {
  name: "j.name",
  category: "j.category",
  quantity: "j.quantity",
  price: "j.sale_value",
  status: "j.status"
};
const visualUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
});

router.get("/api/inventory/intelligence", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  const days = Math.min(Math.max(Number(req.query.days || 90), 30), 365);
  const items = await inventoryIntelligence(db, days);
  res.json({
    period_days: days,
    generated_at: new Date().toISOString(),
    items,
    summary: {
      predicted_stockouts: items.filter((item) => item.days_to_stockout !== null && item.days_to_stockout <= 30).length,
      suggested_units: items.reduce((sum, item) => sum + item.suggested_purchase, 0),
      class_a: items.filter((item) => item.abc_class === "A").length
    }
  });
}));

router.post("/api/inventory/suggestions/refresh", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
  await refreshInventorySuggestions(db, req.user?.id);
  res.json(await db.all(`
    SELECT s.*, j.name AS jewelry_name, j.sku, j.quantity
    FROM inventory_suggestions s JOIN jewelry_inventory j ON j.id=s.jewelry_id
    WHERE s.status='pending' ORDER BY s.confidence DESC, s.id DESC
  `));
}));

router.get("/api/inventory/suggestions", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  const status = ["pending", "accepted", "rejected"].includes(req.query.status) ? req.query.status : "pending";
  res.json(await db.all(`
    SELECT s.*, j.name AS jewelry_name, j.sku, j.quantity
    FROM inventory_suggestions s JOIN jewelry_inventory j ON j.id=s.jewelry_id
    WHERE s.status=? ORDER BY s.confidence DESC, s.id DESC
  `, [status]));
}));

router.patch("/api/inventory/suggestions/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
  const status = String(req.body?.status || "");
  if (!["accepted", "rejected"].includes(status)) return res.status(400).json({ error: "Decisão inválida." });
  const suggestion = await db.get("SELECT * FROM inventory_suggestions WHERE id=? AND status='pending'", [req.params.id]);
  if (!suggestion) return res.status(404).json({ error: "Sugestão pendente não encontrada." });
  const metadataFields = new Set(["material", "color", "stone"]);
  if (status === "accepted" && metadataFields.has(suggestion.suggestion_type)) {
    await db.run(`UPDATE jewelry_inventory SET ${suggestion.suggestion_type}=? WHERE id=?`, [suggestion.suggested_value, suggestion.jewelry_id]);
  }
  await db.run("UPDATE inventory_suggestions SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?", [status, req.user?.id || null, suggestion.id]);
  await db.run(
    "INSERT INTO inventory_audit_log (jewelry_id, action, before_data, after_data, user_id) VALUES (?, ?, ?, ?, ?)",
    [suggestion.jewelry_id, `suggestion_${status}`, JSON.stringify(suggestion), JSON.stringify({ status }), req.user?.id || null]
  );
  res.json(await db.get("SELECT * FROM inventory_suggestions WHERE id=?", [suggestion.id]));
}));

router.get("/api/inventory/counts", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  res.json(await db.all(`
    SELECT c.*, COUNT(i.id) AS item_count,
      COALESCE(SUM(CASE WHEN i.counted_quantity IS NOT NULL AND i.difference != 0 THEN 1 ELSE 0 END), 0) AS divergent_count
    FROM inventory_counts c LEFT JOIN inventory_count_items i ON i.count_id=c.id
    GROUP BY c.id ORDER BY c.created_at DESC, c.id DESC LIMIT 100
  `));
}));

router.post("/api/inventory/counts", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
  await db.run("BEGIN");
  try {
    const created = await db.run("INSERT INTO inventory_counts (notes, created_by) VALUES (?, ?) RETURNING id", [String(req.body?.notes || ""), req.user?.id || null]);
    await db.run(`
      INSERT INTO inventory_count_items (count_id, jewelry_id, variant_id, expected_quantity)
      SELECT ?, j.id, v.id, v.quantity
      FROM jewelry_inventory j JOIN jewelry_variants v ON v.jewelry_id=j.id AND v.is_active=1
      WHERE j.status != 'arquivado'
    `, [created.returnedId]);
    await db.run(`
      INSERT INTO inventory_count_items (count_id, jewelry_id, variant_id, expected_quantity)
      SELECT ?, j.id, NULL, j.quantity FROM jewelry_inventory j
      WHERE j.status != 'arquivado'
        AND NOT EXISTS (SELECT 1 FROM jewelry_variants v WHERE v.jewelry_id=j.id AND v.is_active=1)
    `, [created.returnedId]);
    await db.run("COMMIT");
    res.status(201).json(await db.get("SELECT * FROM inventory_counts WHERE id=?", [created.returnedId]));
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.get("/api/inventory/counts/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  const count = await db.get("SELECT * FROM inventory_counts WHERE id=?", [req.params.id]);
  if (!count) return res.status(404).json({ error: "Inventário não encontrado." });
  count.items = await db.all(`
    SELECT i.*, j.name, COALESCE(v.sku, j.sku) AS sku, j.category, v.variation_name
    FROM inventory_count_items i JOIN jewelry_inventory j ON j.id=i.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id=i.variant_id
    WHERE i.count_id=? ORDER BY j.category, j.name
  `, [count.id]);
  res.json(count);
}));

router.patch("/api/inventory/counts/:id/items", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
  const count = await db.get("SELECT * FROM inventory_counts WHERE id=? AND status='draft'", [req.params.id]);
  if (!count) return res.status(404).json({ error: "Inventário em aberto não encontrado." });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await db.run("BEGIN");
  try {
    for (const item of items) {
      if (item.counted_quantity === null || item.counted_quantity === undefined || item.counted_quantity === "") continue;
      const quantity = Math.max(0, Number(item.counted_quantity || 0));
      await db.run(
        "UPDATE inventory_count_items SET counted_quantity=?, difference=?-expected_quantity WHERE id=? AND count_id=?",
        [quantity, quantity, item.id, count.id]
      );
    }
    await db.run("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.post("/api/inventory/counts/:id/complete", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
  const count = await db.get("SELECT * FROM inventory_counts WHERE id=? AND status='draft'", [req.params.id]);
  if (!count) return res.status(404).json({ error: "Inventário em aberto não encontrado." });
  const missing = await db.get("SELECT COUNT(*) AS count FROM inventory_count_items WHERE count_id=? AND counted_quantity IS NULL", [count.id]);
  if (Number(missing.count) > 0) return res.status(400).json({ error: "Informe a contagem de todos os produtos antes de concluir." });
  const items = await db.all("SELECT * FROM inventory_count_items WHERE count_id=? AND difference != 0", [count.id]);
  await db.run("BEGIN");
  try {
    for (const item of items) {
      const product = await db.get("SELECT * FROM jewelry_inventory WHERE id=? FOR UPDATE", [item.jewelry_id]);
      if (item.variant_id) {
        const variant = await db.get("SELECT * FROM jewelry_variants WHERE id=? FOR UPDATE", [item.variant_id]);
        await db.run("UPDATE jewelry_variants SET quantity=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [
          item.counted_quantity,
          variantStatus(item.counted_quantity, variant?.low_stock_threshold || 5),
          item.variant_id
        ]);
        await syncProductInventory(db, item.jewelry_id);
      } else {
        await db.run("UPDATE jewelry_inventory SET quantity=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [
          item.counted_quantity,
          Number(item.counted_quantity) <= 0 ? "esgotado" : Number(item.counted_quantity) <= Number(product.critical_stock_threshold || 3) ? "crítico" : "disponível",
          item.jewelry_id
        ]);
      }
      await db.run(
        "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'Inventário', ?, ?)",
        [item.jewelry_id, item.variant_id || null, Math.abs(Number(item.difference)), `Inventário #${count.id}: ${item.expected_quantity} → ${item.counted_quantity}`]
      );
      await db.run(
        "INSERT INTO inventory_audit_log (jewelry_id, action, before_data, after_data, user_id) VALUES (?, 'inventory_count', ?, ?, ?)",
        [item.jewelry_id, JSON.stringify({ quantity: product.quantity }), JSON.stringify({ quantity: item.counted_quantity, count_id: count.id }), req.user?.id || null]
      );
    }
    await db.run("UPDATE inventory_counts SET status='completed', completed_by=?, completed_at=CURRENT_TIMESTAMP WHERE id=?", [req.user?.id || null, count.id]);
    await db.run("COMMIT");
    res.json({ ok: true, adjusted_items: items.length });
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.get("/api/inventory/labels", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  const ids = String(req.query.ids || "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: "Selecione ao menos um produto." });
  const placeholders = ids.map(() => "?").join(",");
  const products = await db.all(`SELECT id, name, sku, category, sale_value FROM jewelry_inventory WHERE id IN (${placeholders})`, ids);
  const labels = await Promise.all(products.map(async (product) => {
    const code = product.sku || `AURA-${product.id}`;
    const barcode = await bwipjs.toBuffer({ bcid: "code128", text: code, scale: 2, height: 10, includetext: true, textxalign: "center" });
    const qr = await QRCode.toDataURL(JSON.stringify({ type: "aura_product", id: product.id, sku: code }), { width: 180, margin: 1 });
    return {
      ...product,
      code,
      barcode_data_url: `data:image/png;base64,${barcode.toString("base64")}`,
      qr_data_url: qr
    };
  }));
  res.json({ labels });
}));

router.post("/api/jewelry/visual-search", visualUpload.single("image"), withFeature("visual_search", async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  if (!req.file?.buffer) return res.status(400).json({ error: "Envie uma imagem JPEG, PNG ou WebP de até 5 MB." });
  try {
    const results = await visualSearch(db, req.file.buffer, req.body || {});
    res.json({ phase: "perceptual_hash", stored_query_image: false, results: await attachVariants(db, results) });
  } catch {
    res.status(400).json({ error: "Imagem inválida ou corrompida." });
  }
}));

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
    body.category_id,
    body.subcategory || "",
    body.variant_group || "",
    body.variation_label || "",
    body.material || "",
    body.color || "",
    body.stone,
    body.size,
    body.top_size_mm === "" || body.top_size_mm == null ? null : Number(body.top_size_mm),
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
  if (["quantity", "top_size_mm", "cost_value", "sale_value", "purchase_cost_cents", "allocated_freight_cents", "additional_cost_cents", "total_cost_cents", "price_multiplier", "suggested_price_cents", "sale_price_cents", "price_manually_overridden", "cost_estimated", "low_stock_threshold", "critical_stock_threshold", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "preparation_days", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "virtual_store_active", "is_published"].includes(field)) {
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
    const normalized = "translate(lower(COALESCE(%s, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')";
    const searchable = (column) => normalized.replace("%s", column);
    clauses.push(`(
      ${searchable("j.name")} LIKE ${searchable("?")} OR ${searchable("j.description")} LIKE ${searchable("?")}
      OR ${searchable("j.category")} LIKE ${searchable("?")} OR ${searchable("j.subcategory")} LIKE ${searchable("?")}
      OR EXISTS (
        SELECT 1 FROM jewelry_variants v
        WHERE v.jewelry_id = j.id
          AND (${searchable("v.sku")} LIKE ${searchable("?")} OR ${searchable("v.material")} LIKE ${searchable("?")}
            OR ${searchable("v.color")} LIKE ${searchable("?")} OR ${searchable("v.size")} LIKE ${searchable("?")}
            OR ${searchable("v.thickness")} LIKE ${searchable("?")} OR ${searchable("v.length")} LIKE ${searchable("?")}
            OR ${searchable("v.diameter")} LIKE ${searchable("?")} OR ${searchable("CAST(v.top_size_mm AS TEXT)")} LIKE ${searchable("?")}
            OR ${searchable("v.thread_type")} LIKE ${searchable("?")} OR ${searchable("v.supplier")} LIKE ${searchable("?")})
      )
    )`);
    params.push(...Array(14).fill(`%${req.query.search}%`));
  }
  for (const field of ["category", "subcategory", "status", "physical_location"]) {
    if (req.query[field]) {
      clauses.push(`j.${field} = ?`);
      params.push(req.query[field]);
    }
  }
  for (const field of ["material", "color", "size", "thickness", "length", "diameter", "top_size_mm", "thread_type", "supplier"]) {
    if (req.query[field]) {
      clauses.push(`EXISTS (SELECT 1 FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.${field} LIKE ?)`);
      params.push(`%${req.query[field]}%`);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: JEWELRY_SORTABLE,
    tieBreak: "j.id",
    defaultOrderBy: "ORDER BY j.category, j.name"
  });
  const { rows, total } = await fetchPage(db, {
    select: "j.*",
    from: "jewelry_inventory j",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  // attachVariants agora roda só sobre a página, não sobre o estoque inteiro.
  res.json(pageResponse(await attachVariants(db, rows), total, paging));
}));

router.post("/api/jewelry", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_CREATE)) return;
  if (!validateBody(jewelryCreateSchema, req, res)) return;
  const category = await resolveActiveCategory(db, req.body);
  if (!category) return res.status(400).json({ error: "Selecione uma categoria principal válida." });
  req.body.category_id = category.id;
  req.body.category = category.name;
  if (rejectInvalidStockPayload(req, res)) return;
  // Cota do plano, antes do BEGIN: devolver 409 no meio da transação obrigaria a
  // desfazer SKU e variações já gravados. A cota conta PRODUTOS
  // (jewelry_inventory), não variações — cadastrar uma cor a mais numa joia que
  // já existe passa pelo PATCH e não consome nada.
  if (!(await requireWithinLimit(req, res, "jewelry_items", db))) return;

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
      (name, description, photo_url, gallery_urls, category, category_id, subcategory, variant_group, variation_label, material, color, stone, size, top_size_mm, thickness, stem_length, thread_type, piercing_type, weight_grams, package_length_cm, package_width_cm, package_height_cm, package_type, virtual_store_active, preparation_days, shipping_info, seo_title, seo_description, freight_notes, quantity, cost_value, sale_value, purchase_cost_cents, allocated_freight_cents, additional_cost_cents, total_cost_cents, price_multiplier, price_rounding_mode, suggested_price_cents, sale_price_cents, price_manually_overridden, cost_estimated, supplier, physical_location, sku, is_catalog_active, is_featured, is_new, is_most_wanted, is_promotion, is_last_units, notes, status, low_stock_threshold, critical_stock_threshold, image_url, is_published)
      VALUES (${Array(57).fill("?").join(", ")}) RETURNING id`,
      jewelryPayload(req.body, sku, pricing)
    );
    await replaceJewelryVariants(db, result.returnedId, req.body.variants || [variantFromLegacy({ ...req.body, sku: "" })]);
    await syncProductImages(db, result.returnedId, req.body.images || req.body.gallery_urls || [req.body.image_url || req.body.photo_url].filter(Boolean));
    const product = (await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [result.returnedId])]))[0];
    await db.run("COMMIT");
    return res.status(201).json(product);
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    if (error instanceof InvalidStockQuantityError) return res.status(error.statusCode).json({ error: error.message });
    if (error instanceof SkuConflictError || isUniqueViolation(error)) {
      logSkuError(error, "POST /api/jewelry");
      return skuConflict(res);
    }
    throw error;
  }
}));

router.patch("/api/jewelry/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_EDIT)) return;
  if (!validateBody(jewelryUpdateSchema, req, res)) return;
  if (req.body.category !== undefined || req.body.category_id !== undefined) {
    const category = await resolveActiveCategory(db, req.body);
    if (!category) return res.status(400).json({ error: "Selecione uma categoria principal válida." });
    req.body.category_id = category.id;
    req.body.category = category.name;
  }
  if (rejectInvalidStockPayload(req, res)) return;

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

  const fields = ["name", "description", "photo_url", "image_url", "gallery_urls", "category", "category_id", "subcategory", "variant_group", "variation_label", "material", "color", "stone", "size", "top_size_mm", "thickness", "stem_length", "thread_type", "piercing_type", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "package_type", "virtual_store_active", "preparation_days", "shipping_info", "seo_title", "seo_description", "freight_notes", "quantity", "cost_value", "sale_value", "purchase_cost_cents", "allocated_freight_cents", "additional_cost_cents", "total_cost_cents", "price_multiplier", "price_rounding_mode", "suggested_price_cents", "sale_price_cents", "price_manually_overridden", "cost_estimated", "supplier", "physical_location", "sku", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "is_published", "notes", "status", "low_stock_threshold", "critical_stock_threshold"];
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
    if (error instanceof InvalidStockQuantityError) return res.status(error.statusCode).json({ error: error.message });
    if (error instanceof SkuConflictError || isUniqueViolation(error)) {
      logSkuError(error, `PATCH /api/jewelry/${req.params.id}`);
      return skuConflict(res);
    }
    throw error;
  }
}));

router.post("/api/jewelry/:id/variants/:variantId/movements", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
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
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  const movements = await db.all(
    "SELECT * FROM stock_movements WHERE jewelry_id = ? ORDER BY movement_date DESC, id DESC LIMIT 20",
    [req.params.id]
  );
  res.json(movements);
}));

router.post("/api/jewelry/:id/movements", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
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
  if (!authorizePermission(req, res, P.INVENTORY_DELETE)) return;
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
  // Arquivar mantém a linha (e a contagem); excluir de verdade não.
  invalidateUsageCache(req.tenant?.id);
  res.json({ ok: true, archived: false });
}));

export default router;
