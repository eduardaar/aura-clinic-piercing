import { asArray, removeAccents } from "../../lib/utils.js";

export function catalogCategoryTerms(category) {
  return {
    Labret: ["labret"],
    Argolas: ["argolas", "argola", "segmento", "clicker", "d-ring", "captive", "hinged ring"],
    "Barbell Reto": ["barbell reto"],
    "Barbell Curvo": ["barbell curvo"],
    Nostril: ["nostril"],
    Topos: ["topos", "topo"],
    Microdermal: ["microdermal"],
    Surface: ["surface"],
    "Ouro 14k": ["ouro 14k"],
    "Ouro 18k": ["ouro 18k"]
  }[category] || [String(category || "").toLowerCase()];
}

export function catalogPromotionForItem(item, promotions = []) {
  const today = new Date().toISOString().slice(0, 10);
  return asArray(promotions).find((promotion) => {
    if (!Boolean(Number(promotion.is_active))) return false;
    if (promotion.start_date && promotion.start_date > today) return false;
    if (promotion.end_date && promotion.end_date < today) return false;
    if (promotion.applies_to === "all") return true;
    const productIds = String(promotion.product_ids || "").split(",").map((id) => id.trim()).filter(Boolean);
    const categoryIds = String(promotion.category_ids || "").split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
    if (promotion.applies_to === "products") return productIds.includes(String(item.id));
    if (promotion.applies_to === "categories") return categoryIds.some((category) => `${item.category} ${item.material}`.toLowerCase().includes(category));
    return false;
  });
}

export function promotionalPrice(value, promotion) {
  if (!promotion) return null;
  const discount = Number(promotion.discount_value || 0);
  if (promotion.discount_type === "fixed") return Math.max(value - discount, 0);
  return Math.max(value - (value * discount / 100), 0);
}

export function catalogStockText(item, theme = {}, settings = {}) {
  const mode = theme.stock_display_mode || "status";
  if (mode === "hidden") return "";
  const quantity = Number(item.quantity || 0);
  if (mode === "quantity" || Boolean(Number(theme.show_stock_quantity))) return `${quantity} em estoque`;
  if (quantity <= 0) return settings.unavailable_message || "Indisponível";
  if (quantity <= 2) return settings.low_stock_message || "Poucas unidades";
  return "Em estoque";
}

export function catalogItemIsAvailable(item = {}) {
  const variants = asArray(item.variants).filter((variant) => Number(variant.is_active ?? 1) === 1);
  return variants.length
    ? variants.some((variant) => Number(variant.quantity || 0) > 0)
    : Number(item.quantity || 0) > 0;
}

export function catalogAvailabilityMatches(item, availability = "", showOutOfStock = false) {
  const available = catalogItemIsAvailable(item);
  if (availability === "true") return available;
  if (availability === "false") return !available;
  return Boolean(showOutOfStock) || available;
}

export function catalogFilterOptions(items) {
  const safeItems = asArray(items);
  const variants = safeItems.flatMap((item) => asArray(item?.variants));
  const unique = (key, source = safeItems) => [...new Set(asArray(source).map((item) => cleanDisplayText(item?.[key])).filter(Boolean))].sort();

  return {
    categories: unique("category"),
    subcategories: unique("subcategory"),
    materials: unique("material", variants),
    colors: [...new Set(asArray(variants).flatMap((variant) => splitColorOptions(variant?.color)))].sort(),
    stones: unique("stone"),
    sizes: unique("size", variants),
    topSizes: [...new Set(variants.map((item) => Number(item?.top_size_mm)).filter((value) => value > 0))].sort((a, b) => a - b),
    thicknesses: unique("thickness", variants),
    suppliers: unique("supplier", variants),
    locations: unique("physical_location")
  };
}

export function cleanDisplayText(value = "") {
  return String(value || "")
    .replace(/tit\?nio/gi, "titânio")
    .replace(/titï¿½nio/gi, "titânio")
    .replace(/zirc\?nia/gi, "zircônia")
    .replace(/a\?o/gi, "aço")
    .replace(/sem informa\?\?o/gi, "sem informação")
    .replace(/promo\?\?o/gi, "promoção")
    .replace(/varia\?\?o/gi, "variação")
    .replace(/dispon\?vel/gi, "disponível")
    .replace(/observa\?\?o/gi, "observação")
    .replace(/ÃƒÂ¢/g, "â")
    .replace(/ÃƒÂ£/g, "ã")
    .replace(/ÃƒÂ§/g, "ç")
    .replace(/ÃƒÂ©/g, "é")
    .replace(/ÃƒÂ­/g, "í")
    .replace(/ÃƒÂ³/g, "ó")
    .replace(/ÃƒÂµ/g, "õ")
    .replace(/ÃƒÂº/g, "ú")
    .replace(/Ã‚Â·/g, "·")
    .trim();
}

