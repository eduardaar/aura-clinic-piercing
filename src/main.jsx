import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Cake,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Download,
  Gem,
  Heart,
  Home,
  ImageIcon,
  Instagram,
  LayoutGrid,
  ListFilter,
  FileSignature,
  HeartPulse,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  MessageCircle,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Table2,
  Truck,
  Trash2,
  Trophy,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  XCircle
} from "lucide-react";
import "./styles.css";

const API =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:4000/api");
const API_ORIGIN = API.replace(/\/api$/, "");
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const ANODIZATION_COLOR_OPTIONS = [
  { name: "Natural", color: "#B8B8B3" },
  { name: "Bronze", color: "#9A6A3A" },
  { name: "Dourado", color: "#D6AE4B" },
  { name: "Champagne", color: "#D7B98E" },
  { name: "Rosé", color: "#C98F88" },
  { name: "Rosa", color: "#D97AA8" },
  { name: "Fúcsia", color: "#B62A83" },
  { name: "Roxo", color: "#7650A8" },
  { name: "Azul Escuro", color: "#244F93" },
  { name: "Azul", color: "#3D78C5" },
  { name: "Azul Claro", color: "#65A9D8" },
  { name: "Turquesa", color: "#3AA9A0" },
  { name: "Verde", color: "#5A9A63" },
  { name: "Verde Petróleo", color: "#397A75" },
  { name: "Preto", color: "#252525" }
];
const JEWELRY_LENGTH_OPTIONS = Array.from({ length: 11 }, (_, index) => `${index + 4}mm`);
const JEWELRY_THICKNESS_OPTIONS = ["0.8mm", "1.0mm", "1.2mm", "1.6mm", "2.0mm", "2.5mm"];
const JEWELRY_THREAD_OPTIONS = ["Interna", "Externa", "Push Pin"];
const statusClass = {
  pendente: "status-pendente",
  confirmado: "status-confirmado",
  atendido: "status-atendido",
  cancelado: "status-cancelado",
  remarcado: "status-remarcado"
};

