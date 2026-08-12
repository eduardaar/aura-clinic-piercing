// Serviços de configuração e personalização do catálogo online.
import { JEWELRY_CATEGORIES } from "../config/index.js";
import { boolNumber, defaultCatalogTheme } from "./utils.js";
import { catalogPluginRequiredFeature, countEnabledCatalogPlugins, normalizeCatalogPlugins } from "./catalogPlugins.js";

const CATALOG_SETTINGS_DEFAULTS = {
    brand_name: "",
    slogan: "",
    logo_url: "",
    title: "Escolha a joia perfeita para você",
    subtitle: "",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realçar sua essência",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: `Todos,${JEWELRY_CATEGORIES.join(",")}`,
    whatsapp_phone: "",
    whatsapp_message: "Olá! Vim pelo catálogo online e quero ajuda para escolher uma joia.",
    company_instagram: "",
    company_legal_name: "",
    company_display_name: "",
    company_short_description: "",
    company_phone: "",
    company_whatsapp: "",
    company_email: "",
    company_support_email: "",
    company_address: "",
    company_hours: "",
    company_service_days: "",
    company_website: "",
    company_maps_url: "",
    service_policy: "",
    deposit_policy: "",
    cancellation_policy: "",
    exchange_policy: "",
    biosafety_text: "",
    materials_text: "",
    layout_style: "premium",
    page_title: "Catálogo Online",
    unavailable_message: "Produto indisponível no momento.",
    low_stock_message: "Poucas unidades",
    institutional_text: "Joias selecionadas com cuidado, segurança e estética premium.",
    footer_text: "",
    seo_title: "Catálogo Online",
    seo_description: "Escolha joias para piercing no catálogo online.",
    share_image_url: "",
    product_share_text: "Olha essa joia:",
    footer_enabled: "1",
    footer_display_name: "",
    footer_slogan: "",
    footer_logo_url: "",
    footer_light_logo_url: "",
    footer_dark_logo_url: "",
    footer_logo_alignment: "center",
    footer_logo_max_width: "180",
    footer_logo_max_height: "96",
    footer_show_business_name: "1",
    footer_show_slogan: "1",
    footer_background_type: "solid",
    footer_background_color: "#1c1c1c",
    footer_background_image_url: "",
    footer_background_position: "50% 50%",
    footer_background_size: "cover",
    footer_overlay_color: "#000000",
    footer_overlay_opacity: "0",
    footer_gradient_start_color: "#1c1c1c",
    footer_gradient_end_color: "#34302b",
    footer_gradient_direction: "135deg",
    footer_brand_background_color: "transparent",
    footer_text_color: "#f8f5f0",
    footer_muted_text_color: "#c9c2b8",
    footer_heading_color: "#ffffff",
    footer_link_color: "#f8f5f0",
    footer_link_hover_color: "#ffffff",
    footer_icon_color: "#c8a96a",
    footer_border_color: "#514a42",
    footer_accent_color: "#c8a96a",
    footer_border_radius: "24",
    footer_container_width: "1280",
    footer_spacing: "40",
    footer_copyright_text: "",
    footer_inherit_main_palette: "1",
    site_background: "#f8f5f0",
    section_background: "#ffffff",
    text_color: "#1c1c1c",
    muted_text_color: "#74685e",
    heading_color: "#1c1c1c",
    link_color: "#8b642f",
    link_hover_color: "#5f421d",
    icon_color: "#8b642f",
    border_color: "#d8c3a5",
    button_text_color: "#ffffff",
    content_sections: JSON.stringify([{
      kicker: "Guia",
      title: "Escolha sua joia com orientação profissional",
      text: "Veja materiais, medidas, anodização e cuidados antes de reservar sua joia.",
      media_type: "image",
      media_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
      button_text: "Agendar atendimento",
      button_link: "/agendar",
      active: true,
      order: 1
    }]
    )
  };

const CATALOG_SETTINGS_KEYS = new Set([
  "title", "subtitle", "hero_title", "hero_subtitle", "hero_image_url", "categories", "whatsapp_phone", "whatsapp_message", "layout_style",
  "company_instagram", "company_legal_name", "company_display_name", "company_short_description", "company_phone", "company_whatsapp",
  "company_email", "company_support_email", "company_address", "company_hours", "company_service_days",
  "company_website", "company_maps_url", "service_policy", "deposit_policy", "cancellation_policy",
  "exchange_policy", "biosafety_text", "materials_text",
  "page_title", "unavailable_message", "low_stock_message", "institutional_text", "footer_text", "seo_title", "seo_description", "share_image_url", "product_share_text", "content_sections",
  "footer_enabled", "footer_display_name", "footer_slogan", "footer_logo_url", "footer_light_logo_url", "footer_dark_logo_url",
  "footer_logo_alignment", "footer_logo_max_width", "footer_logo_max_height", "footer_show_business_name", "footer_show_slogan",
  "footer_background_type", "footer_background_color", "footer_background_image_url", "footer_background_position", "footer_background_size",
  "footer_overlay_color", "footer_overlay_opacity", "footer_gradient_start_color", "footer_gradient_end_color", "footer_gradient_direction",
  "footer_brand_background_color", "footer_text_color", "footer_muted_text_color", "footer_heading_color", "footer_link_color",
  "footer_link_hover_color", "footer_icon_color", "footer_border_color", "footer_accent_color", "footer_border_radius",
  "footer_container_width", "footer_spacing", "footer_copyright_text", "footer_inherit_main_palette", "site_background",
  "section_background", "text_color", "muted_text_color", "heading_color", "link_color", "link_hover_color", "icon_color",
  "border_color", "button_text_color", "logo_transform"
]);

