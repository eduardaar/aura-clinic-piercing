import fs from "node:fs/promises";
import { pool } from "../src/database/connection.js";

const dataPath = process.argv.find((arg) => arg.startsWith("--data="))?.slice(7)
  || "/app/scripts/physical-inventory-2026-08-12.json";
const source = JSON.parse(await fs.readFile(dataPath, "utf8"));

function norm(value = "") {
  return String(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replaceAll("�", " ").replaceAll(String.fromCharCode(0x13), " ")
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
  const setResult = (sourceRow, patch) => Object.assign(results.find((r) => r.source_row === sourceRow), patch);
  const existing = (sourceRow, productId, variantId, productName, variantName, currentQuantity, note = "") => setResult(sourceRow, {
    action: "update_variant", product_id: productId, variant_id: variantId, matched_product: productName,
    matched_variant: variantName, current_quantity: currentQuantity,
    difference: Number(results.find((r) => r.source_row === sourceRow).physical_quantity) - Number(currentQuantity), ambiguity: "", notes: note,
  });
  const newVariant = (sourceRow, productId, productName, note = "") => setResult(sourceRow, {
    action: "create_variant", product_id: productId, variant_id: null, matched_product: productName,
    matched_variant: null, current_quantity: null, difference: null, ambiguity: "", notes: note,
  });
  const newProduct = (sourceRow, note = "") => setResult(sourceRow, {
    action: "create_product_and_variant", product_id: null, variant_id: null, matched_product: null,
    matched_variant: null, current_quantity: null, difference: null, ambiguity: "", notes: note,
  });
  const human = (sourceRow, note) => setResult(sourceRow, {
    action: "ambiguous", product_id: null, variant_id: null, matched_product: null,
    matched_variant: null, current_quantity: null, difference: null, ambiguity: note,
  });

  // Decisões técnicas confirmadas após revisão humana do primeiro relatório.
  // Ferradura: duas linhas físicas, uma única atualização final (3 unidades).
  existing(65, 84, 104, "Ferradura Clássica Em Titânio Grau Implante", "Ferradura 8mm", 5, "Quantidade consolidada: 2 completas + 1 somente haste; estoque final 3.");
  setResult(65, { physical_quantity: 3, difference: -2 });
  setResult(66, { action: "update_variant", product_id: 84, variant_id: 104, matched_product: "Ferradura Clássica Em Titânio Grau Implante", matched_variant: "Ferradura 8mm", current_quantity: null, physical_quantity: null, difference: null, ambiguity: "", notes: "Linha consolidada na linha 65; não gera atualização independente." });

  existing(83, 15, 28, "Ponto de Luz", "Topo 2.0mm", 5, "Tamanho do topo 2,0 mm; compatibilidade 1,2 mm.");
  existing(84, 15, 29, "Ponto de Luz", "Topo 2.5mm", 4, "Tamanho do topo 2,5 mm; compatibilidade 1,2 mm.");
  existing(85, 15, 30, "Ponto de Luz", "Topo 3.0mm", 5, "Variação específica de topo 3,0 mm; estoque físico zero.");
  newProduct(105, "Anzol/Nostril ponto de luz é modelo distinto; nenhum produto específico inequívoco encontrado.");
  for (const row of [75, 77, 78, 100]) newProduct(row, "Modelo ornamental distinto de Ponto de Luz; nenhum cadastro específico inequívoco encontrado.");

  // Transversal: produto principal existente, mas a única variação atual é 1,6 mm.
  for (const row of [62, 63, 64]) newVariant(row, 37, "Industrial Barbell (scaffold) Em Titânio Grau Implante – Rosca Interna", "Criar variação 1,2 mm no produto Transversal existente; manter 30/32/34 mm como variações.");

  existing(16, 65, 83, "Argola Clicker Lateral Zircônia Em Titânio Grau Implante", "Variação 1", 0, "Modelo lateral, 8 mm, 1,2 mm, titânio compatíveis.");
  existing(27, 23, 39, "Argola Clicker Ondulada com Zircônias – Titânio Grau Implante", "Variação 2", 1, "Torcida/ondulada, 10 mm, 1,2 mm e zircônias compatíveis.");
  newVariant(28, 65, "Argola Clicker Lateral Zircônia Em Titânio Grau Implante", "Modelo lateral compatível; criar medida 12 mm.");
  newProduct(25, "Segmento coração cravejado é formato ornamental próprio; nenhum cadastro equivalente inequívoco.");
  newProduct(26, "Composição especial de zircônias não corresponde inequivocamente aos clickers genéricos.");
  human(29, "Segmento cravejado genérico 8 mm: mais de um desenho cadastrado tecnicamente compatível; requer identificação visual.");
  human(30, "Segmento cravejado genérico 10 mm: mais de um desenho cadastrado tecnicamente compatível; requer identificação visual.");

  human(10, "Labret 8 mm / 1,6 mm em Ouro: Trio, Lotus, Flor e Trinity são desenhos diferentes; imagens/descrições não identificam o modelo físico com segurança.");
  newProduct(38, "Candidato Produto 1 é 1,2 mm e rosca externa; incompatível com 14 mm / 1,6 mm / Push Pin.");

  newProduct(48, "Navel haste Push Pin: cadastros encontrados usam rosca interna; conflito crítico de encaixe.");
  newProduct(49, "Navel completo topo 5 zircônias: nenhum modelo cadastrado descreve inequivocamente cinco zircônias e Push Pin.");
  human(50, "Navel básico cravejado sem comprimento/desenho suficiente; Crown e Halo são modelos distintos possíveis.");
  human(51, "Navel duplo pingente redondo pode lembrar Cascata Dupla, mas o formato redondo não está comprovado no cadastro.");
  human(52, "Navel básico cravejado circular pode lembrar Halo/Crown, mas o desenho não é inequívoco.");
  human(53, "Navel coração pingente duplo: existem Corações com Pingente e Corações em Cascata; requer identificação visual.");
  human(54, "Navel cravejado plano: nenhum cadastro comprova inequivocamente a construção plana.");
  newProduct(55, "Navel flor cravejado: nenhum produto Navel floral inequívoco encontrado.");
  existing(56, 46, 62, "Barbell Curvo Solar com Pedra Ônix Em Titânio Grau Implante – Rosca Interna", "Variação 1", 1, "Modelo Solar, pedra Ônix, 1,2 mm e titânio compatíveis.");
  human(57, "Navel opala azul com 4 zircônias: Navel Halo aceita opala, mas quatro zircônias e ausência de topo não estão comprovadas.");
  newProduct(58, "Barbell curvo de umbigo básico 1,6 mm: produtos genéricos existentes possuem modelo/material técnico divergente ou ornamentação específica.");
  newProduct(59, "Floating Navel ponto de luz 1,2 mm: Navels ponto de luz existentes são tradicionais e 1,6 mm; conflito crítico de construção/espessura.");

  // Recalcula duplicidades somente depois das decisões explícitas. Linhas consolidadas
  // de Ferradura são a única repetição intencional e não representam duas escritas.
  const finalVariantRows = new Map();
  for (const r of results.filter((item) => item.action === "update_variant" && item.variant_id && item.source_row !== 66)) {
    const prior = finalVariantRows.get(r.variant_id);
    if (prior) { human(prior.source_row, `A mesma variação ${r.variant_id} recebeu linhas independentes ${prior.source_row} e ${r.source_row}.`); human(r.source_row, `A mesma variação ${r.variant_id} recebeu linhas independentes ${prior.source_row} e ${r.source_row}.`); }
    else finalVariantRows.set(r.variant_id, r);
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
    variants_to_zero: source.rows.filter((r) => Number(r.quantity) === 0).length,
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
