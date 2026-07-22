// Serviços de estoque de joalherias: variações, SKUs, sincronização de inventário.
import {
  aggregateVariantStatus,
  variantStatus,
  buildVariationName
} from "./utils.js";
import { calculatePricing, getPricingSettings, normalizeLengthValue } from "./pricing.js";

export class SkuConflictError extends Error {
  constructor(message = "SKU já cadastrado.") {
    super(message);
    this.name = "SkuConflictError";
    this.statusCode = 409;
  }
}

export function isUniqueViolation(error) {
  return error?.code === "23505";
}

export async function jewelrySkuExists(db, sku, excludeId = null) {
  const value = String(sku || "").trim();
  if (!value) return false;
  const row = excludeId
    ? await db.get("SELECT id FROM jewelry_inventory WHERE sku = ? AND id != ?", [value, excludeId])
    : await db.get("SELECT id FROM jewelry_inventory WHERE sku = ?", [value]);
  return Boolean(row);
}

async function variantSkuExists(db, sku, excludeId = null) {
  const value = String(sku || "").trim();
  if (!value) return false;
  const row = excludeId
    ? await db.get("SELECT id FROM jewelry_variants WHERE sku = ? AND id != ?", [value, excludeId])
    : await db.get("SELECT id FROM jewelry_variants WHERE sku = ?", [value]);
  return Boolean(row);
}

export async function generateSku(db, body = {}) {
  const normalize = (value = "") => String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const materialCode = {
    titanio: "TIT",
    titanioimplante: "TIT",
    titanioastmf136: "TIT",
    ouro14k: "G14",
    ouro18k: "G18",
    aco: "ACO",
    outro: "OUT"
  }[normalize(body.material)] || "JWL";

  const categorySource = body.subcategory || body.category || "";
  const categoryCode = {
    labret: "LAB",
    nostril: "NOS",
    clicker: "CLK",
    argola: "ARG",
    banana: "BAN",
    microdermal: "MDR",
    surface: "SRF",
    umbigo: "UMB",
    mamilo: "MAM",
    topo: "TOP",
    haste: "HST"
  }[normalize(categorySource)] || "GEN";

  const prefix = `${materialCode}-${categoryCode}`;
  const rows = await db.all(
    "SELECT sku FROM jewelry_inventory WHERE sku LIKE ?",
    [`${prefix}-%`]
  );
  const usedNumbers = rows
    .map((row) => Number(String(row.sku || "").split("-").pop()))
    .filter((number) => Number.isInteger(number) && number > 0);
  let nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const candidate = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
    if (!(await jewelrySkuExists(db, candidate))) return candidate;
    nextNumber += 1;
  }
  return `${prefix}-${Date.now()}`;
}

async function uniqueVariantSku(db, desiredSku, { excludeId = null, userProvided = false } = {}) {
  const desired = String(desiredSku || "").trim();
  if (!desired) throw new SkuConflictError();
  if (!(await variantSkuExists(db, desired, excludeId))) return desired;
  if (userProvided) throw new SkuConflictError("SKU já cadastrado.");

  const base = desired.replace(/-\d{2,3}$/, "");
  for (let index = 1; index <= 10000; index += 1) {
    const candidate = `${base}-${String(index).padStart(2, "0")}`;
    if (!(await variantSkuExists(db, candidate, excludeId))) return candidate;
  }
  throw new SkuConflictError();
}

export async function countOptionUsage(db, option) {
  const fieldByType = {
    category: "category",
    size: "size",
    thickness: "thickness"
  };
  const field = fieldByType[option.type];
  if (!field) return 0;
  const row = await db.get(`SELECT COUNT(*) AS count FROM jewelry_inventory WHERE ${field} = ?`, [option.name]);
  return row.count;
}

