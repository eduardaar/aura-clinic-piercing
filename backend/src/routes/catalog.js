// Rotas do catálogo online e sua personalização/administração.
import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { attachVariants } from "../services/inventory.js";
import { groupInventoryOptions, splitCatalogCategories } from "../services/utils.js";
import { validateCoupon } from "../services/discounts.js";
import { quotePromotions } from "../services/promotions.js";
import {
  getCatalogCustomization,
  getCatalogSettings,
  saveCatalogCustomization,
  resetCatalogCustomization,
  saveCatalogLayoutDraft,
  publishCatalogLayout
} from "../services/catalog.js";

const router = Router();

router.post("/api/catalog/events", withDb(async (req, res, db) => {
  const eventType = String(req.body?.event_type || "");
  const allowed = new Set(["catalog_view", "product_view", "product_selected", "checkout_started", "booking_created"]);
  if (!allowed.has(eventType)) return res.status(400).json({ error: "Evento inválido." });
  const sessionKey = String(req.body?.session_key || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (sessionKey.length < 8) return res.status(400).json({ error: "Sessão inválida." });
  const productId = req.body?.product_id ? Number(req.body.product_id) : null;
  if (productId && !(await db.get("SELECT id FROM jewelry_inventory WHERE id=? AND is_catalog_active=1", [productId]))) {
    return res.status(404).json({ error: "Produto não encontrado." });
  }
  await db.run(
    "INSERT INTO catalog_events (event_type, product_id, session_key, source, metadata) VALUES (?, ?, ?, ?, ?)",
    [eventType, productId, sessionKey, String(req.body?.source || "catalog").slice(0, 40), JSON.stringify(req.body?.metadata || {})]
  );
  res.status(202).json({ ok: true });
}));

const asArray = (value) => (Array.isArray(value) ? value : []);

router.get("/api/catalog", withDb(async (_req, res, db) => {
  const customization = await getCatalogCustomization(db, { published: true });
  const productRows = await db.all(`
    SELECT
      j.*,
      COALESCE(
        fp.badge,
        CASE
          WHEN j.is_promotion = 1 THEN 'Promoção'
          WHEN j.is_last_units = 1 THEN 'Últimas unidades'
          WHEN j.is_most_wanted = 1 THEN 'Mais desejado'
          WHEN j.is_new = 1 THEN 'Lançamento'
          WHEN j.is_featured = 1 THEN 'Destaque'
          ELSE ''
        END
      ) AS badge,
      fp.sort_order AS featured_order
    FROM jewelry_inventory j
    LEFT JOIN catalog_featured_products fp ON fp.product_id = j.id AND fp.is_active = 1
    WHERE j.is_catalog_active = 1 AND j.status != 'arquivado'
    ORDER BY COALESCE(fp.sort_order, 9999), j.category, j.name
  `);
  const items = (await attachVariants(db, productRows))
    .map((item) => ({
      // Dados públicos
      id: item.id,
      name: item.name,
      photo_url: item.photo_url || item.image_url,
      image_url: item.image_url || item.photo_url,
      images: asArray(item.images).map((image) => ({
        id: image.id,
        image_url: image.image_url,
        alt_text: image.alt_text,
        sort_order: image.sort_order,
        is_primary: image.is_primary
      })),
      gallery_urls: item.gallery_urls,
      category: item.category,
      subcategory: item.subcategory,
      material: item.material,
      color: item.color,
      stone: item.stone,
      size: item.size,
      top_size_mm: item.top_size_mm,
      thickness: item.thickness,
      sku: item.sku,
      description: item.description,
      sale_value: item.sale_value,
      quantity: item.quantity,
      status: item.status,
      is_catalog_active: item.is_catalog_active,
      is_published: item.is_published,
      variants: asArray(item.variants).filter((v) => Number(v.is_active ?? 1) === 1).map((v) => ({
        id: v.id,
        variation_name: v.variation_name,
        diameter: v.diameter,
        length: v.length,
        size: v.size,
        top_size_mm: v.top_size_mm,
        sku: v.sku,
        stone_color: v.stone_color,
        thickness: v.thickness,
        material: v.material,
        color: v.color,
        image_url: v.image_url,
        images: asArray(v.images).map((image) => ({
          id: image.id,
          image_url: image.image_url,
          alt_text: image.alt_text,
          sort_order: image.sort_order,
          is_primary: image.is_primary
        })),
        thread_type: v.thread_type,
        sale_value: v.sale_value || item.sale_value,
        quantity: v.quantity || item.quantity,
        status: v.status,
        is_active: v.is_active
      })),
      badge: item.badge,
      is_featured: item.is_featured,
      is_new: item.is_new,
      is_promotion: item.is_promotion,
      is_last_units: item.is_last_units
      // Dados privados OCULTOS: cost_value, supplier, physical_location, notes, description, etc.
    }));
  res.json({
    ...customization.settings,
    theme: customization.theme,
    banners: customization.banners,
    featuredCategories: customization.featuredCategories,
    featuredProducts: customization.featuredProducts,
    promotions: customization.promotions,
    categories: splitCatalogCategories(customization.settings.categories),
    items
  });
}));

router.get("/api/catalog-customization", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const customization = await getCatalogCustomization(db);
  const products = await attachVariants(db, await db.all("SELECT * FROM jewelry_inventory ORDER BY name"));
  const options = await db.all("SELECT * FROM inventory_options ORDER BY type, name");
  res.json({ ...customization, products, inventoryOptions: groupInventoryOptions(options) });
}));