export function elegantProductName(value = "") {
  const smallWords = new Set(["de", "da", "do", "das", "dos", "e", "com", "para"]);
  const normalized = cleanDisplayText(value)
    .replace(/^Joias Premium\b/i, "Joia Premium")
    .replace(/\bTitanio\b/gi, "Titânio")
    .replace(/\bZirconia\b/gi, "Zircônia")
    .replace(/\s+/g, " ")
    .trim();
  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      if (/^\d+(?:k|mm)?$/i.test(word)) return word.toLowerCase();
      if (index > 0 && smallWords.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}

export function splitColorOptions(value = "") {
  return [...new Set(String(value).split(",").map((item) => elegantProductName(item.trim())).filter(Boolean))];
}

export function normalizeJewelryMaterial(value = "") {
  const normalized = removeAccents(String(value).toLowerCase());
  if (normalized.includes("titanio")) return "Titânio ASTM F136";
  if (normalized.includes("ouro 14")) return "Ouro 14k";
  if (normalized.includes("ouro 18")) return "Ouro 18k";
  if (normalized.includes("aco")) return "Aço";
  return value ? elegantProductName(value) : "Titânio ASTM F136";
}

export function normalizeJewelryThread(value = "") {
  const normalized = removeAccents(String(value).toLowerCase());
  if (normalized === "interna") return "Interna";
  if (normalized === "externa") return "Externa";
  if (["threadless", "push pin", "pushpin"].includes(normalized)) return "Push Pin";
  return value ? elegantProductName(value) : "";
}

// Seção de conteúdo padrão do catálogo. Compartilhada entre a tela de
// Personalização (edição) e o Catálogo público (renderização) — antes vivia
// só no CatalogCustomization e o PublicExperience a usava sem definir.
export function defaultContentSection(order) {
  return {
    kicker: "Guia Aura",
    title: "Escolha sua joia com orientação profissional",
    text: "Use este espaço para explicar materiais, cuidados, medidas, anodização, curadoria ou diferenciais da Aura Clinic.",
    media_type: "image",
    media_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    button_text: "Agendar atendimento",
    button_link: "/agendar",
    active: true,
    order
  };
}

// Normaliza uma seção de conteúdo do catálogo (merge com o padrão + flags).
export function normalizeCatalogContentSection(section, index = 0) {
  return {
    ...defaultContentSection(index + 1),
    ...section,
    active: section.active === undefined ? true : Boolean(section.active),
    order: Number(section.order || index + 1)
  };
}

// Converte o content_sections (array ou JSON string) numa lista normalizada.
// Compartilhado entre a Personalização (edição) e o Catálogo público (render).
export function catalogContentSections(value) {
  if (Array.isArray(value)) return value.map(normalizeCatalogContentSection);
  if (!value) return [defaultContentSection(1)];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(normalizeCatalogContentSection) : [defaultContentSection(1)];
  } catch {
    return [defaultContentSection(1)];
  }
}

function hasText(value) {
  return typeof value === "string" ? Boolean(value.trim()) : value !== undefined && value !== null && value !== false;
}

// Public sections must not reserve layout space unless they can render useful
// content. Keep this decision in one place so the storefront and its editor do
// not drift into different definitions of an "empty" section.
export function hasRenderableContent(section = {}) {
  if (!section || section.active === false || section.is_active === 0 || section.is_active === "0") return false;
  const type = section.type || section.section_type || "custom";
  if (type === "location") return [section.address, section.map_url, section.iframe_url].some(hasText)
    || (Number.isFinite(Number(section.latitude)) && Number.isFinite(Number(section.longitude)));
  if (type === "instagram") return [section.username, section.url, section.embed_url].some(hasText);
  if (type === "whatsapp") return [section.phone, section.url].some(hasText);
  if (type === "banner") return [section.image_url, section.media_url].some(hasText);
  if (type === "video" || type === "iframe") return [section.url, section.src, section.embed_url].some(hasText);
  if (type === "footer") return [section.institutional_text, section.whatsapp_phone, section.company_instagram,
    section.company_email, section.company_hours, section.company_address, section.logo_url, section.display_name,
    section.slogan, section.copyright_text].some(hasText);
  return [section.title, section.text, section.image_url, section.media_url, section.url].some(hasText)
    || (Array.isArray(section.items) && section.items.length > 0);
}