export async function attachVariants(db, products = []) {
  if (!products.length) return [];
  const ids = products.map((product) => Number(product.id)).filter(Boolean);
  const placeholders = ids.map(() => "?").join(", ");
  const variants = await db.all(
    `SELECT * FROM jewelry_variants
     WHERE jewelry_id IN (${placeholders}) AND is_active = 1
     ORDER BY jewelry_id, id`,
    ids
  );
  const byProduct = variants.reduce((map, variant) => {
    if (!map.has(variant.jewelry_id)) map.set(variant.jewelry_id, []);
    map.get(variant.jewelry_id).push(variant);
    return map;
  }, new Map());
  const images = await db.all(
    `SELECT * FROM product_images
     WHERE product_id IN (${placeholders})
     ORDER BY product_id, variation_id NULLS FIRST, sort_order, id`,
    ids
  ).catch(() => []);
  const imagesByProduct = images.reduce((map, image) => {
    if (!image.variation_id) {
      if (!map.has(image.product_id)) map.set(image.product_id, []);
      map.get(image.product_id).push(image);
    }
    return map;
  }, new Map());
  const imagesByVariant = images.reduce((map, image) => {
    if (image.variation_id) {
      if (!map.has(image.variation_id)) map.set(image.variation_id, []);
      map.get(image.variation_id).push(image);
    }
    return map;
  }, new Map());
  return products.map((product) => {
    const productImages = imagesByProduct.get(product.id) || [];
    const primaryImage = productImages.find((image) => Number(image.is_primary)) || productImages[0] || null;
    const productVariants = (byProduct.get(product.id) || []).map((variant) => {
      const variantImages = imagesByVariant.get(variant.id) || [];
      return {
        ...variant,
        images: variantImages,
        image_url: variantImages.find((image) => Number(image.is_primary))?.image_url || variantImages[0]?.image_url || primaryImage?.image_url || product.image_url || product.photo_url
      };
    });
    const quantity = productVariants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
    const saleValues = productVariants.map((variant) => Number(variant.sale_value || 0)).filter((value) => value > 0);
    const costValue = productVariants.reduce((sum, variant) => sum + Number(variant.cost_value || 0) * Number(variant.quantity || 0), 0);
    const unique = (field) => [...new Set(productVariants.map((variant) => variant[field]).filter(Boolean))].join(", ");
    return {
      ...product,
      images: productImages,
      image_url: primaryImage?.image_url || product.image_url || product.photo_url,
      photo_url: primaryImage?.image_url || product.photo_url || product.image_url,
      gallery_urls: productImages.length ? JSON.stringify(productImages.map((image) => image.image_url)) : product.gallery_urls,
      variants: productVariants,
      variant_count: productVariants.length,
      quantity,
      sale_value: saleValues.length ? Math.min(...saleValues) : Number(product.sale_value || 0),
      cost_value: quantity ? costValue / quantity : Number(product.cost_value || 0),
      material: unique("material") || product.material,
      color: unique("color") || product.color,
      size: unique("size") || product.size,
      thickness: unique("thickness") || product.thickness,
      stem_length: unique("length") || product.stem_length,
      diameter: unique("diameter"),
      thread_type: unique("thread_type") || product.thread_type,
      supplier: unique("supplier") || product.supplier,
      status: product.status === "arquivado" ? "arquivado" : aggregateVariantStatus(productVariants)
    };
  });
}

