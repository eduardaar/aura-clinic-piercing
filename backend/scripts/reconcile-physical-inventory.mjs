import fs from "node:fs/promises";
import { pool } from "../src/database/connection.js";

const dataPath = process.argv.find((arg) => arg.startsWith("--data="))?.slice(7)
  || "/app/scripts/physical-inventory-2026-08-12.json";
const source = JSON.parse(await fs.readFile(dataPath, "utf8"));

function norm(value = "") {
  return String(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/�|\x13/g, " ")
    .replace(/barbel\b/g, "barbell").replace(/labrer\b/g, "labret")
    .replace(/d[ -]?ring/g, "dring").replace(/naver\b/g, "navel")
    .replace(/trasnversal/g, "transversal")
    .replace(/\b(prata|natural|titanio natural)\b/g, "natural")
    .replace(/\bgold\b/g, "dourado")
    .replace(/(\d)\.(\d)/g, "$1,$2")
    .replace(/[^a-z0-9,]+/g, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set(["em", "de", "da", "do", "com", "para", "titanio", "grau", "implante", "rosca", "interna", "basico", "basica"]);
const tokens = (value) => new Set(norm(value).split(" ").filter((t) => t && !STOP.has(t) && !/^\d/.test(t)));
const overlap = (a, b) => {
  const aa = tokens(a); const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0; for (const item of aa) if (bb.has(item)) common += 1;
  return common / Math.max(aa.size, bb.size);
};
const cleanMeasure = (value) => {
  const n = norm(value);
  return /nao informado|nao aplicavel/.test(n) ? "" : n.replace(/\s/g, "");
};
const requestedMeasure = (row) => cleanMeasure(row.measure).replace(/^topo/, "");
const colorClass = (value) => {
  const n = norm(value);
  if (/dourado/.test(n)) return "dourado";
  if (/rose|rose gold|rosegold/.test(n)) return "rose gold";
  if (/ouro/.test(n) && !/dourado/.test(n)) return "ouro";
  if (/natural|sem cor/.test(n)) return "natural";
  return n;
};
const categoryClass = (value) => {
  const n = norm(value);
  if (/labret/.test(n)) return "labret";
  if (/segment|argola|clicker|dring|ferradura/.test(n)) return "argola";
  if (/barbell reto|mamilo|transversal/.test(n)) return "barbell reto";
  if (/barbell curvo|umbigo|navel/.test(n)) return "barbell curvo";
  if (/topo|bolinha/.test(n)) return "topo";
  if (/taper|conector/.test(n)) return "conector";
  if (/microdermal|surface/.test(n)) return "microdermal";
  return n;
};

const client = await pool.connect();
try {
  const tenantResult = await client.query(
    "SELECT id, name, slug, store_short_name, responsible_name FROM platform.tenants WHERE slug=$1",
    [source.tenant_slug],
  );
  const tenant = tenantResult.rows[0];
  if (!tenant || Number(tenant.id) !== Number(source.tenant_id)) throw new Error("Tenant não corresponde ao id confirmado.");
  const schema = `tenant_${tenant.id}`;
  if (schema !== source.schema || schema !== "tenant_2") throw new Error("Schema diferente de tenant_2.");
  await client.query(`SET search_path TO "${schema}"`);
  const users = (await client.query("SELECT id,name,email,role FROM users ORDER BY id")).rows;
  const products = (await client.query("SELECT * FROM jewelry_inventory ORDER BY id")).rows;
  const variants = (await client.query("SELECT * FROM jewelry_variants ORDER BY id")).rows;
  const byProduct = new Map(products.map((p) => [Number(p.id), p]));

  const genericProductAliases = new Map([
    ["labret", 10],
    ["segmento clicker basico", 12],
    ["segmento basico", 12],
    ["argola de aco", 4],
    ["dring liso", 8],
    ["dring cravejado", 83],
    ["barbell reto", 14],
    ["barbell curvo", 13],
    ["ferradura", 84],
    ["topo cravejado", 15],
    ["topo baguette safira", 6],
    ["topo safira imperial", 9],
  ]);

  function chooseProduct(row) {
    const rowName = norm(row.product).replace(/\//g, " ");
    const aliasId = genericProductAliases.get(rowName);
    if (aliasId && byProduct.has(aliasId)) return { product: byProduct.get(aliasId), confidence: "alias", candidates: [] };
    const sourceFamily = categoryClass(`${row.category} ${row.product}`);
    const ranked = products.map((product) => {
      const nameScore = overlap(row.product, product.name);
      const variantNameScore = Math.max(0, ...variants.filter((v) => Number(v.jewelry_id) === Number(product.id)).map((v) => overlap(row.product, v.variation_name)));
      const candidateFamily = categoryClass(`${product.category} ${product.name}`);
      let score = Math.max(nameScore, variantNameScore);
      if (sourceFamily === candidateFamily) score += .15;
      if (/^topo\b|^bolinha\b|cluster|pedra/.test(rowName) && /(topo|cluster|ponto de luz|bolinha|safira|opala|perola|zirk|zircon)/.test(norm(product.name))) score += .12;
      if (/navel|umbigo/.test(rowName) && /navel|umbigo|barbell curvo/.test(norm(product.name))) score += .12;
      if (/clicker|segmento|argola/.test(rowName) && /clicker|argola|dring/.test(norm(product.name))) score += .10;
      return { product, score };
    }).sort((a,b) => b.score-a.score || Number(a.product.id)-Number(b.product.id));
    const best = ranked[0]; const second = ranked[1];
    if (!best || best.score < .52) return { product: null, confidence: "new", candidates: ranked.slice(0,3) };
    if (second && best.score-second.score < .10) return { product: null, confidence: "ambiguous", candidates: ranked.slice(0,5) };
    return { product: best.product, confidence: "semantic", candidates: ranked.slice(0,3) };
  }

  function variantMeasures(variant) {
    return new Set([
      cleanMeasure(variant.length), cleanMeasure(variant.diameter), cleanMeasure(variant.size),
      variant.top_size_mm == null ? "" : cleanMeasure(`${variant.top_size_mm} mm`),
      ...Array.from(norm(variant.variation_name).matchAll(/\d+(?:,\d+)?\s*mm/g), (m) => cleanMeasure(m[0])),
    ].filter(Boolean));
  }

  const results = [];
  for (const row of source.rows) {
    const measure = requestedMeasure(row);
    const thickness = cleanMeasure(row.thickness);
    const desiredColor = colorClass(row.color || "Titânio Natural");
    const productMatch = chooseProduct(row);
    const product = productMatch.product;
    const ranked = product ? variants.filter((v) => Number(v.jewelry_id) === Number(product.id)).map((variant) => {
      const measureOk = !measure || variantMeasures(variant).has(measure);
      const thicknessOk = !thickness || cleanMeasure(variant.thickness) === thickness;
      const colorValues = norm(variant.color).split(",").map((v) => colorClass(v.trim())).filter(Boolean);
      const singularColorMatch = colorValues.length <= 1 && colorValues.includes(desiredColor);
      const colorOk = desiredColor === "natural" || singularColorMatch;
      return { variant, product, measureOk, thicknessOk, colorOk, score: (measureOk?1:0)+(thicknessOk?1:0)+(colorOk?1:0) };
    }).filter((c) => c.measureOk && c.thicknessOk && c.colorOk).sort((a,b) => Number(a.variant.id)-Number(b.variant.id)) : [];

    const best = ranked[0];
    const unique = ranked.length === 1;
    let action = product ? "create_variant" : "create_product_and_variant";
    let ambiguity = "";
    if (unique) action = "update_variant";
    else if (ranked.length > 1) { action = "ambiguous"; ambiguity = `Mais de uma variação técnica compatível (${ranked.slice(0, 5).map((c) => `${c.product.id}/${c.variant.id}`).join(", ")})`; }
    else if (productMatch.confidence === "ambiguous") { action = "ambiguous"; ambiguity = `Produto ambíguo (${productMatch.candidates.map((c) => `${c.product.id}:${c.product.name}`).join(" | ")})`; }
    results.push({
      source_row: row.source_row, product: row.product, variation: [row.measure,row.thickness,row.color].join(" / "),
      current_quantity: unique ? Number(best.variant.quantity || 0) : null,
      physical_quantity: Number(row.quantity), difference: unique ? Number(row.quantity)-Number(best.variant.quantity || 0) : null,
      action, product_id: product ? Number(product.id) : null, variant_id: unique ? Number(best.variant.id) : null,
      matched_product: product?.name || null, matched_variant: unique ? best.variant.variation_name : null,
      ambiguity, notes: row.notes,
    });
  }
  const duplicateKeys = new Map();
  for (const r of results) {
    if (!r.variant_id) continue;
    duplicateKeys.set(r.variant_id, [...(duplicateKeys.get(r.variant_id) || []), r.source_row]);
  }
  for (const [variantId, rows] of duplicateKeys) if (rows.length > 1) {
    for (const r of results.filter((item) => item.variant_id === variantId)) { r.action = "ambiguous"; r.ambiguity = `Variação ${variantId} recebeu múltiplas linhas da planilha: ${rows.join(", ")}`; }
  }
  const createRows = results.filter((r) => r.action === "create_product_and_variant");
  const createVariantRows = results.filter((r) => r.action === "create_variant");
  const updateRows = results.filter((r) => r.action === "update_variant");
  const ambiguousRows = results.filter((r) => r.action === "ambiguous");
  const summary = {
    mode: "dry-run", tenant: tenant.slug, tenant_id: Number(tenant.id), schema,
    establishment: tenant.store_short_name || tenant.name, users,
    existing_products: products.length, existing_variants: variants.length,
    spreadsheet_variations: source.rows.length,
    spreadsheet_units: source.rows.reduce((s, r) => s + Number(r.quantity), 0),
    products_to_create: new Set(createRows.map((r) => norm(r.product))).size,
    variants_to_create: createRows.length + createVariantRows.length,
    new_variants_in_existing_products: createVariantRows.length,
    products_to_update: new Set(updateRows.map((r) => r.product_id)).size,
    variants_to_update: updateRows.length,
    variants_to_zero: results.filter((r) => r.physical_quantity === 0 && r.action !== "ambiguous").length,
    possible_duplicates_remaining: ambiguousRows.length,
    unresolved_ambiguities: ambiguousRows.length,
    classification_total: updateRows.length + createVariantRows.length + createRows.length + ambiguousRows.length,
    other_tenants_affected: 0,
  };
  console.log("AURA_DRY_RUN_BEGIN");
  console.log(JSON.stringify({
    summary,
    ambiguities: ambiguousRows,
    comparison: results,
    inventory_snapshot: products.map((product) => ({
      ...product,
      variants: variants.filter((variant) => Number(variant.jewelry_id) === Number(product.id)),
    })),
  }, null, 2));
  console.log("AURA_DRY_RUN_END");
} finally {
  await client.query("SET search_path TO public").catch(() => {});
  client.release();
  await pool.end();
}