function App() {
  const [session, setSession] = useState(readStoredSession);
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const isPublicCatalog = window.location.pathname.startsWith("/catalogo");
  const isPublicBooking = window.location.pathname.startsWith("/agendar");
  const isPublicCheckout = window.location.pathname.startsWith("/comprar");

  useEffect(() => {
    if (session && !canAccessPage(session.user.role, page)) {
      setPage(defaultPageForRole(session.user.role));
    }
  }, [session, page]);

  if (isPublicCatalog) return <PublicCatalog />;
  if (isPublicBooking) return <PublicBooking />;
  if (isPublicCheckout) return <PublicCheckout />;
  if (!session) return <Login onLogin={setSession} />;
  const activePage = canAccessPage(session.user.role, page) ? page : defaultPageForRole(session.user.role);

  return (
    <div className="app-shell">
      <Sidebar
        page={activePage}
        role={session.user.role}
        setPage={(next) => {
          setPage(next);
          setSidebarOpen(false);
        }}
        open={sidebarOpen}
        onLogout={() => {
          localStorage.removeItem("aura-session");
          setSession(null);
        }}
      />
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">Aura Clinic Piercing</span>
            <h1>{activePage === "dashboard" ? `Olá, ${firstName(session.user.name)}!` : pageTitle(activePage)}</h1>
            {activePage === "dashboard" && <p>Bem-vinda ao painel administrativo da Aura Clinic.</p>}
          </div>
          <div className="topbar-actions">
            <button className="notification-button" aria-label="Notificações" onClick={() => setAlertsOpen(true)}>
              <Bell size={19} />
              <span>3</span>
            </button>
            <div className="date-card">
              <Calendar size={21} />
              <div>
                <strong>{new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</strong>
                <span>{new Date().toLocaleDateString("pt-BR", { weekday: "long" })}, {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          <div className="user-chip">
            <UserRound size={16} />
            {session.user.name} · {roleLabel(session.user.role)}
          </div>
          </div>
        </header>
        {activePage === "dashboard" && <Dashboard user={session.user} setPage={setPage} alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen} />}
        {activePage === "erp" && <AuraERP setPage={setPage} />}
        {activePage === "agenda" && <AgendaWorkspace />}
        {activePage === "catalog" && <CatalogWorkspace />}
        {activePage === "client-center" && <ClientWorkspace />}
        {activePage === "catalog-customization" && <CatalogCustomization />}
        {activePage === "sales" && <SalesWorkspace />}
        {activePage === "finance" && <FinanceAdmin />}
        {activePage === "clients" && <ClientsMedical />}
        {activePage === "terms" && <DigitalTerms />}
        {activePage === "postcare" && <PostCare />}
        {activePage === "admin" && <AccessAdmin />}
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const rememberedEmail = localStorage.getItem("aura-remembered-email") || "admin@auraclinic.com";
  const [form, setForm] = useState({ email: rememberedEmail, password: "aura123" });
  const [rememberAccess, setRememberAccess] = useState(Boolean(localStorage.getItem("aura-remembered-email")));
  const [error, setError] = useState("");

 async function submit(event) {
  event.preventDefault();
  setError("");

  const isDemoLogin =
    form.email === "admin@auraclinic.com" &&
    form.password === "aura123";

  if (isDemoLogin) {
    const user = {
      id: 1,
      name: "Administrador Aura",
      email: "admin@auraclinic.com",
      role: "admin",
    };

    localStorage.setItem("aura-session", JSON.stringify({ user }));
    onLogin(user);
    return;
  }

  setError("E-mail ou senha incorretos.");
}

  return (
    <main className="login-screen">
      <section className="login-panel">
        <header className="login-brand">
          <div className="login-monogram" aria-hidden="true">AC</div>
          <div>
            <strong>Aura Clinic</strong>
            <span>Gestão Premium</span>
          </div>
        </header>

        <div className="login-copy">
          <span className="login-kicker">Central Administrativa</span>
          <h1>Acesse sua central administrativa</h1>
          <p>Controle estoque, agenda, clientes, biossegurança e financeiro em um único lugar.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>E-mail
            <input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>Senha
            <input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="remember-access">
            <input type="checkbox" checked={rememberAccess} onChange={(event) => setRememberAccess(event.target.checked)} />
            <span>Lembrar acesso</span>
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="login-submit">Entrar no sistema <ChevronRight size={18} /></button>
        </form>

        <footer className="login-footer">
          <strong>Sistema proprietário Aura Clinic®</strong>
          <span>Desenvolvido por Eduarda Santos</span>
        </footer>
      </section>

      <section className="login-visual" aria-label="Aura Clinic">
        <div className="login-visual-content">
          <div className="gold-line" />
          <span className="login-visual-kicker">Aura Clinic Piercing</span>
          <h2>Gestão inteligente para quem vive da perfuração.</h2>
          <p>Desenvolvido por body piercer para body piercers.</p>

          <div className="login-metrics" aria-label="Indicadores Aura Clinic">
            <div><strong>+3500</strong><span>Perfurações registradas</span></div>
            <div><strong>+1200</strong><span>Joias cadastradas</span></div>
            <div><strong>+800</strong><span>Clientes atendidos</span></div>
          </div>
        </div>

        <div className="login-floating-cards" aria-hidden="true">
          <article><Calendar size={18} /><span>Agenda do Dia</span><strong>08 atendimentos</strong></article>
          <article><AlertTriangle size={18} /><span>Estoque Crítico</span><strong>03 peças</strong></article>
          <article><UserRound size={18} /><span>Último Atendimento</span><strong>Hélix · 16:30</strong></article>
          <article><WalletCards size={18} /><span>Financeiro do Mês</span><strong>R$ 18.420</strong></article>
        </div>
      </section>
    </main>
  );
}

function PublicCatalog() {
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
    const activeCount = (data?.banners || []).filter((banner) => Boolean(Number(banner.is_active))).length;
    if (activeCount <= 1) return undefined;
    const timer = window.setInterval(() => setBannerIndex((index) => (index + 1) % activeCount), 4500);
    return () => window.clearInterval(timer);
  }, [data?.banners]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const theme = data.theme || {};
  const settings = data || {};
  const contentSections = catalogContentSections(settings.content_sections);
  const activeBanners = (data.banners || []).filter((banner) => Boolean(Number(banner.is_active))).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
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
  const categories = catalogCategoriesFromCatalog(data);
  const selectedProduct = (data.items || []).find((item) => Number(item.id) === selectedProductId) || null;
  const filteredItems = (data.items || []).filter((item) => {
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
  const options = catalogFilterOptions(data.items || []);
  const catalogItems = data.items || [];
  const latestItems = catalogItems.filter((item) => Number(item.quantity || 0) > 0).sort((a, b) => b.id - a.id).slice(0, 8);
  const bestSellerItems = catalogItems.filter((item) => Number(item.quantity || 0) > 0).sort((a, b) => Number(b.sale_value || 0) - Number(a.sale_value || 0)).slice(0, 8);
  const lastUnitsItems = catalogItems.filter((item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= 2).slice(0, 8);
  const promoItems = catalogItems.filter((item) => catalogPromotionForItem(item, data.promotions || [])).slice(0, 8);
  const favoriteItems = (data.items || []).filter((item) => favoriteIds.includes(item.id));
  const orderTotal = orderItems.reduce((sum, item) => sum + Number(item.sale_value || 0) * Number(item.qty || 1), 0);
  const catalogStyle = {
    "--catalog-primary": theme.primary_color || "#C8A96A",
    "--catalog-secondary": theme.secondary_color || "#D8C3A5",
    "--catalog-bg": theme.background_color || "#F8F5F0",
    "--catalog-button": theme.button_color || "#C8A96A",
    fontFamily: theme.body_font || "Inter"
  };

  function toggleFavorite(item) {
    setFavoriteIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]);
  }

function addToOrder(item) {
    setOrderItems((current) => {
      const orderKey = `${item.id}-${item.selected_variant_id || "produto"}-${item.selected_color || "sem-cor"}`;
      const existing = current.find((orderItem) => orderItem.order_key === orderKey);
      if (existing) return current.map((orderItem) => orderItem.order_key === orderKey ? { ...orderItem, qty: Number(orderItem.qty || 1) + 1 } : orderItem);
      return [...current, { ...item, order_key: orderKey, qty: 1 }];
    });
  }

  function removeFromOrder(id) {
    setOrderItems((current) => current.filter((item) => (item.order_key || item.id) !== id));
  }

  function updateOrderItemNotes(id, notes) {
    setOrderItems((current) => current.map((item) => ((item.order_key || item.id) === id ? { ...item, customer_notes: notes } : item)));
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
        {!items.length && <p className="empty-state catalog-empty">Nenhuma joia encontrada nessa seleção.</p>}

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
  return (
    <label className="catalog-filter-select">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{label}</option>
        {options.map((option) => <option key={option} value={option}>{elegantProductName(option)}</option>)}
      </select>
    </label>
  );
}

function CatalogBookingWidget() {
  const { data } = usePublicFetch("/booking/config");
  const [form, setForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { service_id: "", professional_id: "", appointment_date: today, appointment_time: "" };
  });
  const [slots, setSlots] = useState([]);
  const services = data?.services || [];
  const professionals = data?.professionals || [];
  const bookingDates = nextBookingDates(10);

  useEffect(() => {
    if (!services.length || form.service_id) return;
    setForm((current) => ({ ...current, service_id: String(services[0].id) }));
  }, [services.length]);

  useEffect(() => {
    if (!professionals.length || form.professional_id) return;
    setForm((current) => ({ ...current, professional_id: String(professionals[0].id) }));
  }, [professionals.length]);

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      const response = await fetch(API + "/booking/slots?service_id=" + form.service_id + "&professional_id=" + form.professional_id + "&date=" + form.appointment_date);
      const json = await response.json().catch(() => ({}));
      setSlots(response.ok ? json.slots || [] : []);
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  if (!data || data.error || !services.length || !professionals.length) return null;
  const href = "/agendar?" + new URLSearchParams(Object.fromEntries(Object.entries(form).filter(([, value]) => value))).toString();

  return (
    <section className="catalog-booking-widget" id="catalog-agenda">
      <div>
        <span className="eyebrow">Agenda online</span>
        <h2>Escolha Um Horário Disponível</h2>
        <p>Reserve pelo link público da Aura. A equipe confirma manualmente pelo WhatsApp.</p>
      </div>
      <div className="catalog-booking-controls">
        <Select label="Serviço" value={form.service_id} onChange={(value) => setForm({ ...form, service_id: value, appointment_time: "" })}>
          {services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}
        </Select>
        <Select label="Profissional" value={form.professional_id} onChange={(value) => setForm({ ...form, professional_id: value, appointment_time: "" })}>
          {professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
        </Select>
        <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value, appointment_time: "" })} />
      </div>
      <div className="catalog-slot-row">
          {slots.slice(0, 8).map((slot) => <button type="button" key={slot.time} className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
        {!slots.length && <span>Nenhum horário nesta seleção.</span>}
      </div>
      <a className="primary-button booking-wide-button" href={href}>Continuar Agendamento</a>
    </section>
  );
}

function CatalogContentSections({ sections }) {
  const active = sections.filter((section) => Boolean(section.active));
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
  if (!items.length) return null;
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
        {items.map((item) => (
          <CatalogProductCard
            item={item}
            favorite={favoriteIds.includes(item.id)}
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
  const availableVariants = (item.variants || []).filter((variant) => Boolean(Number(variant.is_active ?? 1)));
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
  const related = (data.items || [])
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
  const items = isFavorites ? favorites : orderItems;
  const favoriteMessage = favorites.length
    ? `Olá! Quero ajuda com estas joias favoritas: ${favorites.map((item) => item.name).join(", ")}.`
    : "Olá! Quero ajuda para escolher minhas joias favoritas no catálogo da Aura Clinic.";
  const message = orderItems.length
    ? `Olá! Quero agendar com estas joias: ${orderItems.map((item) => `${item.qty || 1}x ${item.name}${item.customer_notes ? ` (${item.customer_notes})` : ""}`).join(", ")}. Total aproximado: ${currency.format(orderTotal)}.`
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
            {orderItems.length > 0 && <button className="secondary-button" onClick={onClearOrder}>Limpar pedido</button>}
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

function PublicCheckout() {
  const { data } = usePublicFetch("/catalog");
  const [form, setForm] = useState({ full_name: "", whatsapp: "", instagram: "", payment_method: "Pix", notes: "" });
  const [orderItems, setOrderItems] = useState(() => readCatalogStorage("aura-catalog-order", []));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    setOrderItems(readCatalogStorage("aura-catalog-order", []));
  }, []);

  const total = orderItems.reduce((sum, item) => sum + Number(item.sale_value || 0) * Number(item.qty || 1), 0);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.full_name.trim() || !form.whatsapp.trim()) {
      setError("Informe nome e WhatsApp para concluir a compra.");
      return;
    }
    if (!orderItems.length) {
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
        items: orderItems.map((item) => ({
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
              <span>{orderItems.length} item(ns)</span>
            </div>
            <div className="sales-checkout-items">
              {orderItems.length ? orderItems.map((item) => (
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

function PublicBooking() {
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
  const services = data?.services || [];
  const professionals = data?.professionals || [];
  const bookingDates = nextBookingDates(10);
  const selectedService = services.find((item) => String(item.id) === String(form.service_id));
  const selectedProfessional = professionals.find((item) => String(item.id) === String(form.professional_id));

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      setLoadingSlots(true);
      const response = await fetch(API + "/booking/slots?service_id=" + form.service_id + "&professional_id=" + form.professional_id + "&date=" + form.appointment_date);
      const json = await response.json().catch(() => ({}));
      setLoadingSlots(false);
      setSlots(response.ok ? json.slots || [] : []);
      if (!response.ok) setError(json.error || "Não foi possível carregar os horários.");
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

        {step === 1 && <BookingChoiceGrid title="Escolha O Serviço" items={services} value={form.service_id} onSelect={(id) => { setForm({ ...form, service_id: id, appointment_time: "" }); setStep(2); }} render={(item) => <><strong>{item.name}</strong><p>{item.description}</p><span>{item.duration_minutes} min  {currency.format(item.price || 0)}</span></>} />}
        {step === 2 && <BookingChoiceGrid title="Escolha A Profissional" items={professionals} value={form.professional_id} onSelect={(id) => { setForm({ ...form, professional_id: id, appointment_time: "" }); setStep(3); }} render={(item) => <><strong>{item.name}</strong><p>{item.specialty || "Body Piercer Aura"}</p></>} />}
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
            <p><strong>Valor:</strong> {currency.format(selectedService?.price || 0)}</p>
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

function BookingChoiceGrid({ title, items, value, onSelect, render }) {
  return (
    <section className="booking-panel">
      <h2>{title}</h2>
      <div className="booking-choice-grid">
        {items.map((item) => (
          <button key={item.id} className={String(value) === String(item.id) ? "active" : ""} onClick={() => onSelect(item.id)}>
            {render(item)}
          </button>
        ))}
      </div>
    </section>
  );
}

function Sidebar({ page, role, setPage, open, onLogout }) {
  const items = [
    ["dashboard", Home, "Dashboard"],
    ["erp", ShieldCheck, "Aura ERP"],
    ["catalog", Gem, "Catálogo"],
    ["agenda", Calendar, "Agenda"],
    ["sales", ShoppingCart, "Vendas"],
    ["finance", WalletCards, "Financeiro"],
    ["client-center", UsersRound, "Clientes"],
    ["admin", ShieldCheck, "Acessos"]
  ].filter(([id]) => canAccessPage(role, id));
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand">
        <strong>Aura</strong>
        <span>Clinic Piercing</span>
        <small>Marca registrada por Eduarda Santos, bodypiercer.</small>
      </div>
      <nav>
        {items.map(([id, Icon, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={18} />
        Sair
      </button>
    </aside>
  );
}

function Dashboard({ user, setPage, alertsOpen, setAlertsOpen }) {
  const { data } = useFetch("/dashboard");

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  return <PremiumDashboard data={data} user={user} setPage={setPage} alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen} />;
}

function PremiumDashboard({ data, user, setPage, alertsOpen, setAlertsOpen }) {
  const [revenueMode, setRevenueMode] = useState("mensal");
  const cards = [
    { label: "Agendamentos hoje", value: String(data.stats.todayCount), icon: Calendar, action: "Ver agenda", page: "agenda", tone: "gold" },
    { label: "Clientes novos", value: String(data.adminDashboard?.upcomingAppointments?.length || data.todaysAppointments?.length || 0), icon: UsersRound, action: "Ver clientes", page: "client-center", tone: "nude" },
    { label: "Joias em estoque crítico", value: String(data.stats.lowStockCount), icon: Gem, action: "Ver estoque", page: "catalog", tone: "green", critical: true },
    { label: "Faturamento hoje", value: currency.format(data.stats.depositReceived), icon: CircleDollarSign, action: "Ver Financeiro", page: "finance", tone: "brown" },
    { label: "Aniversariantes do mês", value: String(data.adminDashboard?.birthdaysMonth?.length || 0), icon: Cake, action: "Ver todos", page: "client-center", tone: "gold" }
  ];
  const pendingValue = Math.max(Number(data.stats.monthForecast || 0) - Number(data.stats.depositReceived || 0), 0);
  const revenueData = {
    diario: data.adminDashboard?.dailyRevenue || [],
    semanal: data.adminDashboard?.weeklyRevenue || [],
    mensal: data.adminDashboard?.monthlyRevenue || []
  }[revenueMode] || [];

  return (
    <section className="premium-dashboard">
      {alertsOpen && <AlertsPopup alerts={data.alerts} onClose={() => setAlertsOpen(false)} />}

      <div className="premium-metric-grid">
        {cards.map(({ label, value, icon: Icon, action, page, tone, critical }) => (
          <article className={`premium-metric-card ${tone}`} key={label}>
            <div className="metric-icon"><Icon size={22} /></div>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
              {critical && <small>crítico</small>}
              <button type="button" onClick={() => setPage(page)}>{action} →</button>
            </div>
          </article>
        ))}
      </div>

      <div className="premium-dashboard-grid">
        <article className="panel revenue-card">
          <div className="panel-heading">
            <h2>Faturamento</h2>
            <div className="segmented compact">
              <button type="button" className={revenueMode === "diario" ? "active" : ""} onClick={() => setRevenueMode("diario")}>Diário</button>
              <button type="button" className={revenueMode === "semanal" ? "active" : ""} onClick={() => setRevenueMode("semanal")}>Semanal</button>
              <button type="button" className={revenueMode === "mensal" ? "active" : ""} onClick={() => setRevenueMode("mensal")}>Mensal</button>
            </div>
          </div>
          <RevenueLineChart data={revenueData} mode={revenueMode} />
        </article>

        <article className="panel upcoming-card">
          <div className="panel-heading">
            <h2>Próximos agendamentos</h2>
            <button className="ghost-button" type="button" onClick={() => setPage("agenda")}>Ver todos</button>
          </div>
          <div className="premium-appointment-list">
            {(data.adminDashboard?.upcomingAppointments || []).slice(0, 4).map((item) => (
              <button type="button" className="premium-appointment-row" key={item.id} onClick={() => setPage("agenda")}>
                <span className="dot-time"><i />{item.appointment_time}</span>
                <div className="avatar-circle">{initials(item.full_name)}</div>
                <div>
                  <strong>{item.full_name}</strong>
                  <small>{item.procedure}<br />Prof. {item.professional_name}</small>
                </div>
                <em className={statusClass[item.status]}>{item.status}</em>
                <ChevronRight size={18} />
              </button>
            ))}
            {!(data.adminDashboard?.upcomingAppointments || []).length && <p className="empty-state">Nenhum próximo agendamento.</p>}
          </div>
        </article>
      </div>

      <div className="premium-lower-grid">
        <article className="panel compact-list-card">
          <div className="panel-heading">
            <h2>Estoque crítico</h2>
            <button className="ghost-button" type="button" onClick={() => setPage("catalog")}>Ver estoque</button>
          </div>
          <div className="clean-list">
            {(data.adminDashboard?.criticalStock || []).slice(0, 3).map((item) => (
              <div key={item.id}>
                <div className="jewel-thumb"><Gem size={21} /></div>
                <span><strong>{item.name}</strong><small>{item.color || item.category}</small></span>
                <em>{item.quantity} unidade{item.quantity === 1 ? "" : "s"}</em>
              </div>
            ))}
            {!(data.adminDashboard?.criticalStock || []).length && <p className="empty-state">Estoque sem alerta crítico.</p>}
          </div>
        </article>

        <article className="panel compact-list-card">
          <div className="panel-heading">
            <h2>Aniversariantes do mês</h2>
            <button className="ghost-button" type="button" onClick={() => setPage("client-center")}>Ver todos</button>
          </div>
          <div className="clean-list birthday-list">
            {(data.adminDashboard?.birthdaysMonth || []).slice(0, 3).map((item) => (
              <div key={item.id}>
                <div className="avatar-circle">{initials(item.full_name)}</div>
                <span><strong>{item.full_name}</strong><small>{formatLongDate(item.birth_date)}</small></span>
                <Cake size={18} />
              </div>
            ))}
            {!(data.adminDashboard?.birthdaysMonth || []).length && <p className="empty-state">Nenhum aniversário neste mês.</p>}
          </div>
        </article>

        <article className="panel finance-summary-card">
          <div className="panel-heading">
            <h2>Resumo Financeiro</h2>
            <span>{new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
          </div>
          <div className="finance-summary-list">
            <div className="ok"><span>Faturamento</span><strong>{currency.format(data.stats.monthForecast)}</strong></div>
            <div className="ok"><span>Sinais recebidos</span><strong>{currency.format(data.stats.depositReceived)}</strong></div>
            <div className="warn"><span>Pendentes</span><strong>{currency.format(pendingValue)}</strong></div>
            <div className="danger"><span>Despesas</span><strong>{currency.format(0)}</strong></div>
          </div>
          <div className="profit-box">
            <span>Lucro estimado</span>
            <strong>{currency.format(data.stats.monthForecast)}</strong>
          </div>
        </article>
      </div>

      <div className="premium-ranking-grid">
        <div className="panel">
          <div className="panel-heading"><h2>Procedimentos mais feitos</h2><span>Ranking</span></div>
          <MiniBarChart data={data.adminDashboard?.procedureRanking || []} valueKey="total" labelKey="label" />
        </div>
        <div className="panel">
          <div className="panel-heading"><h2>Joias mais vendidas</h2><span>Peças vinculadas</span></div>
          <MiniBarChart data={data.adminDashboard?.jewelryRanking || []} valueKey="total" labelKey="label" />
        </div>
        <div className="panel">
          <div className="panel-heading"><h2>Ranking por categoria</h2><span>Joalherias</span></div>
          <MiniBarChart data={data.adminDashboard?.categoryRanking || []} valueKey="total" labelKey="label" />
        </div>
        <DashboardList title="Clientes em retorno" items={data.adminDashboard?.returnClients || []} render={(item) => `${formatDate(item.due_date)} · ${item.full_name} · ${item.reminder_day} dias`} />
      </div>
    </section>
  );
}

function RevenueLineChart({ data = [], mode = "mensal" }) {
  const normalized = data.length ? data : [{ month: new Date().toISOString().slice(0, 7), total: 0 }];
  const max = Math.max(...normalized.map((item) => Number(item.total || 0)), 1);
  const points = normalized.map((item, index) => {
    const x = normalized.length === 1 ? 50 : (index / (normalized.length - 1)) * 100;
    const y = 88 - (Number(item.total || 0) / max) * 66;
    return `${x},${y}`;
  }).join(" ");
  const last = normalized[normalized.length - 1];
  return (
    <div className="revenue-line-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="auraRevenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#C8A96A" stopOpacity=".28" />
            <stop offset="100%" stopColor="#C8A96A" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline className="area" points={`0,100 ${points} 100,100`} />
        <polyline className="line" points={points} />
      </svg>
      <div className="chart-tooltip">
        <span>{formatRevenueLabel(last, mode)}</span>
        <strong>{currency.format(last.total || 0)}</strong>
      </div>
      <div className="chart-months">
        {normalized.map((item, index) => <span key={`${item.month || item.label || index}`}>{formatRevenueAxisLabel(item, mode)}</span>)}
      </div>
    </div>
  );
}

function MiniBarChart({ data = [], valueKey, labelKey, currencyValue }) {
  const max = Math.max(...data.map((item) => Number(item[valueKey] || 0)), 1);
  if (!data.length) return <p className="empty-state">Sem dados para exibir.</p>;
  return (
    <div className="mini-chart">
      {data.map((item) => {
        const value = Number(item[valueKey] || 0);
        return (
          <div className="mini-chart-row" key={`${item[labelKey]}-${value}`}>
            <span>{item[labelKey]}</span>
            <div><i style={{ width: `${Math.max((value / max) * 100, 5)}%` }} /></div>
            <strong>{currencyValue ? currency.format(value) : value}</strong>
          </div>
        );
      })}
    </div>
  );
}

function DashboardList({ title, items = [], render }) {
  return (
    <div className="panel dashboard-list-panel">
      <h2>{title}</h2>
      <div className="dashboard-list">
        {items.length ? items.map((item, index) => <p key={item.id || index}>{render(item)}</p>) : <small>Sem registros.</small>}
      </div>
    </div>
  );
}

function AlertsPopup({ alerts, onClose }) {
  return (
    <div className="popup-backdrop" role="presentation">
      <section className="alerts-popup" role="dialog" aria-modal="true" aria-label="Alertas da Aura Clinic">
        <header>
          <div>
            <span className="eyebrow">Central de alertas</span>
            <h2>O que precisa de atenção</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar alertas">X</button>
        </header>
        <div className="alerts-grid">
          <AlertBlock icon={AlertTriangle} title="Joias acabando" empty="Nenhuma joia em alerta.">
            {alerts?.lowStockJewelry?.map((item) => (
              <article className="alert-item critical" key={item.id}>
                <strong>{item.name}</strong>
                <span>{item.category} · Observação de cor: {item.color || "sem observação"} · {item.size || "sem tamanho"}</span>
                <small>{item.quantity} unidade(s) · {item.status} · SKU {item.sku}</small>
              </article>
            ))}
          </AlertBlock>
          <AlertBlock icon={Cake} title="Aniversários próximos" empty="Nenhum aniversário nos próximos 30 dias.">
            {alerts?.birthdays?.map((client) => (
              <article className="alert-item birthday" key={client.id}>
                <strong>{client.full_name}</strong>
                <span>{client.days_until === 0 ? "Aniversário hoje" : `Em ${client.days_until} dia(s)`}</span>
                <small>{formatLongDate(client.next_birthday)} · {client.whatsapp}</small>
              </article>
            ))}
          </AlertBlock>
          <AlertBlock icon={Trophy} title="Clientes mais frequentes" empty="Sem histórico suficiente ainda.">
            {alerts?.topClients?.map((client) => (
              <article className="alert-item vip" key={client.id}>
                <strong>{client.full_name}</strong>
                <span>{client.appointment_count} atendimento(s) · {client.return_count || 0} retorno(s)</span>
                <small>Última visita: {formatDate(client.last_visit)} · {client.instagram || client.whatsapp}</small>
              </article>
            ))}
          </AlertBlock>
        </div>
      </section>
    </div>
  );
}

function AlertBlock({ icon: Icon, title, empty, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="alert-block">
      <h3><Icon size={17} /> {title}</h3>
      <div className="alert-list">
        {items.length ? items : <p className="empty-state">{empty}</p>}
      </div>
    </div>
  );
}

function AuraERP({ setPage }) {
  const { data } = useFetch("/erp");
  const [moduleFilter, setModuleFilter] = useState("todos");
  if (!data) return <Loading />;
  if (data.error) {
    return (
      <section className="panel erp-error">
        <span className="eyebrow">Aura Clinic ERP</span>
        <h2>Não foi possível carregar esta área.</h2>
        <p>{data.error}</p>
        <small>Reinicie o servidor com npm.cmd run dev para carregar a nova rota /api/erp.</small>
      </section>
    );
  }
  const modules = data.modules.filter((item) => moduleFilter === "todos" || item.status === moduleFilter);

  return (
    <section className="erp-page">
      <div className="erp-hero panel">
        <div>
          <span className="eyebrow">SaaS multiempresa</span>
          <h2>{data.product.name}</h2>
          <p>{data.product.positioning}</p>
          <div className="erp-stack">
            {data.product.stackTarget.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div className="erp-metrics">
          <Metric label="Estudios" value={data.metrics.studios} />
          <Metric label="Clientes" value={data.metrics.clients} />
          <Metric label="Agendamentos" value={data.metrics.appointments} />
          <Metric label="Receita" value={currency.format(data.metrics.revenue)} />
        </div>
      </div>

      <div className="erp-toolbar">
        {["todos", "ativo", "planejado"].map((status) => (
          <button key={status} className={moduleFilter === status ? "active" : ""} onClick={() => setModuleFilter(status)}>{status}</button>
        ))}
      </div>

      <div className="erp-module-grid">
        {modules.map((module) => {
          const action = erpModuleAction(module.name);
          return (
          <article className="erp-module-card" key={module.name}>
            <span className={`erp-status ${module.status}`}>{module.status}</span>
            <h3>{module.name}</h3>
            <p>{module.description}</p>
            <button
              type="button"
              onClick={() => {
                if (action.url) window.open(action.url, "_blank", "noopener,noreferrer");
                if (action.page) setPage(action.page);
              }}
            >
              {action.label}
              <ChevronRight size={16} />
            </button>
          </article>
          );
        })}
      </div>

      <div className="erp-sections-grid">
        <ERPPanel title="CRM e funil" subtitle="Classificacao automatica por historico">
          <div className="erp-bars">
            {data.crm.map((item) => <div key={item.stage}><span>{item.stage}</span><strong>{item.total}</strong></div>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Catalogo online" subtitle="Vitrine publica de joalherias">
          <div className="erp-catalog-preview">
            {data.catalogItems.slice(0, 4).map((item) => (
              <article key={item.id}>
                <img src={item.photo_url} alt={item.name} />
                <strong>{item.name}</strong>
                <span>{currency.format(item.sale_value)} · {item.quantity} un.</span>
              </article>
            ))}
          </div>
        </ERPPanel>
        <ERPPanel title="Cupons e influenciadores" subtitle="Rastreamento comercial">
          <div className="erp-list">
            {data.coupons.map((coupon) => <p key={coupon.code}><strong>{coupon.code}</strong><span>{coupon.value}% · {coupon.status}</span></p>)}
            {data.influencers.map((item) => <p key={item.instagram}><strong>{item.name}</strong><span>{item.coupon} · {item.conversions} conversoes</span></p>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Consultorias e Aura Academy" subtitle="Produtos digitais">
          <div className="erp-list">
            {data.consultancies.map((item) => <p key={item.name}><strong>{item.name}</strong><span>{currency.format(item.price)} · {item.format}</span></p>)}
            {data.academy.map((item) => <p key={item.name}><strong>{item.name}</strong><span>{item.lessons} aulas · {item.students} alunos</span></p>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Calendario editorial" subtitle="Planejamento de conteudo Aura">
          <div className="content-planner">
            {data.contentPlanner.map((item) => <div key={item.day}><strong>{item.day}</strong><span>{item.theme}</span></div>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Mapa corporal" subtitle="Regioes mais realizadas">
          <div className="erp-list">
            {data.bodyMap.map((item) => <p key={item.region}><strong>{item.region}</strong><span>{item.total} procedimento(s)</span></p>)}
          </div>
        </ERPPanel>
      </div>
    </section>
  );
}

function ERPPanel({ title, subtitle, children }) {
  return (
    <article className="panel erp-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
      </div>
      {children}
    </article>
  );
}

function erpModuleAction(name = "") {
  const normalized = removeAccents(String(name).toLowerCase());
  if (normalized.includes("dashboard")) return { label: "Abrir dashboard", page: "dashboard" };
  if (normalized.includes("agendamento")) return { label: "Abrir agenda", page: "agenda" };
  if (normalized.includes("clientes") || normalized.includes("prontuario") || normalized.includes("crm") || normalized.includes("rewards") || normalized.includes("mapa corporal")) return { label: "Abrir clientes", page: "client-center" };
  if (normalized.includes("termo")) return { label: "Abrir clientes", page: "client-center" };
  if (normalized.includes("estoque") || normalized.includes("joalheria")) return { label: "Abrir catálogo", page: "catalog" };
  if (normalized.includes("catalogo")) return { label: "Abrir catálogo", page: "catalog" };
  if (normalized.includes("venda") || normalized.includes("ordem")) return { label: "Abrir vendas", page: "sales" };
  if (normalized.includes("Financeiro") || normalized.includes("relatorio")) return { label: "Abrir Financeiro", page: "finance" };
  if (normalized.includes("administrativo") || normalized.includes("configur")) return { label: "Abrir acessos", page: "admin" };
  if (normalized.includes("pos-atendimento") || normalized.includes("retorno")) return { label: "Abrir clientes", page: "client-center" };
  return { label: "Ver no Aura ERP", page: "erp" };
}

function removeAccents(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function AgendaWorkspace() {
  const [tab, setTab] = useState("visual");
  const tabs = [
    {
      id: "visual",
      title: "Agenda visual",
      description: "Calendário mensal, semanal e diário com status dos atendimentos.",
      icon: Calendar
    },
    {
      id: "agendamentos",
      title: "Agendamentos",
      description: "Cadastro manual, cliente, joia, pagamento e status do atendimento.",
      icon: Clock
    },
    {
      id: "disponibilidade",
      title: "Disponibilidade",
      description: "Serviços online, horários disponíveis, bloqueios e solicitações pendentes.",
      icon: ShieldCheck
    }
  ];

  return (
    <section className="agenda-workspace">
      <div className="agenda-hub">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={20} />
            <span><strong>{title}</strong><small>{description}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      <div className="agenda-tab-panel">
        {tab === "visual" && <VisualCalendar />}
        {tab === "agendamentos" && <Appointments />}
        {tab === "disponibilidade" && <BookingAdmin />}
      </div>
    </section>
  );
}

function CatalogWorkspace() {
  const [tab, setTab] = useState("inicio");
  const tabs = [
    { id: "estoque", title: "Estoque", description: "Abra o controle administrativo completo das joias.", icon: Gem },
    { id: "personalizacao", title: "Personalização", description: "Configure banners, cores, textos, categorias e destaques do catálogo.", icon: Sparkles },
    { id: "público", title: "Catálogo público", description: "Abra a vitrine que o cliente visualiza.", icon: ShoppingCart }
  ];
  if (tab !== "inicio") {
    return (
      <section className="workspace-page workspace-subpage">
        <button className="secondary-button workspace-back-button" type="button" onClick={() => setTab("inicio")}>
          <ChevronLeft size={16} />
          Voltar para Catálogo
        </button>
        {tab === "estoque" && <Inventory2 compact />}
        {tab === "personalizacao" && <CatalogCustomization />}
      </section>
    );
  }
  return (
    <section className="workspace-page">
      <div className="workspace-intro panel">
        <div>
          <span className="eyebrow">Catálogo e estoque</span>
          <h2>Organize a vitrine pública e o controle interno em áreas separadas.</h2>
          <p>Escolha Estoque para cadastrar uma nova joalheria, ajustar quantidades, medidas, valores e dados de envio. O catálogo público atualiza automaticamente.</p>
        </div>
      </div>
      <div className="workspace-hub">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => id === "público" ? window.open("/catalogo", "_blank", "noopener,noreferrer") : setTab(id)}>
            <Icon size={20} />
            <span><strong>{title}</strong><small>{description}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

function ClientWorkspace() {
  const [tab, setTab] = useState("clientes");
  const tabs = [
    { id: "clientes", title: "Clientes", description: "Histórico, prontuários, pagamentos e fidelidade.", icon: UsersRound },
    { id: "termos", title: "Termos digitais", description: "Assinatura, aceite, PDF e vínculo ao agendamento.", icon: FileSignature },
    { id: "retornos", title: "Pós-atendimento", description: "Lembretes, fotos, status de cicatrização e retornos.", icon: HeartPulse }
  ];
  return (
    <section className="workspace-page">
      <div className="workspace-hub">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={20} />
            <span><strong>{title}</strong><small>{description}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      <div className="workspace-panel">
        {tab === "clientes" && <ClientsMedical />}
        {tab === "termos" && <DigitalTerms />}
        {tab === "retornos" && <PostCare />}
      </div>
    </section>
  );
}

function Appointments() {
  const { data: options } = useFetch("/options");
  const { data: clients, refresh: refreshClients } = useFetch("/clients");
  const { data: appointments, refresh } = useFetch("/appointments");
  const { data: services } = useFetch("/services");
  const [form, setForm] = useState(defaultAppointment());
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      setLoadingSlots(true);
      const response = await apiFetch(`/booking/slots?service_id=${form.service_id}&professional_id=${form.professional_id}&date=${form.appointment_date}`);
      const json = await response.json().catch(() => ({}));
      setLoadingSlots(false);
      setSlots(response.ok ? json.slots || [] : []);
      if (!response.ok) setError(json.error || "Não foi possível carregar os horários.");
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  function selectClient(clientId) {
    if (!clientId) {
      setForm({ ...form, client_id: "", full_name: "", whatsapp: "", instagram: "", birth_date: "" });
      return;
    }
    const client = clients?.find((item) => String(item.id) === String(clientId));
    if (!client) return;
    setForm({
      ...form,
      client_id: client.id,
      full_name: client.full_name || "",
      whatsapp: client.whatsapp || "",
      instagram: client.instagram || "",
      birth_date: client.birth_date || ""
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) body.append(key, value);
    });
    const response = await apiFetch(`/appointments`, {
      method: "POST",
      body
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || "Não foi possível salvar o agendamento.");
      return;
    }
    setForm(defaultAppointment());
    setShowForm(false);
    refresh();
    refreshClients();
  }

  return (
    <section className="stack appointments-admin">
      <div className="panel appointments-toolbar">
        <div className="panel-heading">
          <div><span className="eyebrow">Agenda Aura</span><h2>Agendamentos</h2><span>Cadastre e acompanhe os próximos atendimentos.</span></div>
          <button className="primary-button" type="button" onClick={() => setShowForm(true)}><Plus size={17} /> Novo Agendamento</button>
        </div>
      </div>
      {showForm && <div className="modal-backdrop appointment-modal-backdrop" onClick={() => setShowForm(false)}>
      <form className="panel appointment-form manual-appointment-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <div><h2>Novo Agendamento</h2><span>Profissional, serviço, cliente, data e horário.</span></div>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={() => setShowForm(false)}><X size={18} /></button>
        </div>
        <div className="form-section">
          <h3>Cliente</h3>
          <div className="form-grid">
            <Select label="Cliente cadastrado" value={form.client_id} onChange={selectClient}>
              <option value="">Novo cliente</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.full_name} - {client.whatsapp}
                </option>
              ))}
            </Select>
            <Input label="Nome completo" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} required />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} required />
            <Input label="Instagram" value={form.instagram} onChange={(v) => setForm({ ...form, instagram: v })} />
            <Input type="date" label="Aniversário" value={form.birth_date} onChange={(v) => setForm({ ...form, birth_date: v })} />
          </div>
        </div>
        <div className="form-section">
          <h3>Procedimento</h3>
          <div className="form-grid">
            <Select label="Tipo de Atendimento" value={form.service_id} onChange={(value) => {
              const service = services?.find((item) => String(item.id) === String(value));
              setForm(calcRemaining({
                ...form,
                service_id: value,
                procedure: service?.name || "",
                total_value: Number(service?.price || 0),
                deposit_value: Number(service?.deposit_value || 0),
                appointment_time: ""
              }));
            }} required>
              <option value="">Selecione</option>
              {services?.map((service) => <option key={service.id} value={service.id}>{service.name} ({service.duration_minutes} min)</option>)}
            </Select>
            <Input label="Procedimento" value={form.procedure} onChange={(v) => setForm({ ...form, procedure: v })} required />
            <Input label="Região da perfuração" value={form.piercing_region} onChange={(v) => setForm({ ...form, piercing_region: v })} required />
            <Select label="Joalheria escolhida" value={form.jewelry_id} onChange={(v) => setForm({ ...form, jewelry_id: v })}>
              <option value="">Sem joia vinculada</option>
              {options?.jewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Select label="Variação da Joia" value={form.jewelry_variant_id} onChange={(v) => setForm({ ...form, jewelry_variant_id: v })}>
              <option value="">Selecione</option>
              {options?.jewelry.find((item) => String(item.id) === String(form.jewelry_id))?.variants?.filter((variant) => Number(variant.quantity || 0) > 0).map((variant) => (
                <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} · {variant.quantity} un</option>
              ))}
            </Select>
            <Select label="Profissional" value={form.professional_id} onChange={(v) => setForm({ ...form, professional_id: v })} required>
              <option value="">Selecione</option>
              {options?.professionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Input type="date" label="Data" value={form.appointment_date} onChange={(v) => setForm({ ...form, appointment_date: v, appointment_time: "" })} required />
          </div>
          <div className="manual-slot-field">
            <span>Horários Disponíveis</span>
            <div className="manual-slot-grid">
              {loadingSlots && <small>Carregando horários...</small>}
              {slots.map((slot) => <button key={slot.time} type="button" className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
              {!loadingSlots && form.appointment_date && form.service_id && form.professional_id && !slots.length && <small>Nenhum horário livre neste dia.</small>}
            </div>
          </div>
          <label>Descrição do atendimento
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
        </div>
        <div className="form-section">
          <h3>Financeiro</h3>
          <div className="form-grid">
            <Input type="number" label="Valor total" value={form.total_value} onChange={(v) => setForm(calcRemaining({ ...form, total_value: v }))} />
            <Input type="number" label="Valor do sinal" value={form.deposit_value} onChange={(v) => setForm(calcRemaining({ ...form, deposit_value: v }))} />
            <Input type="number" label="Valor restante" value={form.remaining_value} onChange={(v) => setForm({ ...form, remaining_value: v })} />
            <PaymentSelect label="Forma de pagamento do sinal" value={form.deposit_payment_method} onChange={(v) => setForm({ ...form, deposit_payment_method: v })} />
            <PaymentSelect label="Forma de pagamento restante" value={form.remaining_payment_method} onChange={(v) => setForm({ ...form, remaining_payment_method: v })} />
            <StatusSelect value={form.status} onChange={(v) => setForm({ ...form, status: v })} />
          </div>
          <label>Observações importantes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <label>Foto de referência
            <input type="file" accept="image/*" onChange={(event) => setForm({ ...form, reference_photo: event.target.files?.[0] || null })} />
            <small>Opcional. Use uma foto nítida da referência enviada pela cliente.</small>
          </label>
        </div>
        {error && <span className="form-error">{error}</span>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button>
          <button className="primary-button" disabled={!form.appointment_time}>Salvar Agendamento</button>
        </div>
      </form>
      </div>}
      <div className="panel">
        <div className="panel-heading">
          <h2>Próximos Atendimentos</h2>
          <span>Com Ações Rápidas</span>
        </div>
        <AppointmentList appointments={appointments || []} onChanged={refresh} />
      </div>
    </section>
  );
}

function VisualCalendar() {
  const { data: options } = useFetch("/options");
  const [filters, setFilters] = useState({ mode: "mensal", professional_id: "", status: "" });
  const [currentDate, setCurrentDate] = useState(new Date());
  const { data, refresh } = useFetch(`/appointments?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v && !["mensal", "semanal", "diario"].includes(v))))}`);
  const calendar = useMemo(() => buildCalendar(data || [], filters.mode, currentDate), [data, filters.mode, currentDate]);

  return (
    <section className="stack">
      <div className="toolbar">
        <div className="segmented">
          {["mensal", "semanal", "diario"].map((mode) => <button key={mode} className={filters.mode === mode ? "active" : ""} onClick={() => setFilters({ ...filters, mode })}>{mode}</button>)}
        </div>
        <Select label="Profissional" value={filters.professional_id} onChange={(v) => setFilters({ ...filters, professional_id: v })}>
          <option value="">Todos</option>
          {options?.professionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
          <option value="">Todos</option>
          {statuses().map((status) => <option key={status}>{status}</option>)}
        </Select>
        <div className="calendar-nav">
          <button aria-label="Período anterior" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, -1))}><ChevronLeft size={18} /></button>
          <strong>{calendar.title}</strong>
          <button aria-label="Próximo período" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, 1))}><ChevronRight size={18} /></button>
          <button onClick={() => setCurrentDate(new Date())}>Hoje</button>
        </div>
      </div>
      {filters.mode === "diario" ? (
        <DailyAgenda day={calendar.days[0]} refresh={refresh} />
      ) : (
        <GoogleLikeCalendar days={calendar.days} mode={filters.mode} refresh={refresh} />
      )}
    </section>
  );
}

function GoogleLikeCalendar({ days, mode, refresh }) {
  return (
    <div className={`google-calendar ${mode === "semanal" ? "week-view" : ""}`}>
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
      {days.map((day) => (
        <article className={`calendar-cell ${day.isOutside ? "outside" : ""} ${day.isToday ? "today" : ""}`} key={day.key}>
          <header>
            <span>{day.date.getDate()}</span>
            {day.isToday && <strong>Hoje</strong>}
          </header>
          <div className="calendar-events">
            {day.items.map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} />)}
          </div>
        </article>
      ))}
    </div>
  );
}

function DailyAgenda({ day, refresh }) {
  const slots = buildTimeSlots(day.items);
  return (
    <div className="daily-calendar">
      <div className="daily-heading">
        <strong>{day.date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</strong>
        <span>{day.items.length} atendimento(s)</span>
      </div>
      {slots.map((slot) => (
        <div className="time-slot" key={slot.hour}>
          <span>{slot.hour}</span>
          <div>{slot.items.map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} />)}</div>
        </div>
      ))}
    </div>
  );
}

function CalendarEvent({ item, refresh }) {
  return (
    <div className={`calendar-event ${statusClass[item.status]}`}>
      <strong>{item.appointment_time} - {item.full_name}</strong>
      <span>{item.procedure}</span>
      <small>{item.professional_name}</small>
      <div className="event-actions">
        <button onClick={() => updateAppointment(item.id, { status: "remarcado" }, refresh)}>Remarcar</button>
        <button onClick={() => updateAppointment(item.id, { status: "cancelado" }, refresh)}>Cancelar</button>
        <button onClick={() => updateAppointment(item.id, { status: "atendido" }, refresh)}>Atendido</button>
      </div>
    </div>
  );
}

function Inventory() {
  const [view, setView] = useState("cards");
  const [filters, setFilters] = useState({ search: "", material: "", color: "", stone: "", status: "" });
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
  const { data } = useFetch(`/jewelry?${query}`);
  const items = data || [];
  return (
    <section className="stack">
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input placeholder="Buscar por nome, observação de cor, tamanho, espessura ou categoria" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </label>
        <Select label="Material" value={filters.material} onChange={(v) => setFilters({ ...filters, material: v })}>
          <option value="">Todos</option>
          <option>titânio grau implante</option><option>ouro 14k</option><option>ouro 18k</option><option>aço</option><option>outro</option>
        </Select>
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
          <option value="">Todos</option>
          <option>disponível</option><option>baixo estoque</option><option>esgotado</option>
        </Select>
        <div className="icon-toggle">
          <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Cards"><LayoutGrid size={18} /></button>
          <button className={view === "table" ? "active" : ""} onClick={() => setView("table")} aria-label="Tabela"><Table2 size={18} /></button>
        </div>
      </div>
      {view === "cards" ? <JewelryCards items={items} /> : <JewelryTable items={items} />}
    </section>
  );
}

function JewelryCards({ items, onOpen, onEdit, onMovement, onArchive }) {
  return (
    <div className="inventory-product-list">
      {items.map((item) => (
        <article
          className="inventory-product-row clickable"
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen?.(item)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onOpen?.(item);
          }}
        >
          <img src={catalogImageUrl(item.photo_url)} alt={elegantProductName(item.name)} />
          <div>
            <span className={`pill ${inventoryStatusClass(item)}`}>{inventoryStatusLabel(item)}</span>
            <h2>{elegantProductName(item.name)}</h2>
            <p>{[item.category, item.subcategory].map(cleanDisplayText).filter(Boolean).join(" · ")}</p>
            <div className="inventory-inline-meta">
              <span className="stock-chip">{item.quantity} em estoque</span>
              <span className="inventory-visual-tag">{item.variant_count || item.variants?.length || 0} variações</span>
              <strong>A partir de {currency.format(item.sale_value || 0)}</strong>
            </div>
            <div className="card-actions">
              {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Entrada"); }}>Entrada</button>}
              {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Saída"); }}>Saída</button>}
              <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(item); }}>Editar</button>
              {onArchive && <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(item); }}>Arquivar</button>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function Inventory2() {
  const [view, setView] = useState("table");
  const [sectionTab, setSectionTab] = useState("produtos");
  const [inventoryMode, setInventoryMode] = useState("internal");
  const [editingJewelry, setEditingJewelry] = useState(null);
  const [movementTarget, setMovementTarget] = useState(null);
  const [filters, setFilters] = useState({ search: "", category: "", subcategory: "", material: "", color: "", size: "", thickness: "", length: "", diameter: "", thread_type: "", supplier: "", physical_location: "", status: "" });
  const [statusTab, setStatusTab] = useState("todos");
  const [badgeTab, setBadgeTab] = useState("todos");
  const [showEditor, setShowEditor] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const { data: options, refresh: refreshOptions } = useFetch("/options");
  const { status: _statusFilter, ...queryFilters } = filters;
  const query = new URLSearchParams(Object.fromEntries(Object.entries(queryFilters).filter(([, value]) => value))).toString();
  const { data, refresh: refreshJewelry } = useFetch(`/jewelry?${query}`);
  const items = data || [];
  const inventoryOptions = options?.inventoryOptions || { category: [], size: [], thickness: [] };
  const allJewelry = options?.jewelry || items;
  const allVariants = allJewelry.flatMap((item) => item.variants || []);
  const variantOptions = (field) => [...new Set(allVariants.map((variant) => variant[field]).filter(Boolean))].sort();
  const filteredItems = items.filter((item) => {
    if (inventoryMode === "virtual") {
      if (badgeTab === "todos") return true;
      if (badgeTab === "lancamentos") return Boolean(Number(item.is_new));
      if (badgeTab === "promocoes") return Boolean(Number(item.is_promotion));
      if (badgeTab === "mais-desejados") return Boolean(Number(item.is_most_wanted));
      if (badgeTab === "ultimas-unidades") return Boolean(Number(item.is_last_units));
      if (badgeTab === "destaques") return Boolean(Number(item.is_featured));
      return true;
    }
    const effectiveStatus = statusTab !== "todos" ? statusTab : filters.status;
    if (!effectiveStatus || effectiveStatus === "todos") return true;
    if (effectiveStatus === "ativos") return inventoryStockState(item) === "active";
    if (effectiveStatus === "critico" || effectiveStatus === "crítico") return inventoryStockState(item) === "critical";
    if (effectiveStatus === "esgotados" || effectiveStatus === "esgotado") return inventoryStockState(item) === "sold-out";
    return true;
  });
  const displayItems = filteredItems.filter((item) => inventoryMode === "virtual" ? Boolean(Number(item.is_catalog_active)) : true);
  const stockSummary = {
    totalProducts: allJewelry.length,
    totalPieces: allJewelry.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    active: allJewelry.filter((item) => inventoryStockState(item) === "active").length,
    critical: allJewelry.filter((item) => inventoryStockState(item) === "critical").length,
    soldOut: allJewelry.filter((item) => inventoryStockState(item) === "sold-out").length,
    invested: allJewelry.reduce((sum, item) => sum + Number(item.cost_value || 0) * Number(item.quantity || 0), 0),
    potential: allJewelry.reduce((sum, item) => sum + Number(item.sale_value || 0) * Number(item.quantity || 0), 0)
  };
  const criticalStockItems = allJewelry.filter((item) => inventoryStockState(item) === "critical");
  const lowStockItems = criticalStockItems;
  const reorderItems = criticalStockItems;
  const soldOutItems = allJewelry.filter((item) => inventoryStockState(item) === "sold-out");
  const topValueItems = [...allJewelry].sort((a, b) => (Number(b.sale_value || 0) * Number(b.quantity || 0)) - (Number(a.sale_value || 0) * Number(a.quantity || 0))).slice(0, 8);
  const mainTabs = [
    { id: "produtos", label: "Lista de Produtos", icon: LayoutGrid },
    { id: "categorias", label: "Categorias", icon: ListFilter }
  ];

  useEffect(() => {
    setStatusTab("todos");
    setBadgeTab("todos");
  }, [inventoryMode]);

  async function archiveJewelry(item) {
    const response = await apiFetch(`/jewelry/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "arquivado", is_catalog_active: 0 })
    });
    if (response.ok) {
      refreshJewelry();
      refreshOptions();
    }
  }

  function openMovement(item, movement_type) {
    setMovementTarget({ ...item, movement_type });
  }

  async function handleMovementSave(payload) {
    if (!movementTarget) return;
    const selectedVariantId = payload.variant_id || movementTarget.variants?.[0]?.id;
    const endpoint = selectedVariantId
      ? `/jewelry/${movementTarget.id}/variants/${selectedVariantId}/movements`
      : `/jewelry/${movementTarget.id}/movements`;
    const response = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      setMovementTarget(null);
      refreshJewelry();
      refreshOptions();
    }
  }

  function openProduct(item) {
    setEditingJewelry(item);
    setShowEditor(true);
  }

  function openNewProduct() {
    setEditingJewelry(null);
    setShowEditor(true);
    setSectionTab("produtos");
  }

  function closeProduct({ keepCategory = true } = {}) {
    const category = editingJewelry?.category;
    setEditingJewelry(null);
    setShowEditor(false);
    if (keepCategory && category) {
      setFilters((current) => ({ ...current, category }));
    }
  }

  if (showEditor) {
    const productCategory = editingJewelry?.category || filters.category;
    return (
      <section className="inventory-studio inventory-product-page">
        <div className="inventory-main">
          <nav className="inventory-breadcrumb" aria-label="Navegação do estoque">
            <button type="button" onClick={() => closeProduct({ keepCategory: false })}>Estoque</button>
            {productCategory && (
              <>
                <ChevronRight size={14} />
                <button type="button" onClick={() => closeProduct({ keepCategory: true })}>{productCategory}</button>
              </>
            )}
            <ChevronRight size={14} />
            <strong>{editingJewelry ? elegantProductName(editingJewelry.name) : "Novo Produto"}</strong>
          </nav>

          <div className="inventory-product-navigation">
            <button type="button" className="secondary-button" onClick={() => closeProduct({ keepCategory: false })}>
              <ArrowLeft size={16} /> Voltar para Estoque
            </button>
            {productCategory && (
              <button type="button" className="secondary-button" onClick={() => closeProduct({ keepCategory: true })}>
                <ArrowLeft size={16} /> Voltar para {productCategory}
              </button>
            )}
          </div>

          <JewelryEditor
            options={inventoryOptions}
            editing={editingJewelry}
            onMovementOpen={openMovement}
            onCancel={() => closeProduct({ keepCategory: Boolean(productCategory) })}
            onSaved={() => {
              closeProduct({ keepCategory: Boolean(productCategory) });
              refreshJewelry();
              refreshOptions();
            }}
          />
        </div>
        {movementTarget && <StockMovementModal item={movementTarget} initialType={movementTarget.movement_type} onClose={() => setMovementTarget(null)} onSave={handleMovementSave} />}
      </section>
    );
  }

  return (
    <section className="inventory-studio">
      <div className="inventory-main">
        <header className="inventory-hero">
          <div>
            <span className="eyebrow">Aura Clinic / Estoque</span>
            <h2>Estoque</h2>
            <p>Produtos, variações e movimentações em uma navegação simples.</p>
          </div>
          <div className="inventory-hero-actions">
            <button className="primary-button" type="button" onClick={openNewProduct}><Gem size={16} /> Nova Joia</button>
          </div>
        </header>

        <nav className="inventory-module-tabs" aria-label="Módulos do estoque">
          {mainTabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={sectionTab === id ? "active" : ""} onClick={() => setSectionTab(id)}>
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="inventory-panel-shell">
          {sectionTab === "produtos" && (
            <>
              <nav className="inventory-list-breadcrumb" aria-label="Navegação por categoria">
                <button
                  type="button"
                  className={!filters.category ? "active" : ""}
                  onClick={() => setFilters((current) => ({ ...current, category: "" }))}
                >
                  Estoque
                </button>
                {filters.category && (
                  <>
                    <ChevronRight size={14} />
                    <strong>{filters.category}</strong>
                  </>
                )}
              </nav>

              <div className="inventory-category-strip" aria-label="Categorias principais">
                {JEWELRY_CATEGORY_OPTIONS.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={filters.category === category ? "active" : ""}
                    onClick={() => setFilters((current) => ({ ...current, category: current.category === category ? "" : category }))}
                  >
                    {category}
                  </button>
                ))}
              </div>

              <div className="inventory-filter-row simplified">
                <label className="search-field">
                  <Search size={17} />
                  <input placeholder="Buscar joia, SKU ou variação..." value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
                </label>
                <Select label="Categoria" value={filters.category} onChange={(value) => setFilters({ ...filters, category: value })}>
                  <option value="">Categoria</option>
                  {catalogFilterOptions(allJewelry).categories.map((option) => <option key={option}>{option}</option>)}
                </Select>
                <Select label="Status" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })}>
                  <option value="">Status</option>
                  <option value="ativos">Ativos</option>
                  <option value="critico">Crítico</option>
                  <option value="esgotados">Esgotados</option>
                </Select>
                <button type="button" className={`advanced-filter-toggle ${showAdvancedFilters ? "active" : ""}`} onClick={() => setShowAdvancedFilters((value) => !value)}>
                  <SlidersHorizontal size={17} /> Filtros Avançados
                </button>
                <div className="icon-toggle">
                  <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Cards"><LayoutGrid size={18} /></button>
                  <button className={view === "table" ? "active" : ""} onClick={() => setView("table")} aria-label="Tabela"><Table2 size={18} /></button>
                </div>
              </div>

              {showAdvancedFilters && (
                <div className="inventory-advanced-filters">
                  <Select label="Material" value={filters.material} onChange={(value) => setFilters({ ...filters, material: value })}>
                    <option value="">Todos os Materiais</option>
                    {variantOptions("material").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Observação de Cor" value={filters.color} onChange={(value) => setFilters({ ...filters, color: value })}>
                    <option value="">Todas</option>
                    {variantOptions("color").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Tipo de Rosca" value={filters.thread_type} onChange={(value) => setFilters({ ...filters, thread_type: value })}>
                    <option value="">Todos</option>
                    {variantOptions("thread_type").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Espessura" value={filters.thickness} onChange={(value) => setFilters({ ...filters, thickness: value })}>
                    <option value="">Todas</option>
                    {variantOptions("thickness").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Comprimento" value={filters.length} onChange={(value) => setFilters({ ...filters, length: value })}>
                    <option value="">Todos</option>
                    {variantOptions("length").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Diâmetro" value={filters.diameter} onChange={(value) => setFilters({ ...filters, diameter: value })}>
                    <option value="">Todos</option>
                    {variantOptions("diameter").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Fornecedor" value={filters.supplier} onChange={(value) => setFilters({ ...filters, supplier: value })}>
                    <option value="">Todos</option>
                    {variantOptions("supplier").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                </div>
              )}

              {!displayItems.length ? (
                <div className="inventory-empty-state">
                  <Gem size={28} />
                  <strong>Nenhuma joia encontrada neste filtro.</strong>
                  <span>Ajuste os filtros ou escolha outra categoria para continuar.</span>
                </div>
              ) : view === "cards" ? (
                <JewelryCards items={displayItems} onOpen={openProduct} onEdit={openProduct} onMovement={openMovement} onArchive={archiveJewelry} />
              ) : (
                <JewelryTable items={displayItems} onOpen={openProduct} onEdit={openProduct} onMovement={openMovement} onArchive={archiveJewelry} />
              )}
            </>
          )}

          {sectionTab === "categorias" && (
            <div className="inventory-section-card">
              <div className="panel-heading">
                <div>
                  <h2>Categorias e cadastros auxiliares</h2>
                  <span>Organize categorias, tamanhos, espessuras e profissionais sem sair desta página.</span>
                </div>
                <button className="secondary-button" type="button" onClick={() => setShowManagement((value) => !value)}>
                  {showManagement ? "Ocultar cadastros" : "Abrir cadastros"}
                </button>
              </div>
              <div className="inventory-summary-grid compact">
                <Metric label="Categorias" value={String(inventoryOptions.category?.length || 0)} />
                <Metric label="Tamanhos" value={String(inventoryOptions.size?.length || 0)} />
                <Metric label="Espessuras" value={String(inventoryOptions.thickness?.length || 0)} />
                <Metric label="Profissionais" value={String(options?.professionals?.length || 0)} />
              </div>
              {showManagement && <InventoryManagement options={inventoryOptions} professionals={options?.professionals || []} onChanged={refreshOptions} />}
            </div>
          )}

          {sectionTab === "unidades" && (
            <div className="inventory-section-card">
              <div className="panel-heading">
                <div>
                  <h2>Unidades e visão rápida</h2>
                  <span>Resumo por peça com foco no que importa primeiro.</span>
                </div>
              </div>
              <div className="inventory-summary-grid compact">
                <Metric label="Total de peças" value={String(stockSummary.totalPieces)} />
                <Metric label="Total de produtos" value={String(stockSummary.totalProducts)} />
                <Metric label="Críticas" value={String(stockSummary.critical)} />
                <Metric label="Esgotados" value={String(stockSummary.soldOut)} />
                <Metric label="Valor investido" value={currency.format(stockSummary.invested)} />
                <Metric label="Venda potencial" value={currency.format(stockSummary.potential)} />
                <Metric label="Lucro potencial" value={currency.format(stockSummary.potential - stockSummary.invested)} />
              </div>
              <div className="inventory-quick-flags">
                <span><strong>Ativos no Catálogo</strong><small>{allJewelry.filter((item) => Boolean(Number(item.is_catalog_active))).length} peças visíveis na vitrine</small></span>
                <span><strong>Destaques Comerciais</strong><small>Lançamentos, promoções e últimas unidades ficam na Loja Virtual</small></span>
                <span><strong>Alertas</strong><small>Criticidade e reposição continuam no fluxo interno</small></span>
              </div>
              <div className="inventory-mini-list">
                {allJewelry.slice(0, 6).map((item) => (
                  <div key={item.id} className="inventory-mini-row">
                    <img src={catalogImageUrl(item.photo_url)} alt={item.name} />
                    <div>
                      <strong>{item.name}</strong>
                      <small>{[item.category, item.material].filter(Boolean).join(" · ")}</small>
                    </div>
                    <span>{item.quantity} un</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sectionTab === "abc" && (
            <div className="inventory-section-card">
              <div className="panel-heading">
                <div>
                  <h2>Curva ABC</h2>
                  <span>Peças com maior valor total em estoque.</span>
                </div>
              </div>
              <div className="inventory-abc-list">
                {topValueItems.map((item, index) => (
                  <div key={item.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{currency.format(Number(item.sale_value || 0) * Number(item.quantity || 0))}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {movementTarget && <StockMovementModal item={movementTarget} initialType={movementTarget.movement_type} onClose={() => setMovementTarget(null)} onSave={handleMovementSave} />}
    </section>
  );
}

function JewelryEditor({ options, editing, onSaved, onCancel, onMovementOpen }) {
  const [form, setForm] = useState(defaultJewelry());
  const [error, setError] = useState("");
  const [editorTab, setEditorTab] = useState("dados");
  const [editingVariantIndex, setEditingVariantIndex] = useState(null);

  useEffect(() => {
    setForm(editing ? normalizeJewelryForm(editing) : defaultJewelry());
    setError("");
    setEditorTab("dados");
    setEditingVariantIndex(null);
  }, [editing?.id]);

  useEffect(() => {
    if (!form.name) return;
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => (
        variant.sku ? variant : { ...variant, sku: `${jewelrySkuBase(current)}-${String(index + 1).padStart(2, "0")}` }
      ))
    }));
  }, [form.name, form.category]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const payload = {
      ...form,
      gallery_urls: parseGalleryUrls(form.gallery_urls),
      material: form.variants[0]?.material || "",
      color: form.variants[0]?.color || "",
      size: form.variants[0]?.size || "",
      thickness: form.variants[0]?.thickness || "",
      stem_length: form.variants[0]?.length || "",
      thread_type: form.variants[0]?.thread_type || "",
      supplier: form.variants[0]?.supplier || "",
      sku: form.variants[0]?.sku || "",
      quantity: form.variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0),
      cost_value: Math.min(...form.variants.map((variant) => Number(variant.cost_value || 0))),
      sale_value: Math.min(...form.variants.map((variant) => Number(variant.sale_value || 0))),
      virtual_store_active: Boolean(form.virtual_store_active),
      is_catalog_active: Boolean(form.is_catalog_active),
      is_featured: Boolean(form.is_featured),
      is_new: Boolean(form.is_new),
      is_most_wanted: Boolean(form.is_most_wanted),
      is_promotion: Boolean(form.is_promotion),
      is_last_units: Boolean(form.is_last_units)
    };
    const response = await apiFetch(`/jewelry${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Não foi possível salvar a joia.");
    setForm(defaultJewelry());
    onSaved();
  }

  const potentialProfit = form.variants.reduce(
    (sum, variant) => sum + Math.max(0, Number(variant.sale_value || 0) - Number(variant.cost_value || 0)) * Number(variant.quantity || 0),
    0
  );

  function updateVariant(index, patch) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, ...patch } : variant)
    }));
  }

  function addVariant() {
    setForm((current) => {
      const nextIndex = current.variants.length + 1;
      return {
        ...current,
        variants: [
          ...current.variants,
          {
            ...defaultJewelryVariant(nextIndex),
            sku: `${jewelrySkuBase(current)}-${String(nextIndex).padStart(2, "0")}`
          }
        ]
      };
    });
    setEditorTab("variacoes");
    setEditingVariantIndex(form.variants.length);
  }

  function removeVariant(index) {
    if (form.variants.length === 1) return setError("O produto precisa ter ao menos uma variação.");
    setForm((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }));
  }

  return (
    <form className="panel jewelry-editor stock-editor" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Categoria → Produto → Variações</span>
          <h2>{editing ? "Editar Produto" : "Novo Produto"}</h2>
          <span>Cadastre a joia uma vez e controle cada medida separadamente.</span>
        </div>
      </div>

      <nav className="editor-tabs">
        {[
          ["dados", "Dados"],
          ["variacoes", `Variações (${form.variants.length})`],
          ["movimentacao", "Movimentação"],
          ["comercial", "Comercial"],
          ["virtual", "Catálogo"]
        ].map(([id, label]) => (
          <button key={id} type="button" className={editorTab === id ? "active" : ""} onClick={() => setEditorTab(id)}>{label}</button>
        ))}
      </nav>

      {editorTab === "dados" && (
        <div className="editor-section">
          <div className="form-grid">
            <Input label="Nome do Produto" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Select label="Categoria" value={form.category} onChange={(value) => setForm({ ...form, category: value })} required>
              <option value="">Selecione</option>
              {JEWELRY_CATEGORY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
            </Select>
            {form.category === "Argolas" && (
              <Select label="Subcategoria" value={form.subcategory} onChange={(value) => setForm({ ...form, subcategory: value })}>
                <option value="">Selecione</option>
                {["Segmento", "Clicker", "D-Ring", "Captive", "Hinged Ring"].map((item) => <option key={item}>{item}</option>)}
              </Select>
            )}
            <ImageUploadField label="Foto principal" value={form.photo_url} onChange={(value) => setForm({ ...form, photo_url: value })} />
          </div>
          <label>Galeria de fotos
            <textarea value={form.gallery_urls} onChange={(event) => setForm({ ...form, gallery_urls: event.target.value })} placeholder={"Cole uma URL por linha.\nCada imagem aparece no catálogo como galeria."} />
          </label>
          <div className="form-grid">
            <Input label="Pedra" value={form.stone} onChange={(value) => setForm({ ...form, stone: value })} />
            <Input label="Indicação de Uso" value={form.piercing_type} onChange={(value) => setForm({ ...form, piercing_type: value })} />
          </div>
          <label>Descrição curta
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label>Observações internas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
        </div>
      )}

      {editorTab === "variacoes" && (
        <div className="editor-section">
          <div className="variant-editor-heading">
            <div>
              <h3>Variações do Produto</h3>
              <p>Cada combinação possui SKU, preço e estoque próprios.</p>
            </div>
            <button type="button" className="primary-button" onClick={addVariant}>+ Nova Variação</button>
          </div>
          <div className="variant-editor-list">
            {form.variants.map((variant, index) => {
              const measure = variant.diameter
                ? `Diâmetro ${variant.diameter}`
                : variant.length
                  ? `Comprimento ${variant.length}`
                  : variant.size
                    ? `Tamanho ${variant.size}`
                    : variant.variation_name || `Variação ${index + 1}`;
              const specifications = [
                variant.thickness && `${variant.thickness}`,
                variant.material && elegantProductName(variant.material),
                variant.thread_type && `Rosca ${elegantProductName(variant.thread_type)}`
              ].filter(Boolean);
              return (
                <article className="variant-editor-card compact" key={variant.id || index}>
                  <div className="variant-card-measure">
                    <strong>{measure}</strong>
                    {variant.variation_name && !measure.toLocaleLowerCase("pt-BR").includes(String(variant.variation_name).toLocaleLowerCase("pt-BR")) && <small>{variant.variation_name}</small>}
                  </div>
                  <div className="variant-card-specs">
                    {specifications.length
                      ? specifications.map((specification) => <span key={specification}>{specification}</span>)
                      : <span>Configure as especificações</span>}
                  </div>
                  <div className="variant-card-business">
                    <span><small>Estoque</small><strong>{Number(variant.quantity || 0)} un</strong></span>
                    <span><small>Preço</small><strong>{currency.format(variant.sale_value || 0)}</strong></span>
                    <span><small>SKU</small><strong>{variant.sku || "Não informado"}</strong></span>
                  </div>
                  <div className="variant-card-actions">
                    <button type="button" aria-label="Editar Variação" title="Editar Variação" onClick={() => setEditingVariantIndex(index)}><Pencil size={16} /></button>
                    <button type="button" aria-label="Excluir Variação" title="Excluir Variação" onClick={() => removeVariant(index)}><Trash2 size={16} /></button>
                  </div>
                </article>
              );
            })}
          </div>
          {editingVariantIndex !== null && form.variants[editingVariantIndex] && (
            <VariantEditModal
              category={form.category}
              variant={form.variants[editingVariantIndex]}
              onChange={(patch) => updateVariant(editingVariantIndex, patch)}
              onClose={() => setEditingVariantIndex(null)}
            />
          )}
        </div>
      )}

      {editorTab === "movimentacao" && (
        <div className="editor-section">
          <div className="variant-editor-heading">
            <div>
              <h3>Movimentação de Estoque</h3>
              <p>Registre entradas e saídas sem misturar o histórico com o cadastro das variações.</p>
            </div>
            {editing?.id && (
              <div className="product-movement-actions">
                <button type="button" className="secondary-button" onClick={() => onMovementOpen?.(editing, "Entrada")}>Registrar Entrada</button>
                <button type="button" className="secondary-button" onClick={() => onMovementOpen?.(editing, "Saída")}>Registrar Saída</button>
              </div>
            )}
          </div>
          {editing?.id
            ? <StockMovementHistory jewelryId={editing.id} />
            : <p className="empty-state">Salve o produto antes de registrar movimentações.</p>}
        </div>
      )}

      {editorTab === "comercial" && (
        <div className="editor-section">
          <div className="form-grid">
            <Input label="Localização Física" value={form.physical_location} onChange={(value) => setForm({ ...form, physical_location: value })} />
          </div>
          <div className="inventory-stat-box">
            <div><span>Variações Ativas</span><strong>{form.variants.length}</strong></div>
            <div><span>Total de Peças</span><strong>{form.variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0)}</strong></div>
            <div><span>Lucro Potencial</span><strong>{currency.format(potentialProfit)}</strong></div>
          </div>
          <div className="chip-toggle-grid">
            <ToggleChip label="Ativo no catálogo" checked={form.is_catalog_active} onChange={(value) => setForm({ ...form, is_catalog_active: value })} />
            <ToggleChip label="Destaque" checked={form.is_featured} onChange={(value) => setForm({ ...form, is_featured: value })} />
            <ToggleChip label="Promoção" checked={form.is_promotion} onChange={(value) => setForm({ ...form, is_promotion: value })} />
            <ToggleChip label="Lançamento" checked={form.is_new} onChange={(value) => setForm({ ...form, is_new: value })} />
            <ToggleChip label="Mais desejado" checked={form.is_most_wanted} onChange={(value) => setForm({ ...form, is_most_wanted: value })} />
            <ToggleChip label="Últimas unidades" checked={form.is_last_units} onChange={(value) => setForm({ ...form, is_last_units: value })} />
          </div>
        </div>
      )}

      {editorTab === "virtual" && (
        <div className="editor-section">
          <Toggle label="Loja virtual ativa" checked={form.virtual_store_active} onChange={(value) => setForm({ ...form, virtual_store_active: value })} />
          {Boolean(form.virtual_store_active) && (
            <>
              <div className="form-grid">
                <Input type="number" label="Peso para envio (g)" value={form.weight_grams} onChange={(value) => setForm({ ...form, weight_grams: value })} />
                <Input type="number" label="Comprimento da embalagem (cm)" value={form.package_length_cm} onChange={(value) => setForm({ ...form, package_length_cm: value })} />
                <Input type="number" label="Largura da embalagem (cm)" value={form.package_width_cm} onChange={(value) => setForm({ ...form, package_width_cm: value })} />
                <Input type="number" label="Altura da embalagem (cm)" value={form.package_height_cm} onChange={(value) => setForm({ ...form, package_height_cm: value })} />
                <Input label="Tipo de embalagem" value={form.package_type} onChange={(value) => setForm({ ...form, package_type: value })} />
                <Input type="number" label="Prazo de preparação (dias)" value={form.preparation_days} onChange={(value) => setForm({ ...form, preparation_days: value })} />
              </div>
              <label>Informações de frete / envio
                <textarea value={form.shipping_info} onChange={(event) => setForm({ ...form, shipping_info: event.target.value })} placeholder="Ex.: Envio para todo o Brasil, cálculo por Correios ou transportadora, embalagem protegida." />
              </label>
              <label>Observações de frete e envio
                <textarea value={form.freight_notes} onChange={(event) => setForm({ ...form, freight_notes: event.target.value })} placeholder="Ex.: proteger pedra ou opala, usar caixa pequena, separar por variações." />
              </label>
              <div className="form-grid">
                <Input label="SEO título" value={form.seo_title} onChange={(value) => setForm({ ...form, seo_title: value })} />
                <Input label="SEO descrição" value={form.seo_description} onChange={(value) => setForm({ ...form, seo_description: value })} />
              </div>
            </>
          )}
        </div>
      )}

      {error && <span className="form-error">{error}</span>}
      <div className="modal-actions">
        {editing && <button type="button" className="secondary-button" onClick={onCancel}>Cancelar edição</button>}
        <button className="primary-button">{editing ? "Salvar joia" : "Cadastrar joia"}</button>
      </div>
    </form>
  );
}

function VariantEditModal({ category, variant, onChange, onClose }) {
  const normalizedCategory = removeAccents(String(category || "").toLowerCase());
  const usesDiameter = normalizedCategory.includes("argola");
  const usesLength = ["labret", "barbell reto", "barbell curvo", "nostril", "surface"].some((name) => normalizedCategory.includes(name));
  const usesSize = normalizedCategory.includes("topos") || normalizedCategory.includes("microdermal") || normalizedCategory.includes("ouro");
  const usesThickness = !normalizedCategory.includes("topos") && !normalizedCategory.includes("microdermal");
  const usesThread = ["labret", "barbell", "nostril", "topos", "ouro"].some((name) => normalizedCategory.includes(name));
  const selectedColors = splitColorOptions(variant.color);

  function toggleColor(color) {
    const nextColors = selectedColors.includes(color)
      ? selectedColors.filter((item) => item !== color)
      : [...selectedColors, color];
    onChange({ color: nextColors.join(", ") });
  }

  return (
    <div className="modal-backdrop variant-modal-backdrop" onClick={onClose}>
      <section className="panel variant-edit-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><h2>Editar Variação</h2><p>Configure apenas as especificações necessárias para {category || "esta categoria"}.</p></div>
          <button type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="variant-modal-fields">
          <Input label="Nome da Variação" value={variant.variation_name} onChange={(value) => onChange({ variation_name: value })} />
          {usesSize && <Input label="Tamanho / Medida" value={variant.size} onChange={(value) => onChange({ size: value })} />}
          {usesDiameter && <Input label="Diâmetro" value={variant.diameter} onChange={(value) => onChange({ diameter: value })} />}
          {usesLength && (
            <Select label="Comprimento" value={variant.length} onChange={(value) => onChange({ length: value })}>
              <option value="">Selecione</option>
              {JEWELRY_LENGTH_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </Select>
          )}
          {usesThickness && (
            <Select label="Espessura" value={variant.thickness} onChange={(value) => onChange({ thickness: value })}>
              <option value="">Selecione</option>
              {JEWELRY_THICKNESS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </Select>
          )}
          <Select label="Material" value={variant.material} onChange={(value) => onChange({ material: value })}>
            <option>Titânio ASTM F136</option><option>Ouro 14k</option><option>Ouro 18k</option><option>Aço</option><option>Outro</option>
          </Select>
          <fieldset className="anodization-fieldset">
            <legend>Observações de Cor / Anodização</legend>
            <p>Selecione todas as cores que o cliente poderá solicitar para esta mesma joia.</p>
            <div className="anodization-color-grid">
              {ANODIZATION_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  className={selectedColors.includes(option.name) ? "active" : ""}
                  onClick={() => toggleColor(option.name)}
                >
                  <span style={{ backgroundColor: option.color }} />
                  {option.name}
                  {selectedColors.includes(option.name) && <CheckCircle2 size={15} />}
                </button>
              ))}
            </div>
          </fieldset>
          <Select label="Lado" value={variant.side} onChange={(value) => onChange({ side: value })}>
            <option value="">Não se aplica</option><option>Direito</option><option>Esquerdo</option><option>Universal</option>
          </Select>
          <Input label="Cor da Pedraria" value={variant.stone_color} onChange={(value) => onChange({ stone_color: value })} />
          {usesThread && (
            <Select label="Tipo de Rosca" value={variant.thread_type} onChange={(value) => onChange({ thread_type: value })}>
              <option value="">Sem Rosca</option>
              {JEWELRY_THREAD_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </Select>
          )}
          <Input label="SKU" value={variant.sku} onChange={(value) => onChange({ sku: value })} required />
          <Input label="Fornecedor" value={variant.supplier} onChange={(value) => onChange({ supplier: value })} />
          <div className="form-grid">
            <Input type="number" label="Valor de Custo" value={variant.cost_value} onChange={(value) => onChange({ cost_value: value })} />
            <Input type="number" label="Valor de Venda" value={variant.sale_value} onChange={(value) => onChange({ sale_value: value })} required />
            <Input type="number" label="Estoque Atual" value={variant.quantity} onChange={(value) => onChange({ quantity: value })} required />
            <Input type="number" label="Estoque Mínimo" value={variant.low_stock_threshold} onChange={(value) => onChange({ low_stock_threshold: value })} />
          </div>
          <Toggle label="Variação Ativa" checked={variant.is_active} onChange={(value) => onChange({ is_active: value })} />
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="primary-button" onClick={onClose}>Salvar Variação</button></footer>
      </section>
    </div>
  );
}

function StockMovementHistory({ jewelryId }) {
  const { data } = useFetch(`/jewelry/${jewelryId}/movements`);
  const movements = data || [];
  return (
    <div className="movement-history">
      <h3>Histórico de movimentação</h3>
      <div className="movement-history-list">
        {movements.slice(0, 6).map((movement) => (
          <div key={movement.id}>
            <strong>{movement.movement_type}</strong>
            <span>{movement.quantity} un · {formatDate(movement.movement_date)}</span>
            {movement.notes && <small>{movement.notes}</small>}
          </div>
        ))}
        {!movements.length && <p className="empty-state">Nenhuma movimentação registrada.</p>}
      </div>
    </div>
  );
}

function ToggleChip({ label, checked, onChange }) {
  return (
    <button type="button" className={`toggle-chip ${checked ? "active" : ""}`} onClick={() => onChange(!checked)}>
      {label}
    </button>
  );
}

function StockMovementModal({ item, initialType = "Entrada", onClose, onSave }) {
  const [form, setForm] = useState({
    quantity: 1,
    movement_type: initialType,
    variant_id: item?.variants?.[0]?.id || "",
    notes: ""
  });

  useEffect(() => {
    setForm({
      quantity: 1,
      movement_type: initialType,
      variant_id: item?.variants?.[0]?.id || "",
      notes: ""
    });
  }, [item?.id, initialType]);

  if (!item) return null;

  async function submit(event) {
    event.preventDefault();
    await onSave({
      quantity: Math.max(1, Number(form.quantity || 0)),
      movement_type: form.movement_type,
      variant_id: form.variant_id,
      notes: form.notes,
      movement_date: new Date().toISOString().slice(0, 10)
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="panel stock-movement-modal" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="panel-heading">
          <h2>{item.name}</h2>
          <span>{initialType === "Saída" ? "Saída rápida" : "Entrada rápida"}</span>
        </div>
        <div className="form-grid">
          <Select label="Variação" value={form.variant_id} onChange={(value) => setForm({ ...form, variant_id: value })} required>
            {(item.variants || []).map((variant) => (
              <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} · {variant.quantity} un</option>
            ))}
          </Select>
          <Input type="number" label="Quantidade" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} required />
          <Select label="Tipo" value={form.movement_type} onChange={(value) => setForm({ ...form, movement_type: value })} required>
            <option>Entrada</option>
            <option>Saída</option>
            <option>Venda</option>
            <option>Ajuste</option>
            <option>Perda</option>
          </Select>
        </div>
        <label>Observação
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <p className="movement-date-hint">Data automática: {new Date().toLocaleDateString("pt-BR")}</p>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button">Salvar movimentação</button>
        </div>
      </form>
    </div>
  );
}

function CatalogCustomization() {
  const { data, refresh } = useFetch("/catalog-customization");
  const [form, setForm] = useState(defaultCatalogCustomization());
  const [activeSection, setActiveSection] = useState("aparencia");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data || data.error) return;
    setForm(normalizeCatalogCustomization(data));
  }, [data]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const products = data.products || [];
  const categoryOptions = [
    ...(data.inventoryOptions?.category || []).map((item) => item.name),
    ...new Set(products.map((item) => item.category).filter(Boolean))
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  async function save(path = "/catalog-customization", success = "Alterações salvas.") {
    setError("");
    setMessage("");
    const payload = serializeCatalogCustomization(form);
    const response = await apiFetch(path, {
      method: "POST" === path.split("/").at(-1) ? "POST" : path.includes("publish") || path.includes("reset") ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: path.includes("reset") ? undefined : JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Não foi possível salvar.");
    if (path.includes("reset")) setForm(normalizeCatalogCustomization(json));
    setMessage(success);
    refresh();
  }

  return (
    <section className="catalog-customization-page">
      <div className="catalog-customization-panel">
        <header className="customization-header">
          <div>
            <span className="eyebrow">Aura Clinic</span>
            <h2>Personalização do Catálogo</h2>
            <p>Edite aparência, banners, categorias, produtos, promoções e textos sem mexer no código.</p>
          </div>
          <div>
            <button className="secondary-button" type="button" onClick={() => save("/catalog-customization/reset", "Padrão restaurado.")}>Restaurar padrão</button>
            <button className="primary-button" type="button" onClick={() => save("/catalog-customization/publish", "Catálogo publicado.")}>Publicar</button>
          </div>
        </header>

        <nav className="customization-tabs">
          {[
            ["aparencia", "Aparência"],
            ["banners", "Banners"],
            ["componentes", "Componentes"],
            ["categorias", "Categorias"],
            ["produtos", "Produtos"],
            ["promocoes", "Promoções"],
            ["exibicao", "Exibição"],
            ["textos", "Textos"],
            ["contato", "Contato"],
            ["seo", "SEO"]
          ].map(([id, label]) => (
            <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)}>{label}</button>
          ))}
        </nav>

        {activeSection === "aparencia" && (
          <CustomizationCard title="Aparência do catálogo">
            <div className="form-grid">
              <ImageUploadField label="Logo" value={form.theme.logo_url} onChange={(value) => setForm(updateTheme(form, { logo_url: value }))} />
              <div className="form-grid compact-fields">
                <Input label="Nome da marca" value={form.theme.brand_name} onChange={(value) => setForm(updateTheme(form, { brand_name: value }))} />
                <Input label="Slogan" value={form.theme.slogan} onChange={(value) => setForm(updateTheme(form, { slogan: value }))} />
                <Input type="color" label="Cor principal" value={form.theme.primary_color} onChange={(value) => setForm(updateTheme(form, { primary_color: value }))} />
                <Input type="color" label="Cor secundária" value={form.theme.secondary_color} onChange={(value) => setForm(updateTheme(form, { secondary_color: value }))} />
                <Input type="color" label="Cor dos botões" value={form.theme.button_color} onChange={(value) => setForm(updateTheme(form, { button_color: value }))} />
                <Input type="color" label="Cor do fundo" value={form.theme.background_color} onChange={(value) => setForm(updateTheme(form, { background_color: value }))} />
                <Select label="Fonte do título" value={form.theme.title_font} onChange={(value) => setForm(updateTheme(form, { title_font: value }))}>
                  <option>Georgia</option><option>Playfair Display</option><option>Inter</option><option>Arial</option>
                </Select>
                <Select label="Fonte dos textos" value={form.theme.body_font} onChange={(value) => setForm(updateTheme(form, { body_font: value }))}>
                  <option>Inter</option><option>Arial</option><option>Georgia</option><option>Verdana</option>
                </Select>
                <Select label="Tema" value={form.theme.theme} onChange={(value) => setForm(updateTheme(form, { theme: value }))}>
                  <option value="claro">claro</option><option value="escuro">escuro</option><option value="premium">premium</option><option value="minimalista">minimalista</option>
                </Select>
              </div>
            </div>
          </CustomizationCard>
        )}

        {activeSection === "banners" && (
          <CustomizationCard title="Banner principal e carrossel" action={<div className="customization-actions"><button type="button" onClick={() => setForm({ ...form, banners: normalizeSortOrder(form.banners, "asc") })}>Ordem 1, 2, 3</button><button type="button" onClick={() => setForm({ ...form, banners: normalizeSortOrder(form.banners, "desc") })}>Inverter ordem</button><button type="button" onClick={() => setForm({ ...form, banners: [...form.banners, defaultCatalogBanner(form.banners.length + 1)] })}>Novo banner</button></div>}>
            <div className="custom-list">
              {form.banners.map((banner, index) => (
                <article key={index}>
                  <div className="custom-item-toolbar">
                    <strong>Banner {Number(banner.sort_order || index + 1)}</strong>
                    <span>
                      <button type="button" onClick={() => setForm({ ...form, banners: moveListItem(form.banners, index, -1) })}>Subir</button>
                      <button type="button" onClick={() => setForm({ ...form, banners: moveListItem(form.banners, index, 1) })}>Descer</button>
                    </span>
                  </div>
                  <ImageUploadField label="Imagem do banner" value={banner.image_url} onChange={(value) => setForm(updateList(form, "banners", index, { image_url: value }))} />
                  <div className="form-grid">
                    <Input label="Título" value={banner.title} onChange={(value) => setForm(updateList(form, "banners", index, { title: value }))} />
                    <Input label="Subtítulo" value={banner.subtitle} onChange={(value) => setForm(updateList(form, "banners", index, { subtitle: value }))} />
                  <Input label="Texto do botão" value={banner.button_text} onChange={(value) => setForm(updateList(form, "banners", index, { button_text: value }))} />
                  <Input label="Link do botão" value={banner.button_link} onChange={(value) => setForm(updateList(form, "banners", index, { button_link: value }))} />
                  <Input type="number" label="Altura do banner (px)" value={banner.banner_height} onChange={(value) => setForm(updateList(form, "banners", index, { banner_height: value }))} />
                  <Input type="number" label="Largura máxima (px)" value={banner.banner_width} onChange={(value) => setForm(updateList(form, "banners", index, { banner_width: value }))} />
                  <Select label="Enquadramento" value={banner.banner_fit || "cover"} onChange={(value) => setForm(updateList(form, "banners", index, { banner_fit: value }))}>
                    <option value="cover">Cobrir área</option>
                    <option value="contain">Mostrar inteira</option>
                    <option value="fill">Preencher</option>
                  </Select>
                  <Input type="number" label="Ordem" value={banner.sort_order} onChange={(value) => setForm(updateList(form, "banners", index, { sort_order: value }))} />
                  <Toggle label="Banner ativo" checked={banner.is_active} onChange={(value) => setForm(updateList(form, "banners", index, { is_active: value }))} />
                </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "banners", index))}>Remover banner</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "componentes" && (
          <CustomizationCard title="Componentes do catálogo" action={<button type="button" onClick={() => setForm({ ...form, contentSections: [...form.contentSections, defaultContentSection(form.contentSections.length + 1)] })}>Novo componente</button>}>
            <div className="custom-list">
              {form.contentSections.map((section, index) => (
                <article key={index}>
                  <div className="custom-item-toolbar">
                    <strong>Componente {Number(section.order || index + 1)}</strong>
                    <span>
                      <button type="button" onClick={() => setForm({ ...form, contentSections: moveListItem(form.contentSections, index, -1) })}>Subir</button>
                      <button type="button" onClick={() => setForm({ ...form, contentSections: moveListItem(form.contentSections, index, 1) })}>Descer</button>
                    </span>
                  </div>
                  <div className="form-grid">
                    <Input label="Etiqueta" value={section.kicker} onChange={(value) => setForm(updateList(form, "contentSections", index, { kicker: value }))} />
                    <Input label="Título" value={section.title} onChange={(value) => setForm(updateList(form, "contentSections", index, { title: value }))} />
                    <Input type="number" label="Ordem" value={section.order} onChange={(value) => setForm(updateList(form, "contentSections", index, { order: value }))} />
                    <Select label="Tipo de mídia" value={section.media_type} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_type: value }))}>
                      <option value="image">foto</option>
                      <option value="video">vídeo</option>
                      <option value="none">sem mídia</option>
                    </Select>
                    <Input label="Texto do botão" value={section.button_text} onChange={(value) => setForm(updateList(form, "contentSections", index, { button_text: value }))} />
                    <Input label="Link do botão" value={section.button_link} onChange={(value) => setForm(updateList(form, "contentSections", index, { button_link: value }))} />
                  </div>
                  {section.media_type === "image" ? <ImageUploadField label="Foto do componente" value={section.media_url} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_url: value }))} /> : <Input label="URL do vídeo incorporado" value={section.media_url} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_url: value }))} />}
                  <label>Texto
                    <textarea value={section.text} onChange={(event) => setForm(updateList(form, "contentSections", index, { text: event.target.value }))} />
                  </label>
                  <Toggle label="Componente ativo" checked={section.active} onChange={(value) => setForm(updateList(form, "contentSections", index, { active: value }))} />
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "contentSections", index))}>Remover componente</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "categorias" && (
          <CustomizationCard title="Categorias em destaque" action={<button type="button" onClick={() => setForm({ ...form, featuredCategories: [...form.featuredCategories, defaultFeaturedCategory(form.featuredCategories.length + 1)] })}>Nova categoria</button>}>
            <div className="custom-list">
              {form.featuredCategories.map((category, index) => (
                <article key={index}>
                  <div className="form-grid">
                    <Select label="Categoria do estoque" value={category.category_id} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { category_id: value }))}>
                      <option value="">Selecione</option>
                      {categoryOptions.map((option) => <option key={option}>{option}</option>)}
                    </Select>
                    <Input label="Nome público" value={category.public_name} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { public_name: value }))} />
                    <Select label="Ícone" value={category.icon} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { icon: value }))}>
                      <option value="gem">diamante</option><option value="heart">coração</option><option value="star">estrela</option><option value="sparkles">brilho</option><option value="shield">escudo</option>
                    </Select>
                    <Input type="number" label="Ordem" value={category.sort_order} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { sort_order: value }))} />
                    <Toggle label="Ativa" checked={category.is_active} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { is_active: value }))} />
                  </div>
                  <ImageUploadField label="Imagem da categoria" value={category.image_url} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { image_url: value }))} />
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "featuredCategories", index))}>Remover categoria</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "produtos" && (
          <CustomizationCard title="Produtos em destaque" action={<button type="button" onClick={() => setForm({ ...form, featuredProducts: [...form.featuredProducts, defaultFeaturedProduct()] })}>Adicionar produto</button>}>
            <div className="custom-list">
              {form.featuredProducts.map((product, index) => (
                <article key={index}>
                  <div className="form-grid">
                    <Select label="Produto" value={product.product_id} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { product_id: value }))}>
                      <option value="">Selecione</option>
                      {products.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </Select>
                    <Select label="Selo" value={product.badge} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { badge: value }))}>
                      <option value="">Sem selo</option><option value="Lançamento">Lançamento</option><option value="Mais vendido">Mais vendido</option><option value="Promoção">Promoção</option>
                    </Select>
                    <Input type="number" label="Ordem" value={product.sort_order} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { sort_order: value }))} />
                    <Toggle label="Ativo no catálogo" checked={product.is_active} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { is_active: value }))} />
                  </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "featuredProducts", index))}>Remover produto</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "promocoes" && (
          <CustomizationCard title="Promoções" action={<button type="button" onClick={() => setForm({ ...form, promotions: [...form.promotions, defaultPromotion()] })}>Nova promoção</button>}>
            <div className="custom-list">
              {form.promotions.map((promotion, index) => (
                <article key={index}>
                  <div className="form-grid">
                    <Input label="Nome da promoção" value={promotion.name} onChange={(value) => setForm(updateList(form, "promotions", index, { name: value }))} />
                    <Select label="Tipo de desconto" value={promotion.discount_type} onChange={(value) => setForm(updateList(form, "promotions", index, { discount_type: value }))}>
                      <option value="percent">porcentagem</option><option value="fixed">valor fixo</option>
                    </Select>
                    <Input type="number" label="Desconto" value={promotion.discount_value} onChange={(value) => setForm(updateList(form, "promotions", index, { discount_value: value }))} />
                    <Input type="date" label="Data inicial" value={promotion.start_date} onChange={(value) => setForm(updateList(form, "promotions", index, { start_date: value }))} />
                    <Input type="date" label="Data final" value={promotion.end_date} onChange={(value) => setForm(updateList(form, "promotions", index, { end_date: value }))} />
                    <Select label="Aplicar em" value={promotion.applies_to} onChange={(value) => setForm(updateList(form, "promotions", index, { applies_to: value }))}>
                      <option value="products">produtos específicos</option><option value="categories">categorias específicas</option><option value="all">todo catálogo</option>
                    </Select>
                    <Input label="IDs de produtos" value={promotion.product_ids} onChange={(value) => setForm(updateList(form, "promotions", index, { product_ids: value }))} />
                    <Input label="Categorias" value={promotion.category_ids} onChange={(value) => setForm(updateList(form, "promotions", index, { category_ids: value }))} />
                    <Toggle label="Promoção ativa" checked={promotion.is_active} onChange={(value) => setForm(updateList(form, "promotions", index, { is_active: value }))} />
                  </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "promotions", index))}>Remover promoção</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "exibicao" && (
          <CustomizationCard title="Configurações de exibição">
            <div className="toggle-grid">
              <Toggle label="Mostrar produtos sem estoque" checked={form.theme.show_out_of_stock} onChange={(value) => setForm(updateTheme(form, { show_out_of_stock: value }))} />
              <Toggle label="Mostrar quantidade em estoque" checked={form.theme.show_stock_quantity} onChange={(value) => setForm(updateTheme(form, { show_stock_quantity: value }))} />
              <Toggle label="Mostrar botão WhatsApp" checked={form.theme.show_whatsapp_button} onChange={(value) => setForm(updateTheme(form, { show_whatsapp_button: value }))} />
              <Toggle label="Mostrar botão Agendar" checked={form.theme.show_schedule_button} onChange={(value) => setForm(updateTheme(form, { show_schedule_button: value }))} />
              <Toggle label="Mostrar botão Comprar agora" checked={form.theme.show_buy_button} onChange={(value) => setForm(updateTheme(form, { show_buy_button: value }))} />
              <Toggle label="Mostrar favoritos" checked={form.theme.show_favorites} onChange={(value) => setForm(updateTheme(form, { show_favorites: value }))} />
            </div>
            <Select label="Texto de estoque" value={form.theme.stock_display_mode} onChange={(value) => setForm(updateTheme(form, { stock_display_mode: value }))}>
              <option value="status">Em estoque / Poucas unidades / Indisponível</option>
              <option value="quantity">Mostrar quantidade</option>
              <option value="hidden">Ocultar estoque</option>
            </Select>
          </CustomizationCard>
        )}

        {activeSection === "textos" && (
          <CustomizationCard title="Textos do catálogo">
            <div className="form-grid">
              <Input label="Título da página" value={form.settings.page_title} onChange={(value) => setForm(updateSettings(form, { page_title: value }))} />
              <Input label="Subtítulo" value={form.settings.subtitle} onChange={(value) => setForm(updateSettings(form, { subtitle: value }))} />
              <Input label="Mensagem indisponível" value={form.settings.unavailable_message} onChange={(value) => setForm(updateSettings(form, { unavailable_message: value }))} />
              <Input label="Mensagem poucas unidades" value={form.settings.low_stock_message} onChange={(value) => setForm(updateSettings(form, { low_stock_message: value }))} />
            </div>
            <label>Texto institucional
              <textarea value={form.settings.institutional_text} onChange={(event) => setForm(updateSettings(form, { institutional_text: event.target.value }))} />
            </label>
            <label>Texto do rodapé
              <textarea value={form.theme.footer_text} onChange={(event) => setForm(updateTheme(form, { footer_text: event.target.value }))} />
            </label>
          </CustomizationCard>
        )}

        {activeSection === "contato" && (
          <CustomizationCard title="Contato e Informações da Empresa">
            <p className="customization-help">Estes dados aparecem no rodapé do catálogo e nos botões de atendimento ao cliente.</p>
            <div className="form-grid">
              <Input label="WhatsApp com DDD" value={form.settings.whatsapp_phone} onChange={(value) => setForm(updateSettings(form, { whatsapp_phone: value }))} />
              <Input label="Instagram" value={form.settings.company_instagram} onChange={(value) => setForm(updateSettings(form, { company_instagram: value }))} />
              <Input type="email" label="E-mail" value={form.settings.company_email} onChange={(value) => setForm(updateSettings(form, { company_email: value }))} />
              <Input label="Horário de Atendimento" value={form.settings.company_hours} onChange={(value) => setForm(updateSettings(form, { company_hours: value }))} />
            </div>
            <label>Endereço
              <textarea value={form.settings.company_address} onChange={(event) => setForm(updateSettings(form, { company_address: event.target.value }))} placeholder="Rua, número, bairro, cidade e estado" />
            </label>
            <label>Mensagem Inicial do WhatsApp
              <textarea value={form.settings.whatsapp_message} onChange={(event) => setForm(updateSettings(form, { whatsapp_message: event.target.value }))} />
            </label>
          </CustomizationCard>
        )}

        {activeSection === "seo" && (
          <CustomizationCard title="SEO e compartilhamento">
            <div className="form-grid">
              <Input label="Título para Google" value={form.settings.seo_title} onChange={(value) => setForm(updateSettings(form, { seo_title: value }))} />
              <Input label="Descrição para Google" value={form.settings.seo_description} onChange={(value) => setForm(updateSettings(form, { seo_description: value }))} />
              <Input label="Texto padrão WhatsApp" value={form.settings.product_share_text} onChange={(value) => setForm(updateSettings(form, { product_share_text: value }))} />
              <ImageUploadField label="Imagem de compartilhamento" value={form.settings.share_image_url} onChange={(value) => setForm(updateSettings(form, { share_image_url: value }))} />
            </div>
          </CustomizationCard>
        )}

        {error && <span className="form-error">{error}</span>}
        {message && <span className="form-success">{message}</span>}
        <button className="primary-button customization-save" type="button" onClick={() => save()}>Salvar alterações</button>
      </div>

      <CatalogCustomizationPreview form={form} products={products} />
    </section>
  );
}

