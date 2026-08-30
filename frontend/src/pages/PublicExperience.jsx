import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Gem,
  Heart,
  Instagram,
  LayoutGrid,
  Mail,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star
} from "lucide-react";
import { Loading, ApiError } from "../components/common/Feedback";
import { BookingChoiceGrid, Checkbox, Input, Select } from "../components/common/Ui";
import { API_ORIGIN, publicApiFetch, usePublicFetch } from "../lib/api";
import { asArray, asNumber, asObject, formatLongDate, removeAccents } from "../lib/utils";
import { readRecentSearches, saveRecentSearch, smartSearchMatches, useDebouncedValue } from "../lib/smartSearch";
import { JEWELRY_CATEGORY_OPTIONS, defaultPublicBooking, nextBookingDates, parseGalleryUrls } from "../lib/defaultForms";
import {
  catalogAvailabilityMatches,
  catalogCategoryTerms,
  catalogContentSections,
  catalogFilterOptions,
  catalogPromotionForItem,
  catalogStockText,
  cleanDisplayText,
  elegantProductName,
  hasRenderableContent,
  promotionalPrice,
  splitColorOptions
} from "../features/catalog/catalogUtils";
import { variantCatalogLabel } from "../features/shared/helpers";
import { CatalogNativePlugins } from "../features/catalog/CatalogNativePlugins";
import { catalogUrl, publicTenant, publicUrl, replaceCatalogState } from "../lib/publicRoutes";
import { imageTransformStyle, normalizeImageTransform } from "../components/common/ImageEditor";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// --- CPF/CNPJ do cliente final ----------------------------------------------
//
// Um único jeito para as duas portas públicas (checkout do catálogo e
// agendamento): antes só o checkout tinha o campo, sem máscara nem validação, e
// o agendamento não tinha campo nenhum — o que derrubava o sinal online para o
// caminho manual mesmo com gateway configurado.
//
// A validação de verdade é a do backend (`services/taxId.js`, mesma regra). Esta
// existe para o erro aparecer no campo, antes do envio, em vez de voltar como
// 400 depois de o formulário inteiro ter sido preenchido.

function taxIdDigits(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 14);
}

