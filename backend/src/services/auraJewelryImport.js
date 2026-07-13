import { AURA_JEWELRY_CATEGORIES, AURA_JEWELRY_SEED } from "../data/auraJewelrySeed.js";

const CATEGORY_CODES = {
  "Labret": "LAB",
  "Segmento": "SEG",
  "Argola": "ARG",
  "Conector": "CON",
  "Barbell Reto": "BRE",
  "Barbell Curvo": "BCU",
  "Topo": "TOP",
  "Microdermal": "MDR",
  "Transversal": "TRA"
};

export function normalizeSeedText(value, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

export function stockStatus(quantity, minimum = 3) {
  const stock = Number(quantity || 0);
  const min = Math.max(0, Number(minimum || 0));
  if (stock <= 0) return "esgotado";
  if (stock <= min) return "crítico";
  if (stock <= min * 2) return "baixo estoque";
  return "disponível";
}

export function commercialDescription(item = {}) {
  const material = normalizeSeedText(item.material);
  const stone = normalizeSeedText(item.stone);
  if (stone && stone !== "Sem pedra") {
    return `Joia em ${material.toLowerCase()} com detalhe em ${stone.toLowerCase()}, acabamento delicado e rosca interna. Consulte compatibilidade antes da aplicação.`;
  }
  if (material === "Aço") {
    return "Joia em aço, com acabamento prata e rosca interna. Consulte compatibilidade de medida e região antes da aplicação.";
  }
  return `Joia em ${material.toLowerCase()}, com rosca interna, indicada para uso profissional em piercing. Consulte compatibilidade de medida e região antes da aplicação.`;
}

export function variantLabel(item = {}) {
  const measure = item.length
    ? item.length
    : item.diameter
      ? item.diameter
      : item.size || "Não se aplica";
  const detail = item.stone ? ` com ${item.stone}` : "";
  return `${item.product}${detail} em ${item.material} ${item.color || "Sem cor informada"} — ${measure}`;
}

export function productImportKey(item = {}) {
  return [
    normalizeSeedText(item.category),
    normalizeSeedText(item.product),
    normalizeSeedText(item.material),
    normalizeSeedText(item.stone, "Sem pedra")
  ].join("|").toLowerCase();
}

export function variantImportKey(item = {}) {
  return [
    productImportKey(item),
    normalizeSeedText(item.color, "Sem cor informada"),
    normalizeSeedText(item.thickness),
    normalizeSeedText(item.length),
    normalizeSeedText(item.diameter),
    normalizeSeedText(item.size),
    normalizeSeedText(item.thread_type)
  ].join("|").toLowerCase();
}

function productSku(index, category) {
  const code = CATEGORY_CODES[category] || "JOI";
  return `AURA-${code}-${String(index).padStart(3, "0")}`;
}

async function ensureUniqueSku(db, base, table, excludeId = null) {
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const suffix = attempt ? `-${String(attempt + 1).padStart(2, "0")}` : "";
    const candidate = `${base}${suffix}`;
    const row = excludeId
      ? await db.get(`SELECT id FROM ${table} WHERE sku = ? AND id != ?`, [candidate, excludeId])
      : await db.get(`SELECT id FROM ${table} WHERE sku = ?`, [candidate]);
    if (!row) return candidate;
  }
  throw new Error(`Não foi possível gerar SKU único para ${base}.`);
}

async function ensureCategoryOption(db, category, summary) {
  const existing = await db.get("SELECT id FROM inventory_options WHERE type = 'category' AND name = ?", [category]);
  if (existing) {
    summary.categoriesExisting += 1;
    return existing.id;
  }
  await db.run("INSERT INTO inventory_options (type, name) VALUES ('category', ?)", [category]);
  summary.categoriesCreated += 1;
  return null;
}

async function findProduct(db, key, item) {
  const rows = await db.all(
    "SELECT * FROM jewelry_inventory WHERE category = ? AND name = ? AND material = ? AND COALESCE(stone, '') = ? ORDER BY id LIMIT 1",
    [item.category, item.product, item.material, item.stone || ""]
  );
  return rows[0] || null;
}

async function upsertProduct(db, item, index, summary) {
  const existing = await findProduct(db, productImportKey(item), item);
  if (existing) {
    await db.run(
      `UPDATE jewelry_inventory
       SET low_stock_threshold = LEAST(COALESCE(low_stock_threshold, ?), ?),
           critical_stock_threshold = LEAST(COALESCE(critical_stock_threshold, ?), ?),
           is_catalog_active = CASE WHEN is_catalog_active IS NULL THEN 0 ELSE is_catalog_active END,
           is_published = CASE WHEN is_published IS NULL THEN 0 ELSE is_published END
       WHERE id = ?`,
      [item.low_stock_threshold, item.low_stock_threshold, item.low_stock_threshold, item.low_stock_threshold, existing.id]
    );
    if (!summary._seenExistingProducts.has(Number(existing.id))) {
      summary.productsExisting += 1;
      summary._seenExistingProducts.add(Number(existing.id));
    }
    return { ...existing, sku: existing.sku };
  }

  const sku = await ensureUniqueSku(db, productSku(index, item.category), "jewelry_inventory");
  const result = await db.run(
    `INSERT INTO jewelry_inventory
     (name, description, category, subcategory, material, color, stone, size, thickness, stem_length, thread_type,
      quantity, cost_value, sale_value, purchase_cost_cents, total_cost_cents, suggested_price_cents, sale_price_cents,
      supplier, sku, notes, status, low_stock_threshold, critical_stock_threshold, is_catalog_active, is_published,
      virtual_store_active, is_featured, is_new, is_most_wanted, is_promotion, is_last_units)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, '', ?, ?, 'esgotado', ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`,
    [
      item.product,
      commercialDescription(item),
      item.category,
      item.category,
      item.material,
      item.color || "Sem cor informada",
      item.stone || "",
      item.size || "",
      item.thickness || "",
      item.length || "",
      item.thread_type || "",
      sku,
      "Importação inicial Aura: pendente de preço e imagem.",
      item.low_stock_threshold,
      item.low_stock_threshold
    ]
  );
  summary.productsCreated += 1;
  summary.pendingPrice += 1;
  summary.pendingImage += 1;
  return { id: result.lastID, sku };
}