function CustomizationCard({ title, action, children }) {
  return (
    <article className="panel customization-card">
      <div className="panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </article>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-field">
      <input type="checkbox" checked={Boolean(Number(checked))} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function CatalogCustomizationPreview({ form, products }) {
  const theme = form.theme;
  const activeBanner = [...form.banners].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).find((banner) => Boolean(Number(banner.is_active))) || defaultCatalogBanner(1);
  const previewProducts = products.slice(0, 4);
  const style = {
    "--preview-primary": theme.primary_color,
    "--preview-secondary": theme.secondary_color,
    "--preview-bg": theme.background_color,
    "--preview-button": theme.button_color,
    fontFamily: theme.body_font
  };
  return (
    <aside className={`catalog-live-preview theme-${theme.theme}`} style={style}>
      <div className="preview-browser-bar">
        <span />
        <strong>Pré-visualização em tempo real</strong>
        <a href="/catalogo" target="_blank" rel="noreferrer">Abrir</a>
      </div>
      <div className="preview-storefront">
        <header>
          <div className="preview-brand">
            {theme.logo_url ? <img src={catalogImageUrl(theme.logo_url)} alt={theme.brand_name} /> : <strong>{theme.brand_name?.slice(0, 1) || "A"}</strong>}
            <span><b>{theme.brand_name}</b><small>{theme.slogan}</small></span>
          </div>
          {Boolean(Number(theme.show_favorites)) && <Heart size={18} />}
        </header>
        <section className="preview-banner" style={{ backgroundImage: `linear-gradient(90deg, rgba(255,255,255,.95), rgba(255,255,255,.48)), url(${catalogImageUrl(activeBanner.image_url)})`, minHeight: `${Number(activeBanner.banner_height || 340)}px`, maxWidth: activeBanner.banner_width ? `${Number(activeBanner.banner_width)}px` : "none", backgroundSize: activeBanner.banner_fit || "cover" }}>
          <h3 style={{ fontFamily: theme.title_font }}>{activeBanner.title}</h3>
          <p>{activeBanner.subtitle}</p>
          {activeBanner.button_text && <button>{activeBanner.button_text}</button>}
        </section>
        <div className="preview-categories">
          {form.featuredCategories.filter((item) => Boolean(Number(item.is_active))).slice(0, 6).map((category, index) => (
            <span key={`${category.public_name}-${index}`}>{category.public_name}</span>
          ))}
        </div>
        <section className="preview-products">
          {previewProducts.map((item) => (
            <article key={item.id}>
              <img src={catalogImageUrl(item.photo_url)} alt={item.name} />
              <strong>{item.name}</strong>
              <small>{item.material}</small>
              <span>{currency.format(item.sale_value || 0)}</span>
              {Boolean(Number(theme.show_schedule_button)) && <button>Agendar</button>}
            </article>
          ))}
        </section>
        <footer>{theme.footer_text}</footer>
      </div>
    </aside>
  );
}

function normalizeCatalogCustomization(data) {
  const settings = { ...defaultCatalogCustomization().settings, ...(data.settings || {}) };
  return {
    settings,
    theme: { ...defaultCatalogCustomization().theme, ...(data.theme || {}) },
    banners: (data.banners?.length ? data.banners : [defaultCatalogBanner(1)]).map((banner, index) => ({
      ...defaultCatalogBanner(index + 1),
      ...normalizeBooleanRecord(banner)
    })).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    contentSections: catalogContentSections(settings.content_sections),
    featuredCategories: (data.featuredCategories?.length ? data.featuredCategories : defaultCatalogCustomization().featuredCategories).map(normalizeBooleanRecord),
    featuredProducts: (data.featuredProducts || []).map(normalizeBooleanRecord),
    promotions: (data.promotions || []).map(normalizeBooleanRecord)
  };
}

function serializeCatalogCustomization(form) {
  return {
    ...form,
    settings: {
      ...form.settings,
      content_sections: JSON.stringify((form.contentSections || []).map((section, index) => ({
        ...section,
        order: Number(section.order || index + 1),
        active: Boolean(section.active)
      })))
    }
  };
}

function normalizeBooleanRecord(item) {
  return { ...item, is_active: Boolean(Number(item.is_active)) };
}

function updateTheme(form, patch) {
  return { ...form, theme: { ...form.theme, ...patch } };
}

function updateSettings(form, patch) {
  return { ...form, settings: { ...form.settings, ...patch } };
}

function updateList(form, key, index, patch) {
  return { ...form, [key]: form[key].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) };
}