/** Máscara progressiva: CPF até 11 dígitos, CNPJ acima disso. */
export function formatTaxId(value) {
  const digits = taxIdDigits(value);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

function taxIdCheckDigit(digits, length) {
  let sum = 0;
  for (let index = 0; index < length; index++) sum += Number(digits[index]) * (length + 1 - index);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function companyCheckDigit(digits, length) {
  let sum = 0;
  let weight = length - 7;
  for (let index = 0; index < length; index++) {
    sum += Number(digits[index]) * weight;
    weight = weight - 1 < 2 ? 9 : weight - 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * @param {string} value Documento digitado, com ou sem máscara.
 * @param {boolean} [required] Quando o campo em branco já é erro.
 * @returns {string} Mensagem de erro, ou string vazia quando está tudo certo.
 */
export function taxIdError(value, required = false) {
  const digits = taxIdDigits(value);
  if (!digits) return required ? "Informe o CPF para gerar o link do sinal." : "";
  // Repetidos (111.111.111-11) passam no módulo 11 mas não existem.
  if (digits.length === 11) {
    const valido = !/^(\d)\1{10}$/.test(digits)
      && taxIdCheckDigit(digits, 9) === Number(digits[9])
      && taxIdCheckDigit(digits, 10) === Number(digits[10]);
    return valido ? "" : "CPF inválido. Confira os números digitados.";
  }
  if (digits.length === 14) {
    const valido = !/^(\d)\1{13}$/.test(digits)
      && companyCheckDigit(digits, 12) === Number(digits[12])
      && companyCheckDigit(digits, 13) === Number(digits[13]);
    return valido ? "" : "CNPJ inválido. Confira os números digitados.";
  }
  return `Documento deve ter 11 dígitos (CPF) ou 14 (CNPJ); você digitou ${digits.length}.`;
}

function catalogSessionKey() {
  const key = "aura-catalog-session";
  try {
    const current = sessionStorage.getItem(key);
    if (current) return current;
    const created = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now()}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `anonymous${Date.now()}`;
  }
}

function trackCatalogEvent(eventType, productId = null, metadata = {}) {
  publicApiFetch("/catalog/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, product_id: productId, session_key: catalogSessionKey(), metadata })
  }).catch(() => {});
}

// Leitura resiliente do localStorage do catálogo público (favoritos / itens do pedido).
function readCatalogStorage(key, fallback = []) {
  try {
    const raw = localStorage.getItem(`${key}:${publicTenant() || "default"}`) || localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function PublicCatalog() {
  const discoveryRef = useRef(null);
  const productsRef = useRef(null);
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "1" && window.parent !== window;
  const [previewData, setPreviewData] = useState(null);
  const { data: publicData } = usePublicFetch("/catalog");
  const data = previewData || publicData;
  const initialQuery = new URLSearchParams(window.location.search);
  const [activeCategory, setActiveCategory] = useState(initialQuery.get("category") || "Todos");
  const [search, setSearch] = useState(initialQuery.get("q") || "");
  const debouncedSearch = useDebouncedValue(search);
  const [recentSearches, setRecentSearches] = useState(() => readRecentSearches("aura-catalog-recent-searches"));
  const [filters, setFilters] = useState({ material: initialQuery.get("material") || "", color: initialQuery.get("color") || "", stone: initialQuery.get("stone") || "", size: initialQuery.get("size") || "", topSize: initialQuery.get("topSize") || "", availability: initialQuery.get("available") || "" });
  const [sort, setSort] = useState(initialQuery.get("sort") || "recentes");
  const [favoriteIds, setFavoriteIds] = useState(() => readCatalogStorage("aura-catalog-favorites", []));
  const [orderItems, setOrderItems] = useState(() => readCatalogStorage("aura-catalog-order", []));
  const [drawer, setDrawer] = useState(null);
  const [bannerIndex, setBannerIndex] = useState(0);
  const catalogRoute = window.location.pathname;
  const selectedProductId = Number((catalogRoute.match(/^\/catalogo\/produto\/(\d+)/) || [])[1] || 0);

  // O editor manda o snapshot atual para um iframe da própria vitrine. Não há
  // endpoint público de rascunho: a mensagem só é aceita da mesma origem e o
  // conteúdo nunca é persistido nem exposto para visitantes.
  useEffect(() => {
    if (!previewMode) return undefined;
    const receivePreview = (event) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const message = asObject(event.data);
      if (message.type !== "aura-catalog-preview" || !message.catalog || typeof message.catalog !== "object") return;
      setPreviewData(message.catalog);
    };
    window.addEventListener("message", receivePreview);
    if (window.parent !== window) window.parent.postMessage({ type: "aura-catalog-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", receivePreview);
  }, [previewMode]);

  useEffect(() => {
    if (previewMode) return;
    writeCatalogStorage("aura-catalog-favorites", favoriteIds);
  }, [favoriteIds, previewMode]);

  useEffect(() => {
    if (previewMode) return;
    writeCatalogStorage("aura-catalog-order", orderItems);
  }, [orderItems, previewMode]);

  useEffect(() => {
    if (previewMode) return;
    replaceCatalogState({
      category: activeCategory !== "Todos" ? activeCategory : "",
      q: debouncedSearch.trim(),
      material: filters.material,
      color: filters.color,
      stone: filters.stone,
      size: filters.size,
      topSize: filters.topSize,
      available: filters.availability,
      sort: sort !== "recentes" ? sort : ""
    });
  }, [activeCategory, debouncedSearch, filters, sort, previewMode]);

  useEffect(() => {
    const activeCount = asArray(data?.banners).filter((banner) => Boolean(asNumber(banner?.is_active))).length;
    if (activeCount <= 1) return undefined;
    const timer = window.setInterval(() => setBannerIndex((index) => (index + 1) % activeCount), 4500);
    return () => window.clearInterval(timer);
  }, [data?.banners]);

  useEffect(() => {
    if (!previewMode && data && !data.error) trackCatalogEvent("catalog_view");
  }, [Boolean(data && !data.error), previewMode]);

  useEffect(() => {
    if (!previewMode && selectedProductId) trackCatalogEvent("product_view", selectedProductId);
  }, [selectedProductId, previewMode]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const safeData = asObject(data);
  const theme = asObject(safeData.theme);
  const settings = safeData;
  const layoutSections = asArray(safeData.catalogSections);
  const layoutRows = catalogLayoutRows(layoutSections);
  const hasLayoutRows = layoutRows.length > 0;
  const hasBuilderMenu = layoutRows.some((row) => row.columns.some((column) => column.components.some((component) => component.section_type === "menu")));
  // A ordem é parte do conteúdo publicado. Nunca usamos `.find()` aqui: duas
  // seções do mesmo tipo precisam continuar sendo duas instâncias distintas.
  const publishedLayout = hasLayoutRows ? [] : catalogLayoutSections(layoutSections);
  const contentSections = catalogContentSections(settings.content_sections);
  const activeBanners = asArray(safeData.banners).filter((banner) => Boolean(asNumber(banner?.is_active))).sort((a, b) => asNumber(a?.sort_order) - asNumber(b?.sort_order));
  const fallbackBanner = {
    title: data.title || "Escolha a joia perfeita para você",
    subtitle: data.subtitle || "",
    image_url: data.hero_image_url,
    button_text: "Ver todas as joias",
    button_link: "#catalog-products",
    banner_width: 0,
    banner_height: 340,
    banner_fit: "cover"
  };
    const banners = activeBanners.length ? activeBanners : [fallbackBanner];
  const activeBanner = banners[bannerIndex % banners.length] || fallbackBanner;
  const categories = asArray(catalogCategoriesFromCatalog(safeData));
  const catalogItems = asArray(safeData.items);
  // Durante a transição dos campos legados, a vitrine só recebe produto cuja
  // publicação esteja completa. O backend aplica a mesma regra.
  const publishedItems = catalogItems.filter((item) => (
    Boolean(Number(item.is_catalog_active)) &&
    Boolean(Number(item.is_published)) &&
    Boolean(Number(item.virtual_store_active))
  ));
  const selectedProduct = publishedItems.find((item) => asNumber(item?.id) === selectedProductId) || null;
  const filteredItems = publishedItems.filter((item) => {
    const variants = asArray(item.variants);
    const haystack = removeAccents(`${item.name} ${item.description} ${item.category} ${item.subcategory} ${item.material} ${item.color} ${item.stone} ${item.size} ${item.thickness} ${item.sku} ${variants.map((variant) => Object.values(variant).join(" ")).join(" ")}`.toLowerCase());
    const activeCategoryConfig = categories.find((category) => category.name === activeCategory);
    const categoryMatch = activeCategory === "Todos" || catalogCategoryTerms(activeCategoryConfig?.match || activeCategory).some((term) => haystack.includes(term));
    const searchMatch = smartSearchMatches(haystack, debouncedSearch);
    const matchesVariant = (key, value) => !value || variants.some((variant) => String(variant[key] ?? "").toLowerCase().includes(String(value).toLowerCase()));
    const materialMatch = !filters.material || item.material === filters.material || matchesVariant("material", filters.material);
    const colorMatch = !filters.color || String(item.color || "").toLowerCase().includes(filters.color.toLowerCase()) || matchesVariant("color", filters.color);
    const stoneMatch = !filters.stone || String(item.stone || "").toLowerCase().includes(filters.stone.toLowerCase()) || matchesVariant("stone_color", filters.stone);
    const sizeMatch = !filters.size || item.size === filters.size || matchesVariant("size", filters.size);
    const topSizeMatch = !filters.topSize || Number(item.top_size_mm) === Number(filters.topSize) || variants.some((variant) => Number(variant.top_size_mm) === Number(filters.topSize));
    const availabilityMatch = catalogAvailabilityMatches(item, filters.availability, Boolean(Number(theme.show_out_of_stock)));
    return categoryMatch && searchMatch && materialMatch && colorMatch && stoneMatch && sizeMatch && topSizeMatch && availabilityMatch;
  });
  const items = [...filteredItems].sort((a, b) => sort === "menor-preco" ? a.sale_value - b.sale_value : sort === "maior-preco" ? b.sale_value - a.sale_value : sort === "nome-az" ? a.name.localeCompare(b.name) : sort === "nome-za" ? b.name.localeCompare(a.name) : sort === "estoque" ? Number(b.quantity) - Number(a.quantity) : b.id - a.id);
  const options = catalogFilterOptions(publishedItems);
  const latestItems = publishedItems.filter((item) => Number(item.quantity || 0) > 0).sort((a, b) => b.id - a.id);
  const bestSellerItems = publishedItems.filter((item) => Number(item.quantity || 0) > 0).sort((a, b) => Number(b.sale_value || 0) - Number(a.sale_value || 0));
  const promoItems = publishedItems.filter((item) => catalogPromotionForItem(item, asArray(safeData.promotions)));
  const safeFavoriteIds = asArray(favoriteIds);
  const safeOrderItems = asArray(orderItems);
  const favoriteItems = publishedItems.filter((item) => safeFavoriteIds.includes(item.id));
  const orderTotal = safeOrderItems.reduce((sum, item) => sum + asNumber(item?.sale_value) * asNumber(item?.qty, 1), 0);
  const catalogStyle = {
    "--catalog-primary": theme.primary_color || "#C8A96A",
    "--catalog-secondary": theme.secondary_color || "#D8C3A5",
    "--catalog-accent": settings.footer_inherit_main_palette === "1" ? (theme.button_color || theme.primary_color) : (settings.footer_accent_color || theme.primary_color),
    "--catalog-bg": settings.site_background || theme.background_color || "#F8F5F0",
    "--catalog-section-bg": settings.section_background || "#ffffff",
    "--catalog-button": theme.button_color || "#C8A96A",
    "--catalog-button-text": settings.button_text_color || "#ffffff",
    "--catalog-text": settings.text_color || "#1c1c1c",
    "--catalog-muted": settings.muted_text_color || "#74685e",
    "--catalog-heading": settings.heading_color || settings.text_color || "#1c1c1c",
    "--catalog-link": settings.link_color || theme.primary_color || "#8b642f",
    "--catalog-link-hover": settings.link_hover_color || theme.button_color || "#5f421d",
    "--catalog-icon": settings.icon_color || theme.primary_color || "#8b642f",
    "--catalog-border": settings.border_color || theme.secondary_color || "#d8c3a5",
    fontFamily: theme.body_font || "Inter"
  };
  const footerLogo = settings.footer_logo_url || theme.logo_url;
  const footerDisplayName = settings.footer_display_name || theme.brand_name || settings.company_display_name || data.brand_name;

  function toggleFavorite(item) {
    setFavoriteIds((current) => {
      const safeCurrent = asArray(current);
      return safeCurrent.includes(item.id) ? safeCurrent.filter((id) => id !== item.id) : [...safeCurrent, item.id];
    });
  }

function addToOrder(item) {
    if (!previewMode) trackCatalogEvent("product_selected", item.id, { variation_id: item.selected_variant_id || null });
    setOrderItems((currentValue) => {
      const current = asArray(currentValue);
      const orderKey = `${item.id}-${item.selected_variant_id || "produto"}-${item.selected_color || "sem-cor"}`;
      const existing = current.find((orderItem) => orderItem.order_key === orderKey);
      const increment = Math.max(1, Number(item.requested_qty || 1));
      const maximum = Math.max(1, Number(item.quantity || increment));
      if (existing) return current.map((orderItem) => orderItem.order_key === orderKey ? { ...orderItem, qty: Math.min(maximum, Number(orderItem.qty || 1) + increment) } : orderItem);
      return [...current, { ...item, order_key: orderKey, qty: Math.min(maximum, increment) }];
    });
  }

  function removeFromOrder(id) {
    setOrderItems((current) => asArray(current).filter((item) => (item.order_key || item.id) !== id));
  }

  function updateOrderItemNotes(id, notes) {
    setOrderItems((current) => asArray(current).map((item) => ((item.order_key || item.id) === id ? { ...item, customer_notes: notes } : item)));
  }

  function updateOrderItemQuantity(id, quantity) {
    setOrderItems((current) => asArray(current).map((item) => {
      if ((item.order_key || item.id) !== id) return item;
      const max = Math.max(1, Number(item.quantity || 1));
      return { ...item, qty: Math.min(Math.max(1, Number(quantity || 1)), max) };
    }));
  }

  if (selectedProduct) {
    return (
      <CatalogProductDetail
        item={selectedProduct}
        data={data}
        theme={theme}
        settings={settings}
        favorite={favoriteIds.includes(selectedProduct.id)}
        onToggleFavorite={() => toggleFavorite(selectedProduct)}
        onScheduleWithJewelry={(variant) => {
          window.location.href = bookingJewelryUrl(selectedProduct, variant);
        }}
        onAddToOrder={(variant) => {
          addToOrder(variant ? {
            ...selectedProduct,
            selected_variant_id: variant.id,
            selected_variant_name: variant.variation_name,
            selected_color: variant.selected_color || "",
            sale_value: variant.sale_value,
            customer_notes: [
              variant.variation_name,
              variant.selected_color && `Cor: ${variant.selected_color}`
            ].filter(Boolean).join(" · ")
          } : selectedProduct);
          setDrawer("order");
        }}
      />
    );
  }

  return (
    <main className={`catalog-page theme-${theme.theme || "premium"}`} style={catalogStyle}>
      <section className="catalog-main">
        {!hasBuilderMenu && <header className="catalog-topbar" style={{ order: -30 }}>
          <a className="catalog-client-brand" href={catalogUrl()}>
            {theme.logo_url && <img src={catalogImageUrl(theme.logo_url)} alt={theme.brand_name || settings.company_display_name || "Estúdio"} />}
            <strong>{theme.brand_name || settings.company_display_name || data.brand_name || "Estúdio"}</strong>
            <span>{theme.slogan || data.slogan || "Piercing e joias selecionadas"}</span>
          </a>
          <div className="catalog-top-actions">
            <label className="catalog-search catalog-search-desktop">
              <Search size={17} />
              <input
                value={search}
                list="catalog-search-history"
                onChange={(event) => setSearch(event.target.value)}
                onBlur={() => setRecentSearches(saveRecentSearch("aura-catalog-recent-searches", search))}
                placeholder="Buscar joia, SKU, material, pedra ou tamanho"
              />
              <datalist id="catalog-search-history">
                {recentSearches.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            {Boolean(Number(theme.show_favorites || 1)) && <button className="catalog-icon-action" onClick={() => setDrawer("favorites")} aria-label="Favoritos"><Heart size={18} /><span>{favoriteIds.length}</span></button>}
            <button className="catalog-icon-action primary-cart" onClick={() => setDrawer("order")}><ShoppingCart size={19} /> Pedido <span>{orderItems.reduce((sum, item) => sum + Number(item.qty || 1), 0)}</span></button>
          </div>
        </header>}

        {!hasLayoutRows && <div className="catalog-title" style={{ order: -20 }}>
          <span className="eyebrow">Catálogo online</span>
          <h1 style={{ fontFamily: theme.title_font || "Georgia" }}>{settings.page_title || "Catálogo Online"} <Sparkles size={26} /></h1>
          <p>{data.title || "Escolha a joia perfeita para você"}</p>
          {data.subtitle && <small>{data.subtitle}</small>}
        </div>}

        {layoutRows.map((row) => (
          <CatalogLayoutRow
            key={`${row.section_key}-${row._sourceIndex}`}
            row={row}
            data={data}
            settings={settings}
            theme={theme}
            banners={banners}
            activeBanner={activeBanner}
            activeBannerIndex={bannerIndex % banners.length}
            onBannerChange={setBannerIndex}
            categories={categories}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            search={search}
            setSearch={setSearch}
            recentSearches={recentSearches}
            setRecentSearches={setRecentSearches}
            filters={filters}
            setFilters={setFilters}
            options={options}
            sort={sort}
            setSort={setSort}
            productsRef={productsRef}
            discoveryRef={discoveryRef}
            items={items}
            publishedItems={publishedItems}
            latestItems={latestItems}
            bestSellerItems={bestSellerItems}
            promoItems={promoItems}
            contentSections={contentSections}
            favoriteIds={favoriteIds}
            orderCount={orderItems.reduce((sum, item) => sum + Number(item.qty || 1), 0)}
            onOpenFavorites={() => setDrawer("favorites")}
            onOpenOrder={() => setDrawer("order")}
            onToggleFavorite={toggleFavorite}
            onAdd={(item) => { addToOrder(item); setDrawer("order"); }}
            footerLogo={footerLogo}
            footerDisplayName={footerDisplayName}
          />
        ))}

        {publishedLayout.map((section) => (
          <CatalogLayoutBlock
            key={`${section.section_key || section.section_type}-${section.sort_order}-${section._sourceIndex}`}
            section={section}
            data={data}
            settings={settings}
            theme={theme}
            banners={banners}
            activeBanner={activeBanner}
            activeBannerIndex={bannerIndex % banners.length}
            onBannerChange={setBannerIndex}
            categories={categories}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            search={search}
            setSearch={setSearch}
            recentSearches={recentSearches}
            setRecentSearches={setRecentSearches}
            filters={filters}
            setFilters={setFilters}
            options={options}
            sort={sort}
            setSort={setSort}
            productsRef={productsRef}
            discoveryRef={discoveryRef}
            items={items}
            publishedItems={publishedItems}
            latestItems={latestItems}
            bestSellerItems={bestSellerItems}
            promoItems={promoItems}
            contentSections={contentSections}
            favoriteIds={favoriteIds}
            onToggleFavorite={toggleFavorite}
            onAdd={(item) => { addToOrder(item); setDrawer("order"); }}
            footerLogo={footerLogo}
            footerDisplayName={footerDisplayName}
          />
        ))}
        <CatalogNativePlugins plugins={safeData.plugins} settings={settings} theme={theme} />
        {Boolean(Number(theme.show_whatsapp_button || 1)) && <a className="floating-whatsapp" href={whatsappCatalogUrl(data.whatsapp_message, data.whatsapp_phone)} target="_blank" rel="noreferrer"><MessageCircle size={24} /><span>WhatsApp</span></a>}
      </section>
      {drawer && (
        <CatalogDrawer
          type={drawer}
          favorites={favoriteItems}
          orderItems={orderItems}
          orderTotal={orderTotal}
          whatsappPhone={data.whatsapp_phone}
          onClose={() => setDrawer(null)}
          onRemoveFavorite={(id) => setFavoriteIds((current) => current.filter((itemId) => itemId !== id))}
          onRemoveOrder={removeFromOrder}
          onUpdateOrderNotes={updateOrderItemNotes}
          onUpdateOrderQuantity={updateOrderItemQuantity}
          onClearOrder={() => setOrderItems([])}
        />
      )}
    </main>
  );
}

const DEFAULT_CATALOG_LAYOUT_TYPES = ["hero", "categories", "featured_products", "best_sellers", "new_products", "promotions", "booking_cta", "location", "footer"];

const CATALOG_SECTION_TITLES = {
  hero: "Banner principal",
  secondary_banners: "Destaques",
  categories: "Encontre sua joia",
  featured_products: "Produtos em destaque",
  best_sellers: "Mais desejadas",
  new_products: "Lançamentos",
  promotions: "Promoções",
  premium_products: "Joias premium",
  in_stock: "Disponíveis agora",
  out_of_stock: "Indisponíveis",
  category_products: "Joias por categoria",
  services: "Serviços",
  professionals: "Profissionais",
  location: "Localização",
  contact: "Fale com a equipe",
  policies: "Políticas do estúdio",
  biosafety: "Biossegurança",
  materials: "Materiais e cuidados",
  testimonials: "Depoimentos",
  instagram: "Acompanhe no Instagram",
  booking_cta: "Agende seu atendimento",
  footer: "Atendimento",
  custom_content: "Conteúdo especial"
};

function catalogIsActive(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return !["0", "false", "off", "no"].includes(value.toLowerCase());
  return Boolean(value);
}

function catalogComponent(component, index) {
  const source = asObject(component);
  const nested = asObject(source.config || source.settings);
  return {
    ...nested,
    ...source,
    section_key: String(source.section_key || source.component_key || `component-${index + 1}`),
    section_type: String(source.section_type || source.component_type || source.type || "custom_content"),
    sort_order: Number(source.sort_order ?? index + 1),
    _sourceIndex: index
  };
}

/**
 * Normaliza o contrato do construtor sem exigir que todas as colunas ou
 * componentes estejam completos. Linhas antigas continuam fora deste fluxo.
 */
function catalogLayoutRows(sections) {
  return asArray(sections)
    .map((row, index) => ({ ...asObject(row), _sourceIndex: index }))
    .filter((row) => String(row.section_type || row.type) === "layout_row" && catalogIsActive(row.is_active))
    .map((row) => {
      const rawColumns = asArray(row.columns);
      const columnsCount = Math.min(3, Math.max(1, Number(row.columns_count) || rawColumns.length || 1));
      const columns = Array.from({ length: columnsCount }, (_, columnIndex) => {
        const column = asObject(rawColumns[columnIndex]);
        const components = asArray(column.components)
          .map(catalogComponent)
          .filter((component) => catalogIsActive(component.is_active))
          .sort((left, right) => left.sort_order - right.sort_order || left._sourceIndex - right._sourceIndex);
        return {
          ...column,
          column_key: String(column.column_key || `column-${columnIndex + 1}`),
          components
        };
      });
      return {
        ...row,
        section_key: String(row.section_key || `row-${index + 1}`),
        sort_order: Number(row.sort_order ?? index + 1),
        columns_count: columnsCount,
        columns
      };
    })
    .sort((left, right) => left.sort_order - right.sort_order || left._sourceIndex - right._sourceIndex);
}

function CatalogLayoutRow({ row, ...blockProps }) {
  const rowStyle = catalogSectionStyle(row);
  return (
    <section
      className={`catalog-layout-row catalog-layout-row--${row.columns_count}`}
      style={{ ...rowStyle, "--catalog-row-columns": row.columns_count }}
      data-layout-row={row.section_key}
    >
      {row.columns.map((column) => (
        <div className="catalog-layout-column" key={column.column_key}>
          {column.components.map((component) => component.section_type === "menu"
            ? <CatalogMenuBlock key={component.section_key} section={component} {...blockProps} />
            : <CatalogLayoutBlock key={component.section_key} section={component} {...blockProps} />)}
        </div>
      ))}
    </section>
  );
}

function CatalogMenuBlock({ section, data, settings, theme, search, setSearch, recentSearches, setRecentSearches, favoriteIds, orderCount, onOpenFavorites, onOpenOrder }) {
  const items = asArray(section.menu_items)
    .map((item, index) => ({ ...asObject(item), _sourceIndex: index }))
    .filter((item) => catalogIsActive(item.is_active))
    .filter((item) => String(item.label || "").trim());
  const logo = String(section.logo_url || theme.logo_url || "").trim();
  const brand = String(section.brand_name || section.display_name || theme.brand_name || settings.company_display_name || data.brand_name || "Estúdio").trim();
  const slogan = String(section.slogan || theme.slogan || data.slogan || "").trim();
  const showSearch = catalogIsActive(section.show_search, true);
  const showFavorites = catalogIsActive(section.show_favorites, Number(theme.show_favorites ?? 1) !== 0);
  const showCart = catalogIsActive(section.show_cart, true);
  const showBooking = catalogIsActive(section.show_booking, false);
  const searchHistoryId = `catalog-builder-search-${String(section.section_key || "menu").replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <header className={catalogSectionClass(section, "catalog-builder-menu")} style={catalogSectionStyle(section)}>
      <div className="catalog-builder-menu__brand-and-links">
        <a className="catalog-client-brand" href={catalogUrl()}>
          {logo && <img src={catalogImageUrl(logo)} alt={brand} onError={useNeutralImageFallback} />}
          <strong>{brand}</strong>
          {slogan && <span>{slogan}</span>}
        </a>
        {items.length > 0 && <nav className="catalog-builder-menu__links" aria-label="Menu principal">
          {items.map((item) => <a key={`${item.label}-${item._sourceIndex}`} {...catalogLinkProps(item.url, catalogUrl())}>{item.label}</a>)}
        </nav>}
      </div>
      <div className="catalog-top-actions catalog-builder-menu__actions">
        {showSearch && <label className="catalog-search catalog-builder-menu__search">
          <Search size={17} />
          <input
            value={search}
            list={searchHistoryId}
            onChange={(event) => setSearch?.(event.target.value)}
            onBlur={() => setRecentSearches?.(saveRecentSearch("aura-catalog-recent-searches", search))}
            placeholder="Buscar no catálogo"
          />
          <datalist id={searchHistoryId}>
            {asArray(recentSearches).map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>}
        {showBooking && <a className="catalog-icon-action" href={publicUrl("/agendar")}><Clock size={18} /> Agendar</a>}
        {showFavorites && <button type="button" className="catalog-icon-action" onClick={onOpenFavorites} aria-label="Favoritos"><Heart size={18} /><span>{asArray(favoriteIds).length}</span></button>}
        {showCart && <button type="button" className="catalog-icon-action primary-cart" onClick={onOpenOrder}><ShoppingCart size={19} /> Pedido <span>{Number(orderCount || 0)}</span></button>}
      </div>
    </header>
  );
}

function catalogLayoutSections(sections) {
  const source = asArray(sections).length
    ? asArray(sections)
    : DEFAULT_CATALOG_LAYOUT_TYPES.map((section_type, index) => ({ section_key: `${section_type}-${index + 1}`, section_type, sort_order: index + 1, is_active: 1 }));
  return source
    .map((section, index) => ({ ...asObject(section), section_type: String(section?.section_type || "custom_content"), sort_order: Number(section?.sort_order ?? index + 1), _sourceIndex: index }))
    .filter((section) => section.is_active === undefined || section.is_active === null || Boolean(Number(section.is_active)))
    .sort((left, right) => left.sort_order - right.sort_order || left._sourceIndex - right._sourceIndex);
}

function catalogSectionClass(section, baseClass) {
  const type = String(section.section_type || "custom_content").replace(/[^a-z0-9_-]/gi, "");
  const width = section.width_mode === "full" ? "full" : "contained";
  return `${baseClass} catalog-configured-block catalog-configured-block--${type} catalog-configured-block--${width}`;
}

function safeCatalogColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(?:rgb|hsl)a?\([\d.%\s,/-]+\)$/i.test(color)) return color;
  return "";
}

function catalogSectionStyle(section = {}) {
  const alignment = ["left", "center", "right"].includes(section.alignment) ? section.alignment : "left";
  const spacing = Math.min(160, Math.max(0, Number(section.spacing ?? 24)));
  const height = Math.min(1200, Math.max(0, Number(section.height || 0)));
  return {
    backgroundColor: safeCatalogColor(section.background) || undefined,
    padding: `${spacing}px`,
    minHeight: height ? `${height}px` : undefined,
    textAlign: alignment
  };
}

function catalogSectionTitle(section, fallback) {
  return String(section.title || fallback || CATALOG_SECTION_TITLES[section.section_type] || "Catálogo").trim();
}

function catalogSectionSubtitle(section, fallback = "") {
  return String(section.subtitle || fallback || "").trim();
}

function catalogSectionProducts(section, source, { category = "", forceSort = "" } = {}) {
  let items = [...asArray(source)];
  const categoryFilter = String(section.category_filter || category || "").trim();
  if (categoryFilter && categoryFilter !== "Todos") {
    const terms = catalogCategoryTerms(categoryFilter);
    items = items.filter((item) => terms.some((term) => removeAccents(`${item.category || ""} ${item.subcategory || ""} ${item.name || ""}`.toLowerCase()).includes(removeAccents(term.toLowerCase()))));
  }
  const productSort = forceSort || String(section.product_sort || "recent");
  const compare = productSort === "best_sellers" ? (left, right) => Number(right.sale_value || 0) - Number(left.sale_value || 0)
    : productSort === "price_asc" ? (left, right) => Number(left.sale_value || 0) - Number(right.sale_value || 0)
      : productSort === "price_desc" ? (left, right) => Number(right.sale_value || 0) - Number(left.sale_value || 0)
        : productSort === "stock" ? (left, right) => Number(right.quantity || 0) - Number(left.quantity || 0)
          : productSort === "recent" ? (left, right) => Number(right.id || 0) - Number(left.id || 0)
            : null;
  if (compare) items.sort(compare);
  return items;
}

function CatalogLayoutBlock({
  section, data, settings, theme, banners, activeBanner, activeBannerIndex, onBannerChange,
  categories, activeCategory, setActiveCategory, search, setSearch, recentSearches, setRecentSearches,
  filters, setFilters, options, sort, setSort, productsRef, discoveryRef, items, publishedItems,
  latestItems, bestSellerItems, promoItems, contentSections, favoriteIds,
  onToggleFavorite, onAdd, footerLogo, footerDisplayName
}) {
  const type = section.section_type;
  const style = catalogSectionStyle(section);
  const className = (base) => catalogSectionClass(section, base);
  const railProps = {
    data, theme, settings, favoriteIds, onToggleFavorite, onAdd,
    style, className: className("catalog-product-rail"), displayMode: section.display_mode
  };
  const featuredProductIds = new Set(asArray(data.featuredProducts).filter((product) => Boolean(Number(product?.is_active ?? 1))).map((product) => Number(product.product_id)));
  const configuredFeatured = asArray(publishedItems).filter((item) => featuredProductIds.has(Number(item.id)) || Boolean(Number(item.is_featured)));
  const rail = (title, subtitle, source, options = {}) => (
    <CatalogProductRail
      title={catalogSectionTitle(section, title)}
      subtitle={catalogSectionSubtitle(section, subtitle)}
      items={catalogSectionProducts(section, source, options)}
      {...railProps}
    />
  );

  switch (type) {
    case "hero":
      return <PublicCatalogBanner banner={activeBanner} banners={banners} activeIndex={activeBannerIndex} layout={data.layout_style || "premium"} style={style} className={className("catalog-premium-hero catalog-carousel-hero")} onChange={onBannerChange} />;
    case "secondary_banners":
      return <CatalogSecondaryBanners banners={banners} section={section} style={style} className={className("catalog-secondary-banners")} />;
    case "categories":
      return <CatalogDiscovery
        section={section}
        style={style}
        className={className("catalog-discovery")}
        discoveryRef={discoveryRef}
        productsRef={productsRef}
        categories={categories}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        search={search}
        setSearch={setSearch}
        recentSearches={recentSearches}
        setRecentSearches={setRecentSearches}
        filters={filters}
        setFilters={setFilters}
        options={options}
        sort={sort}
        setSort={setSort}
      />;
    case "featured_products": {
      // Ao escolher uma categoria, a vitrine deixa de ser uma seleção curada e
      // exibe todos os produtos que passaram pelos filtros públicos.
      const hasCategorySelection = activeCategory && activeCategory !== "Todos";
      const productSource = section.category_filter ? publishedItems : (hasCategorySelection ? items : (configuredFeatured.length ? configuredFeatured : items));
      return <CatalogProductsBlock section={section} style={style} className={className("catalog-results")} productsRef={productsRef} items={catalogSectionProducts(section, productSource, { category: hasCategorySelection ? activeCategory : "" })} activeCategory={activeCategory} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} onAdd={onAdd} />;
    }
    case "best_sellers":
      return rail("Mais desejadas", "Peças premium em destaque para composições especiais.", bestSellerItems, { forceSort: "best_sellers" });
    case "new_products":
      return rail("Lançamentos", "Novidades recém-adicionadas à curadoria.", latestItems, { forceSort: "recent" });
    case "promotions":
      return rail("Promoções", "Ofertas ativas com preço especial.", promoItems);
    case "premium_products":
      return rail("Joias premium", "Curadoria de alto padrão para composições especiais.", publishedItems, { forceSort: "price_desc" });
    case "in_stock":
      return rail("Disponíveis agora", "Joias prontas para você reservar.", publishedItems.filter((item) => Number(item.quantity || 0) > 0), { forceSort: "stock" });
    case "out_of_stock":
      return rail("Indisponíveis", "Cadastre seu interesse e avisaremos quando voltarem.", publishedItems.filter((item) => Number(item.quantity || 0) <= 0 || item.status === "esgotado"));
    case "category_products":
      return rail("Joias por categoria", "Explore a seleção que mais combina com você.", publishedItems, { category: activeCategory });
    case "services":
      return <CatalogBookingDirectory kind="services" section={section} style={style} className={className("catalog-booking-directory")} />;
    case "professionals":
      return <CatalogBookingDirectory kind="professionals" section={section} style={style} className={className("catalog-booking-directory")} />;
    case "location":
      return <CatalogLocationBlock section={section} settings={settings} style={style} className={className("catalog-information-block")} />;
    case "contact":
      return <CatalogContactBlock section={section} settings={settings} style={style} className={className("catalog-information-block")} />;
    case "policies":
      return <CatalogPoliciesBlock section={section} settings={settings} style={style} className={className("catalog-information-block")} />;
    case "biosafety":
      return <CatalogTextBlock section={section} style={style} className={className("catalog-guide-section")} eyebrow="Biossegurança" text={section.body_text || settings.biosafety_text} />;
    case "materials":
      return <CatalogTextBlock section={section} style={style} className={className("catalog-guide-section")} eyebrow="Materiais" text={section.body_text || settings.materials_text} />;
    case "testimonials":
      return <CatalogTextBlock section={section} style={style} className={className("catalog-guide-section")} eyebrow="Experiências" text={section.body_text || section.subtitle} />;
    case "instagram":
      return <CatalogInstagramBlock section={section} settings={settings} style={style} className={className("catalog-information-block")} />;
    case "booking_cta":
      return <CatalogBookingWidget section={section} style={style} className={className("catalog-booking-widget")} />;
    case "footer":
      return <CatalogFooter section={section} settings={settings} theme={theme} footerLogo={footerLogo} footerDisplayName={footerDisplayName} style={style} className={className("catalog-footer-benefits catalog-dynamic-footer")} />;
    case "custom_content":
      return <CatalogContentSections sections={contentSections} style={style} className={className("catalog-content-sections")} />;
    default:
      return null;
  }
}

function CatalogDiscovery({ section, style, className, discoveryRef, productsRef, categories, activeCategory, setActiveCategory, search, setSearch, filters, setFilters, options, sort, setSort }) {
  return (
    <section ref={discoveryRef} className={className} style={style} aria-label={catalogSectionTitle(section, "Categorias e filtros")}>
      <label className="catalog-search catalog-search-mobile">
        <Search size={17} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar joia, SKU, material ou tamanho" />
      </label>
      <div className="catalog-category-strip">
        {categories.map(({ name, icon: Icon }) => (
          <button key={name} className={activeCategory === name ? "active" : ""} onClick={() => {
            setActiveCategory(name);
            requestAnimationFrame(() => productsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}>
            <Icon size={25} />
            <span>{cleanDisplayText(name)}</span>
          </button>
        ))}
      </div>
      <div className="catalog-filters">
        <span className="catalog-filter-label">{catalogSectionSubtitle(section, "Refinar")}</span>
        <CatalogSelect label="Material" value={filters.material} options={options.materials} onChange={(value) => setFilters({ ...filters, material: value })} />
        <CatalogSelect label="Observação de cor" value={filters.color} options={options.colors} onChange={(value) => setFilters({ ...filters, color: value })} />
        <CatalogSelect label="Pedra" value={filters.stone} options={options.stones} onChange={(value) => setFilters({ ...filters, stone: value })} />
        <CatalogSelect label="Tamanho" value={filters.size} options={options.sizes} onChange={(value) => setFilters({ ...filters, size: value })} />
        <CatalogSelect label="Tamanho do topo" value={filters.topSize} options={options.topSizes.map((number) => ({ value: String(number), label: `${number.toLocaleString("pt-BR", { minimumFractionDigits: 1 })} mm` }))} onChange={(value) => setFilters({ ...filters, topSize: value })} />
        <CatalogSelect label="Disponibilidade" value={filters.availability} options={[{ value: "true", label: "Em estoque" }, { value: "false", label: "Esgotados" }]} onChange={(value) => setFilters({ ...filters, availability: value })} />
        <div className="catalog-sort">
          <SlidersHorizontal size={16} />
          <Select label={null} ariaLabel="Ordenar catálogo" value={sort} onChange={setSort}>
            <option value="recentes">Mais recentes</option><option value="menor-preco">Menor preço</option><option value="maior-preco">Maior preço</option><option value="nome-az">Nome de A a Z</option><option value="nome-za">Nome de Z a A</option><option value="estoque">Em estoque primeiro</option>
          </Select>
        </div>
      </div>
    </section>
  );
}

function CatalogProductsBlock({ section, style, className, productsRef, items, activeCategory, data, theme, settings, favoriteIds, onToggleFavorite, onAdd }) {
  const title = catalogSectionTitle(section, "Produtos em destaque");
  return (
    <section ref={productsRef} className={className} style={style}>
      <div className="catalog-results-heading">
        <div><span className="eyebrow">{catalogSectionSubtitle(section, "Resultados")}</span><h2>{title}</h2></div>
        <strong>{items.length} {items.length === 1 ? "joia encontrada" : "joias encontradas"}</strong>
      </div>
      <div className={`catalog-grid catalog-display-${section.display_mode || "grid"}`} id="catalog-products">
        {items.map((item) => <CatalogProductCard item={item} favorite={favoriteIds.includes(item.id)} onToggleFavorite={() => onToggleFavorite(item)} theme={theme} settings={settings} promotion={catalogPromotionForItem(item, data.promotions || [])} onAddToOrder={() => onAdd(item)} key={item.id} />)}
      </div>
      {!items.length && <p className="empty-state catalog-empty">Nenhuma joia encontrada em {cleanDisplayText(activeCategory)} com os filtros selecionados.</p>}
    </section>
  );
}

function CatalogSecondaryBanners({ banners, section, style, className }) {
  const secondary = asArray(banners).slice(1);
  if (!secondary.length) return null;
  return (
    <section className={className} style={style}>
      <div className="catalog-section-heading"><span className="eyebrow">{catalogSectionSubtitle(section, "Destaques")}</span><h2>{catalogSectionTitle(section, "Destaques")}</h2></div>
      <div className={`catalog-secondary-banners__grid catalog-display-${section.display_mode || "grid"}`}>
        {secondary.map((banner) => (
          <article key={banner.id || banner.banner_id || banner.sort_order || banner.image_url || banner.title}>
            {banner.image_url && <img src={catalogImageUrl(banner.image_url)} alt={banner.alt_text || banner.title || "Destaque"} loading="lazy" onError={useNeutralImageFallback} />}
            <div>{banner.title && <h3>{banner.title}</h3>}{banner.subtitle && <p>{banner.subtitle}</p>}{banner.button_text && <a className="secondary-button" {...catalogLinkProps(banner.button_link)}>{banner.button_text}</a>}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CatalogBookingDirectory({ kind, section, style, className }) {
  const { data } = usePublicFetch("/booking/config");
  const rows = kind === "services" ? asArray(data?.services) : asArray(data?.professionals);
  if (!rows.length) return null;
  const title = catalogSectionTitle(section, kind === "services" ? "Serviços" : "Profissionais");
  return (
    <section className={className} style={style}>
      <div className="catalog-section-heading"><span className="eyebrow">Agenda online</span><h2>{title}</h2>{catalogSectionSubtitle(section) && <p>{catalogSectionSubtitle(section)}</p>}</div>
      <div className={`catalog-directory-grid catalog-display-${section.display_mode || "grid"}`}>
        {rows.map((row) => (
          <article key={row.id || row.name}><i>{kind === "services" ? <Sparkles size={21} /> : <Star size={21} />}</i><strong>{row.name}</strong>{row.description && <p>{row.description}</p>}</article>
        ))}
      </div>
      <a className="secondary-button" href={publicUrl("/agendar")}>Ver horários disponíveis</a>
    </section>
  );
}

function CatalogLocationBlock({ section, settings, style, className }) {
  const address = String(settings.company_address || "").trim();
  const mapUrl = String(settings.company_maps_url || "").trim() || (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "");
  if (!address && !mapUrl) return null;
  return <CatalogInformationBlock style={style} className={className} icon={<MapPin size={22} />} eyebrow="Visite o estúdio" title={catalogSectionTitle(section, "Localização")} text={section.body_text || address} action={mapUrl ? { label: "Abrir no mapa", href: mapUrl } : null} />;
}

function CatalogContactBlock({ section, settings, style, className }) {
  const phone = String(settings.whatsapp_phone || settings.company_phone || settings.company_whatsapp || "").trim();
  const email = safeMailto(settings.company_email || settings.company_support_email);
  const website = safeCatalogLink(settings.company_website, "");
  if (!phone && !email && !website) return null;
  const actions = [
    phone && { label: "Falar pelo WhatsApp", href: whatsappCatalogUrl(settings.whatsapp_message, phone), icon: <MessageCircle size={17} /> },
    email && { label: "Enviar e-mail", href: email, icon: <Mail size={17} /> },
    website && { label: "Visitar site", href: website }
  ].filter(Boolean);
  return <CatalogInformationBlock style={style} className={className} icon={<MessageCircle size={22} />} eyebrow="Atendimento" title={catalogSectionTitle(section, "Fale com a equipe")} text={section.body_text || settings.institutional_text} actions={actions} />;
}

function CatalogPoliciesBlock({ section, settings, style, className }) {
  const policies = [["Atendimento", settings.service_policy], ["Sinal", settings.deposit_policy], ["Cancelamento", settings.cancellation_policy], ["Trocas", settings.exchange_policy]].filter(([, text]) => String(text || "").trim());
  if (!policies.length) return null;
  return (
    <section className={className} style={style}>
      <div className="catalog-section-heading"><span className="eyebrow">Transparência</span><h2>{catalogSectionTitle(section, "Políticas do estúdio")}</h2>{catalogSectionSubtitle(section) && <p>{catalogSectionSubtitle(section)}</p>}</div>
      <div className="catalog-policy-grid">{policies.map(([label, text]) => <article key={label}><strong>{label}</strong><p>{text}</p></article>)}</div>
    </section>
  );
}

function CatalogInstagramBlock({ section, settings, style, className }) {
  const handle = String(settings.company_instagram || "").trim();
  if (!handle) return null;
  return <CatalogInformationBlock style={style} className={className} icon={<Instagram size={22} />} eyebrow="Bastidores e novidades" title={catalogSectionTitle(section, "Acompanhe no Instagram")} text={section.body_text || catalogSectionSubtitle(section, `Siga ${handle} para acompanhar nosso trabalho.`)} action={{ label: "Abrir Instagram", href: instagramCatalogUrl(handle) }} />;
}

function CatalogTextBlock({ section, style, className, eyebrow, text }) {
  const body = String(text || "").trim();
  if (!body) return null;
  return (
    <section className={className} style={style}>
      <article><span className="eyebrow">{eyebrow}</span><h2>{catalogSectionTitle(section, eyebrow)}</h2><p>{body}</p></article>
    </section>
  );
}

function CatalogInformationBlock({ style, className, icon, eyebrow, title, text, action, actions = [] }) {
  const availableActions = [...actions, action].filter(Boolean);
  return (
    <section className={className} style={style}>
      <div className="catalog-information-block__icon">{icon}</div>
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{text && <p>{text}</p>}</div>
      {availableActions.length > 0 && <div className="catalog-information-block__actions">{availableActions.map((item) => <a key={item.label} className="secondary-button" {...catalogActionProps(item.href)}>{item.icon}{item.label}</a>)}</div>}
    </section>
  );
}

function safeMailto(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : "";
}

function CatalogFooter({ section, settings, theme, footerLogo, footerDisplayName, style, className }) {
  const showFooter = settings.footer_enabled !== "0" && hasRenderableContent({
    type: "footer", institutional_text: settings.institutional_text, whatsapp_phone: settings.whatsapp_phone,
    company_instagram: settings.company_instagram, company_email: settings.company_email, company_hours: settings.company_hours,
    company_address: settings.company_address, logo_url: footerLogo,
    display_name: settings.footer_show_business_name !== "0" ? footerDisplayName : "",
    slogan: settings.footer_show_slogan !== "0" ? (settings.footer_slogan || theme.slogan) : "",
    copyright_text: settings.footer_copyright_text || theme.footer_text || settings.footer_text
  });
  if (!showFooter) return null;
  return (
    <footer className={className} style={{ ...catalogFooterStyle(settings, theme), ...style }}>
      <div className="catalog-contact-heading"><span className="eyebrow">{catalogSectionSubtitle(section, "Atendimento")}</span><h2>{catalogSectionTitle(section, "Fale com a nossa equipe")}</h2>{settings.institutional_text && <p>{settings.institutional_text}</p>}</div>
      <div className="catalog-company-contact">
        {settings.whatsapp_phone && <a href={whatsappCatalogUrl(settings.whatsapp_message, settings.whatsapp_phone)} target="_blank" rel="noreferrer"><i><MessageCircle size={20} /></i><span><small>Atendimento rápido</small><strong>WhatsApp</strong><em>{settings.whatsapp_phone}</em></span><ChevronRight size={17} /></a>}
        {settings.company_instagram && <a href={instagramCatalogUrl(settings.company_instagram)} target="_blank" rel="noreferrer"><i><Instagram size={20} /></i><span><small>Acompanhe nosso trabalho</small><strong>Instagram</strong><em>{settings.company_instagram}</em></span><ChevronRight size={17} /></a>}
        {safeMailto(settings.company_email) && <a href={safeMailto(settings.company_email)}><i><Mail size={20} /></i><span><small>Envie sua dúvida</small><strong>E-mail</strong><em>{settings.company_email}</em></span><ChevronRight size={17} /></a>}
        {settings.company_hours && <div><i><Clock size={20} /></i><span><small>Quando falar conosco</small><strong>Atendimento</strong><em>{settings.company_hours}</em></span></div>}
        {settings.company_address && <a {...catalogLinkProps(settings.company_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.company_address)}`)}><i><MapPin size={20} /></i><span><small>Visite a clínica</small><strong>Endereço</strong><em>{settings.company_address}</em></span><ChevronRight size={17} /></a>}
      </div>
      <div className="catalog-footer-signature">
        {footerLogo && <img src={catalogImageUrl(footerLogo)} alt={footerDisplayName || "Marca do estúdio"} />}
        {settings.footer_show_business_name !== "0" && <strong>{footerDisplayName || "Estúdio"}</strong>}
        {settings.footer_show_slogan !== "0" && (settings.footer_slogan || theme.slogan) && <small>{settings.footer_slogan || theme.slogan}</small>}
        {(settings.footer_copyright_text || theme.footer_text || settings.footer_text) && <small>{settings.footer_copyright_text || theme.footer_text || settings.footer_text}</small>}
      </div>
    </footer>
  );
}

function PublicCatalogBanner({ banner, banners, activeIndex, layout, style, className = "catalog-premium-hero catalog-carousel-hero", onChange }) {
  const transform = normalizeImageTransform(
    typeof banner.image_transform === "string" ? safeJson(banner.image_transform) : banner.image_transform,
    "16/5"
  );
  const imageStyle = {
    ...imageTransformStyle(transform),
    transformOrigin: `${transform.focalPointX}% ${transform.focalPointY}%`
  };
  const go = (direction) => onChange((activeIndex + direction + banners.length) % banners.length);
  return (
    <section
      className={`${className} catalog-layout-${layout}`}
      style={{ ...style, maxWidth: banner.banner_width ? `${Number(banner.banner_width)}px` : undefined }}
      aria-roledescription="carrossel"
      aria-label="Destaques do catálogo"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") go(-1);
        if (event.key === "ArrowRight") go(1);
      }}
      tabIndex={banners.length > 1 ? 0 : undefined}
    >
      <picture className="public-banner__media">
        {banner.mobile_image_url && <source media="(max-width: 768px)" srcSet={catalogImageUrl(banner.mobile_image_url)} />}
        <img
          className="public-banner__image"
          src={catalogImageUrl(banner.image_url)}
          alt={banner.alt_text || banner.title || "Destaque do catálogo"}
          width="1600"
          height="500"
          fetchpriority={activeIndex === 0 ? "high" : "auto"}
          loading={activeIndex === 0 ? "eager" : "lazy"}
          style={imageStyle}
        />
      </picture>
      {(banner.title || banner.subtitle || banner.button_text) && (
        <div className="catalog-banner-copy">
          {banner.title && <h2>{banner.title}</h2>}
          {banner.subtitle && <p>{banner.subtitle}</p>}
          {banner.button_text && <a className="catalog-banner-cta" {...catalogLinkProps(banner.button_link, "#catalog-products")}>{banner.button_text}</a>}
        </div>
      )}
      {banners.length > 1 && <>
        <button type="button" className="catalog-carousel-arrow previous" aria-label="Banner anterior" onClick={() => go(-1)}><ChevronLeft /></button>
        <button type="button" className="catalog-carousel-arrow next" aria-label="Próximo banner" onClick={() => go(1)}><ChevronRight /></button>
        <div className="catalog-carousel-dots" aria-label="Selecionar banner">
          {banners.map((item, index) => (
            <button key={item.id || item.banner_id || item.sort_order || item.image_url || item.title} className={index === activeIndex ? "active" : ""} aria-label={`Banner ${index + 1}`} aria-current={index === activeIndex ? "true" : undefined} onClick={() => onChange(index)} />
          ))}
        </div>
      </>}
    </section>
  );
}