router.patch("/api/catalog-customization", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await saveCatalogCustomization(db, req.body || {});
  if (Array.isArray(req.body?.catalogSections)) await saveCatalogLayoutDraft(db, req.body.catalogSections, req.user?.id);
  res.json(await getCatalogCustomization(db));
}));

router.post("/api/catalog-customization/publish", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await saveCatalogCustomization(db, req.body || {});
  if (Array.isArray(req.body?.catalogSections)) await saveCatalogLayoutDraft(db, req.body.catalogSections, req.user?.id);
  const catalogSections = await publishCatalogLayout(db, req.user?.id);
  res.json({ ok: true, published_at: new Date().toISOString(), ...(await getCatalogCustomization(db)), catalogSections });
}));

router.post("/api/catalog-customization/reset", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  await resetCatalogCustomization(db);
  res.json(await getCatalogCustomization(db));
}));

router.get("/api/catalog-settings", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const settings = await getCatalogSettings(db);
  res.json({ ...settings, categories: splitCatalogCategories(settings.categories) });
}));

router.get("/api/coupons", withFeature("coupons", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const coupons = await db.all(`
    SELECT c.*,
      (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) AS usage_count,
      (SELECT COALESCE(SUM(discount_amount), 0) FROM coupon_usages u WHERE u.coupon_id = c.id) AS total_discount
    FROM coupons c
    WHERE c.deleted_at IS NULL
    ORDER BY c.created_at DESC, c.id DESC
  `);
  res.json(coupons);
}));