function removeListItem(form, key, index) {
  return { ...form, [key]: form[key].filter((_, itemIndex) => itemIndex !== index) };
}

function moveListItem(list, index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item);
  return copy.map((entry, itemIndex) => ({ ...entry, sort_order: itemIndex + 1, order: itemIndex + 1 }));
}

function normalizeSortOrder(list, mode = "asc") {
  const sorted = [...list].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const arranged = mode === "desc" ? sorted.reverse() : sorted;
  return arranged.map((entry, index) => ({ ...entry, sort_order: index + 1 }));
}

function defaultCatalogBanner(order) {
  return {
    title: "Escolha a joia perfeita para você",
    subtitle: "Joias de alta qualidade para realçar sua essência.",
    image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    button_text: "Ver todas as joias",
    button_link: "#catalog-products",
    banner_width: 0,
    banner_height: 340,
    banner_fit: "cover",
    is_active: true,
    sort_order: order
  };
}

function defaultFeaturedCategory(order) {
  return { category_id: "", public_name: "Nova categoria", icon: "gem", image_url: "", is_active: true, sort_order: order };
}

function defaultFeaturedProduct() {
  return { product_id: "", badge: "", is_active: true, sort_order: 1 };
}

function defaultPromotion() {
  return {
    name: "Campanha Aura",
    discount_type: "percent",
    discount_value: 10,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    applies_to: "products",
    product_ids: "",
    category_ids: "",
    is_active: true
  };
}