function catalogFooterStyle(settings, theme) {
  const inherit = settings.footer_inherit_main_palette === "1";
  const backgroundType = settings.footer_background_type || "solid";
  const background = backgroundType === "gradient"
    ? `linear-gradient(${settings.footer_gradient_direction || "135deg"}, ${settings.footer_gradient_start_color || theme.primary_color}, ${settings.footer_gradient_end_color || theme.secondary_color})`
    : backgroundType === "image" && settings.footer_background_image_url
      ? `linear-gradient(${hexOverlay(settings.footer_overlay_color, settings.footer_overlay_opacity)}), url(${catalogImageUrl(settings.footer_background_image_url)})`
    : inherit ? (theme.background_color || "#f8f5f0") : (settings.footer_background_color || theme.background_color || "#f8f5f0");
  return {
    "--footer-text": inherit ? (settings.text_color || "#1c1c1c") : settings.footer_text_color,
    "--footer-muted": inherit ? (settings.muted_text_color || "#74685e") : settings.footer_muted_text_color,
    "--footer-heading": inherit ? (settings.heading_color || "#1c1c1c") : settings.footer_heading_color,
    "--footer-link": inherit ? (settings.link_color || theme.primary_color) : settings.footer_link_color,
    "--footer-link-hover": inherit ? (settings.link_hover_color || theme.button_color) : settings.footer_link_hover_color,
    "--footer-icon": inherit ? (settings.icon_color || theme.primary_color) : settings.footer_icon_color,
    "--footer-border": inherit ? (settings.border_color || theme.secondary_color) : settings.footer_border_color,
    "--footer-accent": inherit ? theme.primary_color : settings.footer_accent_color,
    "--footer-logo-width": `${Number(settings.footer_logo_max_width || 180)}px`,
    "--footer-logo-height": `${Number(settings.footer_logo_max_height || 96)}px`,
    "--footer-brand-bg": settings.footer_brand_background_color || "transparent",
    background,
    backgroundPosition: settings.footer_background_position || "50% 50%",
    backgroundSize: settings.footer_background_size || "cover",
    borderRadius: `${Number(settings.footer_border_radius || 24)}px`,
    padding: `${Number(settings.footer_spacing || 40)}px`,
    width: "100%",
    maxWidth: `${Number(settings.footer_container_width || 1280)}px`,
    marginInline: "auto"
  };
}

