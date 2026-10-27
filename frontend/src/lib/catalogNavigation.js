// Navegação comercial do catálogo público: árvore de categorias, filtros
// combinados e ordenação. Funções puras, compartilhadas pela vitrine e pela
// prévia das campanhas no painel.
import { removeAccents } from "./utils.js";

const asList = (value) => (Array.isArray(value) ? value : []);
const text = (value) => String(value ?? "").trim();

export function buildCategoryTree(categories = []) {
  const nodes = new Map(asList(categories).map((category) => [Number(category.id), { ...category, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id == null ? null : nodes.get(Number(node.parent_id));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (list) => list.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || text(a.name).localeCompare(text(b.name), "pt-BR"));
  const sortDeep = (list) => {
    for (const node of order(list)) sortDeep(node.children);
  };
  sortDeep(roots);
  return roots;
}

// A categoria e todas as suas subcategorias, em qualquer profundidade.
export function categoryDescendantIds(categories = [], categoryId) {
  const childrenOf = new Map();
  for (const category of asList(categories)) {
    const key = category.parent_id == null ? 0 : Number(category.parent_id);
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(Number(category.id));
  }
  const ids = new Set();
  const stack = [Number(categoryId)];
  while (stack.length) {
    const id = stack.pop();
    if (ids.has(id)) continue;
    ids.add(id);
    stack.push(...(childrenOf.get(id) || []));
  }
  return ids;
}

export function categoryTrail(categories = [], categoryId) {
  const byId = new Map(asList(categories).map((category) => [Number(category.id), category]));
  const trail = [];
  let cursor = byId.get(Number(categoryId));
  while (cursor && trail.length < 50) {
    trail.unshift(cursor);
    cursor = cursor.parent_id == null ? null : byId.get(Number(cursor.parent_id));
  }
  return trail;
}

export function itemInCategory(item, categoryIds) {
  return asList(item?.category_ids).some((id) => categoryIds.has(Number(id)));
}

const activeVariants = (item) => asList(item?.variants).filter((variant) => Number(variant.is_active ?? 1) === 1);

// Menor preço anunciado do produto (o "a partir de" das variações).
export function catalogItemPrice(item = {}) {
  const prices = activeVariants(item).map((variant) => Number(variant.sale_value ?? item.sale_value)).filter((value) => Number.isFinite(value) && value > 0);
  const base = Number(item.sale_value || 0);
  return prices.length ? Math.min(...prices) : base;
}

// Valores distintos de um campo, no produto e nas variações, para montar os
// filtros só com o que existe no cadastro.
export function catalogFieldValues(items = [], field) {
  const values = new Set();
  for (const item of asList(items)) {
    for (const source of [item, ...activeVariants(item)]) {
      const value = text(source?.[field]);
      if (value) values.add(value);
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function fieldMatches(item, field, wanted) {
  if (!wanted) return true;
  const normalized = text(wanted).toLowerCase();
  return [item, ...activeVariants(item)].some((source) => text(source?.[field]).toLowerCase() === normalized);
}

export function catalogPriceMatches(item, min, max) {
  const price = catalogItemPrice(item);
  if (min !== "" && min !== null && min !== undefined && Number.isFinite(Number(min)) && price < Number(min)) return false;
  if (max !== "" && max !== null && max !== undefined && Number.isFinite(Number(max)) && price > Number(max)) return false;
  return true;
}

// Filtros de espessura, fixação e preço. Todos precisam ser verdadeiros ao
// mesmo tempo (categoria + material + preço, por exemplo).
export function commercialFiltersMatch(item, filters = {}) {
  return fieldMatches(item, "thickness", filters.thickness)
    && fieldMatches(item, "thread_type", filters.thread)
    && catalogPriceMatches(item, filters.priceMin, filters.priceMax);
}

export function countActiveCatalogFilters(filters = {}, { category = "Todos", search = "" } = {}) {
  const keys = ["material", "color", "stone", "size", "topSize", "availability", "thickness", "thread", "priceMin", "priceMax"];
  return keys.filter((key) => text(filters[key])).length + (category && category !== "Todos" ? 1 : 0) + (text(search) ? 1 : 0);
}

function relevance(item, search) {
  const terms = removeAccents(text(search).toLowerCase()).split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const name = removeAccents(text(item.name).toLowerCase());
  const skus = [item.sku, ...activeVariants(item).map((variant) => variant.sku)].map((sku) => text(sku).toLowerCase());
  let score = 0;
  for (const term of terms) {
    if (skus.includes(term)) score += 100;
    else if (skus.some((sku) => sku.startsWith(term))) score += 40;
    if (name.startsWith(term)) score += 20;
    else if (name.includes(term)) score += 10;
  }
  return score;
}

export function sortCatalogItems(items = [], sort = "recentes", search = "") {
  const list = [...asList(items)];
  const byNewest = (a, b) => Number(b.id || 0) - Number(a.id || 0);
  const comparators = {
    relevancia: (a, b) => relevance(b, search) - relevance(a, search) || byNewest(a, b),
    lancamentos: (a, b) => Number(Boolean(Number(b.is_new))) - Number(Boolean(Number(a.is_new))) || byNewest(a, b),
    "menor-preco": (a, b) => catalogItemPrice(a) - catalogItemPrice(b),
    "maior-preco": (a, b) => catalogItemPrice(b) - catalogItemPrice(a),
    "nome-az": (a, b) => text(a.name).localeCompare(text(b.name), "pt-BR"),
    "nome-za": (a, b) => text(b.name).localeCompare(text(a.name), "pt-BR"),
    estoque: (a, b) => Number(b.quantity || 0) - Number(a.quantity || 0)
  };
  return list.sort(comparators[sort] || byNewest);
}

// Campanha da vitrine ordenada por prioridade, com os produtos publicados.
export function campaignItems(campaign, items = [], sectionSlug = "") {
  const section = asList(campaign?.sections).find((entry) => entry.slug === sectionSlug);
  const byId = new Map(asList(items).map((item) => [Number(item.id), item]));
  return asList(campaign?.products)
    .filter((product) => !section || Number(product.section_id) === Number(section.id))
    .map((product) => {
      const item = byId.get(Number(product.product_id));
      if (!item) return null;
      return product.promotional_price !== undefined ? { ...item, campaign_price: Number(product.promotional_price) } : item;
    })
    .filter(Boolean);
}