function defaultContentSection(order) {
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

function defaultCatalogCustomization() {
  return {
    settings: {
      page_title: "Catálogo Online",
      title: "Escolha a joia perfeita para você",
      subtitle: "Curadoria premium da Aura Clinic Piercing",
      institutional_text: "Joias selecionadas com cuidado, segurança e estética premium.",
      unavailable_message: "Produto indisponível no momento.",
      low_stock_message: "Poucas unidades",
      footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.",
      seo_title: "Aura Clinic Piercing | Catálogo Online",
      seo_description: "Escolha joias premium para piercing na Aura Clinic.",
      share_image_url: "",
      product_share_text: "Olha essa joia da Aura Clinic:",
      content_sections: JSON.stringify([defaultContentSection(1)]),
      categories: `Todos,${JEWELRY_CATEGORY_OPTIONS.join(",")}`,
      whatsapp_phone: "",
      whatsapp_message: "Olá! Vim pelo catálogo online da Aura Clinic e quero ajuda para escolher uma joia.",
      company_instagram: "",
      company_email: "",
      company_address: "",
      company_hours: ""
    },
    theme: {
      brand_name: "Aura Clinic",
      slogan: "Piercing premium e joalherias selecionadas",
      logo_url: "",
      primary_color: "#C8A96A",
      secondary_color: "#D8C3A5",
      background_color: "#F8F5F0",
      button_color: "#C8A96A",
      title_font: "Georgia",
      body_font: "Inter",
      theme: "premium",
      show_out_of_stock: false,
      show_stock_quantity: false,
      stock_display_mode: "status",
      show_whatsapp_button: true,
      show_schedule_button: true,
      show_buy_button: false,
      show_favorites: true,
      footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado."
    },
    banners: [defaultCatalogBanner(1)],
    contentSections: [defaultContentSection(1)],
    featuredCategories: JEWELRY_CATEGORY_OPTIONS.map((name, index) => ({ category_id: name, public_name: name, icon: "gem", image_url: "", is_active: true, sort_order: index + 1 })),
    featuredProducts: [],
    promotions: []
  };
}

function ImageUploadField({ label, value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function uploadImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("file", file);
    const response = await apiFetch("/uploads", { method: "POST", body });
    const json = await response.json().catch(() => ({}));
    setUploading(false);
    if (!response.ok) return setError(json.error || "Não foi possível enviar a imagem.");
    onChange(json.url);
  }

  return (
    <label className="image-upload-field">{label}
      <div className="image-upload-preview">
        <img src={catalogImageUrl(value)} alt={label} />
        <span><ImageIcon size={18} /> Prévia da imagem</span>
      </div>
      <input value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder="Cole a URL da imagem ou envie um arquivo" />
      <input type="file" accept="image/*" onChange={uploadImage} />
      {uploading && <small>Enviando imagem...</small>}
      {error && <span className="form-error">{error}</span>}
    </label>
  );
}

function InventoryManagement({ options, professionals, onChanged }) {
  return (
    <div className="management-grid">
      <article className="manager-card">
        <h3>Categorias Principais</h3>
        <p className="manager-help">Estrutura fixa para evitar produtos duplicados e manter o catálogo organizado.</p>
        <div className="manager-list fixed-category-list">
          {JEWELRY_CATEGORY_OPTIONS.map((category) => <div key={category}><span>{category}</span></div>)}
        </div>
      </article>
      <OptionManager title="Tamanhos" type="size" items={options.size} onChanged={onChanged} placeholder="Ex.: 12mm" />
      <OptionManager title="Espessuras" type="thickness" items={options.thickness} onChanged={onChanged} placeholder="Ex.: 2.0mm" />
      <ProfessionalManager professionals={professionals} onChanged={onChanged} />
    </div>
  );
}

function OptionManager({ title, type, items = [], onChanged, placeholder }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/inventory-options${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name })
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar.");
    setName("");
    setEditing(null);
    onChanged();
  }

  async function remove(item) {
    setError("");
    const response = await apiFetch(`/inventory-options/${item.id}`, { method: "DELETE" });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível apagar.");
    onChanged();
  }

  return (
    <article className="manager-card">
      <h3>{title}</h3>
      <form onSubmit={save} className="inline-form">
        <input placeholder={placeholder} value={name} onChange={(event) => setName(event.target.value)} />
        <button>{editing ? "Salvar" : "Criar"}</button>
      </form>
      {error && <span className="form-error">{error}</span>}
      <div className="manager-list">
        {items.map((item) => (
          <div key={item.id}>
            <span>{item.name}</span>
            <button onClick={() => { setEditing(item); setName(item.name); }}>Editar</button>
            <button onClick={() => remove(item)}>Apagar</button>
          </div>
        ))}
      </div>
    </article>
  );
}

function ProfessionalManager({ professionals = [], onChanged }) {
  const [form, setForm] = useState({ name: "", specialty: "" });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/professionals${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar.");
    setForm({ name: "", specialty: "" });
    setEditing(null);
    onChanged();
  }

  async function remove(professional) {
    setError("");
    const response = await apiFetch(`/professionals/${professional.id}`, { method: "DELETE" });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível apagar.");
    onChanged();
  }

  return (
    <article className="manager-card professionals-manager">
      <h3>Profissionais</h3>
      <form onSubmit={save} className="inline-form professional-form">
        <input placeholder="Nome profissional" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input placeholder="Especialidade" value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} />
        <button>{editing ? "Salvar" : "Criar"}</button>
      </form>
      {error && <span className="form-error">{error}</span>}
      <div className="manager-list">
        {professionals.map((professional) => (
          <div key={professional.id}>
            <span>{professional.name}<small>{professional.specialty}</small></span>
            <button onClick={() => { setEditing(professional); setForm({ name: professional.name, specialty: professional.specialty || "" }); }}>Editar</button>
            <button onClick={() => remove(professional)}>Apagar</button>
          </div>
        ))}
      </div>
    </article>
  );
}

function JewelryTable({ items, onOpen, onEdit, onMovement, onArchive }) {
  return (
    <div className="table-wrap inventory-admin-table compact-inventory-table">
      <table>
        <thead><tr><th>Produto</th><th>Variações</th><th>Estoque Total</th><th>Status</th><th>Venda</th><th>Ações</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr className="clickable-product-row" key={item.id} onClick={() => onOpen?.(item)}>
            <td>
              <div className="inventory-product-cell">
                <img src={catalogImageUrl(item.photo_url)} alt={elegantProductName(item.name)} />
                <span><strong>{elegantProductName(item.name)}</strong><small>{[item.category, item.subcategory].map(cleanDisplayText).filter(Boolean).join(" · ")}</small></span>
              </div>
            </td>
            <td>{item.variant_count || item.variants?.length || 0}</td>
            <td>{item.quantity}</td>
            <td><span className={`inventory-status ${inventoryStatusClass(item)}`}>{inventoryStatusLabel(item)}</span></td>
            <td>A partir de {currency.format(item.sale_value || 0)}</td>
            <td>
              <div className="table-actions">
                {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Entrada"); }}>Entrada</button>}
                {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Saída"); }}>Saída</button>}
                <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(item); }}>Editar</button>
                {onArchive && <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(item); }}>Arquivar</button>}
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Finance() {
  const { data } = useFetch("/finance");
  if (!data) return <Loading />;
  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Recebido hoje" value={currency.format(data.totals.day_total || 0)} />
        <Metric label="Recebido na semana" value={currency.format(data.totals.week_total || 0)} />
        <Metric label="Recebido no mês" value={currency.format(data.totals.month_total || 0)} />
        <Metric label="Total previsto" value={currency.format(data.forecast.total || 0)} />
        <Metric label="Total pendente" value={currency.format(data.forecast.pending || 0)} />
        <Metric label="Pagamento mais usado" value={data.mostUsedMethod} />
      </div>
      <div className="panel">
        <div className="panel-heading">
          <h2>Relatório Financeiro</h2>
          <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.csv", "relatorio-aura-clinic.csv")}><Download size={16} /> Exportar CSV</button>
        </div>
        <div className="payment-bars">
          {data.methods.map((item) => <div key={item.method}><span>{item.method}</span><strong>{item.total}</strong></div>)}
        </div>
      </div>
    </section>
  );
}

function Clients() {
  const { data } = useFetch("/clients");
  if (!data) return <Loading />;
  return (
    <section className="client-grid">
      {data.map((client) => (
        <article className="panel client-card" key={client.id}>
          <h2>{client.full_name}</h2>
          <p>{client.whatsapp} · {client.instagram}</p>
          {client.birth_date && <small>Aniversário: {formatLongDate(client.birth_date)}</small>}
          <span>{client.notes}</span>
          <h3>Histórico</h3>
          {client.history.map((item) => <div className="history-item" key={item.id}><strong>{formatDate(item.appointment_date)}</strong><span>{item.procedure} · {item.jewelry_name || "sem joia"}</span><small>{item.status} · {currency.format(item.total_value)}</small></div>)}
        </article>
      ))}
    </section>
  );
}

