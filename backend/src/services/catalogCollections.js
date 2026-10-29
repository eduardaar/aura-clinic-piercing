// Vitrine comercial: categorias hierárquicas e campanhas temporárias.
//
// Produtos entram nas duas estruturas por relacionamento: nenhuma operação
// daqui cria, copia ou altera cadastro, SKU, variação, imagem ou estoque.
import { CLINIC_TIME_ZONE } from "./utils.js";
import { calculatePromotionDiscount, isPromotionActive, promotionMatchesItem } from "./promotions.js";

export class CatalogCollectionError extends Error {
  constructor(message, statusCode = 400, code = "catalog_collection_invalid", details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const fail = (message, statusCode = 400, code, details) => {
  throw new CatalogCollectionError(message, statusCode, code, details);
};

export function slugifyText(value, max = 80) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

const comparableName = (value) => slugifyText(value, 200);
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function cleanText(value, max) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return ["1", "true", "sim", "on"].includes(value.toLowerCase());
  return Boolean(Number(value) || value === true);
}

// Mesma origem dos uploads do painel: caminho local ou URL HTTPS do CDN.
function imageUrl(value, label) {
  const url = String(value || "").trim();
  if (url && !/^\/uploads\/[\w./-]+$/.test(url) && !/^https:\/\/[^\s"'<>]+$/i.test(url)) {
    fail(`${label} inválida. Envie a imagem pelo painel.`);
  }
  return url.slice(0, 1000);
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function idList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(positiveId).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export async function listCatalogCategories(db) {
  const rows = await db.all(`
    SELECT c.*,
      (SELECT COUNT(*)::int FROM catalog_category_products cp WHERE cp.category_id = c.id) AS product_count,
      (SELECT COUNT(*)::int FROM catalog_categories child WHERE child.parent_id = c.id) AS child_count
    FROM catalog_categories c
    ORDER BY c.sort_order, lower(c.name), c.id
  `);
  return withCategoryPaths(rows);
}

// Ordena em profundidade (pai, depois filhas) e acrescenta caminho e nível.
export function withCategoryPaths(rows = []) {
  const byParent = new Map();
  for (const row of rows) {
    const key = row.parent_id == null ? 0 : Number(row.parent_id);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  }
  const ordered = [];
  const visit = (parentId, path, depth) => {
    for (const row of byParent.get(parentId) || []) {
      const names = [...path, row.name];
      ordered.push({ ...row, depth, path: names.join(" › ") });
      visit(Number(row.id), names, depth + 1);
    }
  };
  visit(0, [], 0);
  return ordered;
}

async function categoryOrFail(db, id) {
  const category = await db.get("SELECT * FROM catalog_categories WHERE id = ?", [positiveId(id)]);
  if (!category) fail("Categoria não encontrada.", 404, "catalog_category_not_found");
  return category;
}

async function uniqueSlug(db, table, base, { excludeId = null, scopeColumn = null, scopeValue = null } = {}) {
  const exists = async (slug) => Boolean(await db.get(
    `SELECT id FROM ${table} WHERE slug = ?${excludeId ? " AND id <> ?" : ""}${scopeColumn ? ` AND ${scopeColumn} = ?` : ""}`,
    [slug, ...(excludeId ? [excludeId] : []), ...(scopeColumn ? [scopeValue] : [])]
  ));
  if (!(await exists(base))) return base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base.slice(0, 85)}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }
  fail("Não foi possível gerar um endereço único.", 409, "catalog_slug_conflict");
}

async function validateCategory(db, body, current = null) {
  const name = body.name !== undefined ? cleanText(body.name, 81) : current?.name;
  if (!name) fail("Informe o nome da categoria.");
  if (name.length > 80) fail("O nome da categoria deve ter até 80 caracteres.");

  let parentId = current?.parent_id ?? null;
  if (body.parent_id !== undefined) {
    parentId = body.parent_id === null || body.parent_id === "" ? null : positiveId(body.parent_id);
    if (body.parent_id !== null && body.parent_id !== "" && !parentId) fail("Categoria principal inválida.");
  }
  if (parentId) {
    await categoryOrFail(db, parentId);
    // Uma categoria não pode ficar dentro de si mesma nem de uma descendente.
    let cursor = parentId;
    const seen = new Set();
    while (cursor) {
      if (current && Number(cursor) === Number(current.id)) {
        fail("Uma categoria não pode ficar dentro dela mesma ou de uma subcategoria sua.", 409, "catalog_category_cycle");
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = (await db.get("SELECT parent_id FROM catalog_categories WHERE id = ?", [cursor]))?.parent_id ?? null;
    }
  }

  const siblings = await db.all(
    `SELECT id, name FROM catalog_categories WHERE ${parentId ? "parent_id = ?" : "parent_id IS NULL"}${current ? " AND id <> ?" : ""}`,
    [...(parentId ? [parentId] : []), ...(current ? [current.id] : [])]
  );
  if (siblings.some((sibling) => comparableName(sibling.name) === comparableName(name))) {
    fail(`Já existe "${name}" neste mesmo nível.`, 409, "catalog_category_duplicate");
  }

  let slug = current?.slug;
  if (body.slug !== undefined && String(body.slug || "").trim()) {
    slug = slugifyText(body.slug, 90);
    if (!SLUG_PATTERN.test(slug)) fail("Endereço inválido. Use letras, números e hífens.");
    const taken = await db.get("SELECT id FROM catalog_categories WHERE slug = ?" + (current ? " AND id <> ?" : ""), [slug, ...(current ? [current.id] : [])]);
    if (taken) fail("Este endereço já é usado por outra categoria.", 409, "catalog_slug_conflict");
  } else if (!slug || (body.name !== undefined && body.slug !== undefined)) {
    // Endereço automático: o nome; se já existir, o nome precedido do da categoria principal.
    let base = slugifyText(name, 90);
    if (!base) fail("Informe um nome com letras ou números.");
    if (parentId && (await db.get("SELECT id FROM catalog_categories WHERE slug = ?" + (current ? " AND id <> ?" : ""), [base, ...(current ? [current.id] : [])]))) {
      const parent = await db.get("SELECT slug FROM catalog_categories WHERE id = ?", [parentId]);
      base = slugifyText(`${parent.slug}-${base}`, 90);
    }
    slug = await uniqueSlug(db, "catalog_categories", base, { excludeId: current?.id || null });
  }

  return {
    name,
    parent_id: parentId,
    slug,
    description: body.description !== undefined ? cleanText(body.description, 600) : current?.description ?? "",
    image_url: body.image_url !== undefined ? imageUrl(body.image_url, "Imagem da categoria") : current?.image_url ?? "",
    image_alt: body.image_alt !== undefined ? cleanText(body.image_alt, 200) : current?.image_alt ?? "",
    is_active: body.is_active !== undefined ? booleanValue(body.is_active, true) : current ? Boolean(current.is_active) : true
  };
}

export async function createCatalogCategory(db, body = {}) {
  const values = await validateCategory(db, body);
  const order = body.sort_order !== undefined && Number.isInteger(Number(body.sort_order))
    ? Number(body.sort_order)
    : Number((await db.get(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM catalog_categories WHERE ${values.parent_id ? "parent_id = ?" : "parent_id IS NULL"}`,
      values.parent_id ? [values.parent_id] : []
    ))?.next || 0);
  const result = await db.run(
    `INSERT INTO catalog_categories (parent_id, name, slug, description, image_url, image_alt, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [values.parent_id, values.name, values.slug, values.description, values.image_url, values.image_alt, order, values.is_active]
  );
  return (await listCatalogCategories(db)).find((row) => Number(row.id) === Number(result.returnedId));
}

export async function updateCatalogCategory(db, id, body = {}) {
  const current = await categoryOrFail(db, id);
  const values = await validateCategory(db, body, current);
  await db.run(
    `UPDATE catalog_categories SET parent_id = ?, name = ?, slug = ?, description = ?, image_url = ?, image_alt = ?,
       is_active = ?, sort_order = ?, updated_at = now() WHERE id = ?`,
    [values.parent_id, values.name, values.slug, values.description, values.image_url, values.image_alt, values.is_active,
      body.sort_order !== undefined && Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : current.sort_order, current.id]
  );
  return { before: current, after: (await listCatalogCategories(db)).find((row) => Number(row.id) === Number(current.id)) };
}

// Reordena as irmãs de um mesmo nível na ordem recebida.
export async function reorderCatalogCategories(db, parentId, ids) {
  const parent = parentId === null || parentId === undefined || parentId === "" ? null : positiveId(parentId);
  const siblings = await db.all(`SELECT id FROM catalog_categories WHERE ${parent ? "parent_id = ?" : "parent_id IS NULL"}`, parent ? [parent] : []);
  const wanted = idList(ids);
  const siblingIds = siblings.map((row) => Number(row.id));
  if (wanted.length !== siblingIds.length || wanted.some((id) => !siblingIds.includes(id))) {
    fail("A nova ordem precisa conter exatamente as categorias deste nível.", 409, "catalog_category_order_mismatch");
  }
  for (const [index, id] of wanted.entries()) await db.run("UPDATE catalog_categories SET sort_order = ?, updated_at = now() WHERE id = ?", [index, id]);
}

export async function deleteCatalogCategory(db, id) {
  const category = await categoryOrFail(db, id);
  const usage = await db.get(`SELECT
      (SELECT COUNT(*)::int FROM catalog_categories WHERE parent_id = ?) AS child_count,
      (SELECT COUNT(*)::int FROM catalog_category_products WHERE category_id = ?) AS product_count`, [category.id, category.id]);
  if (usage.child_count > 0 || usage.product_count > 0) {
    fail(
      "A categoria tem subcategorias ou produtos. Mova ou remova os vínculos antes de excluir, ou oculte a categoria.",
      409, "catalog_category_in_use", usage
    );
  }
  await db.run("DELETE FROM catalog_categories WHERE id = ?", [category.id]);
  return category;
}

export async function listCategoryProducts(db, id) {
  const category = await categoryOrFail(db, id);
  const products = await db.all(`${PRODUCT_SUMMARY_SELECT}
    JOIN catalog_category_products cp ON cp.product_id = j.id AND cp.category_id = ?
    ORDER BY cp.sort_order, lower(j.name), j.id`, [category.id]);
  return { category, products: products.map(productSummary) };
}

async function existingProductIds(db, ids) {
  if (!ids.length) return [];
  const rows = await db.all(`SELECT id FROM jewelry_inventory WHERE id IN (${ids.map(() => "?").join(",")}) AND status != 'arquivado'`, ids);
  return rows.map((row) => Number(row.id));
}

export async function addCategoryProducts(db, id, productIds) {
  const category = await categoryOrFail(db, id);
  const ids = idList(productIds);
  if (!ids.length) fail("Selecione ao menos um produto.");
  const valid = await existingProductIds(db, ids);
  if (valid.length !== ids.length) fail("Um dos produtos não existe ou está arquivado.", 404, "catalog_product_not_found");
  let added = 0;
  for (const productId of valid) {
    const result = await db.run(
      "INSERT INTO catalog_category_products (category_id, product_id) VALUES (?, ?) ON CONFLICT (category_id, product_id) DO NOTHING",
      [category.id, productId]
    );
    added += Number(result.changes || 0);
  }
  return { added, already_linked: valid.length - added };
}

export async function removeCategoryProduct(db, id, productId) {
  const category = await categoryOrFail(db, id);
  const result = await db.run("DELETE FROM catalog_category_products WHERE category_id = ? AND product_id = ?", [category.id, positiveId(productId)]);
  return { removed: Number(result.changes || 0) };
}

// Estrutura inicial sugerida na especificação. Cria só o que falta: nada é
// renomeado, movido ou apagado, e rodar de novo não duplica.
export const SUGGESTED_CATEGORY_TREE = [
  ["Argolas", [
    ["Titânio", ["Titânio natural", "Titânio anodizado", "Modelos com pedras"]],
    ["Ouro", ["Ouro 14k", "Ouro 18k"]],
    ["Por mecanismo", ["Segmento", "Clicker", "Captive"]]
  ]],
  ["Labrets", [
    ["Por sistema de fixação", ["Rosca interna", "Rosca externa", "Push pin"]],
    ["Por material", ["Titânio", "Ouro"]],
    ["Por aplicação", ["Nostril", "Helix", "Tragus", "Lóbulo"]]
  ]],
  ["Topos", [["Por formato", []], ["Por pedra", []], ["Por tamanho", []], ["Por sistema de fixação", []], ["Por material", []]]],
  ["Ouro", []],
  ["Insumos", [
    ["Agulhas e descartáveis", []], ["Materiais de biossegurança", []], ["Gaze e cotonetes", []],
    ["Produtos para montagem de kits", []], ["Ferramentas e acessórios", []]
  ]],
  ["Ferramentas e instrumentais", []],
  ["Nostril", []],
  ["Navel", []],
  ["Ferraduras e microbells", []],
  ["Conectores e pingentes", []],
  ["Joias para orelha", []],
  ["Joias para aplicações específicas", []],
  ["Kits promocionais", []],
  ["Lançamentos", []],
  ["Ofertas", []]
];

export async function createSuggestedCategories(db) {
  let created = 0;
  const ensure = async (name, parentId) => {
    const siblings = await db.all(
      `SELECT id, name FROM catalog_categories WHERE ${parentId ? "parent_id = ?" : "parent_id IS NULL"}`,
      parentId ? [parentId] : []
    );
    const found = siblings.find((row) => comparableName(row.name) === comparableName(name));
    if (found) return Number(found.id);
    const category = await createCatalogCategory(db, { name, parent_id: parentId });
    created += 1;
    return Number(category.id);
  };
  const walk = async (nodes, parentId) => {
    for (const node of nodes) {
      const [name, children] = Array.isArray(node) ? node : [node, []];
      const id = await ensure(name, parentId);
      await walk(children || [], id);
    }
  };
  await walk(SUGGESTED_CATEGORY_TREE, null);
  return { created };
}

// Categorias que a vitrine pode exibir: ativas e com todas as ascendentes ativas.
export async function publicCatalogCategories(db, publishedProductIds) {
  const rows = withCategoryPaths(await db.all("SELECT * FROM catalog_categories ORDER BY sort_order, lower(name), id"));
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const visible = rows.filter((row) => {
    let cursor = row;
    while (cursor) {
      if (!cursor.is_active) return false;
      cursor = cursor.parent_id == null ? null : byId.get(Number(cursor.parent_id));
    }
    return true;
  });
  const visibleIds = new Set(visible.map((row) => Number(row.id)));
  const links = await db.all("SELECT category_id, product_id FROM catalog_category_products ORDER BY sort_order, product_id");
  const productCategories = new Map();
  for (const link of links) {
    const productId = Number(link.product_id);
    if (!visibleIds.has(Number(link.category_id)) || !publishedProductIds.has(productId)) continue;
    if (!productCategories.has(productId)) productCategories.set(productId, []);
    productCategories.get(productId).push(Number(link.category_id));
  }
  return {
    categories: visible.map((row) => ({
      id: Number(row.id),
      parent_id: row.parent_id == null ? null : Number(row.parent_id),
      name: row.name,
      slug: row.slug,
      description: row.description,
      image_url: row.image_url,
      image_alt: row.image_alt,
      sort_order: row.sort_order,
      depth: row.depth,
      path: row.path
    })),
    productCategories
  };
}

// ---------------------------------------------------------------------------
// Produtos (resumo usado nas telas de vínculo)
// ---------------------------------------------------------------------------

const PRODUCT_SUMMARY_SELECT = `
  SELECT j.id, j.name, j.sku, j.category, j.material, j.photo_url, j.image_url, j.status, j.sale_value,
    j.is_catalog_active, j.is_published, j.virtual_store_active, j.can_publish,
    CASE WHEN EXISTS (SELECT 1 FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.is_active = 1)
      THEN (SELECT COALESCE(SUM(GREATEST(v.quantity, 0)), 0) FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.is_active = 1)
      ELSE GREATEST(COALESCE(j.quantity, 0), 0) END AS available_quantity
  FROM jewelry_inventory j`;

// Busca para o seletor de produtos: nome, SKU do produto ou de uma variação.
export async function searchCatalogProducts(db, search = "", limit = 60) {
  const term = String(search || "").trim().slice(0, 80);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 200));
  const rows = await db.all(`${PRODUCT_SUMMARY_SELECT}
    WHERE j.status != 'arquivado'
      ${term ? `AND (j.name ILIKE ? OR j.sku ILIKE ? OR EXISTS (SELECT 1 FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.sku ILIKE ?))` : ""}
    ORDER BY lower(j.name), j.id
    LIMIT ?`, [...(term ? Array(3).fill(`%${term}%`) : []), safeLimit]);
  return rows.map(productSummary);
}

function productIsPublished(row) {
  return Number(row.is_catalog_active) === 1 && Number(row.is_published) === 1 && Number(row.virtual_store_active) === 1
    && row.can_publish !== false && row.status !== "arquivado";
}

function productSummary(row) {
  return {
    id: Number(row.id),
    name: row.name,
    sku: row.sku,
    category: row.category,
    material: row.material,
    photo_url: row.photo_url || row.image_url || "",
    sale_value: Number(row.sale_value || 0),
    available_quantity: Number(row.available_quantity || 0),
    published: productIsPublished(row),
    section_id: row.section_id == null ? null : Number(row.section_id)
  };
}

// ---------------------------------------------------------------------------
// Fuso horário da loja
// ---------------------------------------------------------------------------

export function isValidTimezone(value) {
  const zone = String(value || "");
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function getStoreTimezone(db) {
  const row = await db.get("SELECT timezone FROM clinic_settings WHERE id = 1");
  return isValidTimezone(row?.timezone) ? row.timezone : CLINIC_TIME_ZONE;
}

export async function setStoreTimezone(db, timezone) {
  const zone = String(timezone || "").trim();
  if (!isValidTimezone(zone)) fail("Fuso horário inválido.");
  await db.run("INSERT INTO clinic_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  await db.run("UPDATE clinic_settings SET timezone = ? WHERE id = 1", [zone]);
  return zone;
}

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// "2026-10-31T00:00" no fuso da loja -> instante absoluto (o Postgres trata
// horário de verão e mudanças de regra do fuso).
async function localToInstant(db, value, timezone, label) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().slice(0, 16);
  if (!LOCAL_DATETIME.test(text)) fail(`${label} inválida.`);
  const row = await db.get("SELECT (?::timestamp AT TIME ZONE ?) AS instant", [text, timezone]).catch(() => null);
  if (!row?.instant) fail(`${label} inválida.`);
  return row.instant;
}

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATES = ["draft", "scheduled", "active", "paused", "ended"];

export function campaignState(campaign, now = new Date()) {
  if (campaign.status === "draft") return "draft";
  if (campaign.status === "paused") return "paused";
  if (campaign.status === "ended") return "ended";
  const starts = campaign.starts_at ? new Date(campaign.starts_at) : null;
  const ends = campaign.ends_at ? new Date(campaign.ends_at) : null;
  if (ends && ends <= now) return "ended";
  if (starts && starts > now) return "scheduled";
  return "active";
}

const CAMPAIGN_LOCAL_COLUMNS = `
  to_char(c.starts_at AT TIME ZONE ?, 'YYYY-MM-DD"T"HH24:MI') AS starts_local,
  to_char(c.ends_at AT TIME ZONE ?, 'YYYY-MM-DD"T"HH24:MI') AS ends_local,
  to_char(c.highlight_until AT TIME ZONE ?, 'YYYY-MM-DD"T"HH24:MI') AS highlight_until_local`;

const CAMPAIGN_COUNTS = `
  (SELECT COUNT(*)::int FROM catalog_campaign_products cp WHERE cp.campaign_id = c.id) AS product_count,
  (SELECT COUNT(*)::int FROM catalog_campaign_products cp
     JOIN jewelry_inventory j ON j.id = cp.product_id
     WHERE cp.campaign_id = c.id AND NOT (
       j.is_catalog_active = 1 AND j.is_published = 1 AND j.virtual_store_active = 1 AND j.can_publish = true
       AND j.status != 'arquivado'
       AND (CASE WHEN EXISTS (SELECT 1 FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.is_active = 1)
         THEN (SELECT COALESCE(SUM(GREATEST(v.quantity, 0)), 0) FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.is_active = 1)
         ELSE GREATEST(COALESCE(j.quantity, 0), 0) END) > 0
     )) AS unavailable_count`;

function decorateCampaign(row, now = new Date()) {
  if (!row) return row;
  const state = campaignState(row, now);
  const warnings = [];
  if (Number(row.product_count || 0) === 0) warnings.push("Campanha sem produtos.");
  if (Number(row.unavailable_count || 0) > 0) warnings.push(`${row.unavailable_count} produto(s) indisponível(is) ou fora do catálogo público.`);
  if (state === "active" && row.highlight_until && new Date(row.highlight_until) <= now) warnings.push("O período de destaque já terminou.");
  return { ...row, state, warnings, highlighted: Boolean(row.highlight_until && new Date(row.highlight_until) > now) };
}

export async function listCampaigns(db) {
  const timezone = await getStoreTimezone(db);
  const rows = await db.all(`
    SELECT c.*, ${CAMPAIGN_LOCAL_COLUMNS}, ${CAMPAIGN_COUNTS}, p.name AS promotion_name
    FROM catalog_campaigns c
    LEFT JOIN catalog_promotions p ON p.id = c.promotion_id
    ORDER BY c.priority DESC, c.starts_at DESC NULLS LAST, c.id DESC`, [timezone, timezone, timezone]);
  return { timezone, campaigns: rows.map((row) => decorateCampaign(row)) };
}

async function campaignOrFail(db, id) {
  const timezone = await getStoreTimezone(db);
  const row = await db.get(`
    SELECT c.*, ${CAMPAIGN_LOCAL_COLUMNS}, ${CAMPAIGN_COUNTS}, p.name AS promotion_name
    FROM catalog_campaigns c
    LEFT JOIN catalog_promotions p ON p.id = c.promotion_id
    WHERE c.id = ?`, [timezone, timezone, timezone, positiveId(id)]);
  if (!row) fail("Campanha não encontrada.", 404, "catalog_campaign_not_found");
  return decorateCampaign({ ...row, timezone });
}

export async function getCampaign(db, id) {
  const campaign = await campaignOrFail(db, id);
  const sections = await db.all("SELECT * FROM catalog_campaign_sections WHERE campaign_id = ? ORDER BY sort_order, id", [campaign.id]);
  const products = await db.all(`${PRODUCT_SUMMARY_SELECT.replace("SELECT j.id", "SELECT cp.section_id, j.id")}
    JOIN catalog_campaign_products cp ON cp.product_id = j.id AND cp.campaign_id = ?
    ORDER BY cp.sort_order, lower(j.name), j.id`, [campaign.id]);
  return { ...campaign, sections, products: products.map(productSummary) };
}

async function validateCampaign(db, body, current = null) {
  const timezone = await getStoreTimezone(db);
  const pick = (key, fallback) => (body[key] !== undefined ? body[key] : current ? current[key] : fallback);
  const name = cleanText(pick("name", ""), 121);
  const title = cleanText(pick("title", name), 121) || name;
  if (!name) fail("Informe o nome da campanha.");
  if (name.length > 120 || title.length > 120) fail("Nome e título devem ter até 120 caracteres.");

  let slug = current?.slug;
  if (body.slug !== undefined && String(body.slug || "").trim()) {
    slug = slugifyText(body.slug, 90);
    if (!SLUG_PATTERN.test(slug)) fail("Endereço inválido. Use letras, números e hífens.");
    const taken = await db.get("SELECT id FROM catalog_campaigns WHERE slug = ?" + (current ? " AND id <> ?" : ""), [slug, ...(current ? [current.id] : [])]);
    if (taken) fail("Este endereço já é usado por outra campanha.", 409, "catalog_slug_conflict");
  } else if (!slug) {
    const base = slugifyText(title, 90);
    if (!base) fail("Informe um título com letras ou números.");
    slug = await uniqueSlug(db, "catalog_campaigns", base);
  }

  const startsAt = body.starts_local !== undefined ? await localToInstant(db, body.starts_local, timezone, "Data de início") : current?.starts_at ?? null;
  const endsAt = body.ends_local !== undefined ? await localToInstant(db, body.ends_local, timezone, "Data de encerramento") : current?.ends_at ?? null;
  const highlightUntil = body.highlight_until_local !== undefined
    ? await localToInstant(db, body.highlight_until_local, timezone, "Data final do destaque")
    : current?.highlight_until ?? null;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) fail("O encerramento precisa ser depois do início.");

  const position = String(pick("display_position", "top"));
  if (!["top", "before_products"].includes(position)) fail("Posição de exibição inválida.");
  const priority = Number(pick("priority", 0));
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) fail("A prioridade deve ser um número inteiro entre -1000 e 1000.");

  let promotionId = current?.promotion_id ?? null;
  if (body.promotion_id !== undefined) {
    promotionId = body.promotion_id === null || body.promotion_id === "" ? null : positiveId(body.promotion_id);
    if (body.promotion_id !== null && body.promotion_id !== "" && !promotionId) fail("Promoção inválida.");
    if (promotionId && !(await db.get("SELECT id FROM catalog_promotions WHERE id = ? AND deleted_at IS NULL", [promotionId]))) {
      fail("A promoção escolhida não existe mais.", 404, "catalog_promotion_not_found");
    }
  }

  return {
    name, title, slug,
    summary: cleanText(pick("summary", ""), 400),
    banner_desktop_url: imageUrl(pick("banner_desktop_url", ""), "Banner para computador"),
    banner_mobile_url: imageUrl(pick("banner_mobile_url", ""), "Imagem para celular"),
    cover_url: imageUrl(pick("cover_url", ""), "Imagem de capa"),
    image_alt: cleanText(pick("image_alt", ""), 200),
    starts_at: startsAt,
    ends_at: endsAt,
    highlight_until: highlightUntil,
    display_position: position,
    priority,
    show_on_home: booleanValue(pick("show_on_home", true), true),
    show_in_nav: booleanValue(pick("show_in_nav", false), false),
    promotion_id: promotionId
  };
}

export async function createCampaign(db, body = {}, userId = null) {
  const values = await validateCampaign(db, body);
  const result = await db.run(
    `INSERT INTO catalog_campaigns (name, title, slug, summary, banner_desktop_url, banner_mobile_url, cover_url, image_alt,
       starts_at, ends_at, highlight_until, display_position, priority, show_on_home, show_in_nav, promotion_id, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [values.name, values.title, values.slug, values.summary, values.banner_desktop_url, values.banner_mobile_url, values.cover_url,
      values.image_alt, values.starts_at, values.ends_at, values.highlight_until, values.display_position, values.priority,
      values.show_on_home, values.show_in_nav, values.promotion_id, userId]
  );
  return getCampaign(db, result.returnedId);
}

export async function updateCampaign(db, id, body = {}) {
  const current = await campaignOrFail(db, id);
  const values = await validateCampaign(db, body, current);
  await db.run(
    `UPDATE catalog_campaigns SET name = ?, title = ?, slug = ?, summary = ?, banner_desktop_url = ?, banner_mobile_url = ?,
       cover_url = ?, image_alt = ?, starts_at = ?, ends_at = ?, highlight_until = ?, display_position = ?, priority = ?,
       show_on_home = ?, show_in_nav = ?, promotion_id = ?, updated_at = now() WHERE id = ?`,
    [values.name, values.title, values.slug, values.summary, values.banner_desktop_url, values.banner_mobile_url, values.cover_url,
      values.image_alt, values.starts_at, values.ends_at, values.highlight_until, values.display_position, values.priority,
      values.show_on_home, values.show_in_nav, values.promotion_id, current.id]
  );
  return { before: current, after: await getCampaign(db, current.id) };
}

// Ações do administrador. O estado "agendada/ativa/encerrada" de uma campanha
// publicada continua vindo do horário; aqui só muda a decisão gravada.
export async function changeCampaignStatus(db, id, action) {
  const current = await campaignOrFail(db, id);
  const now = new Date();
  const endsInPast = current.ends_at && new Date(current.ends_at) <= now;
  // Campanha publicada cujo fim já passou volta a valer editando o período;
  // "reativar" é para a encerrada manualmente.
  const transitions = {
    publish: ["draft"],
    pause: ["published"],
    resume: ["paused"],
    end: ["published", "paused"],
    reactivate: ["ended"]
  };
  if (!transitions[action]) fail("Ação inválida.");
  if (!transitions[action].includes(current.status)) {
    fail("Esta ação não se aplica ao estado atual da campanha.", 409, "catalog_campaign_invalid_transition");
  }
  if (["publish", "resume", "reactivate"].includes(action) && endsInPast) {
    fail("O encerramento já passou. Defina um novo período antes de publicar a campanha.", 409, "catalog_campaign_period_ended");
  }
  const status = action === "pause" ? "paused" : action === "end" ? "ended" : "published";
  await db.run(
    `UPDATE catalog_campaigns SET status = ?, ended_at = ${action === "end" ? "now()" : "NULL"}, updated_at = now() WHERE id = ?`,
    [status, current.id]
  );
  return { before: current, after: await getCampaign(db, current.id) };
}

// Só rascunhos são apagados; campanhas publicadas ficam no histórico.
export async function deleteCampaign(db, id) {
  const current = await campaignOrFail(db, id);
  if (current.status !== "draft") {
    fail("Campanhas já publicadas ficam no histórico. Encerre a campanha em vez de excluí-la.", 409, "catalog_campaign_in_history");
  }
  await db.run("DELETE FROM catalog_campaigns WHERE id = ?", [current.id]);
  return current;
}

async function sectionOrFail(db, campaignId, sectionId) {
  const section = await db.get("SELECT * FROM catalog_campaign_sections WHERE id = ? AND campaign_id = ?", [positiveId(sectionId), campaignId]);
  if (!section) fail("Subcategoria da campanha não encontrada.", 404, "catalog_campaign_section_not_found");
  return section;
}

export async function saveCampaignSection(db, campaignId, body = {}, sectionId = null) {
  const campaign = await campaignOrFail(db, campaignId);
  const current = sectionId ? await sectionOrFail(db, campaign.id, sectionId) : null;
  const name = cleanText(body.name ?? current?.name, 81);
  if (!name || name.length > 80) fail("Informe um nome de até 80 caracteres para a subcategoria.");
  const siblings = await db.all("SELECT id, name FROM catalog_campaign_sections WHERE campaign_id = ?" + (current ? " AND id <> ?" : ""), [campaign.id, ...(current ? [current.id] : [])]);
  if (siblings.some((row) => comparableName(row.name) === comparableName(name))) fail(`Já existe "${name}" nesta campanha.`, 409, "catalog_campaign_section_duplicate");
  const slug = await uniqueSlug(db, "catalog_campaign_sections", slugifyText(name, 80) || "secao", {
    excludeId: current?.id || null, scopeColumn: "campaign_id", scopeValue: campaign.id
  });
  if (current) {
    await db.run("UPDATE catalog_campaign_sections SET name = ?, slug = ?, sort_order = ? WHERE id = ?",
      [name, slug, Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : current.sort_order, current.id]);
    return db.get("SELECT * FROM catalog_campaign_sections WHERE id = ?", [current.id]);
  }
  const next = Number((await db.get("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM catalog_campaign_sections WHERE campaign_id = ?", [campaign.id]))?.next || 0);
  const result = await db.run("INSERT INTO catalog_campaign_sections (campaign_id, name, slug, sort_order) VALUES (?, ?, ?, ?) RETURNING id", [campaign.id, name, slug, next]);
  return db.get("SELECT * FROM catalog_campaign_sections WHERE id = ?", [result.returnedId]);
}

export async function deleteCampaignSection(db, campaignId, sectionId) {
  const campaign = await campaignOrFail(db, campaignId);
  const section = await sectionOrFail(db, campaign.id, sectionId);
  // Os produtos continuam na campanha, apenas sem subcategoria.
  await db.run("DELETE FROM catalog_campaign_sections WHERE id = ?", [section.id]);
  return section;
}

export async function addCampaignProducts(db, campaignId, productIds, sectionId = null) {
  const campaign = await campaignOrFail(db, campaignId);
  const section = sectionId ? await sectionOrFail(db, campaign.id, sectionId) : null;
  const ids = idList(productIds);
  if (!ids.length) fail("Selecione ao menos um produto.");
  const valid = await existingProductIds(db, ids);
  if (valid.length !== ids.length) fail("Um dos produtos não existe ou está arquivado.", 404, "catalog_product_not_found");
  let added = 0;
  for (const productId of valid) {
    const result = await db.run(
      "INSERT INTO catalog_campaign_products (campaign_id, product_id, section_id) VALUES (?, ?, ?) ON CONFLICT (campaign_id, product_id) DO NOTHING",
      [campaign.id, productId, section?.id || null]
    );
    added += Number(result.changes || 0);
  }
  return { added, already_linked: valid.length - added };
}

export async function updateCampaignProduct(db, campaignId, productId, body = {}) {
  const campaign = await campaignOrFail(db, campaignId);
  const section = body.section_id ? await sectionOrFail(db, campaign.id, body.section_id) : null;
  const result = await db.run("UPDATE catalog_campaign_products SET section_id = ? WHERE campaign_id = ? AND product_id = ?", [section?.id || null, campaign.id, positiveId(productId)]);
  if (!Number(result.changes || 0)) fail("Produto não está nesta campanha.", 404, "catalog_campaign_product_not_found");
  return { section_id: section?.id || null };
}

export async function removeCampaignProduct(db, campaignId, productId) {
  const campaign = await campaignOrFail(db, campaignId);
  const result = await db.run("DELETE FROM catalog_campaign_products WHERE campaign_id = ? AND product_id = ?", [campaign.id, positiveId(productId)]);
  return { removed: Number(result.changes || 0) };
}

// Campanhas visíveis agora na vitrine. A decisão é feita pelo banco em cada
// leitura (`now()`), então o início e o fim agendados não dependem de tarefa
// em segundo plano nem de publicação manual.
export async function publicActiveCampaigns(db, publishedItems) {
  const rows = await db.all(`
    SELECT c.* FROM catalog_campaigns c
    WHERE c.status = 'published'
      AND (c.starts_at IS NULL OR c.starts_at <= now())
      AND (c.ends_at IS NULL OR c.ends_at > now())
    ORDER BY c.priority DESC, c.starts_at DESC NULLS LAST, c.id DESC`);
  if (!rows.length) return [];
  const timezone = await getStoreTimezone(db);
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const sections = await db.all(`SELECT id, campaign_id, name, slug, sort_order FROM catalog_campaign_sections WHERE campaign_id IN (${placeholders}) ORDER BY sort_order, id`, ids);
  const links = await db.all(`SELECT campaign_id, product_id, section_id FROM catalog_campaign_products WHERE campaign_id IN (${placeholders}) ORDER BY sort_order, product_id`, ids);
  const promotionIds = [...new Set(rows.map((row) => row.promotion_id).filter(Boolean))];
  const promotions = promotionIds.length
    ? await db.all(`SELECT * FROM catalog_promotions WHERE id IN (${promotionIds.map(() => "?").join(",")}) AND deleted_at IS NULL`, promotionIds)
    : [];
  const itemsById = new Map(publishedItems.map((item) => [Number(item.id), item]));
  const now = new Date();
  return rows.map((row) => {
    const promotion = promotions.find((entry) => Number(entry.id) === Number(row.promotion_id));
    const promotionActive = Boolean(promotion && isPromotionActive(promotion) && Number(promotion.visible_in_catalog ?? 1) === 1);
    const products = links
      .filter((link) => Number(link.campaign_id) === Number(row.id) && itemsById.has(Number(link.product_id)))
      .map((link) => {
        const item = itemsById.get(Number(link.product_id));
        const price = Number(item.sale_value || 0);
        const matches = promotionActive && promotionMatchesItem(promotion, { product_id: item.id, category: item.category, color: item.color, material: item.material, stone: item.stone, unit_price: price });
        const discount = matches ? calculatePromotionDiscount(promotion, price, 1).discount_amount : 0;
        return {
          product_id: Number(link.product_id),
          section_id: link.section_id == null ? null : Number(link.section_id),
          ...(discount > 0 ? { promotional_price: Number((price - discount).toFixed(2)) } : {})
        };
      });
    return {
      id: Number(row.id),
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      banner_desktop_url: row.banner_desktop_url,
      banner_mobile_url: row.banner_mobile_url,
      cover_url: row.cover_url,
      image_alt: row.image_alt,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      timezone,
      display_position: row.display_position,
      priority: row.priority,
      show_on_home: Boolean(row.show_on_home),
      show_in_nav: Boolean(row.show_in_nav),
      highlighted: Boolean(row.highlight_until && new Date(row.highlight_until) > now),
      promotion: promotionActive ? { name: promotion.name, badge: promotion.badge || "", legal_text: promotion.legal_text || "" } : null,
      sections: sections.filter((section) => Number(section.campaign_id) === Number(row.id)).map(({ campaign_id: _campaign, ...section }) => section),
      products
    };
  });
}

// Link público fora do ar. Rascunho, agendada e pausada não revelam o título
// (a coleção pode ser surpresa); encerrada informa que terminou.
export async function publicCampaignState(db, slug) {
  const row = await db.get("SELECT * FROM catalog_campaigns WHERE slug = ?", [slugifyText(slug, 90)]);
  if (!row || row.status === "draft") return { state: "not_found" };
  const state = campaignState(row);
  if (state === "ended") return { state, title: row.title };
  if (state === "active") return { state, title: row.title };
  return { state: "unavailable" };
}
