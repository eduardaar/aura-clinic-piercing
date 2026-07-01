// Serviços de estoque de joalherias: variações, SKUs, sincronização de inventário.
import {
  aggregateVariantStatus,
  variantStatus,
  buildVariationName
} from "./utils.js";

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
  const row = await db.get(
    "SELECT sku FROM jewelry_inventory WHERE sku LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefix}-%`]
  );
  const nextNumber = row?.sku
    ? Number(String(row.sku).split("-").pop()) + 1
    : 1;
  return `${prefix}-${String(nextNumber).padStart(3, "0")}`;
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
  return products.map((product) => {
    const productVariants = byProduct.get(product.id) || [];
    const quantity = productVariants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
    const saleValues = productVariants.map((variant) => Number(variant.sale_value || 0)).filter((value) => value > 0);
    const costValue = productVariants.reduce((sum, variant) => sum + Number(variant.cost_value || 0) * Number(variant.quantity || 0), 0);
    const unique = (field) => [...new Set(productVariants.map((variant) => variant[field]).filter(Boolean))].join(", ");
    return {
      ...product,
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

export async function replaceJewelryVariants(db, jewelryId, variants = []) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error("Cadastre ao menos uma variação para o produto.");
  }
  const current = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ?", [jewelryId]);
  const product = await db.get("SELECT sku, material, category, subcategory, name FROM jewelry_inventory WHERE id = ?", [jewelryId]);
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
    const sku = String(variant.sku || `${skuBase}-${String(index + 1).padStart(2, "0")}`).trim();
    const values = [
      sku,
      variant.variation_name || buildVariationName(variant),
      variant.material || "",
      variant.color || "",
      variant.stone_color || "",
      variant.side || "",
      variant.size || "",
      variant.thickness || "",
      variant.length || "",
      variant.diameter || "",
      variant.thread_type || "",
      variant.supplier || "",
      Number(variant.cost_value || 0),
      Number(variant.sale_value || 0),
      Number(variant.quantity || 0),
      Number(variant.low_stock_threshold || 5),
      variantStatus(variant.quantity, variant.low_stock_threshold),
      variant.is_active === false ? 0 : 1
    ];
    const existing = current.find((item) => Number(item.id) === Number(variant.id));
    if (existing) {
      await db.run(
        `UPDATE jewelry_variants
         SET sku = ?, variation_name = ?, material = ?, color = ?, stone_color = ?, side = ?, size = ?, thickness = ?, length = ?, diameter = ?,
             thread_type = ?, supplier = ?, cost_value = ?, sale_value = ?, quantity = ?, low_stock_threshold = ?,
             status = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND jewelry_id = ?`,
        [...values, existing.id, jewelryId]
      );
      retainedIds.push(existing.id);
    } else {
      const result = await db.run(
        `INSERT INTO jewelry_variants
         (jewelry_id, sku, variation_name, material, color, stone_color, side, size, thickness, length, diameter, thread_type, supplier,
          cost_value, sale_value, quantity, low_stock_threshold, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [jewelryId, ...values]
      );
      retainedIds.push(result.lastID);
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
  const quantity = variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
  const saleValues = variants.map((variant) => Number(variant.sale_value || 0)).filter((value) => value > 0);
  const costValues = variants.map((variant) => Number(variant.cost_value || 0)).filter((value) => value > 0);
  const first = variants[0] || {};
  await db.run(
    `UPDATE jewelry_inventory
     SET quantity = ?, sale_value = ?, cost_value = ?, material = ?, color = ?, size = ?, thickness = ?,
         stem_length = ?, thread_type = ?, supplier = ?, sku = ?, status = ?
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
      first.sku || `AURA-${jewelryId}`,
      aggregateVariantStatus(variants),
      jewelryId
    ]
  );
}