function hexOverlay(color = "#000000", opacity = 0) {
  const hex = String(color).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(0,0,0,${Number(opacity || 0)})`;
  const values = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${values.join(",")},${Math.max(0, Math.min(1, Number(opacity || 0)))})`;
}

function safeJson(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function CatalogSelect({ label, value, options, onChange }) {
  const safeOptions = asArray(options);
  return (
    <Select className="catalog-filter-select" label={null} ariaLabel={label} value={value} onChange={onChange}>
        <option value="">{label}</option>
        {safeOptions.map((option) => {
          const optionValue = typeof option === "object" ? option.value : option;
          const optionLabel = typeof option === "object" ? option.label : elegantProductName(option);
          return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
        })}
    </Select>
  );
}

function professionalMatchesService(professional, serviceId) {
  if (!serviceId) return true;
  return asArray(professional?.service_ids).some((id) => String(id) === String(serviceId));
}

function CatalogBookingWidget({ section = {}, style, className = "catalog-booking-widget" } = {}) {
  const { data } = usePublicFetch("/booking/config");
  const [form, setForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { service_id: "", professional_id: "", appointment_date: today, appointment_time: "" };
  });
  const [slots, setSlots] = useState([]);
  const safeData = asObject(data);
  const services = asArray(safeData.services);
  const allProfessionals = asArray(safeData.professionals);
  const professionals = allProfessionals.filter((professional) => professionalMatchesService(professional, form.service_id));
  useEffect(() => {
    if (!services.length || form.service_id) return;
    setForm((current) => ({ ...current, service_id: String(services[0].id) }));
  }, [services.length]);

  useEffect(() => {
    if (!professionals.length) return;
    if (professionals.some((professional) => String(professional.id) === String(form.professional_id))) return;
    setForm((current) => ({ ...current, professional_id: String(professionals[0].id) }));
  }, [professionals.length, form.service_id, form.professional_id]);

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      const response = await publicApiFetch("/booking/slots?service_id=" + form.service_id + "&professional_id=" + form.professional_id + "&date=" + form.appointment_date);
      const json = await response.json().catch(() => ({}));
      setSlots(response.ok ? asArray(json.slots) : []);
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  if (!data || data.error || !services.length) return null;
  const href = publicUrl("/agendar", Object.fromEntries(Object.entries(form).filter(([, value]) => value)));

  return (
    <section className={className} style={style} id="catalog-agenda">
      <div>
        <span className="eyebrow">Agenda online</span>
        <h2>{catalogSectionTitle(section, "Escolha um horário disponível")}</h2>
        <p>{catalogSectionSubtitle(section, "Reserve pelo link público do estúdio. A equipe confirma manualmente pelo WhatsApp.")}</p>
      </div>
      <div className="catalog-booking-controls">
        <Select label="Serviço" value={form.service_id} onChange={(value) => setForm({ ...form, service_id: value, professional_id: "", appointment_time: "" })}>
          {services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}
        </Select>
        {professionals.length ? (
          <Select label="Profissional" value={form.professional_id} onChange={(value) => setForm({ ...form, professional_id: value, appointment_time: "" })}>
            {professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
          </Select>
        ) : <p className="empty-state">Este serviço ainda não possui profissional vinculado.</p>}
        <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value, appointment_time: "" })} />
      </div>
      <div className="catalog-slot-row">
          {slots.slice(0, 8).map((slot) => <button type="button" key={slot.time} className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
        {!slots.length && <span>Nenhum horário nesta seleção.</span>}
      </div>
      <a className={`primary-button booking-wide-button${professionals.length ? "" : " disabled"}`} href={professionals.length ? href : "#catalog-agenda"}>Continuar Agendamento</a>
    </section>
  );
}