router.post("/api/coupons", withFeature("coupons", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const body = req.body || {};
  const code = String(body.code || "").trim().toUpperCase();
  const internalName = String(body.internal_name || body.name || "").trim();
  const discountType = body.discount_type === "fixed" ? "fixed" : "percent";
  const discountValue = Number(body.discount_value || 0);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return res.status(400).json({ error: "Código deve ter de 3 a 40 letras, números, _ ou -." });
  if (!internalName) return res.status(400).json({ error: "Informe o nome interno." });
  if (discountValue < 0 || (discountType === "percent" && discountValue > 100)) return res.status(400).json({ error: "Valor de desconto inválido." });
  const result = await db.run(
    `INSERT INTO coupons
      (code, internal_name, description, discount_type, discount_value, starts_at, ends_at, usage_limit,
       usage_limit_per_client, minimum_amount, maximum_discount, product_ids, category_ids,
       excluded_product_ids, excluded_category_ids, service_ids, first_purchase_only,
       selected_client_ids, is_stackable, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      code, internalName, body.description || "", discountType, discountValue,
      body.starts_at || null, body.ends_at || null, body.usage_limit || null,
      body.usage_limit_per_client || null, Number(body.minimum_amount || 0), body.maximum_discount || null,
      body.product_ids || "", body.category_ids || "", body.excluded_product_ids || "",
      body.excluded_category_ids || "", body.service_ids || "", Number(Boolean(body.first_purchase_only)),
      body.selected_client_ids || "", Number(Boolean(body.is_stackable)), body.status || "active"
    ]
  );
  res.status(201).json(await db.get("SELECT * FROM coupons WHERE id = ?", [result.returnedId]));
}));

router.patch("/api/coupons/:id", withFeature("coupons", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM coupons WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Cupom não encontrado." });
  const body = { ...current, ...(req.body || {}) };
  const code = String(body.code || "").trim().toUpperCase();
  const discountType = body.discount_type === "fixed" ? "fixed" : "percent";
  const discountValue = Number(body.discount_value || 0);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code) || discountValue < 0 || (discountType === "percent" && discountValue > 100)) {
    return res.status(400).json({ error: "Dados do cupom inválidos." });
  }
  await db.run(
    `UPDATE coupons SET code = ?, internal_name = ?, description = ?, discount_type = ?, discount_value = ?,
      starts_at = ?, ends_at = ?, usage_limit = ?, usage_limit_per_client = ?, minimum_amount = ?,
      maximum_discount = ?, product_ids = ?, category_ids = ?, excluded_product_ids = ?,
      excluded_category_ids = ?, service_ids = ?, first_purchase_only = ?, selected_client_ids = ?,
      is_stackable = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      code, body.internal_name, body.description || "", discountType, discountValue, body.starts_at || null,
      body.ends_at || null, body.usage_limit || null, body.usage_limit_per_client || null,
      Number(body.minimum_amount || 0), body.maximum_discount || null, body.product_ids || "",
      body.category_ids || "", body.excluded_product_ids || "", body.excluded_category_ids || "",
      body.service_ids || "", Number(Boolean(Number(body.first_purchase_only))), body.selected_client_ids || "",
      Number(Boolean(Number(body.is_stackable))), body.status || "active", req.params.id
    ]
  );
  res.json(await db.get("SELECT * FROM coupons WHERE id = ?", [req.params.id]));
}));

router.delete("/api/coupons/:id", withFeature("coupons", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const usage = await db.get("SELECT COUNT(*) AS count FROM coupon_usages WHERE coupon_id = ?", [req.params.id]);
  if (Number(usage?.count || 0) > 0) {
    await db.run("UPDATE coupons SET status = 'inactive', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  } else {
    await db.run("DELETE FROM coupons WHERE id = ?", [req.params.id]);
  }
  res.json({ ok: true });
}));

router.post("/api/catalog/coupon-quote", withDb(async (req, res, db) => {
  const result = await validateCoupon(db, req.body?.code, req.body || {});
  res.status(result.valid ? 200 : 400).json(result);
}));

router.post("/api/catalog/promotion-quote", withDb(async (req, res, db) => {
  res.json(await quotePromotions(db, req.body || {}));
}));