async function upsertVariant(db, product, item, index, summary) {
  const label = variantLabel(item);
  const existingVariants = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ?", [product.id]);
  const duplicate = existingVariants.find((variant) => variantImportKey({
    category: item.category,
    product: item.product,
    material: item.material,
    stone: item.stone,
    color: variant.color,
    thickness: variant.thickness,
    length: variant.length,
    diameter: variant.diameter,
    size: variant.size,
    thread_type: variant.thread_type
  }) === variantImportKey(item));

  const status = stockStatus(item.quantity, item.low_stock_threshold);
  if (duplicate) {
    await db.run(
      `UPDATE jewelry_variants
       SET quantity = ?, low_stock_threshold = ?, status = ?, is_active = 1
       WHERE id = ?`,
      [item.quantity, item.low_stock_threshold, status, duplicate.id]
    );
    summary.variantsExisting += 1;
    return duplicate;
  }

  const variantSku = await ensureUniqueSku(db, `${product.sku}-${String(index).padStart(2, "0")}`, "jewelry_variants");
  const result = await db.run(
    `INSERT INTO jewelry_variants
     (jewelry_id, sku, variation_name, material, color, stone_color, side, size, thickness, length, length_mm, diameter,
      thread_type, supplier, cost_value, sale_value, purchase_cost_cents, total_cost_cents, suggested_price_cents,
      sale_price_cents, quantity, low_stock_threshold, status, is_active)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, '', 0, 0, 0, 0, 0, 0, ?, ?, ?, 1)`,
    [
      product.id,
      variantSku,
      label,
      item.material,
      item.color || "Sem cor informada",
      item.stone || "",
      item.size || "",
      item.thickness || "",
      item.length || "",
      parseFloat(String(item.length || "").replace(",", ".")) || null,
      item.diameter || "",
      item.thread_type || "",
      item.quantity,
      item.low_stock_threshold,
      status
    ]
  );
  summary.variantsCreated += 1;
  if (item.ambiguous) summary.ambiguousItems += 1;
  return { id: result.lastID, sku: variantSku };
}

async function syncImportedProduct(db, productId) {
  const variants = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1", [productId]);
  const quantity = variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
  const minimum = variants.reduce((min, variant) => Math.min(min, Number(variant.low_stock_threshold || 3)), 999) || 3;
  const first = variants[0] || {};
  await db.run(
    `UPDATE jewelry_inventory
     SET quantity = ?, status = ?, material = ?, color = ?, size = ?, thickness = ?, stem_length = ?, thread_type = ?,
         low_stock_threshold = ?, critical_stock_threshold = ?
     WHERE id = ?`,
    [
      quantity,
      stockStatus(quantity, minimum),
      first.material || "",
      first.color || "",
      first.size || "",
      first.thickness || "",
      first.length || "",
      first.thread_type || "",
      minimum,
      minimum,
      productId
    ]
  );
}

export async function importAuraJewelry(db, { logger = console } = {}) {
  const summary = {
    categoriesCreated: 0,
    categoriesExisting: 0,
    productsCreated: 0,
    productsExisting: 0,
    variantsCreated: 0,
    variantsExisting: 0,
    duplicatesIgnored: 0,
    ambiguousItems: 0,
    pendingPrice: 0,
    pendingImage: 0,
    _seenExistingProducts: new Set()
  };

  const seenVariants = new Set();
  const normalizedRows = AURA_JEWELRY_SEED.map((item) => ({
    ...item,
    category: normalizeSeedText(item.category),
    product: normalizeSeedText(item.product),
    material: normalizeSeedText(item.material),
    color: normalizeSeedText(item.color, "Sem cor informada"),
    stone: normalizeSeedText(item.stone),
    thread_type: normalizeSeedText(item.thread_type, "Interna"),
    low_stock_threshold: Number(item.low_stock_threshold || 3),
    quantity: Number(item.quantity || 0)
  })).filter((item) => {
    const key = variantImportKey(item);
    if (seenVariants.has(key)) {
      summary.duplicatesIgnored += 1;
      return false;
    }
    seenVariants.add(key);
    return true;
  });

  await db.run("BEGIN");
  try {
    for (const category of AURA_JEWELRY_CATEGORIES) {
      await ensureCategoryOption(db, category, summary);
    }

    const productIndexes = new Map();
    let productCounter = 1;
    const touchedProducts = new Set();
    for (const item of normalizedRows) {
      const key = productImportKey(item);
      if (!productIndexes.has(key)) productIndexes.set(key, productCounter++);
      const product = await upsertProduct(db, item, productIndexes.get(key), summary);
      touchedProducts.add(Number(product.id));
      const variantIndex = (await db.get("SELECT COUNT(*)::int AS total FROM jewelry_variants WHERE jewelry_id = ?", [product.id]))?.total + 1;
      await upsertVariant(db, product, item, variantIndex, summary);
    }

    for (const productId of touchedProducts) {
      await syncImportedProduct(db, productId);
    }

    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }

  const publicSummary = { ...summary };
  delete publicSummary._seenExistingProducts;
  logger.log?.("[import:aura-jewelry] resumo", publicSummary);
  return publicSummary;
}
