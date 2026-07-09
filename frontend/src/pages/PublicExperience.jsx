import React, { useEffect, useState } from "react";
import {
  Calendar,
  CheckCircle2,
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
  Star,
  Truck
} from "lucide-react";
import { Loading, ApiError } from "../components/common/Feedback";
import { BookingChoiceGrid, Input, Select } from "../components/common/Ui";
import { API, API_ORIGIN, usePublicFetch } from "../lib/api";
import { asArray, asNumber, asObject, formatLongDate } from "../lib/utils";
import { ANODIZATION_COLOR_OPTIONS, JEWELRY_CATEGORY_OPTIONS, JEWELRY_LENGTH_OPTIONS, defaultPublicBooking, nextBookingDates } from "../lib/defaultForms";
import {
  catalogCategoryTerms,
  catalogContentSections,
  catalogFilterOptions,
  catalogPromotionForItem,
  catalogStockText,
  cleanDisplayText,
  defaultContentSection,
  elegantProductName,
  normalizeCatalogContentSection,
  promotionalPrice,
  splitColorOptions
} from "../features/catalog/catalogUtils";
import { variantCatalogLabel } from "../features/shared/helpers";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Leitura resiliente do localStorage do catálogo público (favoritos / itens do pedido).
function readCatalogStorage(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function PublicCatalog() {
  const { data } = usePublicFetch("/catalog");
  const [activeCategory, setActiveCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ material: "", color: "", stone: "", size: "" });
  const [sort, setSort] = useState("recentes");
  const [favoriteIds, setFavoriteIds] = useState(() => readCatalogStorage("aura-catalog-favorites", []));
  const [orderItems, setOrderItems] = useState(() => readCatalogStorage("aura-catalog-order", []));
  const [drawer, setDrawer] = useState(null);
  const [bannerIndex, setBannerIndex] = useState(0);
  const catalogRoute = window.location.pathname;
  const selectedProductId = Number((catalogRoute.match(/^\/catalogo\/produto\/(\d+)/) || [])[1] || 0);

  useEffect(() => {
    localStorage.setItem("aura-catalog-favorites", JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    localStorage.setItem("aura-catalog-order", JSON.stringify(orderItems));
  }, [orderItems]);

  useEffect(() => {
    const activeCount = asArray(data?.banners).filter((banner) => Boolean(asNumber(banner?.is_active))).length;
    if (activeCount <= 1) return undefined;
    const timer = window.setInterval(() => setBannerIndex((index) => (index + 1) % activeCount), 4500);
    return () => window.clearInterval(timer);
  }, [data?.banners]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const safeData = asObject(data);
  const theme = asObject(safeData.theme);
  const settings = safeData;
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
  // Filtrar apenas produtos publicados para o catálogo público
  const publishedItems = catalogItems.filter((item) => Boolean(Number(item.is_published || 0)));
  const selectedProduct = publishedItems.find((item) => asNumber(item?.id) === selectedProductId) || null;
  const filteredItems = publishedItems.filter((item) => {
    const haystack = `${item.name} ${item.category} ${item.material} ${item.color} ${item.stone} ${item.size} ${item.thickness} ${item.notes}`.toLowerCase();
    const activeCategoryConfig = categories.find((category) => category.name === activeCategory);
    const categoryMatch = activeCategory === "Todos" || catalogCategoryTerms(activeCategoryConfig?.match || activeCategory).some((term) => haystack.includes(term));
    const searchMatch = !search.trim() || haystack.includes(search.trim().toLowerCase());
    const materialMatch = !filters.material || item.material === filters.material;
    const colorMatch = !filters.color || String(item.color || "").toLowerCase().includes(filters.color.toLowerCase());
    const stoneMatch = !filters.stone || String(item.stone || "").toLowerCase().includes(filters.stone.toLowerCase());
    const sizeMatch = !filters.size || item.size === filters.size;
    return categoryMatch && searchMatch && materialMatch && colorMatch && stoneMatch && sizeMatch;
  });
    const items = [...filteredItems].sort((a, b) => sort === "menor-preco" ? a.sale_value - b.sale_value : sort === "maior-preco" ? b.sale_value - a.sale_value : b.id - a.id);
  const options = catalogFilterOptions(publishedItems);
  const latestItems = publishedItems.filter((item) => Number(item.quantity || 0) > 0).sort((a, b) => b.id - a.id).slice(0, 8);
  const bestSellerItems = publishedItems.filter((item) => Number(item.quantity || 0) > 0).sort((a, b) => Number(b.sale_value || 0) - Number(a.sale_value || 0)).slice(0, 8);
  const lastUnitsItems = publishedItems.filter((item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= 2).slice(0, 8);
  const promoItems = publishedItems.filter((item) => catalogPromotionForItem(item, asArray(safeData.promotions))).slice(0, 8);
  const safeFavoriteIds = asArray(favoriteIds);
  const safeOrderItems = asArray(orderItems);
  const favoriteItems = publishedItems.filter((item) => safeFavoriteIds.includes(item.id));
  const orderTotal = safeOrderItems.reduce((sum, item) => sum + asNumber(item?.sale_value) * asNumber(item?.qty, 1), 0);
  const catalogStyle = {
    "--catalog-primary": theme.primary_color || "#C8A96A",
    "--catalog-secondary": theme.secondary_color || "#D8C3A5",
    "--catalog-bg": theme.background_color || "#F8F5F0",
    "--catalog-button": theme.button_color || "#C8A96A",
    fontFamily: theme.body_font || "Inter"
  };

  function toggleFavorite(item) {
    setFavoriteIds((current) => {
      const safeCurrent = asArray(current);
      return safeCurrent.includes(item.id) ? safeCurrent.filter((id) => id !== item.id) : [...safeCurrent, item.id];
    });
  }

function addToOrder(item) {
    setOrderItems((currentValue) => {
      const current = asArray(currentValue);
      const orderKey = `${item.id}-${item.selected_variant_id || "produto"}-${item.selected_color || "sem-cor"}`;
      const existing = current.find((orderItem) => orderItem.order_key === orderKey);
      if (existing) return current.map((orderItem) => orderItem.order_key === orderKey ? { ...orderItem, qty: Number(orderItem.qty || 1) + 1 } : orderItem);
      return [...current, { ...item, order_key: orderKey, qty: 1 }];
    });
  }

  function removeFromOrder(id) {
    setOrderItems((current) => asArray(current).filter((item) => (item.order_key || item.id) !== id));
  }

  function updateOrderItemNotes(id, notes) {
    setOrderItems((current) => asArray(current).map((item) => ((item.order_key || item.id) === id ? { ...item, customer_notes: notes } : item)));
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
        <header className="catalog-topbar">
          <a className="catalog-client-brand" href="/catalogo">
            {theme.logo_url && <img src={catalogImageUrl(theme.logo_url)} alt={theme.brand_name || "Aura Clinic"} />}
            <strong>{theme.brand_name || data.brand_name || "Aura Clinic"}</strong>
            <span>{theme.slogan || data.slogan || "Clinic Piercing"}</span>
          </a>
          <div className="catalog-top-actions">
            <label className="catalog-search">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar joia, material ou tamanho" />
            </label>
            {Boolean(Number(theme.show_favorites || 1)) && <button className="catalog-icon-action" onClick={() => setDrawer("favorites")} aria-label="Favoritos"><Heart size={18} /><span>{favoriteIds.length}</span></button>}
            <button className="catalog-icon-action primary-cart" onClick={() => setDrawer("order")}><ShoppingCart size={19} /> Pedido <span>{orderItems.reduce((sum, item) => sum + Number(item.qty || 1), 0)}</span></button>
          </div>
        </header>

        <div className="catalog-title">
          <span className="eyebrow">Catálogo online</span>
          <h1 style={{ fontFamily: theme.title_font || "Georgia" }}>{settings.page_title || "Catálogo Online"} <Sparkles size={26} /></h1>
          <p>{data.title || "Escolha a joia perfeita para você"}</p>
          {data.subtitle && <small>{data.subtitle}</small>}
        </div>

        <section
          className={`catalog-premium-hero catalog-carousel-hero catalog-layout-${data.layout_style || "premium"}`}
          style={{
            backgroundImage: `linear-gradient(90deg, rgba(255, 253, 249, .08), rgba(255, 253, 249, .04), rgba(28, 28, 28, .14)), url(${catalogImageUrl(activeBanner.image_url || data.hero_image_url)})`,
            minHeight: `${Number(activeBanner.banner_height || 340)}px`,
            maxWidth: activeBanner.banner_width ? `${Number(activeBanner.banner_width)}px` : "none",
            backgroundSize: activeBanner.banner_fit || "cover",
            backgroundRepeat: "no-repeat",
            marginLeft: activeBanner.banner_width ? "auto" : undefined,
            marginRight: activeBanner.banner_width ? "auto" : undefined
          }}
        >
          {banners.length > 1 && (
            <div className="catalog-carousel-dots">
              {banners.map((banner, index) => (
                <button key={`${banner.title}-${index}`} className={index === bannerIndex % banners.length ? "active" : ""} aria-label={`Banner ${index + 1}`} onClick={() => setBannerIndex(index)} />
              ))}
            </div>
          )}
        </section>

        <section className="catalog-category-strip">
          {categories.map(({ name, icon: Icon }) => (
            <button key={name} className={activeCategory === name ? "active" : ""} onClick={() => setActiveCategory(name)}>
              <Icon size={25} />
              <span>{cleanDisplayText(name)}</span>
            </button>
          ))}
        </section>

        <section className="catalog-filters">
          <span className="catalog-filter-label">Refinar</span>
          <CatalogSelect label="Material" value={filters.material} options={options.materials} onChange={(value) => setFilters({ ...filters, material: value })} />
          <CatalogSelect label="Observação de cor" value={filters.color} options={options.colors} onChange={(value) => setFilters({ ...filters, color: value })} />
          <CatalogSelect label="Pedra" value={filters.stone} options={options.stones} onChange={(value) => setFilters({ ...filters, stone: value })} />
          <CatalogSelect label="Tamanho" value={filters.size} options={options.sizes} onChange={(value) => setFilters({ ...filters, size: value })} />
          <label className="catalog-sort">
            <SlidersHorizontal size={16} />
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="recentes">Mais recentes</option>
              <option value="menor-preco">Menor preço</option>
              <option value="maior-preco">Maior preço</option>
            </select>
          </label>
        </section>

        <section className="catalog-trust-strip" aria-label="Diferenciais Aura">
          <span><ShieldCheck size={20} /><strong>Curadoria profissional</strong><small>Joias selecionadas pela Aura</small></span>
          <span><Gem size={20} /><strong>Materiais premium</strong><small>Titânio, ouro e peças seguras</small></span>
          <span><Truck size={20} /><strong>Envio orientado</strong><small>Pedido finalizado pelo WhatsApp</small></span>
          <span><Heart size={20} /><strong>Composição personalizada</strong><small>Favoritos e observações no pedido</small></span>
        </section>

        <CatalogProductRail title="Lançamentos" subtitle="Novidades recém-adicionadas à curadoria." items={latestItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />
        <CatalogProductRail title="Mais desejadas" subtitle="Peças premium em destaque para composições especiais." items={bestSellerItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />
        {promoItems.length > 0 && <CatalogProductRail title="Promoções" subtitle="Ofertas ativas com preço especial." items={promoItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />}
        {lastUnitsItems.length > 0 && <CatalogProductRail title="Últimas unidades" subtitle="Joias com poucas peças disponíveis." items={lastUnitsItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />}

        <CatalogBookingWidget />
        <CatalogContentSections sections={contentSections} />

        <section className="catalog-grid" id="catalog-products">
          {items.map((item) => (
            <CatalogProductCard
              item={item}
              favorite={favoriteIds.includes(item.id)}
              onToggleFavorite={() => toggleFavorite(item)}
              theme={theme}
              settings={settings}
              promotion={catalogPromotionForItem(item, data.promotions || [])}
              onAddToOrder={() => {
                addToOrder(item);
                setDrawer("order");
              }}
              key={item.id}
            />
          ))}
        </section>
        {!items.length && <p className="empty-state catalog-empty">Nenhuma joia disponível no catálogo no momento.</p>}

        <section className="catalog-guide-section">
          <article>
            <span className="eyebrow">Guia Aura</span>
            <h2>Escolha com mais segurança</h2>
            <p>Na dúvida sobre tamanho, espessura, anodização ou região ideal Adicione observações no pedido e finalize pelo WhatsApp para receber orientação personalizada.</p>
          </article>
          <div>
            <span><strong>Medidas</strong><small>Confira tamanho, espessura e haste antes de reservar.</small></span>
            <span><strong>Materiais</strong><small>Priorize titânio grau implante, ouro 14k/18k e peças adequadas à sua pele.</small></span>
            <span><strong>Anodização</strong><small>Descreva a cor desejada nas observações do pedido.</small></span>
          </div>
        </section>

        <footer className="catalog-footer-benefits catalog-dynamic-footer">
          <div className="catalog-contact-heading">
            <span className="eyebrow">Atendimento Aura</span>
            <h2>Fale com a nossa equipe</h2>
            {settings.institutional_text && <p>{settings.institutional_text}</p>}
          </div>
          <div className="catalog-company-contact">
            {settings.whatsapp_phone && (
              <a href={whatsappCatalogUrl(settings.whatsapp_message, settings.whatsapp_phone)} target="_blank" rel="noreferrer">
                <i><MessageCircle size={20} /></i>
                <span><small>Atendimento rápido</small><strong>WhatsApp</strong><em>{settings.whatsapp_phone}</em></span>
                <ChevronRight size={17} />
              </a>
            )}
            {settings.company_instagram && (
              <a href={instagramCatalogUrl(settings.company_instagram)} target="_blank" rel="noreferrer">
                <i><Instagram size={20} /></i>
                <span><small>Acompanhe a Aura</small><strong>Instagram</strong><em>{settings.company_instagram}</em></span>
                <ChevronRight size={17} />
              </a>
            )}
            {settings.company_email && (
              <a href={`mailto:${settings.company_email}`}>
                <i><Mail size={20} /></i>
                <span><small>Envie sua dúvida</small><strong>E-mail</strong><em>{settings.company_email}</em></span>
                <ChevronRight size={17} />
              </a>
            )}
            {settings.company_hours && (
              <div>
                <i><Clock size={20} /></i>
                <span><small>Quando falar conosco</small><strong>Atendimento</strong><em>{settings.company_hours}</em></span>
              </div>
            )}
            {settings.company_address && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.company_address)}`} target="_blank" rel="noreferrer">
                <i><MapPin size={20} /></i>
                <span><small>Visite a clínica</small><strong>Endereço</strong><em>{settings.company_address}</em></span>
                <ChevronRight size={17} />
              </a>
            )}
          </div>
          <div className="catalog-footer-signature">
            <strong>{theme.brand_name || "Aura Clinic Piercing"}</strong>
            {theme.footer_text && <small>{theme.footer_text}</small>}
          </div>
        </footer>
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
          onClearOrder={() => setOrderItems([])}
        />
      )}
    </main>
  );
}

function CatalogSelect({ label, value, options, onChange }) {
  const safeOptions = asArray(options);
  return (
    <label className="catalog-filter-select">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{label}</option>
        {safeOptions.map((option) => <option key={option} value={option}>{elegantProductName(option)}</option>)}
      </select>
    </label>
  );
}

function professionalMatchesService(professional, serviceId) {
  if (!serviceId) return true;
  return asArray(professional?.service_ids).some((id) => String(id) === String(serviceId));
}

function CatalogBookingWidget() {
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
  const bookingDates = nextBookingDates(10);

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
      const response = await fetch(API + "/booking/slots?service_id=" + form.service_id + "&professional_id=" + form.professional_id + "&date=" + form.appointment_date);
      const json = await response.json().catch(() => ({}));
      setSlots(response.ok ? asArray(json.slots) : []);
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  if (!data || data.error || !services.length) return null;
  const href = "/agendar?" + new URLSearchParams(Object.fromEntries(Object.entries(form).filter(([, value]) => value))).toString();

  return (
    <section className="catalog-booking-widget" id="catalog-agenda">
      <div>
        <span className="eyebrow">Agenda online</span>
        <h2>Escolha Um Horário Disponível</h2>
        <p>Reserve pelo link público da Aura. A equipe confirma manualmente pelo WhatsApp.</p>
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

function CatalogContentSections({ sections }) {
  const active = asArray(sections).filter((section) => Boolean(section?.active));
  if (!active.length) return null;
  return (
    <section className="catalog-content-sections">
      {active.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).map((section, index) => (
        <article className={`catalog-content-card ${section.media_type || "image"}`} key={`${section.title}-${index}`}>
          <div>
            <span className="eyebrow">{section.kicker || "Aura Clinic"}</span>
            <h2>{section.title}</h2>
            <p>{section.text}</p>
            {section.button_text && section.button_link && <a className="secondary-button" href={section.button_link}>{section.button_text}</a>}
          </div>
          {section.media_url && section.media_type === "video" ? (
            <iframe title={section.title} src={section.media_url} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          ) : section.media_url ? (
            <img src={catalogImageUrl(section.media_url)} alt={section.title} />
          ) : null}
        </article>
      ))}
    </section>
  );
}

function CatalogProductRail({ title, subtitle, items, data, theme, settings, favoriteIds, onToggleFavorite, onAdd }) {
  const safeItems = asArray(items);
  const safeFavoriteIds = asArray(favoriteIds);
  if (!safeItems.length) return null;
  return (
    <section className="catalog-product-rail">
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
  const shareText = `${settings.product_share_text || "Olha essa joia da Aura Clinic:"} ${productName} - ${description} - ${currency.format(finalValue)}.`;
  const notifyText = `Olá! Quero ser avisada quando a joia ${productName} voltar ao estoque.`;
  const stockText = catalogStockText(item, theme, settings);
  const available = Number(item.quantity || 0) > 0 && item.status !== "esgotado";

  return (
    <article className="catalog-product-card">
      <figure>
        {(item.badge || promotion || !available) && <em className={`catalog-product-badge ${!available ? "unavailable" : ""}`}>{!available ? "Indisponível" : promotion ? "Promoção" : cleanDisplayText(item.badge)}</em>}
        <a className="catalog-product-image-link" href={catalogProductUrl(item.id)} aria-label={`Abrir ${productName}`}>
          <img src={catalogImageUrl(item.photo_url)} alt={productName} />
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
          {available && Boolean(Number(theme.show_buy_button)) && <button className="secondary-button" type="button" onClick={onAddToOrder}>Comprar agora</button>}
          {!available && <a className="primary-button" href={whatsappCatalogUrl(notifyText, settings.whatsapp_phone)} target="_blank" rel="noreferrer">Avise-me</a>}
          <a className="secondary-button" href={whatsappShareUrl(shareText)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Compartilhar</a>
        </div>
      </div>
    </article>
  );
}

function CatalogProductDetail({ item, data, theme = {}, settings = {}, favorite, onToggleFavorite, onAddToOrder }) {
  const productName = elegantProductName(item.name);
  const availableVariants = asArray(item?.variants).filter((variant) => Boolean(asNumber(variant?.is_active, 1)));
  const [selectedVariantId, setSelectedVariantId] = useState(availableVariants.find((variant) => Number(variant.quantity || 0) > 0)?.id || availableVariants[0]?.id || "");
  const selectedVariant = availableVariants.find((variant) => Number(variant.id) === Number(selectedVariantId)) || availableVariants[0] || {};
  const colorOptions = splitColorOptions(selectedVariant.color);
  const [selectedColor, setSelectedColor] = useState(colorOptions[0] || "");

  useEffect(() => {
    const nextColors = splitColorOptions(selectedVariant.color);
    setSelectedColor((current) => nextColors.includes(current) ? current : nextColors[0] || "");
  }, [selectedVariantId, selectedVariant.color]);

  const description = item.description || "Joia selecionada da curadoria Aura Clinic.";
  const detailItems = [
    selectedVariant.material && { label: "Material", value: elegantProductName(selectedVariant.material) },
    selectedColor && { label: "Observação de Cor", value: elegantProductName(selectedColor) },
    item.stone && { label: "Pedra", value: elegantProductName(item.stone) },
    selectedVariant.size && { label: "Tamanho", value: selectedVariant.size },
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
  const available = Number(selectedVariant.quantity ?? item.quantity ?? 0) > 0 && selectedVariant.status !== "esgotado";
  const related = asArray(data?.items)
    .filter((candidate) => candidate.id !== item.id && (candidate.category === item.category || candidate.subcategory === item.subcategory))
    .slice(0, 4);

  return (
    <main className="catalog-page theme-detail" style={{ "--catalog-primary": theme.primary_color || "#C8A96A", "--catalog-secondary": theme.secondary_color || "#D8C3A5", "--catalog-bg": theme.background_color || "#F8F5F0", "--catalog-button": theme.button_color || "#C8A96A", fontFamily: theme.body_font || "Inter" }}>
      <section className="catalog-main catalog-product-detail-page">
        <header className="catalog-topbar">
          <a className="catalog-client-brand" href="/catalogo">
            {theme.logo_url && <img src={catalogImageUrl(theme.logo_url)} alt={theme.brand_name || "Aura Clinic"} />}
            <strong>{theme.brand_name || data.brand_name || "Aura Clinic"}</strong>
            <span>{theme.slogan || data.slogan || "Clinic Piercing"}</span>
          </a>
          <div className="catalog-top-actions">
            <a className="secondary-button" href="/catalogo">Voltar ao catálogo</a>
            {Boolean(Number(theme.show_favorites || 1)) && <button className="catalog-icon-action" onClick={onToggleFavorite} aria-label={favorite ? "Remover dos favoritos" : "Favoritar"}><Heart size={18} /></button>}
          </div>
        </header>

        <section className="catalog-product-detail">
          <div className="catalog-product-gallery">
            <img className="catalog-product-hero-image" src={catalogImageUrl(item.photo_url)} alt={productName} />
            <div className="catalog-product-mini-gallery">
              {[item.photo_url, item.photo_url, item.photo_url].map((photo, index) => (
                <img key={`${item.id}-${index}`} src={catalogImageUrl(photo)} alt={`${productName} ${index + 1}`} />
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
                <label>
                  <span>Escolha a Variação</span>
                  <select value={selectedVariantId} onChange={(event) => setSelectedVariantId(event.target.value)}>
                    {availableVariants.map((variant) => (
                      <option key={variant.id} value={variant.id} disabled={Number(variant.quantity || 0) <= 0}>
                        {variantCatalogLabel(variant)} · {variant.quantity > 0 ? `${variant.quantity} disponíveis` : "Indisponível"}
                      </option>
                    ))}
                  </select>
                </label>
                {colorOptions.length > 0 && (
                  <label>
                    <span>Observação de Cor / Anodização</span>
                    <select value={selectedColor} onChange={(event) => setSelectedColor(event.target.value)}>
                      {colorOptions.map((color) => <option key={color}>{color}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
            <div className="catalog-price-box">
              <strong>{saleValue > 0 ? currency.format(saleValue) : "Valor Sob Consulta"}</strong>
              <span>{stockText || "Disponibilidade sob consulta"}</span>
            </div>
            <div className="catalog-detail-grid">
              {detailItems.map((entry) => (
                <div key={entry.label}>
                  <small>{entry.label}</small>
                  <strong>{entry.value}</strong>
                </div>
              ))}
            </div>
            <div className="catalog-detail-actions">
              {available && Boolean(Number(theme.show_schedule_button || 1)) && <button className="primary-button" type="button" onClick={() => onAddToOrder({ ...selectedVariant, selected_color: selectedColor })}>Agendar com esta Joia</button>}
              {available && Boolean(Number(theme.show_buy_button)) && <button className="secondary-button" type="button" onClick={() => onAddToOrder({ ...selectedVariant, selected_color: selectedColor })}>Comprar Agora</button>}
              {settings.whatsapp_phone && <a className="secondary-button" href={whatsappCatalogUrl(`Olá! Quero informações sobre ${productName}, ${variantCatalogLabel(selectedVariant)}${selectedColor ? `, na cor ${selectedColor}` : ""}.`, settings.whatsapp_phone)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Falar com a Aura</a>}
              <a className="secondary-button" href={whatsappShareUrl(`${settings.product_share_text || "Olha essa joia da Aura Clinic:"} ${item.name} - ${currency.format(saleValue)}.`)} target="_blank" rel="noreferrer">Compartilhar</a>
            </div>
            {item.notes && <div className="catalog-notes-box"><strong>Observações</strong><p>{item.notes}</p></div>}
          </div>
        </section>

        {related.length > 0 && (
          <section className="catalog-related-section">
            <div className="panel-heading">
              <h2>Mais opções parecidas</h2>
              <a className="secondary-button" href="/catalogo">Ver catálogo</a>
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

function CatalogDrawer({ type, favorites, orderItems, orderTotal, whatsappPhone, onClose, onRemoveFavorite, onRemoveOrder, onUpdateOrderNotes, onClearOrder }) {
  const isFavorites = type === "favorites";
  const safeFavorites = asArray(favorites);
  const safeOrderItems = asArray(orderItems);
  const items = isFavorites ? safeFavorites : safeOrderItems;
  const favoriteMessage = safeFavorites.length
    ? `Olá! Quero ajuda com estas joias favoritas: ${safeFavorites.map((item) => item.name).join(", ")}.`
    : "Olá! Quero ajuda para escolher minhas joias favoritas no catálogo da Aura Clinic.";
  const message = safeOrderItems.length
    ? `Olá! Quero agendar com estas joias: ${safeOrderItems.map((item) => `${item.qty || 1}x ${item.name}${item.customer_notes ? ` (${item.customer_notes})` : ""}`).join(", ")}. Total aproximado: ${currency.format(asNumber(orderTotal))}.`
    : "Olá! Quero ajuda para montar meu pedido no catálogo da Aura Clinic.";

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
                {!isFavorites && <textarea value={item.customer_notes || ""} onChange={(event) => onUpdateOrderNotes(item.order_key || item.id, event.target.value)} placeholder="Observações de cor, tamanho ou envio" />}
              </div>
              <button onClick={() => isFavorites ? onRemoveFavorite(item.id) : onRemoveOrder(item.order_key || item.id)}>Remover</button>
            </article>
          )) : <p className="empty-state">{isFavorites ? "Nenhuma joia favoritada ainda." : "Seu pedido ainda está vazio."}</p>}
        </div>
        {!isFavorites && (
          <footer>
            <div><span>Total aproximado</span><strong>{currency.format(orderTotal)}</strong></div>
            <a className="secondary-button" href="/comprar">Finalizar no site</a>
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
  const [form, setForm] = useState({ full_name: "", whatsapp: "", instagram: "", payment_method: "Pix", notes: "" });
  const [orderItems, setOrderItems] = useState(() => readCatalogStorage("aura-catalog-order", []));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  const safeOrderItems = asArray(orderItems);

  useEffect(() => {
    setOrderItems(readCatalogStorage("aura-catalog-order", []));
  }, []);

  const total = safeOrderItems.reduce((sum, item) => sum + asNumber(item?.sale_value) * asNumber(item?.qty, 1), 0);

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
    const response = await fetch(`${API}/sales-orders/public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: form.full_name,
        whatsapp: form.whatsapp,
        instagram: form.instagram,
        payment_method: form.payment_method,
        status: "concluida",
        source: "site",
        order_type: "produto",
        notes: form.notes,
        items: safeOrderItems.map((item) => ({
          item_type: "produto",
          product_id: item.id,
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
    localStorage.removeItem("aura-catalog-order");
    setOrderItems([]);
    setSuccess(json);
  }

  if (!data) return <Loading />;

  if (success) {
    return (
      <main className="public-checkout-page">
        <section className="booking-shell">
          <div className="panel-heading">
            <h2>Compra registrada</h2>
            <span>Seu pedido foi enviado com sucesso.</span>
          </div>
          <p>Pedido #{success.id} confirmado para {success.full_name}.</p>
          <div className="checkout-actions">
            <a className="primary-button" href="/catalogo">Voltar ao catálogo</a>
            <a className="secondary-button" href="/catalogo">Continuar comprando</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="public-checkout-page">
      <section className="booking-shell">
        <header className="booking-public-header">
          <a className="catalog-client-brand" href="/catalogo"><strong>{data.theme?.brand_name || "Aura Clinic"}</strong><span>Checkout direto</span></a>
          <a className="secondary-button" href="/catalogo">Voltar ao catálogo</a>
        </header>
        <div className="checkout-grid">
          <form className="panel appointment-form" onSubmit={submit}>
            <div className="panel-heading">
              <h2>Finalizar compra</h2>
              <span>Vitrine pública Aura Clinic</span>
            </div>
            <div className="form-grid">
              <Input label="Nome completo" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
                <option>Pix</option>
                <option>Dinheiro</option>
                <option>Cartão de crédito</option>
                <option>Cartão de débito</option>
              </Select>
            </div>
            <label>Observações
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Observação de cor, tamanho, envio ou retirada." />
            </label>
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
              <strong>Total</strong>
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
  const [step, setStep] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("appointment_time") ? 5 : params.get("appointment_date") ? 4 : params.get("professional_id") ? 3 : params.get("service_id") ? 2 : 1;
  });
  const [form, setForm] = useState(defaultPublicBooking());
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(null);
  const safeData = asObject(data);
  const services = asArray(safeData.services);
  const allProfessionals = asArray(safeData.professionals);
  const professionals = allProfessionals.filter((professional) => professionalMatchesService(professional, form.service_id));
  const bookingDates = nextBookingDates(10);
  const selectedService = services.find((item) => String(item.id) === String(form.service_id));
  const selectedProfessional = allProfessionals.find((item) => String(item.id) === String(form.professional_id));

  useEffect(() => {
    if (!form.professional_id) return;
    if (professionals.some((professional) => String(professional.id) === String(form.professional_id))) return;
    setForm((current) => ({ ...current, professional_id: "", appointment_time: "" }));
  }, [form.service_id, form.professional_id, professionals.length]);

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      setLoadingSlots(true);
      const response = await fetch(API + "/booking/slots?service_id=" + form.service_id + "&professional_id=" + form.professional_id + "&date=" + form.appointment_date);
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
    setError("");
    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (value) body.append(key, value);
    });
    const response = await fetch(API + "/booking/requests", { method: "POST", body });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Não foi possível solicitar o agendamento.");
    setConfirmed(json);
    setStep(7);
  }

  return (
    <main className="public-booking-page">
      <section className="booking-shell">
        <header className="booking-public-header">
          <a className="catalog-client-brand" href="/catalogo"><strong>Aura Clinic</strong><span>Piercing</span></a>
          <a className="secondary-button" href="/catalogo">Ver Catálogo</a>
        </header>
        <div className="booking-hero">
          <span className="eyebrow">Agendamento online</span>
          <h1>Reserve Seu Horário Na Aura Clinic</h1>
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

        {step === 1 && <BookingChoiceGrid title="Escolha O Serviço" items={services} value={form.service_id} onSelect={(id) => { setForm({ ...form, service_id: id, professional_id: "", appointment_time: "" }); setStep(2); }} render={(item) => <><strong>{item.name}</strong><p>{item.description}</p><span>{item.duration_minutes} min  {currency.format(item.base_price || item.price || 0)}</span></>} />}
        {step === 2 && (
          professionals.length
            ? <BookingChoiceGrid title="Escolha A Profissional" items={professionals} value={form.professional_id} onSelect={(id) => { setForm({ ...form, professional_id: id, appointment_time: "" }); setStep(3); }} render={(item) => <><strong>{item.name}</strong><p>{item.specialty || "Body Piercer Aura"}</p></>} />
            : <section className="booking-panel"><h2>Nenhuma Profissional Vinculada</h2><p className="empty-state">Este serviço ainda não possui profissional ativo vinculado. Volte e escolha outro serviço ou fale com a Aura pelo WhatsApp.</p><button type="button" className="secondary-button" onClick={() => setStep(1)}>Escolher Outro Serviço</button></section>
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
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              <label>Foto de referência<input type="file" accept="image/*" onChange={(event) => setForm({ ...form, reference_photo: event.target.files?.[0] })} /></label>
            </div>
            <label>Observações<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <button className="primary-button booking-wide-button" disabled={!form.full_name || !form.whatsapp} onClick={() => setStep(6)}>Ver Resumo</button>
          </section>
        )}
        {step === 6 && (
          <section className="booking-panel booking-summary">
            <span className="booking-section-kicker">Etapa 6  Resumo</span>
            <h2>Resumo Da Solicitação</h2>
            <p><strong>Serviço:</strong> {selectedService?.name}</p>
            <p><strong>Profissional:</strong> {selectedProfessional?.name}</p>
            <p><strong>Data E Horário:</strong> {formatLongDate(form.appointment_date)} ?s {form.appointment_time}</p>
            <p><strong>Valor:</strong> {currency.format(selectedService?.base_price || selectedService?.price || 0)}</p>
            <p><strong>Sinal:</strong> {currency.format(selectedService?.deposit_value || 0)}</p>
            <p><strong>Regras:</strong> {data.rules?.cancellation}</p>
            <label>Comprovante Do Sinal Pix<input type="file" accept="image/*,.pdf" onChange={(event) => setForm({ ...form, payment_proof: event.target.files?.[0] })} /></label>
            {error && <span className="form-error">{error}</span>}
            <button className="primary-button booking-wide-button" onClick={submit}>Confirmar Solicitação</button>
          </section>
        )}
        {step === 7 && (
          <section className="booking-panel booking-confirmation">
            <CheckCircle2 size={42} />
            <span className="booking-section-kicker">Solicitação enviada</span>
            <h2>Solicitação Enviada</h2>
            <p>Seu horário ficou como pendente. A Aura Clinic vai confirmar manualmente pelo WhatsApp.</p>
            <strong>{confirmed?.procedure}  {formatLongDate(confirmed?.appointment_date)} ?s {confirmed?.appointment_time}</strong>
            <a className="primary-button booking-wide-button" href="/catalogo">Voltar Ao Catálogo</a>
          </section>
        )}
      </section>
    </main>
  );
}

function whatsappUrl(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
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
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message || "Olá! Vim pelo catálogo online da Aura Clinic.")}`;
}

function catalogProductUrl(id) {
  return `/catalogo/produto/${id}`;
}

function catalogImageUrl(url) {
  if (!url) return "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80";
  return url.startsWith("/uploads") ? `${API_ORIGIN}${url}` : url;
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
    Titanio: CircleDollarSign,
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


