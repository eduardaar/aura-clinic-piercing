// Rotas do catálogo online e sua personalização/administração.
import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { attachVariants } from "../services/inventory.js";
import { groupInventoryOptions, splitCatalogCategories } from "../services/utils.js";
import { validateCoupon } from "../services/discounts.js";
import { quotePromotions } from "../services/promotions.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { planLimit } from "../services/plans.js";
import { tenantSubscription } from "../services/subscriptions.js";
import { upload, parseUpload } from "../middleware/upload.js";
import {
  CatalogCustomizationError,
  getCatalogCustomization,
  getCatalogCustomizationChecklist,
  saveCatalogCustomization,
  resetCatalogCustomization,
  publishCatalogCustomization,
  listCatalogCustomizationHistory,
  getCatalogCustomizationRevision,
  rollbackCatalogCustomization
} from "../services/catalog.js";

const router = Router();

// Whitelists de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const COUPON_SORTABLE = {
  created_at: "c.created_at",
  code: "c.code",
  name: "c.internal_name",
  status: "c.status",
  discount: "c.discount_value",
  ends_at: "c.ends_at"
};

const PROMOTION_SORTABLE = {
  priority: "p.priority",
  created_at: "p.created_at",
  name: "p.name",
  status: "p.status",
  discount: "p.discount_value",
  start_date: "p.start_date",
  end_date: "p.end_date"
};

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

function catalogCustomizationError(res, error) {
  if (!(error instanceof CatalogCustomizationError)) throw error;
  return res.status(error.statusCode).json({
    error: error.message,
    code: error.code,
    ...(error.details || {})
  });
}

// O editor pode listar integrações, mas é o servidor que decide quais delas
// pertencem ao plano do tenant. A feature principal já foi checada por
// `withFeature`; esta lista detalha WhatsApp/agenda quando o snapshot muda.
async function catalogPluginAccess(req) {
  const subscription = await tenantSubscription(req.tenant?.id);
  return {
    enabledFeatures: Array.isArray(subscription?.features) ? subscription.features : [],
    pluginLimit: subscription?.plan_code ? planLimit(subscription.plan_code, "catalog_plugins") : null
  };
}