function FinanceAdmin() {
  const { data, refresh } = useFetch("/finance");
  const [expense, setExpense] = useState(defaultExpense());
  const [error, setError] = useState("");
  if (!data) return <Loading />;

  async function saveExpense(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expense)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar a despesa.");
    setExpense(defaultExpense());
    refresh();
  }

  async function removeExpense(id) {
    await apiFetch(`/expenses/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Faturamento diário" value={currency.format(data.totals.day_total || 0)} />
        <Metric label="Faturamento semanal" value={currency.format(data.totals.week_total || 0)} />
        <Metric label="Faturamento mensal" value={currency.format(data.totals.month_total || 0)} />
        <Metric label="Sinais recebidos" value={currency.format(data.deposits.monthTotal || 0)} />
        <Metric label="Valores pendentes" value={currency.format(data.forecast.pending || 0)} />
        <Metric label="Lucro estimado" value={currency.format(data.profit.estimated || 0)} />
        <Metric label="Despesas fixas" value={currency.format(data.expensesSummary.fixed_total || 0)} />
        <Metric label="Despesas variáveis" value={currency.format(data.expensesSummary.variable_total || 0)} />
        <Metric label="Pagamento mais usado" value={data.mostUsedMethod} />
      </div>

      <div className="finance-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>Gráfico de faturamento mensal</h2>
            <span>Últimos meses registrados</span>
          </div>
          <MonthlyChart data={data.monthlyRevenue} />
        </div>
        <div className="panel">
          <div className="panel-heading">
            <h2>Formas de pagamento</h2>
            <span>Mais usadas</span>
          </div>
          <div className="payment-bars">
            {data.methods.map((item) => <div key={item.method}><span>{item.method}</span><strong>{item.total} · {currency.format(item.amount || 0)}</strong></div>)}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Relatórios exportáveis</h2>
          <div className="export-actions">
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.pdf", "relatorio-Financeiro-aura.pdf")}><Download size={16} /> PDF</button>
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.xlsx", "relatorio-Financeiro-aura.xlsx")}><Download size={16} /> Excel</button>
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.csv", "relatorio-aura-clinic.csv")}><Download size={16} /> CSV</button>
          </div>
        </div>
      </div>

      <div className="split-layout">
        <form className="panel appointment-form" onSubmit={saveExpense}>
          <div className="panel-heading">
            <h2>Nova despesa</h2>
            <span>Fixa ou variável</span>
          </div>
          <div className="form-grid">
            <Input label="Descrição" value={expense.description} onChange={(value) => setExpense({ ...expense, description: value })} required />
            <Select label="Tipo" value={expense.expense_type} onChange={(value) => setExpense({ ...expense, expense_type: value })}>
              <option value="fixa">fixa</option>
              <option value="variavel">variável</option>
            </Select>
            <Input label="Categoria" value={expense.category} onChange={(value) => setExpense({ ...expense, category: value })} />
            <Input type="number" label="Valor" value={expense.amount} onChange={(value) => setExpense({ ...expense, amount: value })} required />
            <Input type="date" label="Vencimento" value={expense.due_date} onChange={(value) => setExpense({ ...expense, due_date: value })} required />
            <Select label="Status" value={expense.status} onChange={(value) => setExpense({ ...expense, status: value })}>
              <option value="paga">paga</option>
              <option value="pendente">pendente</option>
            </Select>
            <PaymentSelect label="Forma de pagamento" value={expense.payment_method} onChange={(value) => setExpense({ ...expense, payment_method: value })} />
          </div>
          <label>Observações
            <textarea value={expense.notes} onChange={(event) => setExpense({ ...expense, notes: event.target.value })} />
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button">Salvar despesa</button>
        </form>

        <div className="panel">
          <div className="panel-heading">
            <h2>Despesas lançadas</h2>
            <span>{currency.format(data.expensesSummary.total || 0)} no mês</span>
          </div>
          <div className="expense-list">
            {data.expenses.map((item) => (
              <article key={item.id} className="expense-row">
                <div>
                  <strong>{item.description}</strong>
                  <span>{item.expense_type} · {item.category || "sem categoria"} · {formatDate(item.due_date)}</span>
                </div>
                <strong>{currency.format(item.amount)}</strong>
                <span className={`status-badge ${item.status === "paga" ? "status-atendido" : "status-pendente"}`}>{item.status}</span>
                <button onClick={() => removeExpense(item.id)}>Apagar</button>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SalesWorkspace() {
  const { data: orders, refresh: refreshOrders } = useFetch("/sales-orders");
  const { data: services } = useFetch("/services");
  const { data: jewelry } = useFetch("/jewelry");
  const { data: appointments } = useFetch("/appointments");
  const [tab, setTab] = useState("produto");
  const [form, setForm] = useState(defaultSalesOrderForm());
  const [line, setLine] = useState(defaultSalesLine());
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setLine((current) => ({ ...current, item_type: tab === "servico" ? "servico" : "produto" }));
  }, [tab]);

  useEffect(() => {
    if (jewelry?.length && tab !== "servico" && !line.product_id) {
      setLine((current) => ({ ...current, product_id: String(jewelry[0].id), item_name: jewelry[0].name, unit_price: jewelry[0].sale_value || 0 }));
    }
  }, [jewelry?.length]);

  useEffect(() => {
    if (services?.length && (tab === "servico" || tab === "ordem")) {
      setLine((current) => ({ ...current, service_id: String(services[0].id), item_name: services[0].name, unit_price: services[0].price || 0 }));
    }
  }, [services?.length, tab]);

  if (!orders || !services || !jewelry || !appointments) return <Loading />;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthOrders = orders.filter((order) => String(order.created_at || "").startsWith(currentMonth) && order.status !== "cancelada");
  const summary = {
    total: monthOrders.reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    products: monthOrders.filter((order) => order.order_type === "produto").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    services: monthOrders.filter((order) => order.order_type === "servico").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    mixed: monthOrders.filter((order) => order.order_type === "ordem_servico").reduce((sum, order) => sum + Number(order.total_value || 0), 0)
  };

  function addLineItem() {
    const quantity = Math.max(1, Number(line.quantity || 1));
    const entry = line.item_type === "servico" ?
       services.find((item) => String(item.id) === String(line.service_id))
      : jewelry.find((item) => String(item.id) === String(line.product_id));
    if (!entry) return;
    setItems((current) => [...current, {
      item_type: line.item_type,
      product_id: line.item_type === "produto" ? Number(entry.id) : null,
      service_id: line.item_type === "servico" ? Number(entry.id) : null,
      item_name: entry.name,
      quantity,
      unit_price: Number(line.unit_price || entry.sale_value || entry.price || 0),
      notes: line.notes || ""
    }]);
    setLine((current) => ({ ...current, quantity: 1, notes: "" }));
  }

  function removeLine(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveOrder(event) {
    event.preventDefault();
    setError("");
    if (!items.length) {
      setError("Adicione ao menos um item à venda.");
      return;
    }
    const response = await apiFetch("/sales-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        order_type: tab === "ordem" ? "ordem_servico" : tab,
        source: "interno",
        items
      })
    });
    if (!response.ok) {
      setError((await response.json()).error || "Não foi possível salvar a venda.");
      return;
    }
    setForm(defaultSalesOrderForm());
    setItems([]);
    setLine(defaultSalesLine());
    setTab("produto");
    refreshOrders();
  }

  async function updateStatus(id, status) {
    await apiFetch(`/sales-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    refreshOrders();
  }

  return (
    <section className="sales-page stack">
      <div className="metric-grid">
        <Metric label="Vendas no mês" value={currency.format(summary.total)} />
        <Metric label="Produtos" value={currency.format(summary.products)} />
        <Metric label="Serviços" value={currency.format(summary.services)} />
        <Metric label="Ordens de serviço" value={currency.format(summary.mixed)} />
      </div>

      <div className="customization-tabs sales-tabs">
        {[
          ["produto", "Venda de produto"],
          ["servico", "Venda de serviço"],
          ["ordem", "Ordem de serviço"],
          ["historico", "Histórico"]
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab !== "historico" && (
        <div className="split-layout">
          <form className="panel appointment-form" onSubmit={saveOrder}>
            <div className="panel-heading">
              <h2>{tab === "ordem" ? "Nova ordem de serviço" : tab === "servico" ? "Venda de serviço" : "Venda de produto"}</h2>
              <span>Cadastro interno com baixa financeira</span>
            </div>
            <div className="form-grid">
              <Input label="Cliente" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              <Select label="Agendamento vinculado" value={form.appointment_id} onChange={(value) => setForm({ ...form, appointment_id: value })}>
                <option value="">Sem vínculo</option>
                {appointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.full_name} · {formatDate(appointment.appointment_date)} · {appointment.appointment_time}
                  </option>
                ))}
              </Select>
              <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
                <option>Pix</option>
                <option>Dinheiro</option>
                <option>Cartão de crédito</option>
                <option>Cartão de débito</option>
              </Select>
              <Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
                <option value="concluida">concluída</option>
                <option value="aberta">aberta</option>
                <option value="cancelada">cancelada</option>
              </Select>
            </div>

            <div className="sales-line-builder">
              <div className="sales-line-header">
                <strong>{tab === "servico" ? "Selecionar serviço" : "Selecionar joia"}</strong>
                <span>Adicione os itens da venda.</span>
              </div>
              <div className="form-grid">
                <Select label="Tipo do item" value={line.item_type} onChange={(value) => setLine({ ...line, item_type: value })}>
                  <option value="produto">produto</option>
                  <option value="servico">serviço</option>
                </Select>
                {line.item_type === "servico" ? (
                  <Select label="Serviço" value={line.service_id} onChange={(value) => {
                    const selected = services.find((item) => String(item.id) === String(value));
                    setLine({
                      ...line,
                      service_id: value,
                      item_name: selected?.name || "",
                      unit_price: selected?.price || 0
                    });
                  }}>
                    {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </Select>
                ) : (
                  <Select label="Joia" value={line.product_id} onChange={(value) => {
                    const selected = jewelry.find((item) => String(item.id) === String(value));
                    setLine({
                      ...line,
                      product_id: value,
                      item_name: selected?.name || "",
                      unit_price: selected?.sale_value || 0
                    });
                  }}>
                    {jewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                )}
                <Input type="number" label="Quantidade" value={line.quantity} onChange={(value) => setLine({ ...line, quantity: value })} />
                <Input type="number" label="Valor unitário" value={line.unit_price} onChange={(value) => setLine({ ...line, unit_price: value })} />
              </div>
              <label>Observações do item
                <textarea value={line.notes} onChange={(event) => setLine({ ...line, notes: event.target.value })} />
              </label>
              <button className="secondary-button" type="button" onClick={addLineItem}>Adicionar item</button>
            </div>

            <div className="sales-items-list">
              {items.length ? items.map((item, index) => (
                <article key={`${item.item_name}-${index}`}>
                  <div>
                    <strong>{item.item_name}</strong>
                    <span>{saleItemLabel(item.item_type)} · {item.quantity}x · {currency.format(item.unit_price)}</span>
                    {item.notes && <small>{item.notes}</small>}
                  </div>
                  <button type="button" onClick={() => removeLine(index)}>Remover</button>
                </article>
              )) : <p className="empty-state">Nenhum item adicionado ainda.</p>}
            </div>

            <label>Observações da venda
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
            {error && <span className="form-error">{error}</span>}
            <button className="primary-button">Salvar venda</button>
          </form>

          <div className="panel">
            <div className="panel-heading">
              <h2>Atalhos e referência</h2>
              <span>{appointments.length} agendamentos disponíveis</span>
            </div>
            <div className="sales-quick-reference">
              <div>
                <strong>Produtos</strong>
                <small>Venda direta de joia, com baixa simples de estoque.</small>
              </div>
              <div>
                <strong>Serviços</strong>
                <small>Venda de procedimento avulso, sem depender de agenda.</small>
              </div>
              <div>
                <strong>Ordens de serviço</strong>
                <small>Registro interno com vínculo ao atendimento ou cliente.</small>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "historico" && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Histórico de vendas</h2>
            <span>Pedidos do mês com status e valor</span>
          </div>
          <div className="sales-history-list">
            {orders.map((order) => (
              <article key={order.id} className="sales-history-row">
                <div>
                  <strong>{order.full_name}</strong>
                  <span>{saleOrderTypeLabel(order.order_type)} · {order.source} · {formatDate(order.created_at.slice(0, 10))}</span>
                  <small>{order.items.map((item) => `${item.quantity}x ${item.item_name}`).join(" · ")}</small>
                </div>
                <div className="sales-history-money">
                  <strong>{currency.format(order.total_value || 0)}</strong>
                  <span>{order.payment_method || "Pix"}</span>
                </div>
                <div className="sales-history-actions">
                  <span className={`status-badge ${order.status === "cancelada" ? "status-cancelado" : order.status === "aberta" ? "status-pendente" : "status-atendido"}`}>{order.status}</span>
                  <button type="button" onClick={() => updateStatus(order.id, "concluida")}>Concluir</button>
                  <button type="button" onClick={() => updateStatus(order.id, "cancelada")}>Cancelar</button>
                </div>
              </article>
            ))}
            {!orders.length && <p className="empty-state">Nenhuma venda registrada ainda.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function AccessAdmin() {
  const { data, refresh } = useFetch("/users");
  const [form, setForm] = useState(defaultAccessUser());
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  if (!data) return <Loading />;

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/users${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar o usuário.");
    setForm(defaultAccessUser());
    setEditing(null);
    refresh();
  }

  async function remove(user) {
    await apiFetch(`/users/${user.id}`, { method: "DELETE" });
    refresh();
  }

  async function resetDemoData() {
    setResetLoading(true);
    setResetMessage("");
    const response = await apiFetch("/admin/reset-demo-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: resetConfirmation })
    });
    const payload = await response.json().catch(() => ({}));
    setResetLoading(false);
    if (!response.ok) {
      setResetMessage(payload.error || "Não foi possível limpar os dados.");
      return;
    }
    setResetConfirmation("");
    setResetMessage(payload.message || "Dados de demonstração removidos.");
  }

  return (
    <section className="stack">
      <div className="split-layout">
        <form className="panel appointment-form" onSubmit={save}>
          <div className="panel-heading">
            <h2>{editing ? "Editar Acesso" : "Novo Acesso"}</h2>
            <span>Níveis administrativos</span>
          </div>
          <div className="form-grid">
            <Input label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Input label="E-mail" value={form.email} onChange={(value) => setForm({ ...form, email: value })} required />
            <Input type="password" label={editing ? "Nova Senha Opcional" : "Senha"} value={form.password} onChange={(value) => setForm({ ...form, password: value })} required={!editing} />
            <Select label="Nível de Acesso" value={form.role} onChange={(value) => setForm({ ...form, role: value })}>
              <option value="admin">Administrador Geral</option>
              <option value="piercer">Body Piercer</option>
              <option value="reception">Recepção</option>
              <option value="finance">Financeiro</option>
            </Select>
          </div>
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button">{editing ? "Salvar Alterações" : "Criar Usuário"}</button>
        </form>
        <div className="panel">
          <div className="panel-heading">
            <h2>Usuários</h2>
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/backup.sqlite", `backup-aura-clinic.sqlite`)}>Backup SQLite</button>
          </div>
          <div className="access-list">
            {data.map((user) => (
              <article className="access-row" key={user.id}>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email} · {roleLabel(user.role)}</span>
                </div>
                <button onClick={() => { setEditing(user); setForm({ name: user.name, email: user.email, role: user.role, password: "" }); }}>Editar</button>
                <button onClick={() => remove(user)}>Apagar</button>
              </article>
            ))}
          </div>
        </div>
      </div>

      <article className="panel admin-reset-panel">
        <div>
          <span className="eyebrow">Preparação para Uso Real</span>
          <h2>Limpar Dados de Demonstração</h2>
          <p>Remove clientes, produtos, variações, agendamentos, vendas, despesas e lançamentos financeiros. Usuários, categorias e configurações permanecem.</p>
        </div>
        <div className="admin-reset-action">
          <Input label="Digite RESETAR para confirmar" value={resetConfirmation} onChange={setResetConfirmation} />
          <button
            type="button"
            className="danger-button"
            disabled={resetConfirmation !== "RESETAR" || resetLoading}
            onClick={resetDemoData}
          >
            {resetLoading ? "Limpando..." : "Limpar Dados Fictícios"}
          </button>
        </div>
        {resetMessage && <span className="admin-reset-message">{resetMessage}</span>}
      </article>
    </section>
  );
}

function BookingAdmin() {
  const { data: services, refresh: refreshServices } = useFetch("/services");
  const { data: options } = useFetch("/options");
  const { data: availability, refresh: refreshAvailability } = useFetch("/availability");
  const { data: blocks, refresh: refreshBlocks } = useFetch("/schedule-blocks");
  const { data: appointments, refresh: refreshAppointments } = useFetch("/appointments?status=pendente");
  const [tab, setTab] = useState("servicos");
  const [serviceForm, setServiceForm] = useState(defaultServiceForm());
  const [blockForm, setBlockForm] = useState(defaultScheduleBlock());
  const professionals = options?.professionals || [];

  if (!services || !availability || !blocks || !appointments) return <Loading />;

  async function saveService(event) {
    event.preventDefault();
    await apiFetch("/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serviceForm)
    });
    setServiceForm(defaultServiceForm());
    refreshServices();
  }

  async function updateAvailability(item, patch) {
    await apiFetch(`/availability/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, ...patch })
    });
    refreshAvailability();
  }

  async function saveBlock(event) {
    event.preventDefault();
    await apiFetch("/schedule-blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blockForm)
    });
    setBlockForm(defaultScheduleBlock());
    refreshBlocks();
  }

  async function updateRequest(id, status) {
    await updateAppointment(id, { status }, refreshAppointments);
  }

  return (
    <section className="booking-admin-page">
      <header className="availability-header">
        <div>
          <span className="eyebrow">Agendamento online</span>
          <h2>Disponibilidade</h2>
          <p>Configure serviços, horários, bloqueios e solicitações vindas do link público.</p>
        </div>
        <a className="primary-button" href="/agendar" target="_blank" rel="noreferrer">Abrir link público</a>
      </header>
      <nav className="customization-tabs">
        {[
          ["servicos", "Serviços"],
          ["horarios", "Disponibilidade"],
          ["bloqueios", "Bloqueios"],
          ["solicitacoes", "Solicitações pendentes"]
        ].map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

      {tab === "servicos" && (
        <div className="booking-admin-grid">
          <form className="panel" onSubmit={saveService}>
            <div className="panel-heading"><h2>Novo serviço</h2><span>Disponível no link público</span></div>
            <div className="form-grid">
              <Input label="Nome" value={serviceForm.name} onChange={(value) => setServiceForm({ ...serviceForm, name: value })} required />
              <Input type="number" label="Duração em minutos" value={serviceForm.duration_minutes} onChange={(value) => setServiceForm({ ...serviceForm, duration_minutes: value })} />
              <Input type="number" label="Valor" value={serviceForm.price} onChange={(value) => setServiceForm({ ...serviceForm, price: value })} />
              <Input type="number" label="Valor do sinal" value={serviceForm.deposit_value} onChange={(value) => setServiceForm({ ...serviceForm, deposit_value: value })} />
            </div>
            <label>Descrição<textarea value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} /></label>
            <label>Observações pré-atendimento<textarea value={serviceForm.pre_service_notes} onChange={(event) => setServiceForm({ ...serviceForm, pre_service_notes: event.target.value })} /></label>
            <Toggle label="Ativo no agendamento online" checked={serviceForm.active_online_booking} onChange={(value) => setServiceForm({ ...serviceForm, active_online_booking: value })} />
            <button className="primary-button">Salvar serviço</button>
          </form>
          <div className="panel">
            <div className="panel-heading"><h2>Serviços cadastrados</h2></div>
            <div className="service-list">
              {services.map((service) => (
                <article key={service.id}>
                  <strong>{service.name}</strong>
                  <span>{service.duration_minutes} min · {currency.format(service.price || 0)} · sinal {currency.format(service.deposit_value || 0)}</span>
                  <small>{service.active_online_booking ? "Ativo online" : "Inativo online"}</small>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "horarios" && (
        <div className="availability-grid">
          {availability.map((item) => (
            <article className="panel availability-card" key={item.id}>
              <div className="panel-heading"><h2>{weekdayLabel(item.weekday)}</h2><span>{item.professional_name}</span></div>
              <Toggle label="Atende neste dia" checked={item.is_active} onChange={(value) => updateAvailability(item, { is_active: value })} />
              <div className="form-grid">
                <Input label="Início" value={item.start_time} onChange={(value) => updateAvailability(item, { start_time: value })} />
                <Input label="Final" value={item.end_time} onChange={(value) => updateAvailability(item, { end_time: value })} />
                <Input label="Almoço início" value={item.lunch_start || ""} onChange={(value) => updateAvailability(item, { lunch_start: value })} />
                <Input label="Almoço final" value={item.lunch_end || ""} onChange={(value) => updateAvailability(item, { lunch_end: value })} />
                <Input type="number" label="Duração padrão" value={item.duration_minutes} onChange={(value) => updateAvailability(item, { duration_minutes: value })} />
                <Input type="number" label="Intervalo" value={item.buffer_minutes} onChange={(value) => updateAvailability(item, { buffer_minutes: value })} />
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === "bloqueios" && (
        <div className="booking-admin-grid">
          <form className="panel" onSubmit={saveBlock}>
            <div className="panel-heading"><h2>Novo bloqueio</h2><span>Não aparece para o cliente</span></div>
            <div className="form-grid">
              <Select label="Profissional" value={blockForm.professional_id} onChange={(value) => setBlockForm({ ...blockForm, professional_id: value })}>
                <option value="">Selecione</option>
                {professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
              </Select>
              <Input label="Motivo" value={blockForm.reason} onChange={(value) => setBlockForm({ ...blockForm, reason: value })} />
              <Input type="datetime-local" label="Início" value={blockForm.start_datetime} onChange={(value) => setBlockForm({ ...blockForm, start_datetime: value })} />
              <Input type="datetime-local" label="Final" value={blockForm.end_datetime} onChange={(value) => setBlockForm({ ...blockForm, end_datetime: value })} />
            </div>
            <Toggle label="Dia inteiro" checked={blockForm.is_full_day} onChange={(value) => setBlockForm({ ...blockForm, is_full_day: value })} />
            <Toggle label="Recorrente" checked={blockForm.is_recurring} onChange={(value) => setBlockForm({ ...blockForm, is_recurring: value })} />
            <label>Observação<textarea value={blockForm.notes} onChange={(event) => setBlockForm({ ...blockForm, notes: event.target.value })} /></label>
            <button className="primary-button">Salvar bloqueio</button>
          </form>
          <div className="panel">
            <div className="panel-heading"><h2>Bloqueios cadastrados</h2></div>
            <div className="service-list">
              {blocks.map((block) => (
                <article key={block.id}>
                  <strong>{block.reason}</strong>
                  <span>{block.professional_name} · {new Date(block.start_datetime).toLocaleString("pt-BR")} até {new Date(block.end_datetime).toLocaleString("pt-BR")}</span>
                  <button className="danger-link" onClick={async () => { await apiFetch(`/schedule-blocks/${block.id}`, { method: "DELETE" }); refreshBlocks(); }}>Apagar</button>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "solicitacoes" && (
        <div className="panel">
          <div className="panel-heading"><h2>Solicitações pendentes</h2><span>Confirme ou recuse manualmente</span></div>
          <div className="appointment-list">
            {appointments.map((item) => (
              <article className="appointment-row" key={item.id}>
                <div className="time-box"><strong>{item.appointment_time}</strong><span>{formatDate(item.appointment_date)}</span></div>
                <div><h3>{item.full_name}</h3><p>{item.procedure} · {currency.format(item.deposit_value || 0)} de sinal</p><small>{item.professional_name} · {item.whatsapp}</small></div>
                <div className="row-actions">
                  <button onClick={() => updateRequest(item.id, "confirmado")}>Confirmar</button>
                  <button onClick={() => updateRequest(item.id, "recusado")}>Recusar</button>
                </div>
              </article>
            ))}
            {!appointments.length && <p className="empty-state">Nenhuma solicitação pendente.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function ClientsMedical() {
  const { data, refresh } = useFetch("/clients");
  const [search, setSearch] = useState("");
  const [editingClientId, setEditingClientId] = useState(null);
  if (!data) return <Loading />;
  const filteredClients = data.filter((client) => matchesClientSearch(client, search));
  return (
    <section className="medical-client-list simplified-client-list">
      <label className="client-search">
        <Search size={17} />
        <input placeholder="Pesquisar cliente, WhatsApp ou Instagram" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {filteredClients.map((client) => (
        <article className="panel medical-card simplified-client-card" key={client.id}>
          <div className="medical-header compact">
            <div>
              <h2>{client.full_name}</h2>
              <p>{client.whatsapp} · {client.instagram || "sem Instagram"}</p>
            </div>
            <div className="header-actions">
              <span className="status-badge status-atendido">{client.history.length} atendimento(s)</span>
              <a className="secondary-button" href={whatsappUrl(client.whatsapp, `Ola ${client.full_name}, tudo bem Aqui e da Aura Clinic.`)} target="_blank" rel="noreferrer">WhatsApp</a>
              <button type="button" className="secondary-button" onClick={() => setEditingClientId(editingClientId === client.id ? null : client.id)}>Editar</button>
            </div>
          </div>
          {client.birth_date && <small className="client-birth">Aniversário: {formatLongDate(client.birth_date)}</small>}
          {editingClientId === client.id && (
            <ClientEditForm
              client={client}
              onCancel={() => setEditingClientId(null)}
              onSaved={() => {
                setEditingClientId(null);
                refresh();
              }}
            />
          )}
          <div className="medical-summary-line">
            <span>Último atendimento: {client.history[0] ? formatDate(client.history[0].appointment_date) : "Sem registro"}</span>
            <span>Joia: {client.history[0]?.jewelry_name || "Sem joia vinculada"}</span>
            <span>Fidelidade: {client.loyalty?.level || "Cliente Aura"}</span>
          </div>
          <details className="medical-details">
            <summary>Ver prontuário, fidelidade e retornos</summary>
            <div className="medical-grid stacked">
              <div className="medical-section">
                <h3>Histórico De Perfurações</h3>
                <div className="history-stack">
                  {client.history.length ? client.history.map((item) => (
                    <div className="history-item" key={item.id}>
                      <strong>{formatDate(item.appointment_date)}  {item.procedure}</strong>
                      <span>{item.piercing_region}  {item.professional_name}</span>
                      <small>Joia: {item.jewelry_name || "sem joia vinculada"}  {item.status}</small>
                    </div>
                  )) : <p className="empty-state">Nenhuma perfuração registrada.</p>}
                </div>
              </div>
              <MedicalRecordForm client={client} onSaved={refresh} />
              <LoyaltyPanel client={client} onChanged={refresh} />
              <MedicalRecordTimeline client={client} onChanged={refresh} />
            </div>
          </details>
        </article>
      ))}
      {!filteredClients.length && <p className="empty-state">Nenhum cliente encontrado.</p>}
    </section>
  );
}

function ClientEditForm({ client, onSaved, onCancel }) {
  const [form, setForm] = useState({
    full_name: client.full_name || "",
    whatsapp: client.whatsapp || "",
    instagram: client.instagram || "",
    birth_date: client.birth_date || "",
    notes: client.notes || ""
  });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar o cliente.");
    onSaved();
  }

  return (
    <form className="client-edit-form" onSubmit={submit}>
      <div className="form-grid">
        <Input label="Nome" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
        <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} />
        <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
        <Input type="date" label="Nascimento" value={form.birth_date} onChange={(value) => setForm({ ...form, birth_date: value })} />
      </div>
      <label>Observacoes importantes
        <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      </label>
      {error && <span className="form-error">{error}</span>}
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>
        <button className="primary-button">Salvar cliente</button>
      </div>
    </form>
  );
}

function DigitalTerms() {
  const { data: appointments } = useFetch("/appointments");
  const { data: terms, refresh } = useFetch("/digital-terms");
  const [form, setForm] = useState(defaultDigitalTerm());
  const [error, setError] = useState("");
  const [savedTerm, setSavedTerm] = useState(null);

  const selectedAppointment = (appointments || []).find((item) => String(item.id) === String(form.appointment_id));

  useEffect(() => {
    if (!selectedAppointment) return;
    setForm((current) => ({
      ...current,
      client_id: selectedAppointment.client_id,
      full_name: current.full_name || selectedAppointment.full_name,
      whatsapp: current.whatsapp || selectedAppointment.whatsapp,
      instagram: current.instagram || selectedAppointment.instagram || "",
      procedure: current.procedure || selectedAppointment.procedure,
      piercing_region: current.piercing_region || selectedAppointment.piercing_region,
      address: current.address || selectedAppointment.address || ""
    }));
  }, [selectedAppointment?.id]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFormData(group, field, value) {
    setForm((current) => ({
      ...current,
      form_data: {
        ...current.form_data,
        [group]: {
          ...current.form_data[group],
          [field]: value
        }
      }
    }));
  }

  function toggleHealthItem(key) {
    updateFormData("health_history", key, !form.form_data.health_history[key]);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSavedTerm(null);
    if (!form.signature_data_url) return setError("Assinatura digital obrigatória.");
    const response = await apiFetch(`/digital-terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Não foi possível salvar o termo.");
    setSavedTerm(data);
    setForm(defaultDigitalTerm());
    refresh();
  }

  return (
    <section className="terms-layout terms-anamnesis-layout">
      <form className="panel term-form" onSubmit={submit}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Termos Digitais</span>
            <h2>Ficha De Anamnese</h2>
          </div>
          <span>{appointments?.length || 0} agendamento(s)</span>
        </div>

        <div className="term-intro">
          <strong>Estrutura clínica fiel ao documento físico.</strong>
          <p>Dados pessoais, histórico de saúde, estilo de vida, consentimento, autorização para menores e assinatura digital.</p>
        </div>

        <div className="term-chip-row">
          <span>Dados Pessoais</span>
          <span>Histórico De Saúde</span>
          <span>Estilo De Vida</span>
          <span>Consentimento</span>
          <span>Assinatura Digital</span>
        </div>

        <section className="term-section">
          <h3>Agendamento Vinculado</h3>
          <Select label="Agendamento" value={form.appointment_id} onChange={(value) => updateField("appointment_id", value)} required>
            <option value="">Selecione</option>
            {(appointments || []).map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)}  {item.appointment_time}  {item.full_name}  {item.procedure}</option>)}
          </Select>
        </section>

        <section className="term-section">
          <h3>Dados Pessoais</h3>
          <div className="form-grid">
            <Input label="Nome Completo" value={form.full_name} onChange={(value) => updateField("full_name", value)} required />
            <Input label="Nome Social" value={form.social_name} onChange={(value) => updateField("social_name", value)} />
            <Input label="CPF / RG" value={form.document_number} onChange={(value) => updateField("document_number", value)} />
            <Input type="date" label="Data De Nascimento" value={form.birth_date} onChange={(value) => updateField("birth_date", value)} />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => updateField("whatsapp", value)} />
            <Input label="Instagram" value={form.instagram} onChange={(value) => updateField("instagram", value)} />
          </div>
          <Input label="Endereço" value={form.address} onChange={(value) => updateField("address", value)} />
        </section>

        <section className="term-section">
          <h3>Histórico De Saúde</h3>
          <div className="term-check-grid">
            {DIGITAL_TERM_HEALTH_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`term-check-item ${form.form_data.health_history[item.key] ? "active" : ""}`}
                onClick={() => toggleHealthItem(item.key)}
              >
                <span>{form.form_data.health_history[item.key] ? "Sim" : "Não"}</span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="term-section">
          <h3>Estilo De Vida</h3>
          <div className="term-lifestyle-grid">
            {DIGITAL_TERM_LIFESTYLE_ITEMS.map((item) => (
              <label key={item.key} className="term-choice">
                {item.label}
                <select value={form.form_data.lifestyle[item.key]} onChange={(event) => updateFormData("lifestyle", item.key, event.target.value)}>
                  <option value="">Não Informado</option>
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                  <option value="Às Vezes">Às Vezes</option>
                  {item.key === "blood_pressure" && <option value="Normal">Normal</option>}
                  {item.key === "blood_pressure" && <option value="Alterada">Alterada</option>}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="term-section">
          <h3>Informações do Atendimento</h3>
          <div className="form-grid">
            <Input label="Procedimento" value={form.procedure} onChange={(value) => updateField("procedure", value)} />
            <Input label="Região da Perfuração" value={form.piercing_region} onChange={(value) => updateField("piercing_region", value)} />
            <Input label="Local da Aplicação" value={form.form_data.information.application_location} onChange={(value) => updateFormData("information", "application_location", value)} />
            <Input label="Joia" value={form.form_data.information.jewelry} onChange={(value) => updateFormData("information", "jewelry", value)} />
            <Input label="Valor" value={form.form_data.information.value} onChange={(value) => updateFormData("information", "value", value)} />
          </div>
          <label className="term-notes">
            Observação
            <textarea
              value={form.form_data.information.observation}
              onChange={(event) => updateFormData("information", "observation", event.target.value)}
              placeholder="Alergias, medicamentos, gestação, queloide, observações clínicas ou qualquer detalhe importante."
            />
          </label>
          <label className="term-notes">
            Declaração de Saúde e Observações
            <textarea
              value={form.health_declaration}
              onChange={(event) => updateField("health_declaration", event.target.value)}
              placeholder="Texto complementar livre, se necessário."
            />
          </label>
        </section>

        <section className="term-section term-consent-section">
          <label className="checkbox-line">
            <input type="checkbox" checked={form.orientations_confirmed} onChange={(event) => updateField("orientations_confirmed", event.target.checked)} />
            Confirmo que recebi orientações sobre cuidados, higienização, riscos, cicatrização e retornos.
          </label>
          <p>Declaro que recebi todas as informações referentes ao procedimento e que os materiais utilizados são devidamente esterilizados, lacrados e descartados após o atendimento.</p>
        </section>

        <section className="term-section">
          <div className="term-section-heading">
          <h3>Autorização para Menores</h3>
            <label className="checkbox-line compact">
              <input
                type="checkbox"
                checked={form.form_data.minor.is_minor}
                onChange={(event) => updateFormData("minor", "is_minor", event.target.checked)}
              />
              Cliente Menor De Idade
            </label>
          </div>
          {form.form_data.minor.is_minor && (
            <div className="form-grid">
              <Input label="Nome do Responsável" value={form.form_data.minor.responsible_name} onChange={(value) => updateFormData("minor", "responsible_name", value)} />
              <Input label="Documento Do Responsável" value={form.form_data.minor.responsible_document} onChange={(value) => updateFormData("minor", "responsible_document", value)} />
              <Input label="Nome Do Menor" value={form.form_data.minor.minor_name} onChange={(value) => updateFormData("minor", "minor_name", value)} />
            </div>
          )}
        </section>

        <SignaturePad onChange={(signature) => updateField("signature_data_url", signature)} clearKey={form.appointment_id || "empty"} />
        {error && <span className="form-error">{error}</span>}
        <div className="modal-actions">
          {savedTerm?.pdf_url && <a className="secondary-button" href={`${API_ORIGIN}${savedTerm.pdf_url}`} target="_blank" rel="noreferrer"><Download size={16} /> Abrir PDF Salvo</a>}
          <button className="primary-button">Salvar Termo Em PDF</button>
        </div>
      </form>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Registro</span>
            <h2>Termos Salvos</h2>
          </div>
          <span>{terms?.length || 0} registro(s)</span>
        </div>
        <div className="terms-list">
          {(terms || []).map((term) => (
            <article className="term-row" key={term.id}>
              <div>
                <strong>{term.full_name}</strong>
                <span>{formatDate(term.appointment_date)}  {term.appointment_time}  {term.procedure}</span>
                <small>{term.professional_name}  assinado em {new Date(term.signed_at).toLocaleDateString("pt-BR")}</small>
              </div>
              {term.pdf_url && <a className="secondary-button" href={`${API_ORIGIN}${term.pdf_url}`} target="_blank" rel="noreferrer">PDF</a>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function LoyaltyPanel({ client, onChanged }) {
  const loyalty = client.loyalty || { availablePoints: 0, totalEarned: 0, level: "Cliente Aura", benefits: [], history: [], redemptions: [], redeemedPoints: 0 };
  const [redeem, setRedeem] = useState({ points_used: 10, discount_value: 0, notes: "" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/clients/${client.id}/loyalty-redemptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(redeem)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível resgatar desconto.");
    setRedeem({ points_used: 10, discount_value: 0, notes: "" });
    onChanged();
  }

  return (
    <div className="loyalty-panel">
      <div className="loyalty-summary">
        <div>
          <span className="eyebrow">Programa de fidelidade</span>
          <h3>{loyalty.level}</h3>
          <p>{loyalty.availablePoints} pontos disponíveis · {loyalty.totalEarned} pontos acumulados</p>
        </div>
        <span className="status-badge status-confirmado">{loyalty.redeemedPoints} pontos resgatados</span>
      </div>
      <div className="loyalty-grid">
        <div>
          <h4>Benefícios por nível</h4>
          <ul className="benefit-list">
            {loyalty.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </div>
        <form onSubmit={submit} className="redeem-form">
          <h4>Resgatar desconto</h4>
          <div className="form-grid">
            <Input type="number" label="Pontos" value={redeem.points_used} onChange={(value) => setRedeem({ ...redeem, points_used: value })} />
            <Input type="number" label="Desconto R$" value={redeem.discount_value} onChange={(value) => setRedeem({ ...redeem, discount_value: value })} />
          </div>
          <Input label="Observação" value={redeem.notes} onChange={(value) => setRedeem({ ...redeem, notes: value })} />
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button">Resgatar</button>
        </form>
      </div>
      <div className="loyalty-history">
        <div>
          <h4>Histórico de pontos</h4>
          {(loyalty.history || []).slice(0, 5).map((item) => <p key={item.id}><strong>+{item.points}</strong> {item.description}</p>)}
          {!loyalty.history?.length && <small>Sem pontos registrados ainda.</small>}
        </div>
        <div>
          <h4>Resgates</h4>
          {(loyalty.redemptions || []).slice(0, 5).map((item) => <p key={item.id}><strong>-{item.points_used}</strong> {currency.format(item.discount_value)} · {item.notes || "desconto"}</p>)}
          {!loyalty.redemptions?.length && <small>Nenhum resgate realizado.</small>}
        </div>
      </div>
    </div>
  );
}

function SignaturePad({ onChange, clearKey }) {
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fffdfb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#171412";
    context.lineWidth = 2;
    context.lineCap = "round";
    onChange("");
  }, [clearKey]);

  function point(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0];
    return {
      x: ((touch?.clientX ?? event.clientX) - rect.left) * (canvas.width / rect.width),
      y: ((touch?.clientY ?? event.clientY) - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(event) {
    event.preventDefault();
    drawingRef.current = true;
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
  }

  function move(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
    onChange(canvasRef.current.toDataURL("image/png"));
  }

  function stop() {
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdfb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="signature-box">
      <div className="signature-heading">
        <span>Assinatura digital</span>
        <button type="button" onClick={clear}>Limpar</button>
      </div>
      <canvas ref={canvasRef} width="720" height="220" onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={move} onTouchEnd={stop} />
    </div>
  );
}

function PostCare() {
  const { data, refresh } = useFetch("/post-care");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  if (!data) return <Loading />;
  const items = data.filter((item) => {
    const text = `${item.full_name} ${item.whatsapp} ${item.procedure} ${item.piercing_region} ${item.jewelry_name} ${item.healing_status}`.toLowerCase();
    return (!search.trim() || text.includes(search.toLowerCase())) && (!status || item.status === status);
  });
  const dueCount = data.filter((item) => item.status !== "concluido" && item.due_date <= new Date().toISOString().slice(0, 10)).length;

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Lembretes totais" value={data.length} />
        <Metric label="Pendentes ou vencidos" value={dueCount} />
        <Metric label="Fotos recebidas" value={data.filter((item) => item.client_photo_url).length} />
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input placeholder="Pesquisar cliente, procedimento, joia ou status" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <Select label="Status" value={status} onChange={setStatus}>
          <option value="">Todos</option>
          <option value="pendente">pendente</option>
          <option value="mensagem enviada">mensagem enviada</option>
          <option value="foto recebida">foto recebida</option>
          <option value="concluido">concluído</option>
        </Select>
      </div>
      <div className="post-care-grid">
        {items.map((item) => <PostCareCard item={item} key={item.id} onChanged={refresh} />)}
      </div>
      {!items.length && <p className="empty-state">Nenhum acompanhamento encontrado.</p>}
    </section>
  );
}

function PostCareCard({ item, onChanged }) {
  const [form, setForm] = useState({
    care_message: item.care_message || "",
    healing_status: item.healing_status || "aguardando retorno",
    client_notes: item.client_notes || "",
    status: item.status || "pendente"
  });
  const [photo, setPhoto] = useState(null);
  const isDue = item.status !== "concluido" && item.due_date <= new Date().toISOString().slice(0, 10);

  async function save(event) {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => formData.append(key, value));
    if (photo) formData.append("client_photo", photo);
    await apiFetch(`/post-care/${item.id}`, { method: "PATCH", body: formData });
    setPhoto(null);
    onChanged();
  }

  return (
    <article className={`post-care-card ${isDue ? "due" : ""}`}>
      <header>
        <div>
          <span className="eyebrow">{item.reminder_day} dias</span>
          <h2>{item.full_name}</h2>
          <p>{item.whatsapp} · {item.instagram || "sem Instagram"}</p>
        </div>
        <span className={`status-badge ${isDue ? "status-pendente" : "status-atendido"}`}>{formatDate(item.due_date)}</span>
      </header>
      <dl>
        <div><dt>Procedimento</dt><dd>{item.procedure}</dd></div>
        <div><dt>Região</dt><dd>{item.piercing_region}</dd></div>
        <div><dt>Joia</dt><dd>{item.jewelry_name || "sem joia"}</dd></div>
        <div><dt>Profissional</dt><dd>{item.professional_name}</dd></div>
      </dl>
      {item.client_photo_url && <img className="post-care-photo" src={`${API_ORIGIN}${item.client_photo_url}`} alt="Foto enviada pelo cliente" />}
      <form onSubmit={save} className="post-care-form">
        <label>Mensagem personalizada de cuidados
          <textarea value={form.care_message} onChange={(event) => setForm({ ...form, care_message: event.target.value })} />
        </label>
        <div className="form-grid">
          <Select label="Status da cicatrização" value={form.healing_status} onChange={(value) => setForm({ ...form, healing_status: value })}>
            <option>aguardando retorno</option>
            <option>cicatrização normal</option>
            <option>atenção necessária</option>
            <option>intercorrência</option>
            <option>cicatrização concluída</option>
          </Select>
          <Select label="Status do lembrete" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
            <option value="pendente">pendente</option>
            <option value="mensagem enviada">mensagem enviada</option>
            <option value="foto recebida">foto recebida</option>
            <option value="concluido">concluído</option>
          </Select>
        </div>
        <label>Observações do cliente
          <textarea value={form.client_notes} onChange={(event) => setForm({ ...form, client_notes: event.target.value })} />
        </label>
        <label>Foto enviada pelo cliente
          <input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files[0])} />
        </label>
        <button className="primary-button">Salvar acompanhamento</button>
      </form>
    </article>
  );
}

const DIGITAL_TERM_HEALTH_ITEMS = [
  { key: "epilepsia", label: "Epilepsia" },
  { key: "hemofilia", label: "Hemofilia" },
  { key: "diabetes", label: "Diabetes" },
  { key: "alteracoes_hormonais", label: "Alterações Hormonais" },
  { key: "doencas_cardiacas", label: "Doenças Cardíacas" },
  { key: "queloide", label: "Queloide" },
  { key: "ists", label: "IST's" },
  { key: "hepatite", label: "Hepatite" },
  { key: "dermatite", label: "Dermatite" },
  { key: "anemia", label: "Anemia" }
];

const DIGITAL_TERM_LIFESTYLE_ITEMS = [
  { key: "eats_well", label: "Alimenta-Se Bem?" },
  { key: "sleep_regular", label: "Tem Sono Regular?" },
  { key: "physical_activity", label: "Pratica Atividade Física?" },
  { key: "alcohol", label: "Bebe Álcool?" },
  { key: "smokes", label: "Fuma?" },
  { key: "health_problem", label: "Algum Problema De Saúde?" },
  { key: "medication", label: "Usa Algum Medicamento?" },
  { key: "treatment", label: "Faz Algum Tratamento?" },
  { key: "phobia", label: "Tem Alguma Fobia?" },
  { key: "blood_pressure", label: "Pressão Sanguínea" }
];

function defaultDigitalTerm() {
  return {
    appointment_id: "",
    client_id: "",
    full_name: "",
    social_name: "",
    document_number: "",
    birth_date: "",
    whatsapp: "",
    instagram: "",
    address: "",
    procedure: "",
    piercing_region: "",
    health_declaration: "",
    orientations_confirmed: false,
    form_data: {
      health_history: Object.fromEntries(DIGITAL_TERM_HEALTH_ITEMS.map((item) => [item.key, false])),
      lifestyle: Object.fromEntries(DIGITAL_TERM_LIFESTYLE_ITEMS.map((item) => [item.key, ""])),
      information: {
        application_location: "",
        jewelry: "",
        observation: "",
        value: ""
      },
      minor: {
        is_minor: false,
        responsible_name: "",
        responsible_document: "",
        minor_name: ""
      }
    },
    signature_data_url: ""
  };
}

function MedicalRecordForm({ client, onSaved }) {
  const [record, setRecord] = useState(defaultMedicalRecord());
  const [files, setFiles] = useState({ before_photo: null, after_photo: null });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const formData = new FormData();
    Object.entries(record).forEach(([key, value]) => formData.append(key, value));
    if (files.before_photo) formData.append("before_photo", files.before_photo);
    if (files.after_photo) formData.append("after_photo", files.after_photo);
    const response = await apiFetch(`/clients/${client.id}/medical-records`, { method: "POST", body: formData });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar o prontuário.");
    setRecord(defaultMedicalRecord());
    setFiles({ before_photo: null, after_photo: null });
    event.currentTarget.reset();
    onSaved();
  }

  return (
    <form className="medical-form" onSubmit={submit}>
      <h3>Novo registro de prontuário</h3>
      <div className="form-grid">
        <Input type="date" label="Data do registro" value={record.record_date} onChange={(value) => setRecord({ ...record, record_date: value })} />
        <Select label="Atendimento vinculado" value={record.appointment_id} onChange={(value) => setRecord({ ...record, appointment_id: value })}>
          <option value="">Sem vínculo</option>
          {client.history.map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} · {item.procedure}</option>)}
        </Select>
      </div>
      <label>Histórico de perfurações
        <textarea value={record.piercing_history} onChange={(event) => setRecord({ ...record, piercing_history: event.target.value })} />
      </label>
      <label>Joias usadas
        <textarea value={record.jewelry_used} onChange={(event) => setRecord({ ...record, jewelry_used: event.target.value })} />
      </label>
      <div className="form-grid">
        <label>Foto antes
          <input type="file" accept="image/*" onChange={(event) => setFiles({ ...files, before_photo: event.target.files[0] })} />
        </label>
        <label>Foto depois
          <input type="file" accept="image/*" onChange={(event) => setFiles({ ...files, after_photo: event.target.files[0] })} />
        </label>
      </div>
      <label>Intercorrências
        <textarea value={record.occurrences} onChange={(event) => setRecord({ ...record, occurrences: event.target.value })} />
      </label>
      <label>Orientações passadas
        <textarea value={record.guidance} onChange={(event) => setRecord({ ...record, guidance: event.target.value })} />
      </label>
      <label>Alergias ou observações importantes
        <textarea value={record.allergies_notes} onChange={(event) => setRecord({ ...record, allergies_notes: event.target.value })} />
      </label>
      <label>Evolução da cicatrização
        <textarea value={record.healing_evolution} onChange={(event) => setRecord({ ...record, healing_evolution: event.target.value })} />
      </label>
      <label>Retornos realizados
        <textarea value={record.returns_done} onChange={(event) => setRecord({ ...record, returns_done: event.target.value })} />
      </label>
      {error && <span className="form-error">{error}</span>}
      <button className="primary-button">Salvar prontuário</button>
    </form>
  );
}

function MedicalRecordTimeline({ client, onChanged }) {
  async function remove(recordId) {
    await apiFetch(`/clients/${client.id}/medical-records/${recordId}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="medical-section">
      <h3>Prontuário individual</h3>
      <div className="medical-timeline">
        {client.medicalRecords?.length ? client.medicalRecords.map((record) => (
          <article className="record-entry" key={record.id}>
            <header>
              <div>
                <strong>{formatLongDate(record.record_date)}</strong>
                <span>{record.procedure || "Registro avulso"} · {record.piercing_region || "sem região vinculada"}</span>
              </div>
              <button onClick={() => remove(record.id)}>Apagar</button>
            </header>
            <div className="record-photos">
              {record.before_photo_url && (
  <figure>
    <img src={`${API_ORIGIN}${record.before_photo_url}`} alt="Antes" />
    <figcaption>Antes</figcaption>
  </figure>
)}

{record.after_photo_url && (
  <figure>
    <img src={`${API_ORIGIN}${record.after_photo_url}`} alt="Depois" />
    <figcaption>Depois</figcaption>
  </figure>
)}
            </div>
            <dl className="record-details">
              <div><dt>Joias usadas</dt><dd>{record.jewelry_used || record.appointment_jewelry || "Não informado"}</dd></div>
              <div><dt>Intercorrências</dt><dd>{record.occurrences || "Sem intercorrências registradas"}</dd></div>
              <div><dt>Orientações</dt><dd>{record.guidance || "Não informado"}</dd></div>
              <div><dt>Alergias/observações</dt><dd>{record.allergies_notes || client.notes || "Não informado"}</dd></div>
              <div><dt>Evolução</dt><dd>{record.healing_evolution || "Não informado"}</dd></div>
              <div><dt>Retornos</dt><dd>{record.returns_done || "Não informado"}</dd></div>
            </dl>
          </article>
        )) : <p className="empty-state">Nenhum registro de prontuário ainda.</p>}
      </div>
    </div>
  );
}

function MonthlyChart({ data = [] }) {
  const max = Math.max(...data.map((item) => item.total), 1);
  if (!data.length) return <p className="empty-state">Sem faturamento registrado para montar o gráfico.</p>;
  return (
    <div className="monthly-chart">
      {data.map((item) => (
        <div className="chart-column" key={item.month}>
          <div style={{ height: `${Math.max((item.total / max) * 100, 6)}%` }} />
          <span>{item.month.slice(5)}/{item.month.slice(2, 4)}</span>
          <small>{currency.format(item.total)}</small>
        </div>
      ))}
    </div>
  );
}

function AppointmentList({ appointments = [], onChanged, compact }) {
  if (!appointments.length) return <p className="empty-state">Nenhum atendimento encontrado.</p>;
  return (
    <div className="appointment-list">
      {appointments.map((item) => (
        <article className="appointment-row" key={item.id}>
          <div className="time-box"><strong>{item.appointment_time}</strong><span>{formatDate(item.appointment_date)}</span></div>
          <div>
            <h3>{item.full_name}</h3>
            <p>{item.procedure} · {item.piercing_region}</p>
            <small>{item.professional_name} · {item.jewelry_name || "sem joia vinculada"}</small>
          </div>
          <span className={`status-badge ${statusClass[item.status]}`}>{item.status}</span>
          {!compact && <div className="row-actions">
            <a title="WhatsApp" href={whatsappUrl(item.whatsapp, `Ola ${item.full_name}, tudo bem Aqui e da Aura Clinic sobre seu atendimento de ${formatDate(item.appointment_date)} as ${item.appointment_time}.`)} target="_blank" rel="noreferrer">WhatsApp</a>
            <button title="Cancelar" onClick={() => updateAppointment(item.id, { status: "cancelado" }, onChanged)}><XCircle size={16} /></button>
            <button title="Atendido" onClick={() => updateAppointment(item.id, { status: "atendido" }, onChanged)}><CheckCircle2 size={16} /></button>
          </div>}
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value }) {
  return <article className="metric-card"><ListFilter size={20} /><span>{label}</span><strong>{value}</strong></article>;
}

function Input({ label, value, onChange, type = "text", required }) {
  return <label>{label}<input type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Select({ label, value, onChange, children, required }) {
  return <label>{label}<select value={value} required={required} onChange={(e) => onChange(e.target.value)}>{children}</select></label>;
}

function PaymentSelect(props) {
  return <Select {...props}><option>Pix</option><option>dinheiro</option><option>cartão de crédito</option><option>cartão de débito</option></Select>;
}

function StatusSelect({ value, onChange }) {
  return <Select label="Status" value={value} onChange={onChange}>{statuses().map((status) => <option key={status}>{status}</option>)}</Select>;
}

function Loading() {
  return <div className="loading">Carregando Aura Clinic...</div>;
}

function ApiError({ message }) {
  return (
    <section className="panel erp-error">
      <span className="eyebrow">Aura Clinic</span>
      <h2>Não foi possível carregar os dados.</h2>
      <p>{message || "Tente atualizar a página ou entrar novamente."}</p>
    </section>
  );
}

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem("aura-session") || "null");
  } catch {
    localStorage.removeItem("aura-session");
    return null;
  }
}

function authToken() {
  try {
    return JSON.parse(localStorage.getItem("aura-session") || "null")?.token || "";
  } catch {
    localStorage.removeItem("aura-session");
    return "";
  }
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API}${path}`, { ...options, headers }).then((response) => {
    if (response.status === 401 && path !== "/login") {
      localStorage.removeItem("aura-session");
      window.location.reload();
    }
    return response;
  });
}

async function downloadApiFile(path, filename) {
  const response = await apiFetch(path);
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function useFetch(path) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    apiFetch(`${path}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json.error || "Não foi possível carregar os dados." };
        return json;
      })
      .then((json) => active && setData(json))
      .catch(() => active && setData({ error: "Não foi possível conectar com a API." }));
    return () => { active = false; };
  }, [path, tick]);
  return { data, refresh: () => setTick((value) => value + 1) };
}

function usePublicFetch(path) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    fetch(`${API}${path}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json.error || "Não foi possível carregar os dados." };
        return json;
      })
      .then((json) => active && setData(json))
      .catch(() => active && setData({ error: "Não foi possível conectar com a API." }));
    return () => { active = false; };
  }, [path]);
  return { data };
}