router.post("/api/catalog/price-quote", withDb(async (req, res, db) => {
  const body = req.body || {};
  const promotionQuote = await quotePromotions(db, body);
  let couponQuote = null;
  if (body.coupon_code) {
    couponQuote = await validateCoupon(db, body.coupon_code, {
      ...body,
      amount: promotionQuote.final_amount
    });
    if (!couponQuote.valid) return res.status(400).json(couponQuote);
  }
  const promotionsAllowCoupon = promotionQuote.promotions.every((promotion) => promotion.stackable_with_coupon);
  let promotionDiscount = promotionQuote.discount_amount;
  let couponDiscount = couponQuote?.discount_amount || 0;
  if (couponQuote?.valid && promotionQuote.promotions.length && !promotionsAllowCoupon) {
    if (couponDiscount > promotionDiscount) promotionDiscount = 0;
    else couponDiscount = 0;
  }
  const totalDiscount = Math.min(promotionDiscount + couponDiscount, promotionQuote.original_amount);
  res.json({
    valid: true,
    original_amount: promotionQuote.original_amount,
    promotion_discount: promotionDiscount,
    coupon_discount: couponDiscount,
    discount_amount: Number(totalDiscount.toFixed(2)),
    final_amount: Number((promotionQuote.original_amount - totalDiscount).toFixed(2)),
    promotions: promotionDiscount ? promotionQuote.promotions : [],
    coupon: couponDiscount ? couponQuote.coupon : null
  });
}));

router.get("/api/promotions", withFeature("campaigns", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const rows = await db.all(`
    SELECT p.*,
      (SELECT COUNT(*) FROM promotion_usages u WHERE u.promotion_id = p.id) AS usage_count,
      (SELECT COALESCE(SUM(discount_amount), 0) FROM promotion_usages u WHERE u.promotion_id = p.id) AS total_discount
    FROM catalog_promotions p
    WHERE p.deleted_at IS NULL
    ORDER BY p.priority DESC, p.created_at DESC, p.id DESC
  `);
  res.json(rows);
}));

router.post("/api/promotions", withFeature("campaigns", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const discountValue = Number(body.discount_value || 0);
  const allowedTypes = ["percent", "fixed", "fixed_price", "buy_x_pay_y", "progressive", "quantity"];
  if (!name) return res.status(400).json({ error: "Informe o nome da promoção." });
  if (!allowedTypes.includes(body.discount_type || "percent") || discountValue < 0 || (body.discount_type === "percent" && discountValue > 100)) {
    return res.status(400).json({ error: "Tipo ou valor de desconto inválido." });
  }
  const result = await db.run(
    `INSERT INTO catalog_promotions
      (name, description, status, discount_type, discount_value, priority, start_date, end_date, start_time, end_time,
       usage_limit, usage_limit_per_client, minimum_amount, maximum_discount, minimum_quantity, applies_to,
       product_ids, category_ids, variation_ids, excluded_product_ids, excluded_category_ids, excluded_variation_ids,
       colors, materials, stones, service_ids, buy_quantity, pay_quantity, fixed_promotional_price,
       is_stackable, stackable_with_coupon, badge, legal_text, visible_in_catalog, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    promotionValues(body)
  );
  const created = await db.get("SELECT * FROM catalog_promotions WHERE id = ?", [result.returnedId]);
  await db.run("INSERT INTO promotion_audit_logs (promotion_id, user_id, action, next_data) VALUES (?, ?, 'create', ?)", [created.id, req.user?.id || null, JSON.stringify(created)]);
  res.status(201).json(created);
}));

router.patch("/api/promotions/:id", withFeature("campaigns", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM catalog_promotions WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Promoção não encontrada." });
  const body = { ...current, ...(req.body || {}) };
  await db.run(
    `UPDATE catalog_promotions SET
      name=?, description=?, status=?, discount_type=?, discount_value=?, priority=?, start_date=?, end_date=?,
      start_time=?, end_time=?, usage_limit=?, usage_limit_per_client=?, minimum_amount=?, maximum_discount=?,
      minimum_quantity=?, applies_to=?, product_ids=?, category_ids=?, variation_ids=?, excluded_product_ids=?,
      excluded_category_ids=?, excluded_variation_ids=?, colors=?, materials=?, stones=?, service_ids=?,
      buy_quantity=?, pay_quantity=?, fixed_promotional_price=?, is_stackable=?, stackable_with_coupon=?,
      badge=?, legal_text=?, visible_in_catalog=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [...promotionValues(body), req.params.id]
  );
  const updated = await db.get("SELECT * FROM catalog_promotions WHERE id = ?", [req.params.id]);
  await db.run("INSERT INTO promotion_audit_logs (promotion_id, user_id, action, previous_data, next_data) VALUES (?, ?, 'update', ?, ?)", [updated.id, req.user?.id || null, JSON.stringify(current), JSON.stringify(updated)]);
  res.json(updated);
}));

