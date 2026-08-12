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

  const results = [];
  for (const row of source.rows) {
    const measure = cleanMeasure(row.measure);
    const thickness = cleanMeasure(row.thickness);
    const desiredColor = colorClass(row.color || "Titânio Natural");
    const family = categoryClass(`${row.category} ${row.product}`);
    const ranked = variants.map((variant) => {
      const product = byProduct.get(Number(variant.jewelry_id));
      const variantMeasure = cleanMeasure(variant.length || variant.diameter || variant.size || variant.top_size_mm || "");
      const variantThickness = cleanMeasure(variant.thickness || "");
      const candidateColor = colorClass(variant.color || product?.color || "");
      const candidateFamily = categoryClass(`${product?.category || ""} ${product?.name || ""}`);
      const nameScore = overlap(row.product, `${product?.name || ""} ${variant.variation_name || ""}`);
      const measureOk = !measure || variantMeasure === measure || norm(variant.variation_name).replace(/\s/g, "").includes(measure);
      const thicknessOk = !thickness || variantThickness === thickness || norm(variant.variation_name).replace(/\s/g, "").includes(thickness);
      const colorOk = desiredColor === candidateColor || (desiredColor === "natural" && !candidateColor);
      const familyOk = family === candidateFamily || norm(product?.name).includes(norm(row.product).split(" ")[0]);
      const score = nameScore + (measureOk ? .3 : 0) + (thicknessOk ? .2 : 0) + (colorOk ? .2 : 0) + (familyOk ? .25 : 0);
      return { variant, product, score, measureOk, thicknessOk, colorOk, familyOk };
    }).filter((c) => c.measureOk && c.thicknessOk && c.colorOk && c.familyOk && c.score >= .55)
      .sort((a, b) => b.score - a.score || Number(a.variant.id) - Number(b.variant.id));

    const best = ranked[0]; const second = ranked[1];
    const unique = best && (!second || best.score - second.score >= .18);
    let action = "create_product_and_variant";
    let ambiguity = "";
    if (unique) action = "update_variant";
    else if (best) { action = "ambiguous"; ambiguity = `Mais de um candidato compatível (${ranked.slice(0, 5).map((c) => `${c.product.id}/${c.variant.id}`).join(", ")})`; }
    results.push({
      source_row: row.source_row, product: row.product, variation: [row.measure,row.thickness,row.color].join(" / "),
      current_quantity: unique ? Number(best.variant.quantity || 0) : null,
      physical_quantity: Number(row.quantity), difference: unique ? Number(row.quantity)-Number(best.variant.quantity || 0) : null,
      action, product_id: unique ? Number(best.product.id) : null, variant_id: unique ? Number(best.variant.id) : null,
      matched_product: unique ? best.product.name : null, matched_variant: unique ? best.variant.variation_name : null,
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
  const updateRows = results.filter((r) => r.action === "update_variant");
  const ambiguousRows = results.filter((r) => r.action === "ambiguous");
  const summary = {
    mode: "dry-run", tenant: tenant.slug, tenant_id: Number(tenant.id), schema,
    establishment: tenant.store_short_name || tenant.name, users,
    existing_products: products.length, existing_variants: variants.length,
    spreadsheet_variations: source.rows.length,
    spreadsheet_units: source.rows.reduce((s, r) => s + Number(r.quantity), 0),
    products_to_create: new Set(createRows.map((r) => norm(r.product))).size,
    variants_to_create: createRows.length,
    products_to_update: new Set(updateRows.map((r) => r.product_id)).size,
    variants_to_update: updateRows.length,
    variants_to_zero: results.filter((r) => r.physical_quantity === 0 && r.action !== "ambiguous").length,
    possible_duplicates_remaining: ambiguousRows.length,
    unresolved_ambiguities: ambiguousRows.length,
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