function normalizeImageInput(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return input.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

export async function syncProductImages(db, productId, imagesInput = [], { variationId = null } = {}) {
  const seen = new Set();
  const images = normalizeImageInput(imagesInput)
    .map((item, index) => typeof item === "string" ? { image_url: item, sort_order: index + 1, is_primary: index === 0 } : item)
    .filter((item) => {
      const url = String(item?.image_url || item?.url || "").trim();
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((item, index) => ({
      image_url: String(item.image_url || item.url).trim(),
      storage_key: item.storage_key || "",
      alt_text: item.alt_text || "",
      sort_order: Number(item.sort_order || index + 1),
      is_primary: index === 0 ? 1 : Number(item.is_primary || 0)
    }));

  if (!images.some((image) => Number(image.is_primary)) && images[0]) images[0].is_primary = 1;

  await db.run(
    variationId
      ? "DELETE FROM product_images WHERE product_id = ? AND variation_id = ?"
      : "DELETE FROM product_images WHERE product_id = ? AND variation_id IS NULL",
    variationId ? [productId, variationId] : [productId]
  );
  for (const image of images) {
    await db.run(
      `INSERT INTO product_images (product_id, variation_id, image_url, storage_key, alt_text, sort_order, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, variationId, image.image_url, image.storage_key, image.alt_text, image.sort_order, image.is_primary]
    );
  }
  return images;
}

export function stockAlertLevel(item = {}) {
  const quantity = Number(item.quantity || 0);
  const criticalThreshold = Number(item.critical_stock_threshold ?? item.low_stock_threshold ?? 2);
  if (quantity <= 0) return "Esgotado";
  if (quantity <= criticalThreshold) return "Crítico";
  return "Acabando";
}

export function stockAlertPriority(item = {}) {
  const quantity = Number(item.quantity || 0);
  const criticalThreshold = Number(item.critical_stock_threshold ?? item.low_stock_threshold ?? 2);
  if (quantity <= 0 || quantity <= criticalThreshold) return "high";
  return "medium";
}

export async function listCriticalStockItems(db, { limit = 12 } = {}) {
  const rawProducts = await db.all(`
    SELECT *
    FROM jewelry_inventory
    WHERE status != 'arquivado'
    ORDER BY name
  `);
  const rawById = new Map(rawProducts.map((item) => [Number(item.id), item]));
  const products = await attachVariants(db, rawProducts);
  return products
    .map((item) => {
      const raw = rawById.get(Number(item.id)) || {};
      const aggregateQuantity = Number(item.quantity || 0);
      const rawQuantity = Number(raw.quantity || 0);
      const effectiveQuantity = item.variant_count ? Math.min(aggregateQuantity, rawQuantity) : rawQuantity;
      return { ...item, quantity: effectiveQuantity };
    })
    .filter((item) => Number(item.quantity || 0) <= Number(item.low_stock_threshold ?? 5))
    .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0) || String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      alert_level: stockAlertLevel(item),
      priority: stockAlertPriority(item)
    }));
}

export async function replaceJewelryVariants(db, jewelryId, variants = []) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error("Cadastre ao menos uma variação para o produto.");
  }
  const current = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ?", [jewelryId]);
  const product = await db.get("SELECT sku, material, category, subcategory, name FROM jewelry_inventory WHERE id = ?", [jewelryId]);
  const pricingSettings = await getPricingSettings(db);
  const manuallyEditedSkus = variants
    .filter((variant) => Boolean(variant?.sku_manually_edited))
    .map((variant) => String(variant?.sku || "").trim())
    .filter(Boolean);
  if (new Set(manuallyEditedSkus).size !== manuallyEditedSkus.length) {
    throw new SkuConflictError("SKU já cadastrado.");
  }
  const suppliedSku = variants.map((variant) => String(variant?.sku || "").trim()).find(Boolean);
  const existingSku = current.map((variant) => String(variant.sku || "").trim()).find(Boolean);
  const productSku = String(product?.sku || "").trim();
  const skuBase = (existingSku || suppliedSku || productSku || await generateSku(db, {
    ...product,
    material: variants[0]?.material || product?.material
  })).replace(/-\d{2,3}$/, "");
  const retainedIds = [];
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index] || {};
    const existing = current.find((item) => Number(item.id) === Number(variant.id));
    const requestedSku = String(variant.sku || "").trim();
    const manualSku = Boolean(variant.sku_manually_edited) && requestedSku && requestedSku !== String(existing?.sku || "").trim();
    const sku = await uniqueVariantSku(db, requestedSku || `${skuBase}-${String(index + 1).padStart(2, "0")}`, {
      excludeId: existing?.id || null,
      userProvided: manualSku
    });
    const normalizedLength = normalizeLengthValue(variant.length);
    const pricing = calculatePricing(variant, pricingSettings);
    const values = [
      sku,
      variant.variation_name || buildVariationName(variant),
      variant.material || "",
      variant.color || "",
      variant.stone_color || "",
      variant.side || "",
      variant.size || "",
      variant.top_size_mm === "" || variant.top_size_mm == null ? null : Number(variant.top_size_mm),
      variant.thickness || "",
      normalizedLength.length,
      normalizedLength.length_mm,
      variant.diameter || "",
      variant.thread_type || "",
      variant.supplier || "",
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
      Number(variant.quantity || 0),
      Number(variant.low_stock_threshold || 5),
      variantStatus(variant.quantity, variant.low_stock_threshold),
      variant.is_active === false ? 0 : 1
    ];
    if (existing) {
      await db.run(
        `UPDATE jewelry_variants
         SET sku = ?, variation_name = ?, material = ?, color = ?, stone_color = ?, side = ?, size = ?, top_size_mm = ?, thickness = ?, length = ?, length_mm = ?, diameter = ?,
             thread_type = ?, supplier = ?, cost_value = ?, sale_value = ?, purchase_cost_cents = ?, allocated_freight_cents = ?,
             additional_cost_cents = ?, total_cost_cents = ?, price_multiplier = ?, price_rounding_mode = ?, suggested_price_cents = ?,
             sale_price_cents = ?, price_manually_overridden = ?, cost_estimated = ?, quantity = ?, low_stock_threshold = ?,
             status = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND jewelry_id = ?`,
        [...values, existing.id, jewelryId]
      );
      retainedIds.push(existing.id);
      if ("images" in variant || "gallery_urls" in variant || "image_url" in variant || "photo_url" in variant) {
        await syncProductImages(db, jewelryId, variant.images || variant.gallery_urls || [variant.image_url || variant.photo_url].filter(Boolean), { variationId: existing.id });
      }
    } else {
      const result = await db.run(
        `INSERT INTO jewelry_variants
         (jewelry_id, sku, variation_name, material, color, stone_color, side, size, top_size_mm, thickness, length, length_mm, diameter, thread_type, supplier,
          cost_value, sale_value, purchase_cost_cents, allocated_freight_cents, additional_cost_cents, total_cost_cents, price_multiplier,
          price_rounding_mode, suggested_price_cents, sale_price_cents, price_manually_overridden, cost_estimated, quantity, low_stock_threshold, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [jewelryId, ...values]
      );
      retainedIds.push(result.lastID);
      await syncProductImages(db, jewelryId, variant.images || variant.gallery_urls || [variant.image_url || variant.photo_url].filter(Boolean), { variationId: result.lastID });
    }
  }
  for (const variant of current.filter((item) => !retainedIds.includes(item.id))) {
    const used = await db.get(
      `SELECT
        (SELECT COUNT(*) FROM stock_movements WHERE variant_id = ?) +
        (SELECT COUNT(*) FROM appointments WHERE jewelry_variant_id = ?) +
        (SELECT COUNT(*) FROM sales_order_items WHERE product_variant_id = ?) AS count`,
      [variant.id, variant.id, variant.id]
    );
    if (Number(used.count || 0) > 0) {
      await db.run("UPDATE jewelry_variants SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [variant.id]);
    } else {
      await db.run("DELETE FROM jewelry_variants WHERE id = ?", [variant.id]);
    }
  }
  await syncProductInventory(db, jewelryId);
}

export async function syncProductInventory(db, jewelryId) {
  const variants = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1", [jewelryId]);
  const product = await db.get("SELECT sku FROM jewelry_inventory WHERE id = ?", [jewelryId]);
  const quantity = variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
  const saleValues = variants.map((variant) => Number(variant.sale_value || 0)).filter((value) => value > 0);
  const costValues = variants.map((variant) => Number(variant.cost_value || 0)).filter((value) => value > 0);
  const first = variants[0] || {};
  const cheapest = variants
    .filter((variant) => Number(variant.sale_price_cents || variant.sale_value || 0) > 0)
    .sort((a, b) => Number(a.sale_price_cents || Math.round(Number(a.sale_value || 0) * 100) || 0) - Number(b.sale_price_cents || Math.round(Number(b.sale_value || 0) * 100) || 0))[0] || first;
  await db.run(
    `UPDATE jewelry_inventory
     SET quantity = ?, sale_value = ?, cost_value = ?, material = ?, color = ?, size = ?, thickness = ?,
         stem_length = ?, thread_type = ?, supplier = ?, sku = ?, status = ?, purchase_cost_cents = ?,
         allocated_freight_cents = ?, additional_cost_cents = ?, total_cost_cents = ?, price_multiplier = ?,
         price_rounding_mode = ?, suggested_price_cents = ?, sale_price_cents = ?, price_manually_overridden = ?, cost_estimated = ?
     WHERE id = ?`,
    [
      quantity,
      saleValues.length ? Math.min(...saleValues) : 0,
      costValues.length ? Math.min(...costValues) : 0,
      first.material || "",
      first.color || "",
      first.size || "",
      first.thickness || "",
      first.length || "",
      first.thread_type || "",
      first.supplier || "",
      product?.sku || first.sku || `AURA-${jewelryId}`,
      aggregateVariantStatus(variants),
      Number(cheapest.purchase_cost_cents || 0),
      Number(cheapest.allocated_freight_cents || 0),
      Number(cheapest.additional_cost_cents || 0),
      Number(cheapest.total_cost_cents || 0),
      Number(cheapest.price_multiplier || 3),
      cheapest.price_rounding_mode || "exact",
      Number(cheapest.suggested_price_cents || 0),
      Number(cheapest.sale_price_cents || 0),
      Number(cheapest.price_manually_overridden || 0),
      Number(cheapest.cost_estimated || 0),
      jewelryId
    ]
  );
}