router.get("/api/catalog", withDb(async (_req, res, db) => {
  const customization = await getCatalogCustomization(db, { published: true });
  const featuredByProduct = new Map(
    asArray(customization.featuredProducts)
      .filter((product) => Number(product.is_active ?? 1) === 1)
      .map((product) => [Number(product.product_id), product])
  );
  const productRows = await db.all(`
    SELECT
      j.*
    FROM jewelry_inventory j
    WHERE j.is_catalog_active = 1 AND j.status != 'arquivado'
    ORDER BY j.category, j.name
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
      badge: featuredByProduct.get(Number(item.id))?.badge ||
        (item.is_promotion ? "Promoção" : item.is_last_units ? "Últimas unidades" : item.is_most_wanted ? "Mais desejado" : item.is_new ? "Lançamento" : item.is_featured ? "Destaque" : ""),
      is_featured: item.is_featured,
      is_new: item.is_new,
      is_promotion: item.is_promotion,
      is_last_units: item.is_last_units
      // Dados privados OCULTOS: cost_value, supplier, physical_location, notes, description, etc.
    }))
    .sort((a, b) => {
      const orderA = Number(featuredByProduct.get(Number(a.id))?.sort_order ?? 999999);
      const orderB = Number(featuredByProduct.get(Number(b.id))?.sort_order ?? 999999);
      return orderA - orderB || String(a.category || "").localeCompare(String(b.category || "")) || String(a.name || "").localeCompare(String(b.name || ""));
    });
  res.json({
    ...customization.settings,
    theme: customization.theme,
    banners: customization.banners,
    featuredCategories: customization.featuredCategories,
    featuredProducts: customization.featuredProducts,
    promotions: customization.promotions,
    catalogSections: customization.catalogSections,
    plugins: customization.plugins,
    // A vitrine precisa identificar a revisão publicada para métricas/cache,
    // mas nunca deve revelar o lock nem a data do rascunho de quem edita.
    version: {
      published: customization.version?.published || 0,
      revision_id: customization.version?.revision_id || null,
      published_at: customization.version?.published_at || null
    },
    categories: splitCatalogCategories(customization.settings.categories),
    items
  });
}));

router.get("/api/catalog-customization", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const customization = await getCatalogCustomization(db);
  const products = await attachVariants(db, await db.all("SELECT * FROM jewelry_inventory ORDER BY name"));
  const options = await db.all("SELECT * FROM inventory_options ORDER BY type, name");
  // A interface usa este resumo apenas para desabilitar escolhas que o
  // servidor também valida ao salvar. Nunca é uma autorização no cliente.
  const pluginAccess = await catalogPluginAccess(req);
  res.json({ ...customization, products, inventoryOptions: groupInventoryOptions(options), pluginAccess });
}));

// Biblioteca de imagens do editor. `withFeature` resolve o tenant e fixa o
// schema antes de acessar a tabela; a chave do objeto também leva o tenant,
// via `parseUpload(..., { category: 'catalog' })`.
router.get("/api/catalog-media", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const items = await db.all(
    "SELECT id, url, storage_key, original_name, mime_type, alt_text, created_at, updated_at FROM catalog_media_assets ORDER BY created_at DESC, id DESC"
  );
  res.json({ items });
}));

router.post("/api/catalog-media", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await parseUpload(upload.single("file"), req, res, { category: "catalog" });
  if (!req.file?.publicUrl || !req.file?.storageKey) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  const created = await db.run(
    `INSERT INTO catalog_media_assets (url, storage_key, original_name, mime_type, alt_text, created_by)
     VALUES (?, ?, ?, ?, '', ?)
     RETURNING id, url, storage_key, original_name, mime_type, alt_text, created_at, updated_at`,
    [
      req.file.publicUrl,
      req.file.storageKey,
      String(req.file.originalname || "").slice(0, 255),
      String(req.file.mimetype || "application/octet-stream").slice(0, 100),
      req.user?.id ?? null
    ]
  );
  res.status(201).json({ item: created.rows[0] });
}));

router.patch("/api/catalog-media/:id", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Mídia inválida." });
  const altText = String(req.body?.alt_text ?? "").replace(/\s+/g, " ").trim();
  if (altText.length > 500) return res.status(422).json({ error: "O texto alternativo aceita no máximo 500 caracteres.", code: "catalog_media_alt_text_too_long" });
  if (/[\x00-\x1F\x7F<>]/.test(altText)) return res.status(422).json({ error: "O texto alternativo deve ser texto simples.", code: "catalog_media_alt_text_invalid" });
  const updated = await db.run(
    `UPDATE catalog_media_assets SET alt_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
     RETURNING id, url, storage_key, original_name, mime_type, alt_text, created_at, updated_at`,
    [altText, id]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: "Mídia não encontrada." });
  res.json({ item: updated.rows[0] });
}));

// O checklist lê apenas o draft. Ele é útil para a interface avisar antes do
// clique em "Publicar" e não expõe nenhuma revisão ou asset de outro tenant.
router.get("/api/catalog-customization/checklist", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    res.json({ checklist: await getCatalogCustomizationChecklist(db) });
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

router.patch("/api/catalog-customization", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    await saveCatalogCustomization(db, req.body || {}, { userId: req.user?.id, ...await catalogPluginAccess(req) });
    res.json(await getCatalogCustomization(db));
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

router.post("/api/catalog-customization/publish", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    const published = await publishCatalogCustomization(db, req.body || {}, { userId: req.user?.id, ...await catalogPluginAccess(req) });
    const customization = await getCatalogCustomization(db);
    res.json({
      ok: true,
      published_at: published.revision.published_at,
      revision: published.revision,
      checklist: published.checklist,
      ...customization
    });
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

router.post("/api/catalog-customization/reset", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    await resetCatalogCustomization(db, req.body || {}, { userId: req.user?.id });
    res.json(await getCatalogCustomization(db));
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

router.get("/api/catalog-customization/history", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    res.json(await listCatalogCustomizationHistory(db, { limit: req.query.limit }));
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

router.get("/api/catalog-customization/history/:version", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    res.json({ revision: await getCatalogCustomizationRevision(db, req.params.version) });
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

router.post("/api/catalog-customization/rollback/:version", withFeature("public_catalog_customization", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    const rolledBack = await rollbackCatalogCustomization(db, req.params.version, req.body || {}, { userId: req.user?.id, ...await catalogPluginAccess(req) });
    const customization = await getCatalogCustomization(db);
    res.json({
      ok: true,
      restored_from_version: rolledBack.restored_from_version,
      published_at: rolledBack.revision.published_at,
      revision: rolledBack.revision,
      ...customization
    });
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

router.get("/api/catalog-settings", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const customization = await getCatalogCustomization(db);
  res.json({
    ...customization.settings,
    categories: splitCatalogCategories(customization.settings.categories),
    version: customization.version
  });
}));

router.get("/api/coupons", withFeature("coupons", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  // O cupom "apagado" continua fora da lista: é o filtro base, não um opcional.
  const clauses = ["c.deleted_at IS NULL"];
  const params = [];
  if (req.query.status) {
    clauses.push("c.status = ?");
    params.push(req.query.status);
  }
  if (req.query.from) {
    clauses.push("c.created_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("c.created_at <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  if (req.query.search) {
    clauses.push("(c.code ILIKE ? OR c.internal_name ILIKE ? OR c.description ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const paging = parsePaging(req.query, {
    sortable: COUPON_SORTABLE,
    tieBreak: "c.id",
    defaultOrderBy: "ORDER BY c.created_at DESC, c.id DESC"
  });
  const { rows, total } = await fetchPage(db, {
    select: `c.*,
      (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) AS usage_count,
      (SELECT COALESCE(SUM(discount_amount), 0) FROM coupon_usages u WHERE u.coupon_id = c.id) AS total_discount`,
    from: "coupons c",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows, total, paging));
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
  const clauses = ["p.deleted_at IS NULL"];
  const params = [];
  if (req.query.status) {
    clauses.push("p.status = ?");
    params.push(req.query.status);
  }
  // Período pela vigência da campanha: pega tudo que se sobrepõe ao intervalo.
  if (req.query.from) {
    clauses.push("(p.end_date IS NULL OR p.end_date >= ?)");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("(p.start_date IS NULL OR p.start_date <= ?)");
    params.push(req.query.to);
  }
  if (req.query.search) {
    clauses.push("(p.name ILIKE ? OR p.description ILIKE ? OR p.badge ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const paging = parsePaging(req.query, {
    sortable: PROMOTION_SORTABLE,
    tieBreak: "p.id",
    defaultOrderBy: "ORDER BY p.priority DESC, p.created_at DESC, p.id DESC"
  });
  const { rows, total } = await fetchPage(db, {
    select: `p.*,
      (SELECT COUNT(*) FROM promotion_usages u WHERE u.promotion_id = p.id) AS usage_count,
      (SELECT COALESCE(SUM(discount_amount), 0) FROM promotion_usages u WHERE u.promotion_id = p.id) AS total_discount`,
    from: "catalog_promotions p",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows, total, paging));
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
  try {
    await saveCatalogCustomization(db, {
      settings: Object.fromEntries(entries.map(([key, value]) => [key, Array.isArray(value) ? value.filter(Boolean).join(",") : String(value || "")])),
      expected_draft_version: req.body?.expected_draft_version
    }, { userId: req.user?.id, ...await catalogPluginAccess(req) });
    const customization = await getCatalogCustomization(db);
    res.json({
      ...customization.settings,
      categories: splitCatalogCategories(customization.settings.categories),
      version: customization.version
    });
  } catch (error) {
    catalogCustomizationError(res, error);
  }
}));

export default router;