router.post("/api/promotions/:id/duplicate", withFeature("campaigns", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM catalog_promotions WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Promoção não encontrada." });
  const result = await db.run(
    `INSERT INTO catalog_promotions
      (name, description, status, discount_type, discount_value, priority, start_date, end_date, start_time, end_time,
       usage_limit, usage_limit_per_client, minimum_amount, maximum_discount, minimum_quantity, applies_to,
       product_ids, category_ids, variation_ids, excluded_product_ids, excluded_category_ids, excluded_variation_ids,
       colors, materials, stones, service_ids, buy_quantity, pay_quantity, fixed_promotional_price,
       is_stackable, stackable_with_coupon, badge, legal_text, visible_in_catalog, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    promotionValues({ ...current, name: `${current.name} (cópia)`, status: "paused", is_active: 0 })
  );
  res.status(201).json(await db.get("SELECT * FROM catalog_promotions WHERE id = ?", [result.returnedId]));
}));

router.delete("/api/promotions/:id", withFeature("campaigns", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM catalog_promotions WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Promoção não encontrada." });
  await db.run("UPDATE catalog_promotions SET status='ended', is_active=0, deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?", [req.params.id]);
  await db.run("INSERT INTO promotion_audit_logs (promotion_id, user_id, action, previous_data) VALUES (?, ?, 'delete', ?)", [current.id, req.user?.id || null, JSON.stringify(current)]);
  res.json({ ok: true });
}));

function promotionValues(body) {
  return [
    String(body.name || "").trim(), body.description || "", body.status || "active", body.discount_type || "percent",
    Number(body.discount_value || 0), Number(body.priority || 0), body.start_date || null, body.end_date || null,
    body.start_time || null, body.end_time || null, body.usage_limit || null, body.usage_limit_per_client || null,
    Number(body.minimum_amount || 0), body.maximum_discount || null, Number(body.minimum_quantity || 1),
    body.applies_to || "all", body.product_ids || "", body.category_ids || "", body.variation_ids || "",
    body.excluded_product_ids || "", body.excluded_category_ids || "", body.excluded_variation_ids || "",
    body.colors || "", body.materials || "", body.stones || "", body.service_ids || "", body.buy_quantity || null,
    body.pay_quantity || null, body.fixed_promotional_price || null, Number(Boolean(Number(body.is_stackable))),
    Number(Boolean(Number(body.stackable_with_coupon))), body.badge || "", body.legal_text || "",
    Number(body.visible_in_catalog ?? 1), Number(body.is_active ?? 1)
  ];
}

router.patch("/api/catalog-settings", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const allowed = ["title", "subtitle", "hero_title", "hero_subtitle", "hero_image_url", "categories", "whatsapp_phone", "whatsapp_message", "company_instagram", "company_email", "company_address", "company_hours", "layout_style"];
  const entries = Object.entries(req.body).filter(([key]) => allowed.includes(key));
  for (const [key, value] of entries) {
    const cleanValue = Array.isArray(value) ? value.filter(Boolean).join(",") : String(value || "");
    await db.run(
      "INSERT INTO catalog_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, cleanValue]
    );
  }
  const settings = await getCatalogSettings(db);
  res.json({ ...settings, categories: splitCatalogCategories(settings.categories) });
}));

export default router;