export function hasRenderableCatalogContent(section) {
  if (!section || !Boolean(section.active)) return false;
  return Boolean(String(section.title || section.text || section.media_url || "").trim());
}

function CatalogContentSections({ sections, style, className = "catalog-content-sections" }) {
  const active = asArray(sections).filter(hasRenderableCatalogContent);
  if (!active.length) return null;
  return (
    <section className={className} style={style}>
      {active.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).map((section) => (
        <article className={`catalog-content-card ${section.media_type || "image"}`} key={section.id || section.order || section.title}>
          <div>
            <span className="eyebrow">{section.kicker || "Conteúdo especial"}</span>
            <h2>{section.title}</h2>
            <p>{section.text}</p>
            {section.button_text && section.button_link && <a className="secondary-button" {...catalogLinkProps(section.button_link)}>{section.button_text}</a>}
          </div>
          {section.media_url && section.media_type === "video" && safeCatalogEmbedUrl(section.media_url) ? (
            <iframe
              title={section.title || "Vídeo do catálogo"}
              src={safeCatalogEmbedUrl(section.media_url)}
              sandbox="allow-scripts allow-presentation allow-popups"
              referrerPolicy="no-referrer"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : section.media_url ? (
            <img src={catalogImageUrl(section.media_url)} alt={section.media_alt || section.title || "Imagem do catálogo"} />
          ) : null}
        </article>
      ))}
    </section>
  );
}

function CatalogProductRail({ title, subtitle, items, data, theme, settings, favoriteIds, onToggleFavorite, onAdd, style, className = "catalog-product-rail", displayMode = "carousel" }) {
  const safeItems = asArray(items);
  const safeFavoriteIds = asArray(favoriteIds);
  if (!safeItems.length) return null;
  return (
    <section className={`${className} catalog-display-${displayMode}`} style={style}>
      <header>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <a href="#catalog-products">Ver todos</a>
      </header>
      <div>
        {safeItems.map((item) => (
          <CatalogProductCard
            item={item}
            favorite={safeFavoriteIds.includes(item.id)}
            onToggleFavorite={() => onToggleFavorite(item)}
            theme={theme}
            settings={settings}
            promotion={catalogPromotionForItem(item, data.promotions || [])}
            onAddToOrder={() => onAdd(item)}
            compact
            key={`${title}-${item.id}`}
          />
        ))}
      </div>
    </section>
  );
}