async function updateAppointment(id, body, refresh) {
  await apiFetch(`/appointments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  refresh?.();
}

function defaultAppointment() {
  const today = localDateValue(new Date());
  return {
    client_id: "",
    full_name: "",
    whatsapp: "",
    instagram: "",
    birth_date: "",
    procedure: "",
    description: "",
    piercing_region: "",
    service_id: "",
    jewelry_id: "",
    jewelry_variant_id: "",
    appointment_kind: "Atendimento",
    reference_photo: null,
    appointment_date: today,
    appointment_time: "",
    professional_id: "",
    total_value: 0,
    deposit_value: 0,
    remaining_value: 0,
    deposit_payment_method: "Pix",
    remaining_payment_method: "Pix",
    status: "pendente",
    notes: ""
  };
}

function defaultPublicBooking() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  return {
    service_id: params.get("service_id") || "",
    professional_id: params.get("professional_id") || "",
    appointment_date: params.get("appointment_date") || "",
    appointment_time: params.get("appointment_time") || "",
    full_name: "",
    whatsapp: "",
    instagram: "",
    notes: "",
    reference_photo: null,
    payment_proof: null
  };
}

function nextBookingDates(total = 10) {
  return Array.from({ length: total }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      value: localDateValue(date),
      day: String(date.getDate()).padStart(2, "0"),
      weekday: date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase(),
      month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")
    };
  });
}

function localDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function defaultServiceForm() {
  return {
    name: "",
    description: "",
    duration_minutes: 40,
    price: 0,
    deposit_value: 0,
    active_online_booking: true,
    pre_service_notes: ""
  };
}

function defaultSalesOrderForm() {
  return {
    full_name: "",
    whatsapp: "",
    instagram: "",
    appointment_id: "",
    payment_method: "Pix",
    status: "concluida",
    notes: ""
  };
}

function defaultSalesLine() {
  return {
    item_type: "produto",
    product_id: "",
    service_id: "",
    quantity: 1,
    unit_price: 0,
    notes: ""
  };
}

function defaultScheduleBlock() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    professional_id: "",
    start_datetime: `${today}T09:00`,
    end_datetime: `${today}T18:00`,
    reason: "Bloqueio",
    notes: "",
    is_full_day: false,
    is_recurring: false
  };
}

const JEWELRY_CATEGORY_OPTIONS = [
  "Labret",
  "Argolas",
  "Barbell Reto",
  "Barbell Curvo",
  "Nostril",
  "Topos",
  "Microdermal",
  "Surface",
  "Ouro 14k",
  "Ouro 18k"
];

function defaultJewelry() {
  return {
    name: "",
    description: "",
    photo_url: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80",
    gallery_urls: "",
    category: "",
    subcategory: "",
    variant_group: "",
    variation_label: "",
    material: "",
    color: "",
    stone: "",
    size: "",
    thickness: "",
    stem_length: "",
    thread_type: "",
    piercing_type: "",
    weight_grams: 50,
    package_length_cm: 15,
    package_width_cm: 10,
    package_height_cm: 3,
    package_type: "Envelope / caixa pequena",
    virtual_store_active: true,
    preparation_days: 1,
    shipping_info: "",
    seo_title: "",
    seo_description: "",
    freight_notes: "",
    quantity: 0,
    low_stock_threshold: 5,
    critical_stock_threshold: 3,
    cost_value: 0,
    sale_value: 0,
    supplier: "",
    physical_location: "",
    sku: "",
    is_catalog_active: true,
    is_featured: false,
    is_new: false,
    is_most_wanted: false,
    is_promotion: false,
    is_last_units: false,
    notes: "",
    status: "disponível",
    variants: [defaultJewelryVariant()]
  };
}

function defaultJewelryVariant(index = 1) {
  return {
    id: null,
    sku: "",
    variation_name: `Variação ${index}`,
    material: "Titânio ASTM F136",
    color: "Natural",
    stone_color: "",
    side: "",
    size: "",
    thickness: "1.2mm",
    length: "",
    diameter: "",
    thread_type: "Interna",
    supplier: "",
    cost_value: 0,
    sale_value: 0,
    quantity: 0,
    low_stock_threshold: 5,
    status: "disponível",
    is_active: true
  };
}

function normalizeJewelryForm(item = {}) {
  let galleryUrls = item.gallery_urls || "";
  if (Array.isArray(galleryUrls)) {
    galleryUrls = galleryUrls.join("\n");
  } else if (typeof galleryUrls === "string") {
    try {
      const parsed = JSON.parse(galleryUrls);
      galleryUrls = Array.isArray(parsed) ? parsed.join("\n") : galleryUrls;
    } catch {
      galleryUrls = galleryUrls;
    }
  }
  return {
    ...defaultJewelry(),
    ...item,
    gallery_urls: galleryUrls,
    virtual_store_active: Boolean(Number(item.virtual_store_active ?? 1)),
    is_catalog_active: Boolean(Number(item.is_catalog_active ?? 1)),
    is_featured: Boolean(Number(item.is_featured)),
    is_new: Boolean(Number(item.is_new)),
    is_most_wanted: Boolean(Number(item.is_most_wanted)),
    is_promotion: Boolean(Number(item.is_promotion)),
    is_last_units: Boolean(Number(item.is_last_units)),
    weight_grams: Number(item.weight_grams || 50),
    package_length_cm: Number(item.package_length_cm || 15),
    package_width_cm: Number(item.package_width_cm || 10),
    package_height_cm: Number(item.package_height_cm || 3),
    preparation_days: Number(item.preparation_days || 1),
    low_stock_threshold: Number(item.low_stock_threshold || 5),
    critical_stock_threshold: Number(item.critical_stock_threshold || 3),
    variants: Array.isArray(item.variants) && item.variants.length
      ? item.variants.map((variant, index) => ({
          ...defaultJewelryVariant(index + 1),
          ...variant,
          material: normalizeJewelryMaterial(variant.material),
          color: splitColorOptions(variant.color).join(", "),
          thread_type: normalizeJewelryThread(variant.thread_type),
          is_active: Boolean(Number(variant.is_active ?? 1))
        }))
      : [defaultJewelryVariant()]
  };
}

function parseGalleryUrls(value = "") {
  return String(value)
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultCatalogSettings() {
  return {
    title: "Escolha a joia perfeita para você",
    subtitle: "Curadoria premium da Aura Clinic Piercing",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realçar sua essência",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: `Todos, ${JEWELRY_CATEGORY_OPTIONS.join(", ")}`,
    whatsapp_phone: "",
    whatsapp_message: "Olá! Vim pelo catálogo online da Aura Clinic e quero ajuda para escolher uma joia.",
    company_instagram: "",
    company_email: "",
    company_address: "",
    company_hours: "",
    layout_style: "premium"
  };
}

function defaultExpense() {
  return {
    description: "",
    expense_type: "fixa",
    category: "",
    amount: 0,
    due_date: new Date().toISOString().slice(0, 10),
    status: "paga",
    payment_method: "Pix",
    notes: ""
  };
}

function defaultAccessUser() {
  return { name: "", email: "", password: "", role: "reception" };
}

function defaultMedicalRecord() {
  return {
    appointment_id: "",
    record_date: new Date().toISOString().slice(0, 10),
    piercing_history: "",
    jewelry_used: "",
    occurrences: "",
    guidance: "",
    allergies_notes: "",
    healing_evolution: "",
    returns_done: ""
  };
}

function calcRemaining(form) {
  return { ...form, remaining_value: Math.max(Number(form.total_value || 0) - Number(form.deposit_value || 0), 0) };
}

function statuses() {
  return ["pendente", "confirmado", "recusado", "atendido", "cancelado", "remarcado"];
}

function weekdayLabel(day) {
  return ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][Number(day)] || "Dia";
}

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatLongDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function formatRevenueLabel(item, mode) {
  const label = item.label || item.month || "";
  if (mode === "diario" && label) return formatDate(label);
  if (mode === "semanal") return label.replace("-W", " semana ");
  if (label.length === 7) return `${label.slice(5)}/${label.slice(0, 4)}`;
  return label || "Período";
}

function formatRevenueAxisLabel(item, mode) {
  const label = item.label || item.month || "";
  if (mode === "diario" && label) return label.slice(8, 10);
  if (mode === "semanal" && label) return label.slice(-2);
  if (label.length === 7) return label.slice(5);
  return label.slice(0, 4);
}

function firstName(name = "") {
  return String(name).trim().split(" ")[0] || "Aura";
}

function initials(name = "") {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
}

function matchesClientSearch(client, search) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const historyText = (client.history || []).map((item) => `${item.procedure} ${item.piercing_region} ${item.jewelry_name} ${item.professional_name}`).join(" ");
  const recordText = (client.medicalRecords || []).map((record) => `${record.piercing_history} ${record.jewelry_used} ${record.occurrences} ${record.guidance} ${record.allergies_notes} ${record.healing_evolution} ${record.returns_done}`).join(" ");
  return `${client.full_name} ${client.whatsapp} ${client.instagram} ${client.notes} ${historyText} ${recordText}`.toLowerCase().includes(term);
}

function whatsappUrl(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function whatsappShareUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
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
    Titânio: CircleDollarSign,
    Titanio: CircleDollarSign,
    Opalas: Gem,
    Lançamentos: Star,
    Lancamentos: Star
  };
  const categoryNames = names.length ? names : ["Todos", ...JEWELRY_CATEGORY_OPTIONS];
  return categoryNames.map((name) => ({ name, icon: iconByCategory[name] || Gem }));
}

function catalogCategoriesFromCatalog(data) {
  const active = (data.featuredCategories || [])
    .filter((category) => Boolean(Number(category.is_active)))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  if (!active.length) return catalogCategories(data.categories);
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

function catalogPromotionForItem(item, promotions = []) {
  const today = new Date().toISOString().slice(0, 10);
  return promotions.find((promotion) => {
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

function promotionalPrice(value, promotion) {
  if (!promotion) return null;
  const discount = Number(promotion.discount_value || 0);
  if (promotion.discount_type === "fixed") return Math.max(value - discount, 0);
  return Math.max(value - (value * discount / 100), 0);
}

function catalogStockText(item, theme = {}, settings = {}) {
  const mode = theme.stock_display_mode || "status";
  if (mode === "hidden") return "";
  const quantity = Number(item.quantity || 0);
  if (mode === "quantity" || Boolean(Number(theme.show_stock_quantity))) return `${quantity} em estoque`;
  if (quantity <= 0) return settings.unavailable_message || "Indisponível";
  if (quantity <= 2) return settings.low_stock_message || "Poucas unidades";
  return "Em estoque";
}

function catalogFilterOptions(items) {
  const variants = items.flatMap((item) => item.variants || []);
  const unique = (key, source = items) => [...new Set(source.map((item) => cleanDisplayText(item[key])).filter(Boolean))].sort();
  return {
    categories: unique("category"),
    subcategories: unique("subcategory"),
    materials: unique("material", variants),
    colors: [...new Set(variants.flatMap((variant) => splitColorOptions(variant.color)))].sort(),
    stones: unique("stone"),
    sizes: unique("size", variants),
    thicknesses: unique("thickness", variants),
    suppliers: unique("supplier", variants),
    locations: unique("physical_location")
  };
}

function catalogContentSections(value) {
  if (Array.isArray(value)) return value.map(normalizeCatalogContentSection);
  if (!value) return [defaultContentSection(1)];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(normalizeCatalogContentSection) : [defaultContentSection(1)];
  } catch {
    return [defaultContentSection(1)];
  }
}

function normalizeCatalogContentSection(section, index = 0) {
  return {
    ...defaultContentSection(index + 1),
    ...section,
    active: section.active === undefined ? true : Boolean(section.active),
    order: Number(section.order || index + 1)
  };
}

function inventoryStatusLabel(item) {
  const state = inventoryStockState(item);
  if (state === "sold-out") return "Esgotado";
  if (state === "critical") return "Crítico";
  return "Ativo";
}

function inventoryStatusClass(item) {
  return removeAccents(inventoryStatusLabel(item)).replace(/\s+/g, "-").toLowerCase();
}

function inventoryStockState(item) {
  const quantity = Number(item.quantity || 0);
  const minimum = Number(item.low_stock_threshold || 5);
  if (quantity <= 0) return "sold-out";
  if (quantity <= minimum) return "critical";
  return "active";
}

function cleanDisplayText(value = "") {
  return String(value || "")
    .replace(/tit\?nio/gi, "titânio")
    .replace(/tit�nio/gi, "titânio")
    .replace(/zirc\?nia/gi, "zircônia")
    .replace(/a\?o/gi, "aço")
    .replace(/sem informa\?\?o/gi, "sem informação")
    .replace(/promo\?\?o/gi, "promoção")
    .replace(/varia\?\?o/gi, "variação")
    .replace(/dispon\?vel/gi, "disponível")
    .replace(/observa\?\?o/gi, "observação")
    .replace(/Ã¢/g, "â")
    .replace(/Ã£/g, "ã")
    .replace(/Ã§/g, "ç")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãµ/g, "õ")
    .replace(/Ãº/g, "ú")
    .replace(/Â·/g, "·")
    .trim();
}

function elegantProductName(value = "") {
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

function subcategoryOptions(category = "") {
  const normalized = removeAccents(String(category).toLowerCase());
  if (normalized.includes("nariz")) return ["Nostril", "D-Ring", "Segment Clicker", "Argola Clicker", "Screw", "L Shape", "Septo"];
  if (normalized.includes("orelha")) return ["Hélix", "Tragus", "Conch", "Daith", "Rook", "Flat", "Forward Helix", "Lóbulo", "Anti-Hélix"];
  if (normalized.includes("boca")) return ["Labret", "Side Labret", "Medusa", "Monroe", "Ashley", "Vertical Labret"];
  if (normalized.includes("corpo")) return ["Umbigo", "Mamilo", "Surface", "Microdermal", "Sobrancelha"];
  if (normalized.includes("joias premium")) return ["Ouro 14k", "Ouro 18k", "Titânio ASTM F136", "Cluster", "Trinity", "Opala", "Navete", "Correntes"];
  if (normalized.includes("acessor")) return ["Hastes", "Discos", "Topos", "Bases de Microdermal", "Correntes", "Extensores"];
  return [];
}

function generateLocalSku(item = {}) {
  const materialCode = {
    "titânio grau implante": "TIT",
    "titanio grau implante": "TIT",
    "titanio astm f136": "TIT",
    "ouro 14k": "G14",
    "ouro 18k": "G18",
    aço: "ACO",
    outro: "OUT"
  }[removeAccents(String(item.material || "").toLowerCase())] || "JWL";
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
  }[removeAccents(String(item.subcategory || item.category || "").toLowerCase())] || "GEN";
  const variation = [
    item.variant_group,
    item.variation_label,
    item.size,
    item.thickness,
    item.color,
    item.stem_length
  ].filter(Boolean).map((part) => removeAccents(String(part).toUpperCase()).replace(/[^A-Z0-9]+/g, "")).join("");
  const key = `${materialCode}-${categoryCode}`;
  const hashSource = `${key}-${variation || removeAccents(String(item.name || "JOIA").toUpperCase()).replace(/[^A-Z0-9]+/g, "")}`;
  const hash = Array.from(hashSource).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 1000000, 7);
  const suffix = String(hash).padStart(6, "0").slice(0, 6);
  return `${key}-${suffix}`;
}

function jewelrySkuBase(item = {}) {
  const existingSku = (item.variants || []).map((variant) => variant.sku).find(Boolean) || item.sku || "";
  const existingBase = String(existingSku).replace(/-\d{2,3}$/, "");
  if (existingBase) return existingBase;
  const firstVariant = item.variants?.[0] || {};
  return generateLocalSku({ ...item, ...firstVariant });
}

function splitColorOptions(value = "") {
  return [...new Set(
    String(value)
      .split(",")
      .map((item) => elegantProductName(item.trim()))
      .filter(Boolean)
  )];
}

function variantCatalogLabel(variant = {}) {
  const measurement = variant.length
    ? `Comprimento ${variant.length}`
    : variant.diameter
      ? `Diâmetro ${variant.diameter}`
      : variant.size
        ? `Tamanho ${variant.size}`
        : variant.variation_name || variant.sku || "Variação";
  return [
    measurement,
    variant.thickness,
    variant.material && elegantProductName(variant.material),
    variant.thread_type && `Rosca ${elegantProductName(variant.thread_type)}`
  ].filter(Boolean).join(" · ");
}

function normalizeJewelryMaterial(value = "") {
  const normalized = removeAccents(String(value).toLowerCase());
  if (normalized.includes("titanio")) return "Titânio ASTM F136";
  if (normalized.includes("ouro 14")) return "Ouro 14k";
  if (normalized.includes("ouro 18")) return "Ouro 18k";
  if (normalized.includes("aco")) return "Aço";
  return value ? elegantProductName(value) : "Titânio ASTM F136";
}

function normalizeJewelryThread(value = "") {
  const normalized = removeAccents(String(value).toLowerCase());
  if (normalized === "interna") return "Interna";
  if (normalized === "externa") return "Externa";
  if (normalized === "threadless" || normalized === "push pin" || normalized === "pushpin") return "Push Pin";
  return value ? elegantProductName(value) : "";
}

function readCatalogStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function catalogCategoryTerms(category) {
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
    "Ouro 18k": ["ouro 18k"],
  }[category] || [category.toLowerCase()];
}

function countAlerts(alerts) {
  return (alerts?.lowStockJewelry?.length || 0) + (alerts?.birthdays?.length || 0) + (alerts?.topClients?.length || 0);
}

function roleLabel(role) {
  return {
    admin: "Administrador Geral",
    piercer: "Body Piercer",
    reception: "Recepção",
    finance: "Financeiro"
  }[role] || "Administrador Geral";
}

function saleOrderTypeLabel(type = "") {
  return {
    produto: "Venda de produto",
    servico: "Venda de serviço",
    ordem_servico: "Ordem de serviço",
    mista: "Venda mista"
  }[type] || "Venda";
}

function saleItemLabel(type = "") {
  return {
    produto: "Produto",
    servico: "Serviço"
  }[type] || "Item";
}

function allowedPagesForRole(role) {
  return {
    admin: ["dashboard", "erp", "agenda", "catalog", "catalog-customization", "sales", "finance", "client-center", "clients", "terms", "postcare", "admin"],
    reception: ["agenda", "sales", "client-center", "clients"],
    finance: ["finance", "sales"],
    piercer: ["agenda", "sales", "client-center", "clients", "postcare"]
  }[role] || ["dashboard", "erp", "agenda", "catalog", "sales", "finance", "client-center", "clients", "terms", "postcare", "admin"];
}

function canAccessPage(role, page) {
  return allowedPagesForRole(role).includes(page);
}

function defaultPageForRole(role) {
  return allowedPagesForRole(role)[0] || "dashboard";
}

function pageTitle(page) {
  return {
    dashboard: "Dashboard",
    erp: "Aura Clinic ERP",
    agenda: "Agenda",
    catalog: "Catálogo",
    "catalog-customization": "Personalização do Catálogo",
    sales: "Vendas e ordens",
    finance: "Administrativo Financeiro",
    "client-center": "Clientes",
    clients: "Clientes",
    terms: "Termos digitais",
    postcare: "Pós-atendimento",
    admin: "Acessos administrativos"
  }[page];
}

function buildCalendar(items, mode, currentDate) {
  const base = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const days = mode === "mensal" ? buildMonthDays(base) : mode === "semanal" ? buildWeekDays(base) : [base];
  const mappedDays = days.map((date) => {
    const key = dateKey(date);
    return {
      date,
      key,
      isOutside: mode === "mensal" && date.getMonth() !== base.getMonth(),
      isToday: key === dateKey(new Date()),
      items: items
        .filter((item) => item.appointment_date === key)
        .sort((a, b) => a.appointment_time.localeCompare(b.appointment_time))
    };
  });
  return { title: calendarTitle(base, mode), days: mappedDays };
}

function buildMonthDays(date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = addDays(firstDay, -firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function buildWeekDays(date) {
  const start = addDays(date, -date.getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function buildTimeSlots(items) {
  const baseHours = Array.from({ length: 11 }, (_, index) => `${String(index + 8).padStart(2, "0")}:00`);
  const eventHours = items.map((item) => `${item.appointment_time.slice(0, 2)}:00`);
  return [...new Set([...baseHours, ...eventHours])].sort().map((hour) => ({
    hour,
    items: items.filter((item) => item.appointment_time.slice(0, 2) === hour.slice(0, 2))
  }));
}

function movePeriod(date, mode, direction) {
  if (mode === "mensal") return new Date(date.getFullYear(), date.getMonth() + direction, 1);
  if (mode === "semanal") return addDays(date, direction * 7);
  return addDays(date, direction);
}

function calendarTitle(date, mode) {
  if (mode === "mensal") return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  if (mode === "semanal") {
    const week = buildWeekDays(date);
    return `${formatDate(dateKey(week[0]))} - ${formatDate(dateKey(week[6]))}`;
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const auraRoot = window.__auraReactRoot || createRoot(document.getElementById("root"));
window.__auraReactRoot = auraRoot;
auraRoot.render(<App />);