const THEME_KEYS = Object.keys(defaultCatalogTheme());

export class CatalogCustomizationError extends Error {
  constructor(message, statusCode = 400, code = null, details = null) {
    super(message);
    this.name = "CatalogCustomizationError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function getCatalogSettingsDefaults() {
  // O default contém estruturas aninhadas; não permita que quem recebe o
  // resultado altere a constante de módulo por acidente.
  return JSON.parse(JSON.stringify(CATALOG_SETTINGS_DEFAULTS));
}

export async function getCatalogSettings(db) {
  const rows = await db.all("SELECT key, value FROM catalog_settings");
  const defaults = getCatalogSettingsDefaults();
  for (const row of rows) defaults[row.key] = row.value;
  return defaults;
}

function jsonObject(value, fallback = {}) {
  if (!value) return { ...fallback };
  if (typeof value === "string") {
    try { return jsonObject(JSON.parse(value), fallback); } catch { return { ...fallback }; }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : { ...fallback };
}

function jsonArray(value) {
  if (!value) return [];
  if (typeof value === "string") {
    try { return jsonArray(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function omitSystemFields(record) {
  const copy = { ...jsonObject(record) };
  for (const key of ["id", "layout_id", "created_at", "updated_at", "published_at", "deleted_at", "name", "photo_url", "category", "material", "sale_value", "quantity"]) {
    delete copy[key];
  }
  return copy;
}

function normalizeSettings(settings, base = getCatalogSettingsDefaults()) {
  const next = { ...getCatalogSettingsDefaults(), ...jsonObject(base) };
  for (const [key, rawValue] of Object.entries(jsonObject(settings))) {
    if (!CATALOG_SETTINGS_KEYS.has(key)) continue;
    if (key === "categories" && Array.isArray(rawValue)) next[key] = rawValue.join(",");
    else if (key === "content_sections" && typeof rawValue !== "string") next[key] = JSON.stringify(rawValue ?? []);
    else next[key] = String(rawValue ?? "");
  }
  return next;
}

function normalizeTheme(theme, base = defaultCatalogTheme()) {
  const next = { ...defaultCatalogTheme(), ...jsonObject(base) };
  for (const key of THEME_KEYS) {
    if (Object.hasOwn(jsonObject(theme), key)) next[key] = jsonObject(theme)[key];
  }
  for (const key of ["show_out_of_stock", "show_stock_quantity", "show_whatsapp_button", "show_schedule_button", "show_buy_button", "show_favorites"]) {
    next[key] = boolNumber(next[key]);
  }
  return next;
}

function normalizeBanner(banner, index) {
  const next = omitSystemFields(banner);
  next.title = String(next.title || "Banner");
  next.subtitle = String(next.subtitle || "");
  next.image_url = String(next.image_url || "");
  next.mobile_image_url = String(next.mobile_image_url || "");
  next.original_image_url = String(next.original_image_url || next.image_url || "");
  next.alt_text = String(next.alt_text || next.title || "Banner");
  next.image_transform = validateImageTransform(next.image_transform);
  next.button_text = String(next.button_text || "");
  next.button_link = String(next.button_link || "");
  next.banner_width = Number(next.banner_width || 0);
  next.banner_height = Number(next.banner_height || 340);
  next.banner_fit = String(next.banner_fit || "contain");
  next.is_active = boolNumber(next.is_active ?? 1);
  next.sort_order = Number(next.sort_order ?? index + 1);
  return next;
}

function normalizeSection(section, index) {
  const next = omitSystemFields(section);
  return {
    section_key: String(next.section_key || `section-${index + 1}`),
    section_type: String(next.section_type || "custom_content"),
    title: String(next.title || ""),
    subtitle: String(next.subtitle || next.kicker || ""),
    is_active: boolNumber(next.is_active ?? next.active ?? 1),
    sort_order: Number(next.sort_order ?? next.order ?? index + 1),
    alignment: String(next.alignment || "left"),
    background: String(next.background || ""),
    spacing: Number(next.spacing ?? 24),
    item_limit: Number(next.item_limit ?? 8),
    display_mode: String(next.display_mode || "grid"),
    width_mode: String(next.width_mode || "contained"),
    height: next.height === "" || next.height === undefined ? null : Number(next.height),
    columns_count: Number(next.columns_count ?? 4),
    image_ratio: String(next.image_ratio || "1:1"),
    card_size: String(next.card_size || "medium"),
    product_sort: String(next.product_sort || "recent"),
    category_filter: String(next.category_filter || ""),
    media_url: String(next.media_url || ""),
    button_text: String(next.button_text || ""),
    button_link: String(next.button_link || ""),
    body_text: String(next.body_text || next.text || "")
  };
}

function normalizeSnapshot(snapshot, base = {}) {
  const source = jsonObject(snapshot);
  const previous = jsonObject(base);
  const next = {
    settings: normalizeSettings(source.settings, previous.settings),
    theme: normalizeTheme(source.theme, previous.theme),
    banners: Array.isArray(source.banners)
      ? source.banners.map(normalizeBanner)
      : jsonArray(previous.banners).map(normalizeBanner),
    featuredCategories: Array.isArray(source.featuredCategories)
      ? source.featuredCategories.map((item, index) => ({ ...omitSystemFields(item), is_active: boolNumber(item?.is_active ?? 1), is_featured: boolNumber(item?.is_featured ?? 0), sort_order: Number(item?.sort_order ?? index + 1) }))
      : jsonArray(previous.featuredCategories).map((item, index) => ({ ...omitSystemFields(item), is_active: boolNumber(item?.is_active ?? 1), is_featured: boolNumber(item?.is_featured ?? 0), sort_order: Number(item?.sort_order ?? index + 1) })),
    featuredProducts: Array.isArray(source.featuredProducts)
      ? source.featuredProducts.map((item, index) => ({ ...omitSystemFields(item), product_id: Number(item?.product_id || 0), badge: String(item?.badge || ""), is_active: boolNumber(item?.is_active ?? 1), sort_order: Number(item?.sort_order ?? index + 1) })).filter((item) => item.product_id > 0)
      : jsonArray(previous.featuredProducts).map((item, index) => ({ ...omitSystemFields(item), product_id: Number(item?.product_id || 0), badge: String(item?.badge || ""), is_active: boolNumber(item?.is_active ?? 1), sort_order: Number(item?.sort_order ?? index + 1) })).filter((item) => item.product_id > 0),
    promotions: Array.isArray(source.promotions)
      ? source.promotions.map(omitSystemFields)
      : jsonArray(previous.promotions).map(omitSystemFields),
    catalogSections: Array.isArray(source.catalogSections)
      ? source.catalogSections.map(normalizeSection)
      : jsonArray(previous.catalogSections).map(normalizeSection),
    // Plugins vivem no mesmo documento versionado que os blocos. Mesmo uma
    // revisão legada/externa não injeta campos livres: o normalizador reduz a
    // lista ao registro fechado antes de ela chegar à vitrine.
    plugins: Array.isArray(source.plugins)
      ? normalizeCatalogPlugins(source.plugins).plugins
      : normalizeCatalogPlugins(jsonArray(previous.plugins)).plugins
  };
  return next;
}

function applyCustomizationPatch(current, body = {}) {
  const source = jsonObject(body);
  const base = normalizeSnapshot(current);
  const pluginResult = Object.hasOwn(source, "plugins")
    ? normalizeCatalogPlugins(source.plugins)
    : { plugins: base.plugins, errors: [] };
  if (pluginResult.errors.length) {
    throw new CatalogCustomizationError(
      "Revise as integrações nativas antes de salvar o catálogo.",
      422,
      "catalog_plugins_invalid",
      { plugin_errors: pluginResult.errors }
    );
  }
  const patch = {
    settings: Object.hasOwn(source, "settings") ? source.settings : base.settings,
    theme: Object.hasOwn(source, "theme") ? source.theme : base.theme,
    banners: Array.isArray(source.banners) ? source.banners : base.banners,
    featuredCategories: Array.isArray(source.featuredCategories) ? source.featuredCategories : base.featuredCategories,
    featuredProducts: Array.isArray(source.featuredProducts) ? source.featuredProducts : base.featuredProducts,
    promotions: Array.isArray(source.promotions) ? source.promotions : base.promotions,
    catalogSections: Array.isArray(source.catalogSections) ? source.catalogSections : base.catalogSections,
    plugins: pluginResult.plugins
  };
  return normalizeSnapshot(patch, base);
}

function assertCatalogPluginFeatures(plugins, enabledFeatures) {
  if (!Array.isArray(enabledFeatures)) return;
  const allowed = new Set(enabledFeatures);
  const unavailable = jsonArray(plugins)
    .filter((plugin) => plugin?.enabled !== false)
    .map((plugin) => ({ plugin: String(plugin?.pluginId || ""), feature: catalogPluginRequiredFeature(plugin?.pluginId) }))
    .filter((item) => item.feature && !allowed.has(item.feature));
  if (!unavailable.length) return;
  throw new CatalogCustomizationError(
    "Uma ou mais integrações nativas não estão incluídas no plano desta clínica.",
    403,
    "catalog_plugin_feature_unavailable",
    { plugins: unavailable }
  );
}

// A cota é aplicada sobre integrações LIGADAS, pois são elas que entram na
// vitrine. Ao fazer downgrade, um catálogo acima da nova cota continua
// editável enquanto não aumentar o uso — a mesma regra dos outros limites do
// produto: nunca prender uma clínica aos dados que ela já possui.
function assertCatalogPluginLimit(plugins, pluginLimit, previousPlugins = []) {
  if (pluginLimit === undefined || pluginLimit === null || pluginLimit === "") return;
  const limit = Number(pluginLimit);
  if (!Number.isFinite(limit) || limit < 0) return;
  const used = countEnabledCatalogPlugins(plugins);
  const previouslyUsed = countEnabledCatalogPlugins(previousPlugins);
  if (used <= limit || (previouslyUsed > limit && used <= previouslyUsed)) return;
  throw new CatalogCustomizationError(
    "O limite de plugins ativos do catálogo para este plano foi atingido.",
    409,
    "catalog_plugin_limit_reached",
    {
      limit_key: "catalog_plugins",
      limit,
      used,
      previous_used: previouslyUsed
    }
  );
}

function defaultCatalogSections() {
  return ["hero", "categories", "featured_products", "best_sellers", "new_products", "promotions", "booking_cta", "location", "footer"]
    .map((section_type, index) => normalizeSection({ section_key: `${section_type}-${index + 1}`, section_type, title: "", sort_order: index + 1 }, index));
}

function defaultCatalogSnapshot() {
  return normalizeSnapshot({
    settings: getCatalogSettingsDefaults(),
    theme: defaultCatalogTheme(),
    banners: [{
      title: "Escolha a joia perfeita para você",
      subtitle: "Joias de alta qualidade para realçar sua essência.",
      image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
      button_text: "Ver todas as joias",
      button_link: "#catalog-products",
      banner_width: 0,
      banner_height: 340,
      banner_fit: "contain",
      is_active: 1,
      sort_order: 1
    }],
    featuredCategories: JEWELRY_CATEGORIES.map((name, index) => ({
      category_id: name, public_name: name, icon: index === 4 ? "shield" : "gem", image_url: "", is_active: 1, sort_order: index + 1
    })),
    featuredProducts: [],
    promotions: [],
    catalogSections: defaultCatalogSections()
  });
}

async function getLegacyCatalogCustomization(db, { published = false } = {}) {
  const settings = await getCatalogSettings(db);
  const theme = await db.get("SELECT * FROM catalog_theme WHERE id = 1") || defaultCatalogTheme();
  const banners = await db.all("SELECT * FROM catalog_banners ORDER BY sort_order, id");
  const featuredCategories = await db.all("SELECT * FROM catalog_featured_categories ORDER BY sort_order, id");
  const featuredProducts = await db.all(`
    SELECT fp.*, j.name, j.photo_url, j.category, j.material, j.sale_value, j.quantity
    FROM catalog_featured_products fp
    JOIN jewelry_inventory j ON j.id = fp.product_id
    ORDER BY fp.sort_order, fp.id
  `);
  const promotions = await db.all("SELECT * FROM catalog_promotions ORDER BY start_date DESC, id DESC");
  let catalogSections = await getCatalogSections(db, published ? "published" : "draft");
  // Instalações legadas podem ter apenas o layout de rascunho. Antes do v2 ele
  // era o único layout salvo; usá-lo como fallback evita uma vitrine vazia na
  // primeira publicação/migração.
  if (published && !catalogSections.length) catalogSections = await getCatalogSections(db, "draft");
  return normalizeSnapshot({ settings, theme, banners, featuredCategories, featuredProducts, promotions, catalogSections });
}

export async function getCatalogSections(db, status = "draft") {
  const layout = await db.get("SELECT * FROM catalog_layouts WHERE status = ?", [status]);
  if (!layout) return [];
  return db.all("SELECT * FROM catalog_sections WHERE layout_id = ? ORDER BY sort_order, id", [layout.id]);
}

function revisionMetadata(draft, published, { source = "draft" } = {}) {
  return {
    draft: Number(draft?.version || 0),
    published: Number(published?.version || 0),
    revision_id: published?.id ?? null,
    updated_at: draft?.updated_at || null,
    published_at: published?.published_at || null,
    source,
    // O editor deve enviar draft em PATCH/publish e published no rollback.
    // São versões otimistas, não um token secreto.
    lock: {
      expected_draft_version: Number(draft?.version || 0),
      expected_published_version: Number(published?.version || 0)
    }
  };
}

async function getLatestPublishedRevision(db) {
  return db.get("SELECT * FROM catalog_customization_revisions ORDER BY version DESC LIMIT 1");
}

async function ensureDraftForUpdate(db) {
  let draft = await db.get("SELECT * FROM catalog_customization_drafts WHERE id = 1 FOR UPDATE");
  if (draft) return draft;
  const legacySnapshot = await getLegacyCatalogCustomization(db, { published: false });
  await db.run(
    "INSERT INTO catalog_customization_drafts (id, version, snapshot) VALUES (1, 0, ?) ON CONFLICT(id) DO NOTHING",
    [JSON.stringify(legacySnapshot)]
  );
  draft = await db.get("SELECT * FROM catalog_customization_drafts WHERE id = 1 FOR UPDATE");
  return draft;
}

function expectedVersion(body, key) {
  const raw = body?.[key] ?? body?.version?.[key === "expected_draft_version" ? "draft" : "published"];
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new CatalogCustomizationError("Versão de edição inválida.", 400, "invalid_version");
  return value;
}

function assertExpectedVersion(actual, expected, name) {
  if (expected === null || expected === undefined) return;
  if (Number(actual || 0) === expected) return;
  throw new CatalogCustomizationError(
    "Este catálogo foi alterado por outra sessão. Atualize a página antes de tentar novamente.",
    409,
    "catalog_version_conflict",
    { current_version: Number(actual || 0), expected_version: expected, resource: name }
  );
}

async function hydrateFeaturedProducts(db, featuredProducts) {
  const configured = jsonArray(featuredProducts).filter((item) => Number(item?.product_id) > 0);
  if (!configured.length) return [];
  const ids = [...new Set(configured.map((item) => Number(item.product_id)))];
  const products = await db.all(
    `SELECT id, name, photo_url, image_url, category, material, sale_value, quantity
       FROM jewelry_inventory WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids
  );
  const byId = new Map(products.map((product) => [Number(product.id), product]));
  return configured
    .filter((item) => byId.has(Number(item.product_id)))
    .map((item) => ({ ...item, ...byId.get(Number(item.product_id)) }))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

async function decorateCustomization(db, snapshot, metadata) {
  const normalized = normalizeSnapshot(snapshot);
  const theme = normalized.theme;
  return {
    settings: {
      ...normalized.settings,
      brand_name: theme.brand_name || normalized.settings.brand_name,
      slogan: theme.slogan || normalized.settings.slogan,
      logo_url: theme.logo_url || normalized.settings.logo_url,
      footer_text: theme.footer_text || normalized.settings.footer_text,
      layout_style: theme.theme || normalized.settings.layout_style
    },
    theme,
    banners: normalized.banners,
    featuredCategories: normalized.featuredCategories,
    featuredProducts: await hydrateFeaturedProducts(db, normalized.featuredProducts),
    promotions: normalized.promotions,
    catalogSections: normalized.catalogSections,
    plugins: normalized.plugins,
    version: metadata
  };
}

export async function getCatalogCustomization(db, { published = false } = {}) {
  // `db` encapsula um único client Postgres por request; consultas concorrentes
  // nesse client geram aviso no pg 9. A leitura é barata e sequencial mantém a
  // sessão/tenant estritamente isolada.
  const draft = await db.get("SELECT * FROM catalog_customization_drafts WHERE id = 1");
  const revision = await getLatestPublishedRevision(db);
  if (published && revision) {
    return decorateCustomization(db, revision.snapshot, revisionMetadata(draft, revision, { source: "published_revision" }));
  }
  if (!published && draft) {
    return decorateCustomization(db, draft.snapshot, revisionMetadata(draft, revision, { source: "draft" }));
  }
  const legacySnapshot = await getLegacyCatalogCustomization(db, { published });
  return decorateCustomization(db, legacySnapshot, revisionMetadata(draft, revision, { source: "legacy" }));
}

export async function saveCatalogCustomization(db, body = {}, { userId = null, enabledFeatures, pluginLimit } = {}) {
  return db.transaction(async () => {
    const draft = await ensureDraftForUpdate(db);
    assertExpectedVersion(draft.version, expectedVersion(body, "expected_draft_version"), "draft");
    const current = normalizeSnapshot(draft.snapshot);
    const snapshot = applyCustomizationPatch(current, body);
    assertCatalogPluginFeatures(snapshot.plugins, enabledFeatures);
    assertCatalogPluginLimit(snapshot.plugins, pluginLimit, current.plugins);
    const changed = JSON.stringify(snapshot) !== JSON.stringify(current);
    const version = Number(draft.version || 0) + (changed ? 1 : 0);
    if (changed) {
      await db.run(
        "UPDATE catalog_customization_drafts SET snapshot = ?, version = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1",
        [JSON.stringify(snapshot), version, userId]
      );
    }
    return { snapshot, version };
  });
}

// Mantido para consumidores internos antigos. A implementação passa pelo
// documento v2, logo uma alteração de seções também fica em rascunho.
export async function saveCatalogLayoutDraft(db, sections = [], userId = null, options = {}) {
  const saved = await saveCatalogCustomization(db, {
    catalogSections: sections,
    expected_draft_version: options.expectedDraftVersion
  }, { userId });
  return saved.snapshot.catalogSections;
}

// Registro interno dos blocos que o renderer público conhece hoje. A lista é
// deliberadamente fechada: salvar um tipo desconhecido é tolerado no draft
// para não destruir um rascunho legado, mas publicar algo que a vitrine não
// sabe renderizar deve parar aqui, antes de chegar a visitantes.
const KNOWN_CATALOG_SECTION_TYPES = new Set([
  "hero", "secondary_banners", "categories", "featured_products", "best_sellers", "new_products",
  "promotions", "premium_products", "in_stock", "out_of_stock", "category_products", "services",
  "professionals", "location", "contact", "policies", "biosafety", "materials", "testimonials",
  "instagram", "booking_cta", "footer", "custom_content"
]);

const BUILTIN_CATALOG_ANCHORS = new Set(["catalog-products", "catalog-agenda", "catalog-search-history"]);

function catalogChecklistItem(code, path, message, extra = {}) {
  return { code, path, message, ...extra };
}

function catalogString(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

/**
 * Valida URL que vai para o `href` de CTA. Hashes e caminhos internos são
 * permitidos; para sair da plataforma só aceitamos HTTPS (e os esquemas de
 * contato mailto/tel). Isso bloqueia javascript:, data:, protocol-relative e
 * HTTP, inclusive quando o navegador os aceitaria silenciosamente.
 */
function unsafeCatalogCtaUrl(value) {
  const raw = catalogString(value);
  if (!raw) return null;
  if (/[\x00-\x1F\x7F\s]/.test(raw)) return "contém espaços ou caracteres de controle";
  if (raw.startsWith("#")) return /^#[A-Za-z][\w-]*$/.test(raw) ? null : "âncora inválida";
  if (raw.startsWith("/")) return raw.startsWith("//") || raw.includes("\\") ? "caminho relativo inseguro" : null;
  if (raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("?")) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "não é uma URL válida";
  }
  if (["https:", "mailto:", "tel:"].includes(parsed.protocol) && !parsed.username && !parsed.password) return null;
  return "use um link HTTPS, interno, e-mail ou telefone";
}

/** URL de imagem/mídia pública: não há motivo para aceitar esquemas executáveis. */
function unsafeCatalogAssetUrl(value) {
  const raw = catalogString(value);
  if (!raw) return null;
  if (/[\x00-\x1F\x7F\s]/.test(raw)) return "contém espaços ou caracteres de controle";
  if (raw.startsWith("/")) return raw.startsWith("//") || raw.includes("\\") ? "caminho relativo inseguro" : null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "não é uma URL HTTPS ou caminho interno válido";
  }
  if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return null;
  return "use uma URL HTTPS ou caminho interno";
}

// Mantido em paridade com `safeCatalogEmbedUrl` da vitrine. O checklist não
// tenta "consertar" a URL: ele só diz se o valor sobreviveria à allowlist do
// renderer e, assim, evita uma publicação com bloco de vídeo que some.
function isAllowedCatalogEmbedUrl(value) {
  let parsed;
  try {
    parsed = new URL(catalogString(value));
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return /^[\w-]{6,}$/.test(parsed.pathname.split("/").filter(Boolean)[0] || "");
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = parsed.pathname.startsWith("/embed/") ? parsed.pathname.split("/")[2] : parsed.searchParams.get("v");
    return /^[\w-]{6,}$/.test(id || "");
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") return Boolean(parsed.pathname.match(/(?:video\/)?(\d+)/)?.[1]);
  return false;
}

function readLegacyContentSections(snapshot) {
  const value = snapshot?.settings?.content_sections;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try { return Array.isArray(JSON.parse(value)) ? JSON.parse(value) : []; } catch { return []; }
}

function parseHexColor(value) {
  const color = catalogString(value);
  const match = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split("").map((part) => part + part).join("") : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function relativeLuminance(color) {
  const rgb = parseHexColor(color);
  if (!rgb) return null;
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  if (first === null || second === null) return null;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function collectCatalogCtas(snapshot) {
  const ctas = [];
  for (const [index, banner] of jsonArray(snapshot?.banners).entries()) {
    ctas.push({ path: `banners[${index}].button_link`, value: banner?.button_link });
  }
  for (const [index, section] of jsonArray(snapshot?.catalogSections).entries()) {
    ctas.push({ path: `catalogSections[${index}].button_link`, value: section?.button_link });
  }
  for (const [index, section] of readLegacyContentSections(snapshot).entries()) {
    ctas.push({ path: `settings.content_sections[${index}].button_link`, value: section?.button_link });
  }
  return ctas;
}

/**
 * Checklist puro de publicação. Não muta o snapshot, não consulta o banco e
 * aceita as estruturas anteriores ao Builder v2 (que não tinham seções).
 *
 * `errors` impede publicação; `warnings` orienta mas não bloqueia o cliente.
 */
export function catalogPublishChecklist(snapshot = {}) {
  const source = jsonObject(snapshot);
  const normalized = normalizeSnapshot(source);
  const errors = [];
  const warnings = [];

  if (Object.hasOwn(source, "plugins")) {
    const pluginValidation = normalizeCatalogPlugins(source.plugins);
    for (const error of pluginValidation.errors) {
      errors.push(catalogChecklistItem("invalid_catalog_plugin", error.path, error.message, { plugin_code: error.code }));
    }
  }

  for (const [index, banner] of jsonArray(source.banners).entries()) {
    for (const field of ["image_url", "mobile_image_url", "original_image_url"]) {
      const reason = unsafeCatalogAssetUrl(banner?.[field]);
      if (reason) errors.push(catalogChecklistItem("unsafe_banner_url", `banners[${index}].${field}`, `URL do banner ${reason}.`));
    }
    const reason = unsafeCatalogCtaUrl(banner?.button_link);
    if (reason) errors.push(catalogChecklistItem("unsafe_cta_url", `banners[${index}].button_link`, `Link do botão ${reason}.`));
  }

  // `hero_image_url` e `share_image_url` são banners/preview de catálogo
  // legados; continuamos validando-os mesmo sem um array `banners` no snapshot.
  for (const field of ["hero_image_url", "share_image_url"]) {
    const reason = unsafeCatalogAssetUrl(source?.settings?.[field]);
    if (reason) errors.push(catalogChecklistItem("unsafe_banner_url", `settings.${field}`, `URL de imagem ${reason}.`));
  }

  const sectionKeys = new Set();
  const sectionOrders = new Map();
  for (const [index, section] of jsonArray(source.catalogSections).entries()) {
    const type = catalogString(section?.section_type || "custom_content");
    if (type && !KNOWN_CATALOG_SECTION_TYPES.has(type)) {
      errors.push(catalogChecklistItem("unknown_catalog_block", `catalogSections[${index}].section_type`, `O bloco "${type}" não é reconhecido pela vitrine.`));
    }
    const key = catalogString(section?.section_key);
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(key)) {
      warnings.push(catalogChecklistItem("invalid_section_reference", `catalogSections[${index}].section_key`, "A referência da seção deve usar letras minúsculas, números e hífens."));
    } else if (sectionKeys.has(key)) {
      warnings.push(catalogChecklistItem("duplicate_section_reference", `catalogSections[${index}].section_key`, `A referência "${key}" é usada por mais de uma seção.`));
    } else {
      sectionKeys.add(key);
    }
    const order = Number(section?.sort_order);
    if (!Number.isInteger(order) || order < 1) {
      warnings.push(catalogChecklistItem("invalid_section_order", `catalogSections[${index}].sort_order`, "A ordem da seção deve ser um número inteiro maior que zero."));
    } else if (sectionOrders.has(order)) {
      warnings.push(catalogChecklistItem("duplicate_section_order", `catalogSections[${index}].sort_order`, `A ordem ${order} também é usada pela seção ${sectionOrders.get(order) + 1}.`));
    } else {
      sectionOrders.set(order, index);
    }
    const reason = unsafeCatalogCtaUrl(section?.button_link);
    if (reason) errors.push(catalogChecklistItem("unsafe_cta_url", `catalogSections[${index}].button_link`, `Link do botão ${reason}.`));

    const looksLikeEmbed = ["video", "iframe", "embed"].includes(catalogString(section?.media_type || section?.type))
      || Object.hasOwn(section || {}, "embed_url") || Object.hasOwn(section || {}, "iframe_url");
    const embed = section?.embed_url || section?.iframe_url || (looksLikeEmbed ? section?.media_url || section?.src : "");
    if (catalogString(embed) && !isAllowedCatalogEmbedUrl(embed)) {
      errors.push(catalogChecklistItem("unallowed_catalog_embed", `catalogSections[${index}].media_url`, "Embed não permitido. Use um vídeo público do YouTube ou Vimeo."));
    }
  }

  for (const [index, section] of readLegacyContentSections(source).entries()) {
    const reason = unsafeCatalogCtaUrl(section?.button_link);
    if (reason) errors.push(catalogChecklistItem("unsafe_cta_url", `settings.content_sections[${index}].button_link`, `Link do botão ${reason}.`));
    const embed = section?.embed_url || section?.iframe_url || (catalogString(section?.media_type) === "video" ? section?.media_url : "");
    if (catalogString(embed) && !isAllowedCatalogEmbedUrl(embed)) {
      errors.push(catalogChecklistItem("unallowed_catalog_embed", `settings.content_sections[${index}].media_url`, "Embed não permitido. Use um vídeo público do YouTube ou Vimeo."));
    }
  }

  const anchors = new Set([...BUILTIN_CATALOG_ANCHORS, ...sectionKeys]);
  for (const cta of collectCatalogCtas(source)) {
    const value = catalogString(cta.value);
    if (value.startsWith("#") && !anchors.has(value.slice(1))) {
      warnings.push(catalogChecklistItem("unknown_section_reference", cta.path, `A âncora "${value}" não corresponde a uma seção ou área conhecida do catálogo.`));
    }
  }

  const colors = [
    ["text_color", normalized.settings.text_color, "site_background", normalized.settings.site_background],
    ["heading_color", normalized.settings.heading_color, "section_background", normalized.settings.section_background],
    ["button_text_color", normalized.settings.button_text_color, "theme.button_color", normalized.theme.button_color]
  ];
  for (const [foregroundName, foreground, backgroundName, background] of colors) {
    const ratio = contrastRatio(foreground, background);
    if (ratio !== null && ratio < 4.5) {
      warnings.push(catalogChecklistItem(
        "insufficient_theme_contrast",
        `settings.${foregroundName}`,
        `O contraste entre ${foregroundName} e ${backgroundName} é ${ratio.toFixed(2)}:1; o recomendado para texto normal é 4.5:1.`,
        { contrast_ratio: Number(ratio.toFixed(2)), foreground: foregroundName, background: backgroundName }
      ));
    }
  }

  return { errors, warnings, ready: errors.length === 0 };
}

/** Lê somente o rascunho atual (ou o snapshot legado quando ainda não há v2). */
export async function getCatalogCustomizationChecklist(db) {
  const draft = await db.get("SELECT snapshot FROM catalog_customization_drafts WHERE id = 1");
  const snapshot = draft?.snapshot ? draft.snapshot : await getLegacyCatalogCustomization(db, { published: false });
  return catalogPublishChecklist(snapshot);
}

export async function publishCatalogCustomization(db, body = {}, { userId = null, enabledFeatures, pluginLimit } = {}) {
  return db.transaction(async () => {
    const draft = await ensureDraftForUpdate(db);
    assertExpectedVersion(draft.version, expectedVersion(body, "expected_draft_version"), "draft");

    // Publicar conserva a ergonomia da API anterior: se o formulário completo
    // veio no POST, ele é salvo no draft e publicado na mesma transação.
    const current = normalizeSnapshot(draft.snapshot);
    const snapshot = applyCustomizationPatch(current, body);
    assertCatalogPluginFeatures(snapshot.plugins, enabledFeatures);
    assertCatalogPluginLimit(snapshot.plugins, pluginLimit, current.plugins);
    const checklist = catalogPublishChecklist(snapshot);
    if (!checklist.ready) {
      throw new CatalogCustomizationError(
        "Corrija os erros do checklist antes de publicar o catálogo.",
        422,
        "catalog_publish_blocked",
        { checklist }
      );
    }
    const changed = JSON.stringify(snapshot) !== JSON.stringify(current);
    const draftVersion = Number(draft.version || 0) + (changed ? 1 : 0);
    if (changed) {
      await db.run(
        "UPDATE catalog_customization_drafts SET snapshot = ?, version = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1",
        [JSON.stringify(snapshot), draftVersion, userId]
      );
    }
    const previous = await getLatestPublishedRevision(db);
    const revisionVersion = Number(previous?.version || 0) + 1;
    const created = await db.run(
      `INSERT INTO catalog_customization_revisions (version, action, source_revision_id, snapshot, created_by)
       VALUES (?, 'publish', ?, ?, ?) RETURNING id, version, action, source_revision_id, published_at, created_at, created_by`,
      [revisionVersion, previous?.id ?? null, JSON.stringify(snapshot), userId]
    );
    return { snapshot, draftVersion, revision: created.rows[0], checklist };
  });
}

// Compatibilidade para chamadas que antes publicavam somente layout. Agora a
// revisão sempre contém o snapshot inteiro, evitando que seções e tema saiam
// de sincronia na vitrine.
export async function publishCatalogLayout(db, userId = null, options = {}) {
  const published = await publishCatalogCustomization(db, {
    expected_draft_version: options.expectedDraftVersion
  }, { userId });
  return published.snapshot.catalogSections;
}

export async function listCatalogCustomizationHistory(db, { limit = 30 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const revisions = await db.all(
    `SELECT id, version, action, source_revision_id, published_at, created_at, created_by
       FROM catalog_customization_revisions ORDER BY version DESC LIMIT ?`,
    [safeLimit]
  );
  const draft = await db.get("SELECT * FROM catalog_customization_drafts WHERE id = 1");
  const published = await getLatestPublishedRevision(db);
  return { revisions, version: revisionMetadata(draft, published, { source: published ? "published_revision" : "legacy" }) };
}

export async function getCatalogCustomizationRevision(db, version) {
  const revision = await db.get(
    "SELECT id, version, action, source_revision_id, snapshot, published_at, created_at, created_by FROM catalog_customization_revisions WHERE version = ?",
    [Number(version)]
  );
  if (!revision) throw new CatalogCustomizationError("Revisão do catálogo não encontrada.", 404, "catalog_revision_not_found");
  return revision;
}

export async function rollbackCatalogCustomization(db, targetVersion, body = {}, { userId = null, enabledFeatures, pluginLimit } = {}) {
  return db.transaction(async () => {
    const draft = await ensureDraftForUpdate(db);
    const current = await getLatestPublishedRevision(db);
    assertExpectedVersion(draft.version, expectedVersion(body, "expected_draft_version"), "draft");
    assertExpectedVersion(current?.version || 0, expectedVersion(body, "expected_published_version"), "published");
    const target = await getCatalogCustomizationRevision(db, targetVersion);
    const snapshot = normalizeSnapshot(target.snapshot);
    assertCatalogPluginFeatures(snapshot.plugins, enabledFeatures);
    assertCatalogPluginLimit(snapshot.plugins, pluginLimit, normalizeSnapshot(draft.snapshot).plugins);
    const draftVersion = Number(draft.version || 0) + 1;
    await db.run(
      "UPDATE catalog_customization_drafts SET snapshot = ?, version = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1",
      [JSON.stringify(snapshot), draftVersion, userId]
    );
    const revisionVersion = Number(current?.version || 0) + 1;
    const created = await db.run(
      `INSERT INTO catalog_customization_revisions (version, action, source_revision_id, snapshot, created_by)
       VALUES (?, 'rollback', ?, ?, ?) RETURNING id, version, action, source_revision_id, published_at, created_at, created_by`,
      [revisionVersion, target.id, JSON.stringify(snapshot), userId]
    );
    return { snapshot, draftVersion, revision: created.rows[0], restored_from_version: target.version };
  });
}

export async function resetCatalogCustomization(db, body = {}, { userId = null } = {}) {
  return db.transaction(async () => {
    const draft = await ensureDraftForUpdate(db);
    assertExpectedVersion(draft.version, expectedVersion(body, "expected_draft_version"), "draft");
    const snapshot = defaultCatalogSnapshot();
    const version = Number(draft.version || 0) + 1;
    await db.run(
      "UPDATE catalog_customization_drafts SET snapshot = ?, version = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = 1",
      [JSON.stringify(snapshot), version, userId]
    );
    return { snapshot, version };
  });
}

export function validateImageTransform(value) {
  const source = value == null || value === "" ? {} : value;
  if (typeof source !== "object" || Array.isArray(source)) {
    const error = new Error("Configuração de enquadramento inválida.");
    error.statusCode = 400;
    throw error;
  }
  const fitMode = source.fitMode || "contain";
  const numericRules = [
    ["focalPointX", 0, 100, 50],
    ["focalPointY", 0, 100, 50],
    ["zoom", 0.5, 3, 1],
    ["rotation", -360, 360, 0]
  ];
  if (!["contain", "cover", "custom"].includes(fitMode)) {
    const error = new Error("Modo de enquadramento inválido.");
    error.statusCode = 400;
    throw error;
  }
  const normalized = { fitMode };
  for (const [key, min, max, fallback] of numericRules) {
    const number = source[key] == null ? fallback : Number(source[key]);
    if (!Number.isFinite(number) || number < min || number > max) {
      const error = new Error(`Valor inválido para ${key}.`);
      error.statusCode = 400;
      throw error;
    }
    normalized[key] = number;
  }
  normalized.flipHorizontal = Boolean(source.flipHorizontal);
  normalized.aspectRatio = String(source.aspectRatio || "16/5");
  return normalized;
}