function CatalogProductCard({ item, favorite, onToggleFavorite, onAddToOrder, theme = {}, settings = {}, promotion }) {
  const productName = elegantProductName(item.name);
  const description = [elegantProductName(item.material), cleanDisplayText(item.size)].filter(Boolean).join(" · ");
  const detail = [elegantProductName(item.color), elegantProductName(item.stone)].filter(Boolean).join(" · ");
  const saleValue = Number(item.sale_value || 0);
  const promotionalValue = promotion ? promotionalPrice(saleValue, promotion) : null;
  const finalValue = promotionalValue || saleValue;
  const pixValue = finalValue * 0.95;
  const installmentValue = finalValue / 3;
  const shareText = `${settings.product_share_text || "Olha esta joia:"} ${productName} - ${description} - ${currency.format(finalValue)}.`;
  const notifyText = `Olá! Quero ser avisada quando a joia ${productName} voltar ao estoque.`;
  const stockText = catalogStockText(item, theme, settings);
  const available = Number(item.quantity || 0) > 0 && item.status !== "esgotado";
  const requiresVariant = asArray(item.variants).filter((variant) => Number(variant.is_active ?? 1) === 1 && Number(variant.quantity || 0) > 0).length > 1;

  return (
    <article className="catalog-product-card">
      <figure>
        {(item.badge || promotion || !available) && <em className={`catalog-product-badge ${!available ? "unavailable" : ""}`}>{!available ? "Indisponível" : promotion ? "Promoção" : cleanDisplayText(item.badge)}</em>}
        <a className="catalog-product-image-link" href={catalogProductUrl(item.id)} aria-label={`Abrir ${productName}`}>
          <img src={catalogImageUrl(item.photo_url)} alt="" loading="lazy" onError={useNeutralImageFallback} />
        </a>
        {Boolean(Number(theme.show_favorites || 1)) && <button type="button" className={favorite ? "favorite active" : "favorite"} onClick={onToggleFavorite} aria-label="Favoritar">
          <Heart size={19} />
        </button>}
      </figure>
      <div className="catalog-product-info">
        <h2><a href={catalogProductUrl(item.id)}>{productName}</a></h2>
        <p>{description || "Joalheria selecionada Aura"}</p>
        {detail && <span className="catalog-soft-detail">{detail}</span>}
        {item.sku && <small className="catalog-sku">SKU {item.sku}</small>}
        <strong>{finalValue > 0 ? <>{promotion && <del>{currency.format(saleValue)}</del>}{currency.format(finalValue)}</> : "Valor Sob Consulta"}</strong>
        {finalValue > 0 && <span className="catalog-payment-line">ou {currency.format(pixValue)} via Pix</span>}
        {finalValue >= 60 && <span className="catalog-payment-line muted">até 3x de {currency.format(installmentValue)} sem juros</span>}
        {stockText && <small className={Number(item.quantity || 0) <= 2 ? "catalog-stock warning" : "catalog-stock"}>{stockText}</small>}
        <div className="catalog-actions">
          {available && Boolean(Number(theme.show_schedule_button || 1)) && <button className="primary-button" type="button" onClick={onAddToOrder}>Quero essa joia</button>}
          {available && Boolean(Number(theme.show_buy_button)) && (requiresVariant
            ? <a className="secondary-button" href={catalogUrl(`/catalogo/produto/${item.id}`)}>Escolher variação</a>
            : <button className="secondary-button" type="button" onClick={onAddToOrder}>Adicionar ao carrinho</button>)}
          {!available && <a className="primary-button" href={whatsappCatalogUrl(notifyText, settings.whatsapp_phone)} target="_blank" rel="noreferrer">Avise-me</a>}
          <a className="secondary-button" href={whatsappShareUrl(shareText)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Compartilhar</a>
        </div>
      </div>
    </article>
  );
}

function CatalogProductDetail({ item, data, theme = {}, settings = {}, favorite, onToggleFavorite, onAddToOrder, onScheduleWithJewelry }) {
  const productName = elegantProductName(item.name);
  const availableVariants = asArray(item?.variants).filter((variant) => Boolean(asNumber(variant?.is_active, 1)));
  const [selectedVariantId, setSelectedVariantId] = useState(availableVariants.find((variant) => Number(variant.quantity || 0) > 0)?.id || availableVariants[0]?.id || "");
  const selectedVariant = availableVariants.find((variant) => Number(variant.id) === Number(selectedVariantId)) || availableVariants[0] || {};
  const colorOptions = splitColorOptions(selectedVariant.color);
  const [selectedColor, setSelectedColor] = useState(colorOptions[0] || "");
  const [quantity, setQuantity] = useState(1);
  const galleryImages = [
    ...asArray(selectedVariant.images),
    ...asArray(item.images),
    ...(parseGalleryUrls(item.gallery_urls).map((image_url) => ({ image_url })))
  ].filter((image) => image?.image_url);
  const uniqueGalleryImages = galleryImages.filter((image, index, list) => list.findIndex((entry) => entry.image_url === image.image_url) === index);
  const [activeImage, setActiveImage] = useState(uniqueGalleryImages[0]?.image_url || item.photo_url || item.image_url);

  useEffect(() => {
    const nextColors = splitColorOptions(selectedVariant.color);
    setSelectedColor((current) => nextColors.includes(current) ? current : nextColors[0] || "");
    setActiveImage(uniqueGalleryImages[0]?.image_url || item.photo_url || item.image_url || "");
  }, [item.id, selectedVariantId]);

  const description = item.description || "Joia selecionada com curadoria profissional.";
  const detailItems = [
    selectedVariant.material && { label: "Material", value: elegantProductName(selectedVariant.material) },
    selectedColor && { label: "Observação de Cor", value: elegantProductName(selectedColor) },
    item.stone && { label: "Pedra", value: elegantProductName(item.stone) },
    selectedVariant.size && { label: "Tamanho", value: selectedVariant.size },
    Number(selectedVariant.top_size_mm) > 0 && { label: "Tamanho do topo", value: `${Number(selectedVariant.top_size_mm).toLocaleString("pt-BR", { minimumFractionDigits: 1 })} mm` },
    selectedVariant.thickness && { label: "Espessura", value: selectedVariant.thickness },
    selectedVariant.length && { label: "Comprimento", value: selectedVariant.length },
    selectedVariant.diameter && { label: "Diâmetro", value: selectedVariant.diameter },
    selectedVariant.thread_type && { label: "Tipo de Rosca", value: elegantProductName(selectedVariant.thread_type) },
    item.weight_grams ? { label: "Peso", value: `${item.weight_grams} g` } : null,
    item.package_length_cm || item.package_width_cm || item.package_height_cm ? { label: "Embalagem", value: `${item.package_length_cm || 0} x ${item.package_width_cm || 0} x ${item.package_height_cm || 0} cm` } : null,
    item.physical_location && { label: "Localização", value: item.physical_location }
  ].filter(Boolean);
  const stockText = catalogStockText(item, theme, settings);
  const saleValue = Number(selectedVariant.sale_value || item.sale_value || 0);
  const maximumQuantity = Math.max(0, Number(selectedVariant.quantity ?? item.inventory_quantity ?? 0));
  const available = Number(selectedVariant.quantity ?? item.quantity ?? 0) > 0 && selectedVariant.status !== "esgotado";
  const related = asArray(data?.items)
    .filter((candidate) => candidate.id !== item.id && (candidate.category === item.category || candidate.subcategory === item.subcategory))
    .slice(0, 4);

  return (
    <main className="catalog-page theme-detail" style={{ "--catalog-primary": theme.primary_color || "#C8A96A", "--catalog-secondary": theme.secondary_color || "#D8C3A5", "--catalog-bg": theme.background_color || "#F8F5F0", "--catalog-button": theme.button_color || "#C8A96A", fontFamily: theme.body_font || "Inter" }}>
      <section className="catalog-main catalog-product-detail-page">
        <header className="catalog-topbar">
          <a className="catalog-client-brand" href={catalogUrl()}>
            {theme.logo_url && <img src={catalogImageUrl(theme.logo_url)} alt={theme.brand_name || settings.company_display_name || "Estúdio"} />}
            <strong>{theme.brand_name || settings.company_display_name || data.brand_name || "Estúdio"}</strong>
            <span>{theme.slogan || data.slogan || "Clinic Piercing"}</span>
          </a>
          <div className="catalog-top-actions">
            <a className="secondary-button" href={catalogUrl()}>Voltar ao catálogo</a>
            {Boolean(Number(theme.show_favorites || 1)) && <button className="catalog-icon-action" onClick={onToggleFavorite} aria-label={favorite ? "Remover dos favoritos" : "Favoritar"}><Heart size={18} /></button>}
          </div>
        </header>

        <section className="catalog-product-detail">
          <div className="catalog-product-gallery">
            <img className="catalog-product-hero-image" src={catalogImageUrl(activeImage || item.photo_url)} alt="" onError={useNeutralImageFallback} />
            <div className="catalog-product-mini-gallery">
              {(uniqueGalleryImages.length ? uniqueGalleryImages : [{ image_url: item.photo_url }]).map((photo, index) => (
                <button key={`${item.id}-${selectedVariantId || "product"}-${photo.id || photo.image_url}`} type="button" className={activeImage === photo.image_url ? "active" : ""} onClick={() => setActiveImage(photo.image_url)} aria-label={`Selecionar imagem ${index + 1}`}>
                  <img src={catalogImageUrl(photo.image_url)} alt="" loading="lazy" onError={useNeutralImageFallback} />
                </button>
              ))}
            </div>
          </div>
          <div className="catalog-product-sidebar">
            <span className={`catalog-product-badge detail ${available ? "" : "unavailable"}`}>{available ? item.badge || "Disponível" : "Indisponível"}</span>
            <p className="catalog-breadcrumb">Catálogo / {cleanDisplayText(item.category || "Joias")} / {cleanDisplayText(item.subcategory || productName)}</p>
            <h1>{productName}</h1>
            <p className="catalog-product-description">{description}</p>
            {availableVariants.length > 0 && (
              <div className="catalog-variant-picker">
                <Select label="Escolha a Variação" value={selectedVariantId} onChange={setSelectedVariantId}>
                    {availableVariants.map((variant) => (
                      <option key={variant.id} value={variant.id} disabled={Number(variant.quantity || 0) <= 0}>
                        {variantCatalogLabel(variant)} · {variant.quantity > 0 ? `${variant.quantity} disponíveis` : "Indisponível"}
                      </option>
                    ))}
                </Select>
                {colorOptions.length > 0 && (
                  <Select label="Observação de Cor / Anodização" value={selectedColor} onChange={setSelectedColor}>
                      {colorOptions.map((color) => <option key={color}>{color}</option>)}
                  </Select>
                )}
              </div>
            )}
            <div className="catalog-price-box">
              <strong>{saleValue > 0 ? currency.format(saleValue) : "Valor Sob Consulta"}</strong>
              <span>{stockText || "Disponibilidade sob consulta"}</span>
            </div>
            {available && <div className="catalog-quantity-picker" aria-label="Quantidade"><button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} disabled={quantity <= 1}>−</button><strong>{quantity}</strong><button type="button" onClick={() => setQuantity((current) => Math.min(maximumQuantity, current + 1))} disabled={quantity >= maximumQuantity}>+</button><small>{maximumQuantity} disponível(is)</small></div>}
            <div className="catalog-detail-grid">
              {detailItems.map((entry) => (
                <div key={entry.label}>
                  <small>{entry.label}</small>
                  <strong>{entry.value}</strong>
                </div>
              ))}
            </div>
            <div className="catalog-detail-actions">
              {available && Boolean(Number(theme.show_schedule_button || 1)) && <button className="primary-button" type="button" onClick={() => onScheduleWithJewelry({ ...selectedVariant, selected_color: selectedColor })}>Quero Agendar Com Essa Joia</button>}
              {available && <button className="secondary-button" type="button" onClick={() => onAddToOrder({ ...selectedVariant, selected_color: selectedColor, requested_qty: quantity })}>Adicionar {quantity} ao carrinho</button>}
              {!available && settings.whatsapp_phone && <a className="primary-button" href={whatsappCatalogUrl(`Ola! Gostaria de consultar a disponibilidade desta joia:\n\nProduto: ${productName}\nVariacao: ${variantCatalogLabel(selectedVariant)}\nMaterial: ${selectedVariant.material || item.material || "nao informado"}\nCor: ${selectedColor || selectedVariant.color || item.color || "nao informada"}\nTamanho: ${variantCatalogLabel(selectedVariant)}\nLink: ${window.location.href}\n\nPodem me informar prazo e valor?`, settings.whatsapp_phone)} target="_blank" rel="noreferrer">Pedir pelo WhatsApp</a>}
              {!available && !settings.whatsapp_phone && <span className="form-error">WhatsApp de vendas nao configurado. Avise a administracao.</span>}
              {settings.whatsapp_phone && <a className="secondary-button" href={whatsappCatalogUrl(`Olá! Quero informações sobre ${productName}, ${variantCatalogLabel(selectedVariant)}${selectedColor ? `, na cor ${selectedColor}` : ""}.`, settings.whatsapp_phone)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Falar com a Aura</a>}
              <a className="secondary-button" href={whatsappShareUrl(`${settings.product_share_text || "Olha esta joia:"} ${item.name} - ${currency.format(saleValue)}.`)} target="_blank" rel="noreferrer">Compartilhar</a>
            </div>
            {item.notes && <div className="catalog-notes-box"><strong>Observações</strong><p>{item.notes}</p></div>}
          </div>
        </section>

        {related.length > 0 && (
          <section className="catalog-related-section">
            <div className="panel-heading">
              <h2>Mais opções parecidas</h2>
              <a className="secondary-button" href={catalogUrl()}>Ver catálogo</a>
            </div>
            <div className="catalog-grid catalog-related-grid">
              {related.map((relatedItem) => (
                <CatalogProductCard
                  key={relatedItem.id}
                  item={relatedItem}
                  favorite={false}
                  onToggleFavorite={() => {}}
                  onAddToOrder={() => {}}
                  theme={{ ...theme, show_favorites: 0 }}
                  settings={settings}
                  promotion={catalogPromotionForItem(relatedItem, data.promotions || [])}
                />
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function CatalogDrawer({ type, favorites, orderItems, orderTotal, whatsappPhone, onClose, onRemoveFavorite, onRemoveOrder, onUpdateOrderNotes, onUpdateOrderQuantity, onClearOrder }) {
  const isFavorites = type === "favorites";
  const [couponCode, setCouponCode] = useState("");
  const [couponQuote, setCouponQuote] = useState(null);
  const [couponError, setCouponError] = useState("");
  const safeFavorites = asArray(favorites);
  const safeOrderItems = asArray(orderItems);
  const items = isFavorites ? safeFavorites : safeOrderItems;
  useEffect(() => {
    if (isFavorites || !safeOrderItems.length) {
      setCouponQuote(null);
      return;
    }
    let active = true;
    publicApiFetch("/catalog/price-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: safeOrderItems.map((item) => ({
          product_id: item.id,
          variation_id: item.selected_variant_id,
          category: item.category,
          color: item.selected_color || item.color,
          material: item.material,
          stone: item.stone,
          unit_price: item.sale_value,
          quantity: item.qty || 1
        }))
      })
    }).then((response) => response.json()).then((json) => {
      if (active && json.valid) setCouponQuote(json);
    }).catch(() => {});
    return () => { active = false; };
  }, [isFavorites, orderItems]);
  const favoriteMessage = safeFavorites.length
    ? `Olá! Quero ajuda com estas joias favoritas: ${safeFavorites.map((item) => item.name).join(", ")}.`
    : "Olá! Quero ajuda para escolher minhas joias favoritas no catálogo.";
  const finalTotal = couponQuote?.valid ? couponQuote.final_amount : orderTotal;
  const message = safeOrderItems.length
    ? `Olá! Quero agendar com estas joias: ${safeOrderItems.map((item) => `${item.qty || 1}x ${item.name}${item.customer_notes ? ` (${item.customer_notes})` : ""}`).join(", ")}. ${couponQuote?.coupon ? `Cupom: ${couponQuote.coupon.code}. ` : ""}Total aproximado: ${currency.format(asNumber(finalTotal))}.`
    : "Olá! Quero ajuda para montar meu pedido no catálogo.";

  async function applyCoupon() {
    setCouponError("");
    setCouponQuote(null);
    const response = await publicApiFetch("/catalog/price-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coupon_code: couponCode,
        items: safeOrderItems.map((item) => ({
          product_id: item.id,
          variation_id: item.selected_variant_id,
          category: item.category,
          color: item.selected_color || item.color,
          material: item.material,
          stone: item.stone,
          unit_price: item.sale_value,
          quantity: item.qty || 1
        }))
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setCouponError(json.error || "Cupom inválido.");
    setCouponQuote(json);
  }

  return (
    <div className="catalog-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="catalog-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">{isFavorites ? "Favoritos" : "Meu pedido"}</span>
            <h2>{isFavorites ? "Joias favoritas" : "Pedido em andamento"}</h2>
          </div>
          <button onClick={onClose} aria-label="Fechar">X</button>
        </header>
        <div className="catalog-drawer-list">
          {items.length ? items.map((item) => (
            <article key={item.order_key || item.id}>
              <img src={catalogImageUrl(item.photo_url)} alt={item.name} />
              <div>
                <strong>{item.name}</strong>
                <span>{[item.material, item.selected_color || item.color, item.selected_variant_name || item.size].map(elegantProductName).filter(Boolean).join(" · ")}</span>
                <small>{isFavorites ? currency.format(item.sale_value || 0) : `${item.qty || 1}x · ${currency.format(item.sale_value || 0)}`}</small>
                {!isFavorites && <label>Quantidade<input type="number" min="1" max={Math.max(1, Number(item.quantity || 1))} value={item.qty || 1} onChange={(event) => onUpdateOrderQuantity(item.order_key || item.id, event.target.value)} /></label>}
                {!isFavorites && <textarea value={item.customer_notes || ""} onChange={(event) => onUpdateOrderNotes(item.order_key || item.id, event.target.value)} placeholder="Observações de cor, tamanho ou envio" />}
              </div>
              <button onClick={() => isFavorites ? onRemoveFavorite(item.id) : onRemoveOrder(item.order_key || item.id)}>Remover</button>
            </article>
          )) : <p className="empty-state">{isFavorites ? "Nenhuma joia favoritada ainda." : "Seu pedido ainda está vazio."}</p>}
        </div>
        {!isFavorites && (
          <footer>
            <div className="catalog-coupon-field">
              <input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Cupom de desconto" />
              <button type="button" className="secondary-button" onClick={applyCoupon} disabled={!couponCode.trim() || !safeOrderItems.length}>Aplicar</button>
            </div>
            {couponError && <span className="form-error">{couponError}</span>}
            {couponQuote?.promotion_discount > 0 && <span className="form-success">Promoções: −{currency.format(couponQuote.promotion_discount)}</span>}
            {couponQuote?.coupon_discount > 0 && <span className="form-success">Cupom aplicado: −{currency.format(couponQuote.coupon_discount)}</span>}
            <div><span>Total aproximado</span><strong>{currency.format(finalTotal)}</strong></div>
            <a className="secondary-button" href={publicUrl("/comprar")}>Finalizar no site</a>
            <a className="primary-button whatsapp-checkout" href={whatsappCatalogUrl(message, whatsappPhone)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Finalizar pelo WhatsApp</a>
            {safeOrderItems.length > 0 && <button className="secondary-button" onClick={onClearOrder}>Limpar pedido</button>}
          </footer>
        )}
        {isFavorites && (
          <footer>
            <a className="primary-button whatsapp-checkout" href={whatsappCatalogUrl(favoriteMessage, whatsappPhone)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Enviar favoritos pelo WhatsApp</a>
          </footer>
        )}
      </aside>
    </div>
  );
}

export function PublicCheckout() {
  const { data } = usePublicFetch("/catalog");
  const [form, setForm] = useState({ full_name: "", cpf: "", whatsapp: "", email: "", instagram: "", payment_method: "Pix", fulfillment_method: "pickup", delivery_address: "", coupon_code: "", accepted_policies: false, notes: "" });
  const [orderItems, setOrderItems] = useState(() => readCatalogStorage("aura-catalog-order", []));
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  const safeOrderItems = asArray(orderItems);

  useEffect(() => {
    setOrderItems(readCatalogStorage("aura-catalog-order", []));
  }, []);

  const subtotal = safeOrderItems.reduce((sum, item) => sum + asNumber(item?.sale_value) * asNumber(item?.qty, 1), 0);
  const total = quote?.valid ? asNumber(quote.final_amount) : subtotal;

  async function applyCheckoutCoupon() {
    setError("");
    const response = await publicApiFetch("/catalog/price-quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coupon_code: form.coupon_code, items: safeOrderItems.map((item) => ({ product_id: item.id, variation_id: item.selected_variant_id, category: item.category, unit_price: item.sale_value, quantity: item.qty || 1 })) })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Cupom inválido.");
    setQuote(json);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.full_name.trim() || !form.whatsapp.trim()) {
      setError("Informe nome e WhatsApp para concluir a compra.");
      return;
    }
    if (!safeOrderItems.length) {
      setError("Seu pedido está vazio.");
      return;
    }
    // CPF continua opcional aqui, mas errado ele não passa: o backend guardaria
    // um documento inválido em `clients.tax_id` e a recusa só apareceria na
    // primeira cobrança online daquele cliente.
    const cpfError = taxIdError(form.cpf);
    if (cpfError) return setError(cpfError);
    if (!form.accepted_policies) return setError("Aceite as políticas para concluir o pedido.");
    if (form.fulfillment_method === "delivery" && !form.delivery_address.trim()) return setError("Informe o endereço de entrega.");
    const response = await publicApiFetch("/sales-orders/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: form.full_name,
        whatsapp: form.whatsapp,
        instagram: form.instagram,
        payment_method: form.payment_method,
        cpf: form.cpf,
        email: form.email,
        fulfillment_method: form.fulfillment_method,
        delivery_address: form.delivery_address,
        accepted_policies: form.accepted_policies,
        coupon_code: form.coupon_code,
        idempotency_key: idempotencyKey,
        source: "site",
        order_type: "produto",
        notes: form.notes,
        items: safeOrderItems.map((item) => ({
          item_type: "produto",
          product_id: item.id,
          product_variant_id: item.selected_variant_id || null,
          item_name: item.name,
          quantity: Number(item.qty || 1),
          unit_price: Number(item.sale_value || 0),
          notes: item.customer_notes || ""
        }))
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error || "Não foi possível concluir a compra.");
      return;
    }
    localStorage.removeItem(`aura-catalog-order:${publicTenant() || "default"}`);
    setOrderItems([]);
    setSuccess(json);
  }

  if (!data) return <Loading />;

  if (success) {
    return (
      <main className="public-checkout-page">
        <section className="booking-shell">
          <div className="panel-heading">
            <h2>Pedido registrado</h2>
            <span>Seu pedido foi recebido e aguarda confirmação.</span>
          </div>
          <p>Pedido #{success.id} criado para {success.full_name}. O pagamento ainda não foi confirmado.</p>
          <div className="checkout-actions">
            <a className="primary-button" href={catalogUrl()}>Voltar ao catálogo</a>
            <a className="secondary-button" href={catalogUrl()}>Continuar comprando</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="public-checkout-page">
      <section className="booking-shell">
        <header className="booking-public-header">
          <a className="catalog-client-brand" href={catalogUrl()}><strong>{data.theme?.brand_name || data.settings?.company_display_name || "Estúdio"}</strong><span>Checkout direto</span></a>
          <a className="secondary-button" href={catalogUrl()}>Voltar ao catálogo</a>
        </header>
        <div className="checkout-grid">
          <form className="panel appointment-form" onSubmit={submit}>
            <div className="panel-heading">
              <h2>Finalizar compra</h2>
              <span>Vitrine pública do estúdio</span>
            </div>
            <div className="form-grid">
              <Input label="Nome completo" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
              <Input label="CPF (opcional)" value={form.cpf} onChange={(value) => setForm({ ...form, cpf: formatTaxId(value) })} />
              <Input label="E-mail" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
                <option>Pix</option>
                <option>Dinheiro</option>
                <option>Cartão de crédito</option>
                <option>Cartão de débito</option>
              </Select>
              <Select label="Recebimento" value={form.fulfillment_method} onChange={(value) => setForm({ ...form, fulfillment_method: value })}>
                <option value="pickup">Retirada na clínica</option>
                <option value="delivery">Entrega</option>
              </Select>
              {form.fulfillment_method === "delivery" && <Input label="Endereço de entrega" value={form.delivery_address} onChange={(value) => setForm({ ...form, delivery_address: value })} required />}
            </div>
            <div className="catalog-coupon-field">
              <input value={form.coupon_code} onChange={(event) => { setForm({ ...form, coupon_code: event.target.value.toUpperCase() }); setQuote(null); }} placeholder="Cupom de desconto" />
              <button type="button" className="secondary-button" onClick={applyCheckoutCoupon} disabled={!form.coupon_code.trim()}>Aplicar cupom</button>
              {quote?.coupon_discount > 0 && <button type="button" className="secondary-button" onClick={() => { setForm({ ...form, coupon_code: "" }); setQuote(null); }}>Remover</button>}
            </div>
            <label>Observações
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Observação de cor, tamanho, envio ou retirada." />
            </label>
            <Checkbox className="checkout-policy" label="Li e aceito as políticas da clínica." checked={form.accepted_policies} onChange={(accepted_policies) => setForm({ ...form, accepted_policies })} />
            {error && <span className="form-error">{error}</span>}
            <button className="primary-button" type="submit">Confirmar compra</button>
          </form>
          <div className="panel">
            <div className="panel-heading">
              <h2>Resumo do pedido</h2>
              <span>{safeOrderItems.length} item(ns)</span>
            </div>
            <div className="sales-checkout-items">
              {safeOrderItems.length ? safeOrderItems.map((item) => (
                <article key={item.id} className="sales-checkout-item">
                  <img src={catalogImageUrl(item.photo_url)} alt={item.name} />
                  <div>
                    <strong>{item.name}</strong>
                    <small>{[item.material, item.color, item.size].filter(Boolean).join(" · ")}</small>
                    <span>{Number(item.qty || 1)}x {currency.format(item.sale_value || 0)}</span>
                  </div>
                </article>
              )) : <p className="empty-state">Seu carrinho está vazio. Volte ao catálogo e adicione joias.</p>}
            </div>
            <div className="checkout-total-row">
              <strong>Subtotal</strong><span>{currency.format(subtotal)}</span>
            </div>
            {quote?.discount_amount > 0 && <div className="checkout-total-row"><strong>Desconto</strong><span>−{currency.format(quote.discount_amount)}</span></div>}
            <div className="checkout-total-row">
              <strong>Total final</strong>
              <span>{currency.format(total)}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export function PublicBooking() {
  const { data } = usePublicFetch("/booking/config");
  const { data: catalogData } = usePublicFetch("/catalog");
  const [step, setStep] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("appointment_time") ? 5 : params.get("appointment_date") ? 4 : params.get("professional_id") ? 3 : params.get("service_id") ? 2 : 1;
  });
  // `cpf`/`email` ficam fora de `defaultPublicBooking()` porque nascem sempre
  // vazios: são digitados na etapa 5 e não vêm por query string como o resto.
  const [form, setForm] = useState(() => ({ ...defaultPublicBooking(), cpf: "", email: "", birth_date: "", guardian_name: "", guardian_document: "" }));
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(null);
  const [serviceIds, setServiceIds] = useState([]);
  const safeData = asObject(data);
  const services = asArray(safeData.services);
  const catalogItems = asArray(catalogData?.items);
  const allProfessionals = asArray(safeData.professionals);
  const effectiveServiceIds = serviceIds.length ? serviceIds : form.service_id ? [form.service_id] : [];
  const professionals = allProfessionals.filter((professional) => effectiveServiceIds.every((serviceId) => professionalMatchesService(professional, serviceId)));
  const bookingDates = nextBookingDates(10);
  const selectedService = services.find((item) => String(item.id) === String(form.service_id));
  const selectedProfessional = allProfessionals.find((item) => String(item.id) === String(form.professional_id));
  const selectedJewelry = catalogItems.find((item) => String(item.id) === String(form.jewelry_id));
  const selectedJewelryVariant = asArray(selectedJewelry?.variants).find((variant) => String(variant.id) === String(form.jewelry_variant_id));
  const selectedJewelryValue = form.jewelry_id ? asNumber(selectedJewelryVariant?.sale_value || selectedJewelry?.sale_value || 0) : 0;
  const selectedServices = services.filter((item) => effectiveServiceIds.some((id) => String(id) === String(item.id)));
  const needsBirthDate = selectedServices.some((item) => (item.minimum_age_years !== null && item.minimum_age_years !== undefined) || Boolean(item.requires_guardian));
  const minimumAge = Math.max(0, ...selectedServices.map((item) => asNumber(item.minimum_age_years, 0)));
  const birthDate = form.birth_date ? new Date(`${form.birth_date}T12:00:00`) : null;
  const appointmentDate = form.appointment_date ? new Date(`${form.appointment_date}T12:00:00`) : new Date();
  const ageAtAppointment = birthDate && !Number.isNaN(birthDate.getTime()) ? appointmentDate.getFullYear() - birthDate.getFullYear() - (appointmentDate < new Date(appointmentDate.getFullYear(), birthDate.getMonth(), birthDate.getDate()) ? 1 : 0) : null;
  const guardianRequired = selectedServices.some((item) => Boolean(item.requires_guardian)) && ageAtAppointment !== null && ageAtAppointment < 18;
  const ageBlocked = minimumAge > 0 && ageAtAppointment !== null && ageAtAppointment < minimumAge;
  const rulesDataMissing = (needsBirthDate && !form.birth_date) || (guardianRequired && (!form.guardian_name.trim() || !String(form.guardian_document || "").replace(/\D/g, "")));
  const selectedServiceValue = selectedServices.reduce((sum, item) => sum + asNumber(item.base_price || item.price || 0), 0);
  const bookingOrderItems = readCatalogStorage("aura-catalog-order", []);
  const orderJewelryValue = asArray(bookingOrderItems).reduce((sum, item) => sum + asNumber(item.sale_value) * asNumber(item.qty, 1), 0);
  const selectedTotal = selectedServiceValue + (bookingOrderItems.length ? orderJewelryValue : selectedJewelryValue);
  const selectedDeposit = asNumber(selectedService?.deposit_value || 25);
  const selectedRemaining = Math.max(selectedTotal - selectedDeposit, 0);
  // Sinal online = clínica com gateway configurado E solicitação que gera sinal.
  // Só nesse caso o CPF é barreira: o Asaas recusa criar o pagador sem ele e o
  // link de pagamento nunca existiria. Sem gateway o campo continua opcional —
  // pedir documento para agendar um horário que será pago no balcão afasta
  // cliente sem nenhum ganho.
  const onlineDeposit = Boolean(asObject(safeData.payment).gateway_enabled) && selectedDeposit > 0;
  const cpfError = taxIdError(form.cpf, onlineDeposit);

  useEffect(() => {
    if (!form.professional_id) return;
    if (professionals.some((professional) => String(professional.id) === String(form.professional_id))) return;
    setForm((current) => ({ ...current, professional_id: "", appointment_time: "" }));
  }, [form.service_id, form.professional_id, professionals.length]);

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      setLoadingSlots(true);
      const response = await publicApiFetch("/booking/slots?service_id=" + form.service_id + "&professional_id=" + form.professional_id + "&date=" + form.appointment_date);
      const json = await response.json().catch(() => ({}));
      setLoadingSlots(false);
      setSlots(response.ok ? asArray(json.slots) : []);
      setError(response.ok ? "" : json.error || "Não foi possível carregar os horários.");
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  async function submit() {
    if (submitting) return;
    // Última barreira antes do envio: a etapa 5 pode ter sido pulada por link
    // com query string, e o backend devolveria 400 depois do resumo inteiro.
    if (cpfError) return setError(`${cpfError} Volte à etapa "Dados" para corrigir.`);
    if (ageBlocked) return setError(`Este procedimento exige idade mínima de ${minimumAge} anos.`);
    if (rulesDataMissing) return setError("Preencha os dados necessários para validar idade e responsável legal.");
    setError("");
    setSubmitting(true);
    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (value) body.append(key, value);
    });
    body.set("service_id", String(effectiveServiceIds[0] || form.service_id));
    body.append("items", JSON.stringify([
      ...selectedServices.map((item) => ({ item_type: "service", service_id: item.id, quantity: 1 })),
      ...asArray(bookingOrderItems).map((item) => ({
        item_type: "jewelry",
        jewelry_id: item.id,
        jewelry_variant_id: item.selected_variant_id || null,
        quantity: item.qty || 1,
        selected_color: item.selected_color || item.color || "",
        notes: item.customer_notes || ""
      }))
    ]));
    const response = await publicApiFetch("/booking/requests", { method: "POST", body });
    const json = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (!response.ok) return setError(json.error || "Não foi possível solicitar o agendamento.");
    setConfirmed(json);
    setStep(7);
  }

  return (
    <main className="public-booking-page">
      <section className="booking-shell">
        <header className="booking-public-header">
          <a className="catalog-client-brand" href={catalogUrl()}><strong>{catalogData?.theme?.brand_name || catalogData?.brand_name || "Estúdio"}</strong><span>{catalogData?.theme?.slogan || "Agendamento"}</span></a>
          <a className="secondary-button" href={catalogUrl()}>Ver Catálogo</a>
        </header>
        <div className="booking-hero">
          <span className="eyebrow">Agendamento online</span>
          <h1>Reserve seu horário</h1>
          <p>Escolha Serviço, Profissional, Data E Horário Disponível. A equipe confirma manualmente sua solicitação.</p>
        </div>
        <div className="booking-progress">
          {["Serviço", "Profissional", "Data", "Horário", "Dados", "Resumo"].map((label, index) => (
            <button key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => step > index + 1 && setStep(index + 1)}>
              <strong>{index + 1}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {step === 1 && (
          <section className="booking-panel">
            <h2>Escolha um ou mais serviços</h2>
            <div className="booking-choice-grid">
              {services.map((item) => {
                const selected = effectiveServiceIds.some((id) => String(id) === String(item.id));
                return (
                  <button type="button" key={item.id} className={selected ? "active" : ""} onClick={() => {
                    const next = selected ? effectiveServiceIds.filter((id) => String(id) !== String(item.id)) : [...effectiveServiceIds, item.id];
                    setServiceIds(next);
                    setForm({ ...form, service_id: next[0] || "", professional_id: "", appointment_time: "" });
                  }}>
                    <strong>{item.name}</strong><p>{item.description}</p><span>{item.duration_minutes} min · {currency.format(item.base_price || item.price || 0)}</span>
                    {(item.minimum_age_years != null || item.requires_guardian || item.requires_signed_term) && <small>{[item.minimum_age_years != null ? `${item.minimum_age_years}+ anos` : "", item.requires_guardian ? "responsável para menor" : "", item.requires_signed_term ? "termo obrigatório" : ""].filter(Boolean).join(" · ")}</small>}
                  </button>
                );
              })}
            </div>
            <button type="button" className="primary-button booking-wide-button" disabled={!effectiveServiceIds.length} onClick={() => setStep(2)}>Continuar com {effectiveServiceIds.length} serviço(s)</button>
          </section>
        )}
        {step === 2 && (
          professionals.length
            ? <BookingChoiceGrid title="Escolha A Profissional" items={professionals} value={form.professional_id} onSelect={(id) => { setForm({ ...form, professional_id: id, appointment_time: "" }); setStep(3); }} render={(item) => <><strong>{item.name}</strong><p>{item.specialty || "Body Piercer Aura"}</p></>} />
            : <section className="booking-panel"><h2>Nenhuma Profissional Vinculada</h2><p className="empty-state">Este serviço ainda não possui profissional ativo vinculado. Volte e escolha outro serviço ou fale com o estúdio pelo WhatsApp.</p><button type="button" className="secondary-button" onClick={() => setStep(1)}>Escolher Outro Serviço</button></section>
        )}
        {step === 3 && (
          <section className="booking-panel booking-date-card">
            <span className="booking-section-kicker">Etapa 3 · Data</span>
            <h2>Escolha a Data</h2>
            <p>Os horários serão carregados automaticamente para o dia escolhido.</p>
            <div className="booking-date-strip">
              {bookingDates.map((date) => (
                <button key={date.value} type="button" className={form.appointment_date === date.value ? "active" : ""} onClick={() => {
                  setForm({ ...form, appointment_date: date.value, appointment_time: "" });
                  setStep(4);
                }}>
                  <strong>{date.day}</strong><span>{date.weekday}</span><small>{date.month}</small>
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 4 && (
          <section className="booking-panel booking-time-card">
            <span className="booking-section-kicker">Etapa 4 · Horários</span>
            <h2>Agende seu Horário</h2>
            <p className="booking-selected-date">{form.appointment_date ? formatLongDate(form.appointment_date) : "Selecione uma data para ver os horários."}</p>
            <div className="booking-date-strip compact">
              {bookingDates.map((date) => (
                <button key={date.value} type="button" className={form.appointment_date === date.value ? "active" : ""} onClick={() => setForm({ ...form, appointment_date: date.value, appointment_time: "" })}>
                  <strong>{date.day}</strong><span>{date.weekday}</span>
                </button>
              ))}
            </div>
            {loadingSlots && <p className="empty-state">Carregando horários...</p>}
            <div className="slot-grid">
              {slots.map((slot) => <button key={slot.time} className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
            </div>
            {error && <span className="form-error">{error}</span>}
            {!loadingSlots && !slots.length && <p className="empty-state">Nenhum horário disponível nesta data.</p>}
            <button className="primary-button booking-wide-button" disabled={!form.appointment_time} onClick={() => setStep(5)}>Continuar</button>
          </section>
        )}
        {step === 5 && (
          <section className="booking-panel">
            <span className="booking-section-kicker">Etapa 5  Dados</span>
            <h2>Seus Dados</h2>
            <div className="form-grid">
              <Input label="Nome" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
              <Input label={onlineDeposit ? "CPF" : "CPF (opcional)"} value={form.cpf} onChange={(value) => setForm({ ...form, cpf: formatTaxId(value) })} required={onlineDeposit} />
              {/* E-mail é opcional no gateway (`email: client.email || undefined`),
                  então ele não vira barreira — mas é por onde o Asaas manda a
                  fatura e o recibo do sinal. */}
              <Input label="E-mail (opcional)" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              {needsBirthDate && <Input label="Data de nascimento" type="date" value={form.birth_date} onChange={(value) => setForm({ ...form, birth_date: value })} required />}
              {guardianRequired && <>
                <Input label="Nome do responsável legal" value={form.guardian_name} onChange={(value) => setForm({ ...form, guardian_name: value })} required />
                <Input label="Documento do responsável" value={form.guardian_document} onChange={(value) => setForm({ ...form, guardian_document: formatTaxId(value) })} required />
              </>}
              <label>Foto de referência<input type="file" accept="image/*" onChange={(event) => setForm({ ...form, reference_photo: event.target.files?.[0] })} /></label>
            </div>
            <span className={cpfError && form.cpf ? "field-hint is-error" : "field-hint"}>
              {cpfError && form.cpf
                ? cpfError
                : onlineDeposit
                  ? "O CPF é obrigatório para emitir o link do sinal — o gateway não cria a cobrança sem documento. O e-mail recebe o comprovante."
                  : "Sem CPF o sinal não pode ser cobrado online: você envia o comprovante do Pix pelo WhatsApp e a equipe confirma na mão."}
            </span>
            <label>Observações<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            {ageBlocked && <span className="field-hint is-error">Este procedimento exige idade mínima de {minimumAge} anos.</span>}
            <button className="primary-button booking-wide-button" disabled={!form.full_name || !form.whatsapp || Boolean(cpfError) || rulesDataMissing || ageBlocked} onClick={() => setStep(6)}>Ver Resumo</button>
          </section>
        )}
        {step === 6 && (
          <section className="booking-panel booking-summary">
            <span className="booking-section-kicker">Etapa 6  Resumo</span>
            <h2>Resumo Da Solicitação</h2>
            <p><strong>Serviços:</strong> {selectedServices.map((item) => item.name).join(", ")}</p>
            {bookingOrderItems.length > 0
              ? <p><strong>Joias:</strong> {bookingOrderItems.map((item) => `${item.qty || 1}x ${elegantProductName(item.name)}`).join(", ")}</p>
              : selectedJewelry && <p><strong>Joia escolhida:</strong> {elegantProductName(selectedJewelry.name)}{selectedJewelryVariant ? ` · ${variantCatalogLabel(selectedJewelryVariant)}` : ""}{form.selected_color ? ` · ${form.selected_color}` : ""}</p>}
            <p><strong>Profissional:</strong> {selectedProfessional?.name}</p>
            <p><strong>Data E Horário:</strong> {formatLongDate(form.appointment_date)} às {form.appointment_time}</p>
            <p><strong>Valor do procedimento:</strong> {currency.format(selectedServiceValue)}</p>
            {(selectedJewelry || bookingOrderItems.length > 0) && <p><strong>Valor das joias:</strong> {currency.format(bookingOrderItems.length ? orderJewelryValue : selectedJewelryValue)}</p>}
            <p><strong>Valor total:</strong> {currency.format(selectedTotal)}</p>
            <p><strong>Sinal obrigatório:</strong> {currency.format(selectedDeposit)}</p>
            {selectedServices.some((item) => Boolean(item.requires_signed_term)) && <p><strong>Termo digital:</strong> deverá estar assinado antes da conclusão do atendimento.</p>}
            <p><strong>Valor restante:</strong> {currency.format(selectedRemaining)}</p>
            <p><strong>Regras:</strong> {data.rules?.cancellation}</p>
            <Input label="Cupom (opcional)" value={form.coupon_code || ""} onChange={(value) => setForm({ ...form, coupon_code: value.toUpperCase() })} />
            <label>Comprovante Do Sinal Pix (opcional)<input type="file" accept="image/*,.pdf" onChange={(event) => setForm({ ...form, payment_proof: event.target.files?.[0] })} /></label>
            {error && <span className="form-error">{error}</span>}
            <button className="primary-button booking-wide-button" disabled={submitting} onClick={submit}>{submitting ? "Enviando..." : "Confirmar Solicitação"}</button>
          </section>
        )}
        {step === 7 && (
          <section className="booking-panel booking-confirmation">
            <CheckCircle2 size={42} />
            <span className="booking-section-kicker">Solicitação enviada</span>
            <h2>Solicitação Enviada</h2>
            {/* O texto vem do backend porque só ele sabe qual caminho de fato
                existiu: com link de pagamento, mandar enviar comprovante é
                ruído; sem link, prometer pagamento online deixa o cliente
                esperando algo que nunca chega. */}
            <p>{confirmed?.payment_instructions || "Seu horário ficou aguardando o comprovante do sinal. Envie o comprovante pelo WhatsApp da profissional para a Aura confirmar manualmente."}</p>
            <strong>{confirmed?.procedure}  {formatLongDate(confirmed?.appointment_date)} às {confirmed?.appointment_time}</strong>
            <p><strong>Sinal:</strong> {currency.format(asNumber(confirmed?.deposit_value || selectedDeposit))} · <strong>Restante:</strong> {currency.format(asNumber(confirmed?.remaining_value || selectedRemaining))}</p>
            {confirmed?.online_payment_available && confirmed?.payment_url && <a className="primary-button booking-wide-button" href={confirmed.payment_url} target="_blank" rel="noreferrer"><CircleDollarSign size={16} /> Pagar o sinal agora</a>}
            {confirmed?.professional_whatsapp_url && <a className={confirmed?.online_payment_available ? "secondary-button booking-wide-button" : "primary-button booking-wide-button"} href={confirmed.professional_whatsapp_url} target="_blank" rel="noreferrer"><MessageCircle size={16} /> {confirmed?.online_payment_available ? "Falar com a profissional" : "Enviar comprovante pelo WhatsApp"}</a>}
            <a className="primary-button booking-wide-button" href={catalogUrl()}>Voltar Ao Catálogo</a>
          </section>
        )}
      </section>
    </main>
  );
}

function whatsappShareUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function instagramCatalogUrl(handle = "") {
  const username = String(handle).trim().replace(/^@/, "");
  return username ? `https://www.instagram.com/${encodeURIComponent(username)}/` : "https://www.instagram.com/";
}

function whatsappCatalogUrl(message, phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const normalized = digits ? (digits.startsWith("55") ? digits : `55${digits}`) : "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message || "Olá! Vim pelo catálogo online.")}`;
}

function catalogProductUrl(id) {
  return catalogUrl(`/catalogo/produto/${id}`);
}

function writeCatalogStorage(key, value) {
  localStorage.setItem(`${key}:${publicTenant() || "default"}`, JSON.stringify(value));
}

function bookingJewelryUrl(item = {}, variant = {}) {
  return publicUrl("/agendar", {
    jewelry_id: item.id,
    jewelry_variant_id: variant.id,
    selected_color: variant.selected_color
  });
}

function catalogLinkProps(value, fallback = "#catalog-products") {
  const href = safeCatalogLink(value, fallback);
  return href.startsWith("https://") ? { href, target: "_blank", rel: "noreferrer" } : { href };
}

function catalogActionProps(value, fallback = "#catalog-products") {
  const href = String(value || "").trim();
  if (href.startsWith("mailto:") && safeMailto(href.slice(7))) return { href };
  return catalogLinkProps(href, fallback);
}

// Conteúdo configurável por cada clínica é dado não confiável. Os links do
// catálogo aceitam âncoras, rotas públicas e HTTPS; esquemas como javascript:
// e data: nunca chegam a um atributo href.
function safeCatalogLink(url = "", fallback = "#catalog-products") {
  const value = String(url).trim();
  if (!value) return fallback;
  if (value.startsWith("#")) return /^#[a-zA-Z][\w-]*$/.test(value) ? value : fallback;

  const internal = tenantAwareContentUrl(value);
  try {
    const origin = globalThis.location?.origin || "https://catalog.local";
    const parsed = new URL(internal, origin);
    if (parsed.origin === origin) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.protocol === "https:" ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function tenantAwareContentUrl(url = "") {
  const value = String(url).trim();
  if (value.startsWith("/catalogo")) return catalogUrl(value.split("?")[0]);
  if (value.startsWith("/agendar") || value.startsWith("/comprar")) return publicUrl(value.split("?")[0]);
  return value;
}

// Apenas provedores de vídeo incorporável conhecidos são aceitos. A conversão
// de URLs de compartilhamento evita que o editor exija conhecimento técnico.
function safeCatalogEmbedUrl(value = "") {
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return /^[\w-]{6,}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = parsed.pathname.startsWith("/embed/")
      ? parsed.pathname.split("/")[2]
      : parsed.searchParams.get("v");
    return /^[\w-]{6,}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parsed.pathname.match(/(?:video\/)?(\d+)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : "";
  }
  return "";
}

function catalogImageUrl(url) {
  if (!url) return "/placeholder-jewel-neutral.svg";
  return url.startsWith("/uploads") ? `${API_ORIGIN}${url}` : url;
}

function useNeutralImageFallback(event) {
  if (event.currentTarget.dataset.fallbackApplied) return;
  event.currentTarget.dataset.fallbackApplied = "true";
  event.currentTarget.src = "/placeholder-jewel-neutral.svg";
  event.currentTarget.alt = "";
}

function catalogCategories(names = []) {
  const iconByCategory = {
    Todos: LayoutGrid,
    Nariz: Sparkles,
    Orelha: Heart,
    Umbigo: CircleDollarSign,
    Surface: Sparkles,
    "Ouro 14k": Gem,
    "Ouro 18k": Gem,
    "Titânio": CircleDollarSign,
    Opalas: Gem,
    "Lançamentos": Star,
    Lancamentos: Star
  };
  const safeNames = asArray(names);
  const categoryNames = safeNames.length ? safeNames : ["Todos", ...JEWELRY_CATEGORY_OPTIONS];
  return categoryNames.map((name) => ({ name, icon: iconByCategory[name] || Gem }));
}

function catalogCategoriesFromCatalog(data) {
  const safeData = asObject(data);
  const active = asArray(safeData.featuredCategories)
    .filter((category) => Boolean(Number(category.is_active)))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  if (!active.length) return catalogCategories(asArray(safeData.categories));
  return [
    { name: "Todos", icon: LayoutGrid, match: "Todos" },
    ...active.map((category) => ({
      name: category.public_name || category.category_id,
      icon: catalogIcon(category.icon),
      match: category.category_id || category.public_name
    }))
  ];
}

function catalogIcon(icon) {
  return {
    gem: Gem,
    heart: Heart,
    star: Star,
    sparkles: Sparkles,
    shield: ShieldCheck,
    circle: CircleDollarSign
  }[icon] || Gem;
}
