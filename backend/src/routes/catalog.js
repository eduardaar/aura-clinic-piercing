// Rotas do catálogo online e sua personalização/administração.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { attachVariants } from "../services/inventory.js";
import { groupInventoryOptions, splitCatalogCategories } from "../services/utils.js";
import {
  getCatalogCustomization,
  getCatalogSettings,
  saveCatalogCustomization,
  resetCatalogCustomization
} from "../services/catalog.js";

const router = Router();

const asArray = (value) => (Array.isArray(value) ? value : []);

router.get("/api/catalog", withDb(async (_req, res, db) => {
  const customization = await getCatalogCustomization(db);
  const showOutOfStock = Boolean(Number(customization.theme.show_out_of_stock));
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
    .filter((item) => showOutOfStock || item.quantity > 0)
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
      thickness: item.thickness,
      sale_value: item.sale_value,
      quantity: item.quantity,
      variants: asArray(item.variants).map((v) => ({
        id: v.id,
        variation_name: v.variation_name,
        diameter: v.diameter,
        length: v.length,
        size: v.size,
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
        quantity: v.quantity || item.quantity
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

router.get("/api/catalog-customization", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const customization = await getCatalogCustomization(db);
  const products = await attachVariants(db, await db.all("SELECT * FROM jewelry_inventory ORDER BY name"));
  const options = await db.all("SELECT * FROM inventory_options ORDER BY type, name");
  res.json({ ...customization, products, inventoryOptions: groupInventoryOptions(options) });
}));

router.patch("/api/catalog-customization", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await saveCatalogCustomization(db, req.body || {});
  res.json(await getCatalogCustomization(db));
}));

router.post("/api/catalog-customization/publish", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await saveCatalogCustomization(db, req.body || {});
  res.json({ ok: true, published_at: new Date().toISOString(), ...(await getCatalogCustomization(db)) });
}));

router.post("/api/catalog-customization/reset", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  await resetCatalogCustomization(db);
  res.json(await getCatalogCustomization(db));
}));

router.get("/api/catalog-settings", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const settings = await getCatalogSettings(db);
  res.json({ ...settings, categories: splitCatalogCategories(settings.categories) });
}));

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
