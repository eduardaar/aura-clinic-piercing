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
import { Login } from "./components/auth/Login";
import { Sidebar } from "./components/layout/Sidebar";
import { Loading, ApiError } from "./components/common/Feedback";
import { AlertBlock, BookingChoiceGrid, Input, Metric, PaymentSelect, Select, StatusSelect } from "./components/common/Ui";
import { asArray, asNumber, asObject, removeAccents, firstName, initials, formatDate, formatLongDate, localDateValue, dateInputValue } from "./lib/utils";
import { API, API_ORIGIN, apiFetch, downloadApiFile, readStoredSession, useFetch, usePublicFetch } from "./lib/api";
import { canAccessPage, defaultPageForRole, pageTitle } from "./lib/permissions";
import { catalogCategoryTerms, catalogFilterOptions, catalogPromotionForItem, catalogStockText, cleanDisplayText, elegantProductName, normalizeJewelryMaterial, normalizeJewelryThread, promotionalPrice, splitColorOptions } from "./features/catalog/catalogUtils";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const SHOULD_AUTO_LOGIN_LOCAL = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname);

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

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Aura Clinic runtime error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="runtime-error-page">
          <section className="panel">
            <span className="eyebrow">Aura Clinic</span>
            <h1>Erro ao carregar esta Ã¡rea</h1>
            <p>Os dados ainda podem estar sendo preparados. Volte ao inÃ­cio e tente novamente.</p>
            <button type="button" className="primary-button" onClick={() => { window.location.href = "/"; }}>Voltar ao inÃ­cio</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [session, setSession] = useState(readStoredSession);
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsData, setAlertsData] = useState({ count: 0, items: [] });
  const [alertsLoading, setAlertsLoading] = useState(false);
  
  // VerificaÃ§Ã£o de autenticaÃ§Ã£o administrativa
  const isAdminAuthenticated = session?.user?.id ? true : false;
  
  // Verificar pathname atual (para renderizar apenas login em /login)
  const currentPathname = window.location.pathname;
  const isLoginPath = currentPathname === "/login" || currentPathname.startsWith("/login?");
  
  const isPublicCatalog = currentPathname.startsWith("/catalogo");
  const isPublicBooking = currentPathname.startsWith("/agendar");
  const isPublicCheckout = currentPathname.startsWith("/comprar");
  
  const normalizedSession = session?.user ? session : session ? { user: session } : null;

  async function openAlerts() {
    setAlertsOpen(true);
    setAlertsLoading(true);
    try {
      const response = await apiFetch("/alerts");
      const payload = await response.json().catch(() => ({}));
      setAlertsData(response.ok ? {
        count: asNumber(payload?.count),
        items: asArray(payload?.items)
      } : { count: 0, items: [] });
    } catch (error) {
      console.error("NÃ£o foi possÃ­vel carregar os alertas:", error);
      setAlertsData({ count: 0, items: [] });
    } finally {
      setAlertsLoading(false);
    }
  }

  useEffect(() => {
    if (normalizedSession && !canAccessPage(normalizedSession.user?.role, page)) {
      setPage(defaultPageForRole(normalizedSession.user?.role));
    }
  }, [normalizedSession, page]);

  // Se estÃ¡ em /login mas jÃ¡ autenticado, redirecionar para home
  useEffect(() => {
    if (isLoginPath && isAdminAuthenticated) {
      window.location.href = "/";
    }
  }, [isLoginPath, isAdminAuthenticated]);

  // Se nÃ£o tem sessÃ£o e nÃ£o estÃ¡ em rota pÃºblica, redirecionar para login
  useEffect(() => {
    if (!normalizedSession && !isPublicCatalog && !isPublicBooking && !isPublicCheckout && !isLoginPath) {
      window.location.href = "/login";
    }
  }, [normalizedSession, isPublicCatalog, isPublicBooking, isPublicCheckout, isLoginPath]);

  // Se estÃ¡ em /login, renderizar APENAS login (sem app shell)
  if (isLoginPath) {
    return <Login onLogin={setSession} />;
  }

  // Rotas pÃºblicas: sempre acessÃ­veis
  if (isPublicCatalog) return <PublicCatalog />;
  if (isPublicBooking) return <PublicBooking />;
  if (isPublicCheckout) return <PublicCheckout />;
  
  // Se nÃ£o tem sessÃ£o, renderizar nada (useEffect acima vai redirecionar)
  if (!normalizedSession) {
    return null;
  }
  
  const activePage = canAccessPage(normalizedSession.user?.role, page) ? page : defaultPageForRole(normalizedSession.user?.role);

  return (
    <div className="app-shell">
      {/* Sidebar apenas renderizado se autenticado */}
      {isAdminAuthenticated && (
        <Sidebar
          page={activePage}
          role={normalizedSession.user?.role}
          setPage={(next) => {
            setPage(next);
            setSidebarOpen(false);
          }}
          open={sidebarOpen}
          onLogout={() => {
            localStorage.removeItem("aura-session");
            localStorage.removeItem("aura-admin-authenticated");
            setSession(null);
          }}
        />
      )}
      
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">Aura Clinic Piercing</span>
            <h1>{activePage === "dashboard" ? `OlÃ¡, ${firstName(normalizedSession.user?.name || "UsuÃ¡rio")}!` : pageTitle(activePage)}</h1>
            {activePage === "dashboard" && <p>Bem-vinda ao painel administrativo da Aura Clinic.</p>}
          </div>
          <div className="topbar-actions">
            <button className="notification-button" aria-label="NotificaÃ§Ãµes" onClick={openAlerts}>
              <Bell size={19} />
              {asNumber(alertsData.count) > 0 && <span>{asNumber(alertsData.count)}</span>}
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
            {normalizedSession.user?.name || "UsuÃ¡rio"} Â· {roleLabel(normalizedSession.user?.role)}
          </div>
          </div>
        </header>
        {activePage === "dashboard" && <Dashboard user={normalizedSession.user} setPage={setPage} alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen} alertsData={alertsData} alertsLoading={alertsLoading} />}
        {activePage !== "dashboard" && alertsOpen && <AlertsPopup alerts={alertsData} loading={alertsLoading} onClose={() => setAlertsOpen(false)} onAction={(nextPage) => { setAlertsOpen(false); setPage(nextPage); }} />}
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

function LegacyLogin({ onLogin }) {
  const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || "aura123"; "admin@auraclinic.com";
  const [form, setForm] = useState({ password: "" });
  const [rememberAccess, setRememberAccess] = useState(Boolean(localStorage.getItem("aura-admin-authenticated")));
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");

    // VerificaÃ§Ã£o de senha simples
    const isValidPassword = form.password === adminPassword;

    if (isValidPassword) {
      const user = {
        id: 1,
        name: "Administrador Aura",
        email: "admin@auraclinic.com",
        role: "admin",
      };

      // Salvar autenticaÃ§Ã£o no localStorage
      localStorage.setItem("aura-admin-authenticated", rememberAccess ? "true" : "");
      localStorage.setItem("aura-session", JSON.stringify({ user }));
      onLogin({ user });
      return;
    }

    setError("Senha incorreta. Por favor, tente novamente.");
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <header className="login-brand">
          <div className="login-monogram" aria-hidden="true">AC</div>
          <div>
            <strong>Aura Clinic</strong>
            <span>GestÃ£o Premium</span>
          </div>
        </header>

        <div className="login-copy">
          <span className="login-kicker">Central Administrativa</span>
          <h1>Acesse sua central administrativa</h1>
          <p>Controle estoque, agenda, clientes, biosseguranÃ§a e financeiro em um Ãºnico lugar.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>Senha da Central Administrativa
            <input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Digite a senha" />
          </label>
          <label className="remember-access">
            <input type="checkbox" checked={rememberAccess} onChange={(event) => setRememberAccess(event.target.checked)} />
            <span>Manter conectado</span>
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="login-submit">Entrar no sistema <ChevronRight size={18} /></button>
        </form>

        <footer className="login-footer">
          <strong>Sistema proprietÃ¡rio Aura ClinicÂ®</strong>
          <span>Desenvolvido por Eduarda Santos</span>
        </footer>
      </section>

      <section className="login-visual" aria-label="Aura Clinic">
        <div className="login-visual-content">
          <div className="gold-line" />
          <span className="login-visual-kicker">Aura Clinic Piercing</span>
          <h2>GestÃ£o inteligente para quem vive da perfuraÃ§Ã£o.</h2>
          <p>Desenvolvido por body piercer para body piercers.</p>

          <div className="login-metrics" aria-label="Indicadores Aura Clinic">
            <div><strong>+3500</strong><span>PerfuraÃ§Ãµes registradas</span></div>
            <div><strong>+1200</strong><span>Joias cadastradas</span></div>
            <div><strong>+800</strong><span>Clientes atendidos</span></div>
          </div>
        </div>

        <div className="login-floating-cards" aria-hidden="true">
          <article><Calendar size={18} /><span>Agenda do Dia</span><strong>08 atendimentos</strong></article>
          <article><AlertTriangle size={18} /><span>Estoque CrÃ­tico</span><strong>03 peÃ§as</strong></article>
          <article><UserRound size={18} /><span>Ãšltimo Atendimento</span><strong>HÃ©lix Â· 16:30</strong></article>
          <article><WalletCards size={18} /><span>Financeiro do MÃªs</span><strong>R$ 18.420</strong></article>
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
    title: data.title || "Escolha a joia perfeita para vocÃª",
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
  // Filtrar apenas produtos publicados para o catÃ¡logo pÃºblico
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
            ].filter(Boolean).join(" Â· ")
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
          <span className="eyebrow">CatÃ¡logo online</span>
          <h1 style={{ fontFamily: theme.title_font || "Georgia" }}>{settings.page_title || "CatÃ¡logo Online"} <Sparkles size={26} /></h1>
          <p>{data.title || "Escolha a joia perfeita para vocÃª"}</p>
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
          <CatalogSelect label="ObservaÃ§Ã£o de cor" value={filters.color} options={options.colors} onChange={(value) => setFilters({ ...filters, color: value })} />
          <CatalogSelect label="Pedra" value={filters.stone} options={options.stones} onChange={(value) => setFilters({ ...filters, stone: value })} />
          <CatalogSelect label="Tamanho" value={filters.size} options={options.sizes} onChange={(value) => setFilters({ ...filters, size: value })} />
          <label className="catalog-sort">
            <SlidersHorizontal size={16} />
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="recentes">Mais recentes</option>
              <option value="menor-preco">Menor preÃ§o</option>
              <option value="maior-preco">Maior preÃ§o</option>
            </select>
          </label>
        </section>

        <section className="catalog-trust-strip" aria-label="Diferenciais Aura">
          <span><ShieldCheck size={20} /><strong>Curadoria profissional</strong><small>Joias selecionadas pela Aura</small></span>
          <span><Gem size={20} /><strong>Materiais premium</strong><small>TitÃ¢nio, ouro e peÃ§as seguras</small></span>
          <span><Truck size={20} /><strong>Envio orientado</strong><small>Pedido finalizado pelo WhatsApp</small></span>
          <span><Heart size={20} /><strong>ComposiÃ§Ã£o personalizada</strong><small>Favoritos e observaÃ§Ãµes no pedido</small></span>
        </section>

        <CatalogProductRail title="LanÃ§amentos" subtitle="Novidades recÃ©m-adicionadas Ã  curadoria." items={latestItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />
        <CatalogProductRail title="Mais desejadas" subtitle="PeÃ§as premium em destaque para composiÃ§Ãµes especiais." items={bestSellerItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />
        {promoItems.length > 0 && <CatalogProductRail title="PromoÃ§Ãµes" subtitle="Ofertas ativas com preÃ§o especial." items={promoItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />}
        {lastUnitsItems.length > 0 && <CatalogProductRail title="Ãšltimas unidades" subtitle="Joias com poucas peÃ§as disponÃ­veis." items={lastUnitsItems} data={data} theme={theme} settings={settings} favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} onAdd={(item) => { addToOrder(item); setDrawer("order"); }} />}

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
        {!items.length && <p className="empty-state catalog-empty">Nenhuma joia disponÃ­vel no catÃ¡logo no momento.</p>}

        <section className="catalog-guide-section">
          <article>
            <span className="eyebrow">Guia Aura</span>
            <h2>Escolha com mais seguranÃ§a</h2>
            <p>Na dÃºvida sobre tamanho, espessura, anodizaÃ§Ã£o ou regiÃ£o ideal Adicione observaÃ§Ãµes no pedido e finalize pelo WhatsApp para receber orientaÃ§Ã£o personalizada.</p>
          </article>
          <div>
            <span><strong>Medidas</strong><small>Confira tamanho, espessura e haste antes de reservar.</small></span>
            <span><strong>Materiais</strong><small>Priorize titÃ¢nio grau implante, ouro 14k/18k e peÃ§as adequadas Ã  sua pele.</small></span>
            <span><strong>AnodizaÃ§Ã£o</strong><small>Descreva a cor desejada nas observaÃ§Ãµes do pedido.</small></span>
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
                <span><small>Atendimento rÃ¡pido</small><strong>WhatsApp</strong><em>{settings.whatsapp_phone}</em></span>
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
                <span><small>Envie sua dÃºvida</small><strong>E-mail</strong><em>{settings.company_email}</em></span>
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
                <span><small>Visite a clÃ­nica</small><strong>EndereÃ§o</strong><em>{settings.company_address}</em></span>
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

function CatalogBookingWidget() {
  const { data } = usePublicFetch("/booking/config");
  const [form, setForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { service_id: "", professional_id: "", appointment_date: today, appointment_time: "" };
  });
  const [slots, setSlots] = useState([]);
  const safeData = asObject(data);
  const services = asArray(safeData.services);
  const professionals = asArray(safeData.professionals);
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
      setSlots(response.ok ? asArray(json.slots) : []);
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  if (!data || data.error || !services.length || !professionals.length) return null;
  const href = "/agendar?" + new URLSearchParams(Object.fromEntries(Object.entries(form).filter(([, value]) => value))).toString();

  return (
    <section className="catalog-booking-widget" id="catalog-agenda">
      <div>
        <span className="eyebrow">Agenda online</span>
        <h2>Escolha Um HorÃ¡rio DisponÃ­vel</h2>
        <p>Reserve pelo link pÃºblico da Aura. A equipe confirma manualmente pelo WhatsApp.</p>
      </div>
      <div className="catalog-booking-controls">
        <Select label="ServiÃ§o" value={form.service_id} onChange={(value) => setForm({ ...form, service_id: value, appointment_time: "" })}>
          {services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}
        </Select>
        <Select label="Profissional" value={form.professional_id} onChange={(value) => setForm({ ...form, professional_id: value, appointment_time: "" })}>
          {professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
        </Select>
        <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value, appointment_time: "" })} />
      </div>
      <div className="catalog-slot-row">
          {slots.slice(0, 8).map((slot) => <button type="button" key={slot.time} className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
        {!slots.length && <span>Nenhum horÃ¡rio nesta seleÃ§Ã£o.</span>}
      </div>
      <a className="primary-button booking-wide-button" href={href}>Continuar Agendamento</a>
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
  const description = [elegantProductName(item.material), cleanDisplayText(item.size)].filter(Boolean).join(" Â· ");
  const detail = [elegantProductName(item.color), elegantProductName(item.stone)].filter(Boolean).join(" Â· ");
  const saleValue = Number(item.sale_value || 0);
  const promotionalValue = promotion ? promotionalPrice(saleValue, promotion) : null;
  const finalValue = promotionalValue || saleValue;
  const pixValue = finalValue * 0.95;
  const installmentValue = finalValue / 3;
  const shareText = `${settings.product_share_text || "Olha essa joia da Aura Clinic:"} ${productName} - ${description} - ${currency.format(finalValue)}.`;
  const notifyText = `OlÃ¡! Quero ser avisada quando a joia ${productName} voltar ao estoque.`;
  const stockText = catalogStockText(item, theme, settings);
  const available = Number(item.quantity || 0) > 0 && item.status !== "esgotado";

  return (
    <article className="catalog-product-card">
      <figure>
        {(item.badge || promotion || !available) && <em className={`catalog-product-badge ${!available ? "unavailable" : ""}`}>{!available ? "IndisponÃ­vel" : promotion ? "PromoÃ§Ã£o" : cleanDisplayText(item.badge)}</em>}
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
        {finalValue >= 60 && <span className="catalog-payment-line muted">atÃ© 3x de {currency.format(installmentValue)} sem juros</span>}
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
    selectedColor && { label: "ObservaÃ§Ã£o de Cor", value: elegantProductName(selectedColor) },
    item.stone && { label: "Pedra", value: elegantProductName(item.stone) },
    selectedVariant.size && { label: "Tamanho", value: selectedVariant.size },
    selectedVariant.thickness && { label: "Espessura", value: selectedVariant.thickness },
    selectedVariant.length && { label: "Comprimento", value: selectedVariant.length },
    selectedVariant.diameter && { label: "DiÃ¢metro", value: selectedVariant.diameter },
    selectedVariant.thread_type && { label: "Tipo de Rosca", value: elegantProductName(selectedVariant.thread_type) },
    item.weight_grams ? { label: "Peso", value: `${item.weight_grams} g` } : null,
    item.package_length_cm || item.package_width_cm || item.package_height_cm ? { label: "Embalagem", value: `${item.package_length_cm || 0} x ${item.package_width_cm || 0} x ${item.package_height_cm || 0} cm` } : null,
    item.physical_location && { label: "LocalizaÃ§Ã£o", value: item.physical_location }
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
            <a className="secondary-button" href="/catalogo">Voltar ao catÃ¡logo</a>
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
            <span className={`catalog-product-badge detail ${available ? "" : "unavailable"}`}>{available ? item.badge || "DisponÃ­vel" : "IndisponÃ­vel"}</span>
            <p className="catalog-breadcrumb">CatÃ¡logo / {cleanDisplayText(item.category || "Joias")} / {cleanDisplayText(item.subcategory || productName)}</p>
            <h1>{productName}</h1>
            <p className="catalog-product-description">{description}</p>
            {availableVariants.length > 0 && (
              <div className="catalog-variant-picker">
                <label>
                  <span>Escolha a VariaÃ§Ã£o</span>
                  <select value={selectedVariantId} onChange={(event) => setSelectedVariantId(event.target.value)}>
                    {availableVariants.map((variant) => (
                      <option key={variant.id} value={variant.id} disabled={Number(variant.quantity || 0) <= 0}>
                        {variantCatalogLabel(variant)} Â· {variant.quantity > 0 ? `${variant.quantity} disponÃ­veis` : "IndisponÃ­vel"}
                      </option>
                    ))}
                  </select>
                </label>
                {colorOptions.length > 0 && (
                  <label>
                    <span>ObservaÃ§Ã£o de Cor / AnodizaÃ§Ã£o</span>
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
              {settings.whatsapp_phone && <a className="secondary-button" href={whatsappCatalogUrl(`OlÃ¡! Quero informaÃ§Ãµes sobre ${productName}, ${variantCatalogLabel(selectedVariant)}${selectedColor ? `, na cor ${selectedColor}` : ""}.`, settings.whatsapp_phone)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Falar com a Aura</a>}
              <a className="secondary-button" href={whatsappShareUrl(`${settings.product_share_text || "Olha essa joia da Aura Clinic:"} ${item.name} - ${currency.format(saleValue)}.`)} target="_blank" rel="noreferrer">Compartilhar</a>
            </div>
            {item.notes && <div className="catalog-notes-box"><strong>ObservaÃ§Ãµes</strong><p>{item.notes}</p></div>}
          </div>
        </section>

        {related.length > 0 && (
          <section className="catalog-related-section">
            <div className="panel-heading">
              <h2>Mais opÃ§Ãµes parecidas</h2>
              <a className="secondary-button" href="/catalogo">Ver catÃ¡logo</a>
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
    ? `OlÃ¡! Quero ajuda com estas joias favoritas: ${safeFavorites.map((item) => item.name).join(", ")}.`
    : "OlÃ¡! Quero ajuda para escolher minhas joias favoritas no catÃ¡logo da Aura Clinic.";
  const message = safeOrderItems.length
    ? `OlÃ¡! Quero agendar com estas joias: ${safeOrderItems.map((item) => `${item.qty || 1}x ${item.name}${item.customer_notes ? ` (${item.customer_notes})` : ""}`).join(", ")}. Total aproximado: ${currency.format(asNumber(orderTotal))}.`
    : "OlÃ¡! Quero ajuda para montar meu pedido no catÃ¡logo da Aura Clinic.";

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
                <span>{[item.material, item.selected_color || item.color, item.selected_variant_name || item.size].map(elegantProductName).filter(Boolean).join(" Â· ")}</span>
                <small>{isFavorites ? currency.format(item.sale_value || 0) : `${item.qty || 1}x Â· ${currency.format(item.sale_value || 0)}`}</small>
                {!isFavorites && <textarea value={item.customer_notes || ""} onChange={(event) => onUpdateOrderNotes(item.order_key || item.id, event.target.value)} placeholder="ObservaÃ§Ãµes de cor, tamanho ou envio" />}
              </div>
              <button onClick={() => isFavorites ? onRemoveFavorite(item.id) : onRemoveOrder(item.order_key || item.id)}>Remover</button>
            </article>
          )) : <p className="empty-state">{isFavorites ? "Nenhuma joia favoritada ainda." : "Seu pedido ainda estÃ¡ vazio."}</p>}
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

function PublicCheckout() {
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
      setError("Seu pedido estÃ¡ vazio.");
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
      setError(json.error || "NÃ£o foi possÃ­vel concluir a compra.");
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
            <a className="primary-button" href="/catalogo">Voltar ao catÃ¡logo</a>
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
          <a className="secondary-button" href="/catalogo">Voltar ao catÃ¡logo</a>
        </header>
        <div className="checkout-grid">
          <form className="panel appointment-form" onSubmit={submit}>
            <div className="panel-heading">
              <h2>Finalizar compra</h2>
              <span>Vitrine pÃºblica Aura Clinic</span>
            </div>
            <div className="form-grid">
              <Input label="Nome completo" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
                <option>Pix</option>
                <option>Dinheiro</option>
                <option>CartÃ£o de crÃ©dito</option>
                <option>CartÃ£o de dÃ©bito</option>
              </Select>
            </div>
            <label>ObservaÃ§Ãµes
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="ObservaÃ§Ã£o de cor, tamanho, envio ou retirada." />
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
                    <small>{[item.material, item.color, item.size].filter(Boolean).join(" Â· ")}</small>
                    <span>{Number(item.qty || 1)}x {currency.format(item.sale_value || 0)}</span>
                  </div>
                </article>
              )) : <p className="empty-state">Seu carrinho estÃ¡ vazio. Volte ao catÃ¡logo e adicione joias.</p>}
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
  const safeData = asObject(data);
  const services = asArray(safeData.services);
  const professionals = asArray(safeData.professionals);
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
      setSlots(response.ok ? asArray(json.slots) : []);
      if (!response.ok) setError(json.error || "NÃ£o foi possÃ­vel carregar os horÃ¡rios.");
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
    if (!response.ok) return setError(json.error || "NÃ£o foi possÃ­vel solicitar o agendamento.");
    setConfirmed(json);
    setStep(7);
  }

  return (
    <main className="public-booking-page">
      <section className="booking-shell">
        <header className="booking-public-header">
          <a className="catalog-client-brand" href="/catalogo"><strong>Aura Clinic</strong><span>Piercing</span></a>
          <a className="secondary-button" href="/catalogo">Ver CatÃ¡logo</a>
        </header>
        <div className="booking-hero">
          <span className="eyebrow">Agendamento online</span>
          <h1>Reserve Seu HorÃ¡rio Na Aura Clinic</h1>
          <p>Escolha ServiÃ§o, Profissional, Data E HorÃ¡rio DisponÃ­vel. A equipe confirma manualmente sua solicitaÃ§Ã£o.</p>
        </div>
        <div className="booking-progress">
          {["ServiÃ§o", "Profissional", "Data", "HorÃ¡rio", "Dados", "Resumo"].map((label, index) => (
            <button key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => step > index + 1 && setStep(index + 1)}>
              <strong>{index + 1}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {step === 1 && <BookingChoiceGrid title="Escolha O ServiÃ§o" items={services} value={form.service_id} onSelect={(id) => { setForm({ ...form, service_id: id, appointment_time: "" }); setStep(2); }} render={(item) => <><strong>{item.name}</strong><p>{item.description}</p><span>{item.duration_minutes} min  {currency.format(item.base_price || item.price || 0)}</span></>} />}
        {step === 2 && <BookingChoiceGrid title="Escolha A Profissional" items={professionals} value={form.professional_id} onSelect={(id) => { setForm({ ...form, professional_id: id, appointment_time: "" }); setStep(3); }} render={(item) => <><strong>{item.name}</strong><p>{item.specialty || "Body Piercer Aura"}</p></>} />}
        {step === 3 && (
          <section className="booking-panel booking-date-card">
            <span className="booking-section-kicker">Etapa 3 Â· Data</span>
            <h2>Escolha a Data</h2>
            <p>Os horÃ¡rios serÃ£o carregados automaticamente para o dia escolhido.</p>
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
            <span className="booking-section-kicker">Etapa 4 Â· HorÃ¡rios</span>
            <h2>Agende seu HorÃ¡rio</h2>
            <p className="booking-selected-date">{form.appointment_date ? formatLongDate(form.appointment_date) : "Selecione uma data para ver os horÃ¡rios."}</p>
            <div className="booking-date-strip compact">
              {bookingDates.map((date) => (
                <button key={date.value} type="button" className={form.appointment_date === date.value ? "active" : ""} onClick={() => setForm({ ...form, appointment_date: date.value, appointment_time: "" })}>
                  <strong>{date.day}</strong><span>{date.weekday}</span>
                </button>
              ))}
            </div>
            {loadingSlots && <p className="empty-state">Carregando horÃ¡rios...</p>}
            <div className="slot-grid">
              {slots.map((slot) => <button key={slot.time} className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
            </div>
            {!loadingSlots && !slots.length && <p className="empty-state">Nenhum horÃ¡rio disponÃ­vel nesta data.</p>}
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
              <label>Foto de referÃªncia<input type="file" accept="image/*" onChange={(event) => setForm({ ...form, reference_photo: event.target.files?.[0] })} /></label>
            </div>
            <label>ObservaÃ§Ãµes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <button className="primary-button booking-wide-button" disabled={!form.full_name || !form.whatsapp} onClick={() => setStep(6)}>Ver Resumo</button>
          </section>
        )}
        {step === 6 && (
          <section className="booking-panel booking-summary">
            <span className="booking-section-kicker">Etapa 6  Resumo</span>
            <h2>Resumo Da SolicitaÃ§Ã£o</h2>
            <p><strong>ServiÃ§o:</strong> {selectedService?.name}</p>
            <p><strong>Profissional:</strong> {selectedProfessional?.name}</p>
            <p><strong>Data E HorÃ¡rio:</strong> {formatLongDate(form.appointment_date)} ?s {form.appointment_time}</p>
            <p><strong>Valor:</strong> {currency.format(selectedService?.base_price || selectedService?.price || 0)}</p>
            <p><strong>Sinal:</strong> {currency.format(selectedService?.deposit_value || 0)}</p>
            <p><strong>Regras:</strong> {data.rules?.cancellation}</p>
            <label>Comprovante Do Sinal Pix<input type="file" accept="image/*,.pdf" onChange={(event) => setForm({ ...form, payment_proof: event.target.files?.[0] })} /></label>
            {error && <span className="form-error">{error}</span>}
            <button className="primary-button booking-wide-button" onClick={submit}>Confirmar SolicitaÃ§Ã£o</button>
          </section>
        )}
        {step === 7 && (
          <section className="booking-panel booking-confirmation">
            <CheckCircle2 size={42} />
            <span className="booking-section-kicker">SolicitaÃ§Ã£o enviada</span>
            <h2>SolicitaÃ§Ã£o Enviada</h2>
            <p>Seu horÃ¡rio ficou como pendente. A Aura Clinic vai confirmar manualmente pelo WhatsApp.</p>
            <strong>{confirmed?.procedure}  {formatLongDate(confirmed?.appointment_date)} ?s {confirmed?.appointment_time}</strong>
            <a className="primary-button booking-wide-button" href="/catalogo">Voltar Ao CatÃ¡logo</a>
          </section>
        )}
      </section>
    </main>
  );
}

function LegacySidebar({ page, role, setPage, open, onLogout }) {
  const items = [
    ["dashboard", Home, "Dashboard"],
    ["erp", ShieldCheck, "Aura ERP"],
    ["catalog", Gem, "CatÃ¡logo"],
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

function Dashboard({ user, setPage, alertsOpen, setAlertsOpen, alertsData, alertsLoading }) {
  const { data } = useFetch("/dashboard");

  if (data == null) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  return <PremiumDashboard data={data} user={user} setPage={setPage} alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen} alertsData={alertsData} alertsLoading={alertsLoading} />;
}

function PremiumDashboard({ data, user, setPage, alertsOpen, setAlertsOpen, alertsData, alertsLoading }) {
  const [revenueMode, setRevenueMode] = useState("mensal");
  const safeData = asObject(data);
  const safeStats = {
    todayCount: 0,
    pendingCount: 0,
    completedCount: 0,
    revenue: 0,
    criticalStock: 0,
    lowStockCount: 0,
    depositReceived: 0,
    monthForecast: 0,
    ...asObject(safeData.stats)
  };
  const adminDashboard = asObject(safeData.adminDashboard);
  const upcomingAppointments = asArray(adminDashboard.upcomingAppointments);
  const criticalStockItems = asArray(adminDashboard.criticalStock);
  const birthdaysItems = asArray(adminDashboard.birthdaysMonth);
  const procedureRanking = asArray(adminDashboard.procedureRanking);
  const jewelryRanking = asArray(adminDashboard.jewelryRanking);
  const categoryRanking = asArray(adminDashboard.categoryRanking);
  const returnClients = asArray(adminDashboard.returnClients);
  const todaysAppointments = asArray(safeData.todaysAppointments);

  const cards = [
    { label: "Agendamentos hoje", value: String(safeStats.todayCount ?? 0), icon: Calendar, action: "Ver agenda", page: "agenda", tone: "gold" },
    { label: "Clientes novos", value: String(upcomingAppointments.length || todaysAppointments.length), icon: UsersRound, action: "Ver clientes", page: "clients", tone: "nude" },
    { label: "Joias em estoque crÃ­tico", value: String(safeStats.lowStockCount ?? safeStats.criticalStock ?? 0), icon: Gem, action: "Ver estoque", page: "catalog", tone: "green" },
    { label: "Faturamento hoje", value: currency.format(Number(safeStats.depositReceived ?? 0)), icon: CircleDollarSign, action: "Ver Financeiro", page: "finance", tone: "brown" },
    { label: "Aniversariantes do mÃªs", value: String(birthdaysItems.length), icon: Cake, action: "Ver todos", page: "clients", tone: "gold" }
  ];

  const pendingValue = Math.max(
    Number(safeStats.monthForecast ?? 0) - Number(safeStats.depositReceived ?? 0),
    0
  );
  const revenueData = {
    diario: asArray(adminDashboard.dailyRevenue),
    semanal: asArray(adminDashboard.weeklyRevenue),
    mensal: asArray(adminDashboard.monthlyRevenue)
  }[revenueMode] || [];

  return (
    <section className="premium-dashboard">
      {alertsOpen && <AlertsPopup alerts={alertsData} loading={alertsLoading} onClose={() => setAlertsOpen(false)} onAction={(nextPage) => { setAlertsOpen(false); setPage(nextPage); }} />}

      <div className="premium-metric-grid">
        {cards.map(({ label, value, icon: Icon, action, page, tone, critical }) => (
          <article className={`premium-metric-card ${tone}`} key={label}>
            <div className="metric-icon"><Icon size={22} /></div>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
              {critical && <small>crÃ­tico</small>}
              <button type="button" onClick={() => setPage(page)}>{action} â†’</button>
            </div>
          </article>
        ))}
      </div>

      <div className="premium-dashboard-grid">
        <article className="panel revenue-card">
          <div className="panel-heading">
            <h2>Faturamento</h2>
            <div className="segmented compact">
              <button type="button" className={revenueMode === "diario" ? "active" : ""} onClick={() => setRevenueMode("diario")}>DiÃ¡rio</button>
              <button type="button" className={revenueMode === "semanal" ? "active" : ""} onClick={() => setRevenueMode("semanal")}>Semanal</button>
              <button type="button" className={revenueMode === "mensal" ? "active" : ""} onClick={() => setRevenueMode("mensal")}>Mensal</button>
            </div>
          </div>
          <RevenueLineChart data={revenueData} mode={revenueMode} />
        </article>

        <article className="panel upcoming-card">
          <div className="panel-heading">
            <h2>PrÃ³ximos agendamentos</h2>
            <button className="ghost-button" type="button" onClick={() => setPage("agenda")}>Ver todos</button>
          </div>
          <div className="premium-appointment-list">
            {upcomingAppointments.slice(0, 4).map((item) => (
              <button type="button" className="premium-appointment-row" key={item.id} onClick={() => setPage("agenda")}>
                <span className="dot-time"><i />{item.appointment_time}</span>
                <div className="avatar-circle">{initials(item.full_name)}</div>
                <div>
                  <strong>{item.full_name || "Cliente"}</strong>
                  <small>{item.procedure || "Procedimento"}<br />Prof. {item.professional_name || "â€”"}</small>
                </div>
                <em className={statusClass[item.status] || ""}>{item.status || "â€”"}</em>
                <ChevronRight size={18} />
              </button>
            ))}
            {!upcomingAppointments.length && <p className="empty-state">Nenhum prÃ³ximo agendamento.</p>}
          </div>
        </article>
      </div>

      <div className="premium-lower-grid">
        <article className="panel compact-list-card">
          <div className="panel-heading">
            <h2>Estoque crÃ­tico</h2>
            <button className="ghost-button" type="button" onClick={() => setPage("catalog")}>Ver estoque</button>
          </div>
          <div className="clean-list">
            {criticalStockItems.slice(0, 3).map((item) => (
              <div key={item.id || `${item.name}-${item.quantity}`}>
                <div className="jewel-thumb"><Gem size={21} /></div>
                <span><strong>{item.name || "Joia"}</strong><small>{item.color || item.category || "Sem categoria"}</small></span>
                <em>{Number(item.quantity || 0)} unidade{Number(item.quantity || 0) === 1 ? "" : "s"}</em>
              </div>
            ))}
            {!criticalStockItems.length && <p className="empty-state">Estoque sem alerta crÃ­tico.</p>}
          </div>
        </article>

        <article className="panel compact-list-card">
          <div className="panel-heading">
            <h2>Aniversariantes do mÃªs</h2>
            <button className="ghost-button" type="button" onClick={() => setPage("client-center")}>Ver todos</button>
          </div>
          <div className="clean-list birthday-list">
            {birthdaysItems.slice(0, 3).map((item) => (
              <div key={item.id || `${item.full_name}-${item.birth_date}`}>
                <div className="avatar-circle">{initials(item.full_name)}</div>
                <span><strong>{item.full_name || "Cliente"}</strong><small>{formatLongDate(item.birth_date)}</small></span>
                <Cake size={18} />
              </div>
            ))}
            {!birthdaysItems.length && <p className="empty-state">Nenhum aniversÃ¡rio neste mÃªs.</p>}
          </div>
        </article>

        <article className="panel finance-summary-card">
          <div className="panel-heading">
            <h2>Resumo Financeiro</h2>
            <span>{new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
          </div>
          <div className="finance-summary-list">
            <div className="ok"><span>Faturamento</span><strong>{currency.format(Number(safeStats.revenue ?? safeStats.monthForecast ?? 0))}</strong></div>
            <div className="ok"><span>Sinais recebidos</span><strong>{currency.format(Number(safeStats.depositReceived ?? 0))}</strong></div>
            <div className="warn"><span>Pendentes</span><strong>{currency.format(Number(pendingValue || 0))}</strong></div>
            <div className="danger"><span>Despesas</span><strong>{currency.format(0)}</strong></div>
          </div>
          <div className="profit-box">
            <span>Lucro estimado</span>
            <strong>{currency.format(Number(safeStats.revenue ?? safeStats.monthForecast ?? 0))}</strong>
          </div>
        </article>
      </div>

      <div className="premium-ranking-grid">
        <div className="panel">
          <div className="panel-heading"><h2>Procedimentos mais feitos</h2><span>Ranking</span></div>
          <MiniBarChart data={procedureRanking} valueKey="total" labelKey="label" />
        </div>
        <div className="panel">
          <div className="panel-heading"><h2>Joias mais vendidas</h2><span>PeÃ§as vinculadas</span></div>
          <MiniBarChart data={jewelryRanking} valueKey="total" labelKey="label" />
        </div>
        <div className="panel">
          <div className="panel-heading"><h2>Ranking por categoria</h2><span>Joalherias</span></div>
          <MiniBarChart data={categoryRanking} valueKey="total" labelKey="label" />
        </div>
        <DashboardList title="Clientes em retorno" items={returnClients} render={(item) => `${formatDate(item.due_date)} Â· ${item.full_name || "Cliente"} Â· ${item.reminder_day || 0} dias`} />
      </div>
    </section>
  );
}

function RevenueLineChart({ data = [], mode = "mensal" }) {
  const safeData = asArray(data);
  const normalized = safeData.length ? safeData : [{ month: new Date().toISOString().slice(0, 7), total: 0 }];
  const max = Math.max(...normalized.map((item) => asNumber(item?.total)), 1);
  const points = normalized.map((item, index) => {
    const x = normalized.length === 1 ? 50 : (index / (normalized.length - 1)) * 100;
    const y = 88 - (asNumber(item?.total) / max) * 66;
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
        <strong>{currency.format(asNumber(last?.total))}</strong>
      </div>
      <div className="chart-months">
        {normalized.map((item, index) => <span key={`${item.month || item.label || index}`}>{formatRevenueAxisLabel(item, mode)}</span>)}
      </div>
    </div>
  );
}

function MiniBarChart({ data = [], valueKey, labelKey, currencyValue }) {
  const safeData = asArray(data);
  const max = Math.max(...safeData.map((item) => asNumber(item?.[valueKey])), 1);
  if (!safeData.length) return <p className="empty-state">Sem dados para exibir.</p>;
  return (
    <div className="mini-chart">
      {safeData.map((item) => {
        const value = asNumber(item?.[valueKey]);
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
  const safeItems = asArray(items);
  return (
    <div className="panel dashboard-list-panel">
      <h2>{title}</h2>
      <div className="dashboard-list">
        {safeItems.length ? safeItems.map((item, index) => <p key={item?.id || index}>{render(item)}</p>) : <small>Sem registros.</small>}
      </div>
    </div>
  );
}

function AlertsPopup({ alerts, loading, onClose, onAction }) {
  const safeAlerts = asObject(alerts);
  const items = asArray(safeAlerts.items);
  const iconByCategory = {
    Estoque: Gem,
    Clientes: Cake,
    Relacionamento: Trophy
  };
  return (
    <div className="popup-backdrop" role="presentation" onClick={onClose}>
      <section className="alerts-popup" role="dialog" aria-modal="true" aria-label="Alertas da Aura Clinic" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">Central de alertas</span>
            <h2>O que precisa de atenÃ§Ã£o hoje</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar alertas">X</button>
        </header>
        {loading ? <Loading /> : items.length ? (
          <div className="alerts-grid real-alerts-grid">
            {items.map((item) => {
              const Icon = iconByCategory[item.category] || Bell;
              return (
                <article className={`alert-card priority-${item.priority || "low"}`} key={item.id}>
                  <div className="alert-card-icon"><Icon size={20} /></div>
                  <div className="alert-card-heading">
                    <span>{item.category || "Aura Clinic"}</span>
                    <em>{item.priority === "high" ? "Alta" : item.priority === "medium" ? "MÃ©dia" : "Baixa"}</em>
                  </div>
                  <h3>{item.title || "Alerta"}</h3>
                  <strong>{item.subject || ""}</strong>
                  <p>{item.description || "Verifique esta informaÃ§Ã£o no sistema."}</p>
                  {item.related_date && <small>{formatLongDate(item.related_date)}</small>}
                  {item.action_page && <button type="button" onClick={() => onAction?.(item.action_page)}>{item.action_label || "Ver detalhes"} <ChevronRight size={15} /></button>}
                </article>
              );
            })}
          </div>
        ) : <div className="alerts-empty-state"><Bell size={28} /><strong>Nenhum alerta importante no momento.</strong><span>EstÃ¡ tudo em ordem por aqui.</span></div>}
      </section>
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
        <h2>NÃ£o foi possÃ­vel carregar esta Ã¡rea.</h2>
        <p>{data.error}</p>
        <small>Reinicie o servidor com npm.cmd run dev para carregar a nova rota /api/erp.</small>
      </section>
    );
  }
  const safeData = asObject(data);
  const product = asObject(safeData.product);
  const metrics = asObject(safeData.metrics);
  const modules = asArray(safeData.modules).filter((item) => moduleFilter === "todos" || item?.status === moduleFilter);
  const crm = asArray(safeData.crm);
  const catalogItems = asArray(safeData.catalogItems);
  const coupons = asArray(safeData.coupons);
  const influencers = asArray(safeData.influencers);
  const consultancies = asArray(safeData.consultancies);
  const academy = asArray(safeData.academy);
  const contentPlanner = asArray(safeData.contentPlanner);
  const bodyMap = asArray(safeData.bodyMap);

  return (
    <section className="erp-page">
      <div className="erp-hero panel">
        <div>
          <span className="eyebrow">SaaS multiempresa</span>
          <h2>{product.name || "Aura ERP"}</h2>
          <p>{product.positioning || "GestÃ£o integrada para a Aura Clinic."}</p>
          <div className="erp-stack">
            {asArray(product.stackTarget).map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div className="erp-metrics">
          <Metric label="EstÃºdios" value={asNumber(metrics.studios)} />
          <Metric label="Clientes" value={asNumber(metrics.clients)} />
          <Metric label="Agendamentos" value={asNumber(metrics.appointments)} />
          <Metric label="Receita" value={currency.format(asNumber(metrics.revenue))} />
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
            {crm.map((item) => <div key={item.stage}><span>{item.stage}</span><strong>{asNumber(item.total)}</strong></div>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Catalogo online" subtitle="Vitrine publica de joalherias">
          <div className="erp-catalog-preview">
            {catalogItems.slice(0, 4).map((item) => (
              <article key={item.id}>
                <img src={item.photo_url} alt={item.name} />
                <strong>{item.name}</strong>
                <span>{currency.format(item.sale_value)} Â· {item.quantity} un.</span>
              </article>
            ))}
          </div>
        </ERPPanel>
        <ERPPanel title="Cupons e influenciadores" subtitle="Rastreamento comercial">
          <div className="erp-list">
            {coupons.map((coupon) => <p key={coupon.code}><strong>{coupon.code}</strong><span>{asNumber(coupon.value)}% Â· {coupon.status}</span></p>)}
            {influencers.map((item) => <p key={item.instagram}><strong>{item.name}</strong><span>{item.coupon} Â· {asNumber(item.conversions)} conversÃµes</span></p>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Consultorias e Aura Academy" subtitle="Produtos digitais">
          <div className="erp-list">
            {consultancies.map((item) => <p key={item.name}><strong>{item.name}</strong><span>{currency.format(asNumber(item.price))} Â· {item.format}</span></p>)}
            {academy.map((item) => <p key={item.name}><strong>{item.name}</strong><span>{asNumber(item.lessons)} aulas Â· {asNumber(item.students)} alunos</span></p>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Calendario editorial" subtitle="Planejamento de conteudo Aura">
          <div className="content-planner">
            {contentPlanner.map((item) => <div key={item.day}><strong>{item.day}</strong><span>{item.theme}</span></div>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Mapa corporal" subtitle="Regioes mais realizadas">
          <div className="erp-list">
            {bodyMap.map((item) => <p key={item.region}><strong>{item.region}</strong><span>{asNumber(item.total)} procedimento(s)</span></p>)}
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
  if (normalized.includes("estoque") || normalized.includes("joalheria")) return { label: "Abrir catÃ¡logo", page: "catalog" };
  if (normalized.includes("catalogo")) return { label: "Abrir catÃ¡logo", page: "catalog" };
  if (normalized.includes("venda") || normalized.includes("ordem")) return { label: "Abrir vendas", page: "sales" };
  if (normalized.includes("Financeiro") || normalized.includes("relatorio")) return { label: "Abrir Financeiro", page: "finance" };
  if (normalized.includes("administrativo") || normalized.includes("configur")) return { label: "Abrir acessos", page: "admin" };
  if (normalized.includes("pos-atendimento") || normalized.includes("retorno")) return { label: "Abrir clientes", page: "client-center" };
  return { label: "Ver no Aura ERP", page: "erp" };
}

function legacyRemoveAccents(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function AgendaWorkspace() {
  const [tab, setTab] = useState("visual");
  const tabs = [
    {
      id: "visual",
      title: "Agenda visual",
      description: "CalendÃ¡rio mensal, semanal e diÃ¡rio com status dos atendimentos.",
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
      description: "ServiÃ§os online, horÃ¡rios disponÃ­veis, bloqueios e solicitaÃ§Ãµes pendentes.",
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
    { id: "personalizacao", title: "PersonalizaÃ§Ã£o", description: "Configure banners, cores, textos, categorias e destaques do catÃ¡logo.", icon: Sparkles },
    { id: "pÃºblico", title: "CatÃ¡logo pÃºblico", description: "Abra a vitrine que o cliente visualiza.", icon: ShoppingCart }
  ];
  if (tab !== "inicio") {
    return (
      <section className="workspace-page workspace-subpage">
        <button className="secondary-button workspace-back-button" type="button" onClick={() => setTab("inicio")}>
          <ChevronLeft size={16} />
          Voltar para CatÃ¡logo
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
          <span className="eyebrow">CatÃ¡logo e estoque</span>
          <h2>Organize a vitrine pÃºblica e o controle interno em Ã¡reas separadas.</h2>
          <p>Escolha Estoque para cadastrar uma nova joalheria, ajustar quantidades, medidas, valores e dados de envio. O catÃ¡logo pÃºblico atualiza automaticamente.</p>
        </div>
      </div>
      <div className="workspace-hub">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => id === "pÃºblico" ? window.open("/catalogo", "_blank", "noopener,noreferrer") : setTab(id)}>
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
    { id: "clientes", title: "Clientes", description: "HistÃ³rico, prontuÃ¡rios, pagamentos e fidelidade.", icon: UsersRound },
    { id: "termos", title: "Termos digitais", description: "Assinatura, aceite, PDF e vÃ­nculo ao agendamento.", icon: FileSignature },
    { id: "retornos", title: "PÃ³s-atendimento", description: "Lembretes, fotos, status de cicatrizaÃ§Ã£o e retornos.", icon: HeartPulse }
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
  const { data: procedures } = useFetch("/procedures");
  const [form, setForm] = useState(defaultAppointment());
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const safeOptions = asObject(options);
  const safeClients = asArray(clients);
  const safeAppointments = asArray(appointments);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(safeOptions.jewelry);
  const safeProfessionals = asArray(safeOptions.professionals);

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      setLoadingSlots(true);
      const response = await apiFetch(`/booking/slots?service_id=${form.service_id}&professional_id=${form.professional_id}&date=${form.appointment_date}`);
      const json = await response.json().catch(() => ({}));
      setLoadingSlots(false);
      setSlots(response.ok ? asArray(json.slots) : []);
      if (!response.ok) setError(json.error || "NÃ£o foi possÃ­vel carregar os horÃ¡rios.");
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  function selectClient(clientId) {
    if (!clientId) {
      setForm({ ...form, client_id: "", full_name: "", whatsapp: "", instagram: "", birth_date: "" });
      return;
    }
    const client = safeClients.find((item) => String(item.id) === String(clientId));
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
      setError(data.error || "NÃ£o foi possÃ­vel salvar o agendamento.");
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
          <div><span className="eyebrow">Agenda Aura</span><h2>Agendamentos</h2><span>Cadastre e acompanhe os prÃ³ximos atendimentos.</span></div>
          <button className="primary-button" type="button" onClick={() => setShowForm(true)}><Plus size={17} /> Novo Agendamento</button>
        </div>
      </div>
      {showForm && <div className="modal-backdrop appointment-modal-backdrop" onClick={() => setShowForm(false)}>
      <form className="panel appointment-form manual-appointment-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <div><h2>Novo Agendamento</h2><span>Profissional, serviÃ§o, cliente, data e horÃ¡rio.</span></div>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={() => setShowForm(false)}><X size={18} /></button>
        </div>
        <div className="form-section">
          <h3>Cliente</h3>
          <div className="form-grid">
            <Select label="Cliente cadastrado" value={form.client_id} onChange={selectClient}>
              <option value="">Novo cliente</option>
              {safeClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.full_name} - {client.whatsapp}
                </option>
              ))}
            </Select>
            <Input label="Nome completo" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} required />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} required />
            <Input label="Instagram" value={form.instagram} onChange={(v) => setForm({ ...form, instagram: v })} />
            <Input type="date" label="AniversÃ¡rio" value={form.birth_date} onChange={(v) => setForm({ ...form, birth_date: v })} />
          </div>
        </div>
        <div className="form-section">
          <h3>Procedimento</h3>
          <div className="form-grid">
            <Select label="Tipo de Atendimento" value={form.service_id} onChange={(value) => {
              const service = safeServices.find((item) => String(item.id) === String(value));
              setForm(calcRemaining({
                ...form,
                service_id: value,
                procedure: service?.name || "",
                total_value: Number(service?.base_price || service?.price || 0),
                deposit_value: Number(service?.deposit_value || 0),
                appointment_time: ""
              }));
            }} required>
              <option value="">Selecione</option>
              {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name} ({service.duration_minutes} min)</option>)}
            </Select>
            <Input label="Procedimento" value={form.procedure} onChange={(v) => setForm({ ...form, procedure: v })} required />
            <Input label="RegiÃ£o da perfuraÃ§Ã£o" value={form.piercing_region} onChange={(v) => setForm({ ...form, piercing_region: v })} required />
            <Select label="Joalheria escolhida" value={form.jewelry_id} onChange={(v) => setForm({ ...form, jewelry_id: v })}>
              <option value="">Sem joia vinculada</option>
              {safeJewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Select label="VariaÃ§Ã£o da Joia" value={form.jewelry_variant_id} onChange={(v) => setForm({ ...form, jewelry_variant_id: v })}>
              <option value="">Selecione</option>
              {asArray(safeJewelry.find((item) => String(item.id) === String(form.jewelry_id))?.variants).filter((variant) => asNumber(variant?.quantity) > 0).map((variant) => (
                <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} Â· {variant.quantity} un</option>
              ))}
            </Select>
            <Select label="Profissional" value={form.professional_id} onChange={(v) => setForm({ ...form, professional_id: v })} required>
              <option value="">Selecione</option>
              {safeProfessionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Input type="date" label="Data" value={form.appointment_date} onChange={(v) => setForm({ ...form, appointment_date: v, appointment_time: "" })} required />
          </div>
          <div className="manual-slot-field">
            <span>HorÃ¡rios DisponÃ­veis</span>
            <div className="manual-slot-grid">
              {loadingSlots && <small>Carregando horÃ¡rios...</small>}
              {asArray(slots).map((slot) => <button key={slot.time} type="button" className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
              {!loadingSlots && form.appointment_date && form.service_id && form.professional_id && !asArray(slots).length && <small>Nenhum horÃ¡rio livre neste dia.</small>}
            </div>
          </div>
          <label>DescriÃ§Ã£o do atendimento
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
          <label>ObservaÃ§Ãµes importantes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <label>Foto de referÃªncia
            <input type="file" accept="image/*" onChange={(event) => setForm({ ...form, reference_photo: event.target.files?.[0] || null })} />
            <small>Opcional. Use uma foto nÃ­tida da referÃªncia enviada pela cliente.</small>
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
          <h2>PrÃ³ximos Atendimentos</h2>
          <span>Com AÃ§Ãµes RÃ¡pidas</span>
        </div>
        <AppointmentList appointments={safeAppointments} onChanged={refresh} />
      </div>
    </section>
  );
}

function VisualCalendar() {
  const { data: options } = useFetch("/options");
  const [filters, setFilters] = useState({ mode: "mensal", professional_id: "", status: "" });
  const [currentDate, setCurrentDate] = useState(new Date());
  const { data, refresh } = useFetch(`/appointments?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v && !["mensal", "semanal", "diario"].includes(v))))}`);
  const safeOptions = asObject(options);
  const calendar = useMemo(() => buildCalendar(asArray(data), filters.mode, currentDate), [data, filters.mode, currentDate]);

  return (
    <section className="stack">
      <div className="toolbar">
        <div className="segmented">
          {["mensal", "semanal", "diario"].map((mode) => <button key={mode} className={filters.mode === mode ? "active" : ""} onClick={() => setFilters({ ...filters, mode })}>{mode}</button>)}
        </div>
        <Select label="Profissional" value={filters.professional_id} onChange={(v) => setFilters({ ...filters, professional_id: v })}>
          <option value="">Todos</option>
          {asArray(safeOptions.professionals).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
          <option value="">Todos</option>
          {statuses().map((status) => <option key={status}>{status}</option>)}
        </Select>
        <div className="calendar-nav">
          <button aria-label="PerÃ­odo anterior" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, -1))}><ChevronLeft size={18} /></button>
          <strong>{calendar.title}</strong>
          <button aria-label="PrÃ³ximo perÃ­odo" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, 1))}><ChevronRight size={18} /></button>
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
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "SÃ¡b"].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
      {days.map((day) => (
        <article className={`calendar-cell ${day.isOutside ? "outside" : ""} ${day.isToday ? "today" : ""}`} key={day.key}>
          <header>
            <span>{day.date.getDate()}</span>
            {day.isToday && <strong>Hoje</strong>}
          </header>
          <div className="calendar-events">
            {asArray(day.items).map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} />)}
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
          <div>{asArray(slot.items).map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} />)}</div>
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
          <input placeholder="Buscar por nome, observaÃ§Ã£o de cor, tamanho, espessura ou categoria" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </label>
        <Select label="Material" value={filters.material} onChange={(v) => setFilters({ ...filters, material: v })}>
          <option value="">Todos</option>
          <option>titÃ¢nio grau implante</option><option>ouro 14k</option><option>ouro 18k</option><option>aÃ§o</option><option>outro</option>
        </Select>
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
          <option value="">Todos</option>
          <option>disponÃ­vel</option><option>baixo estoque</option><option>esgotado</option>
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
  const safeItems = asArray(items);
  return (
    <div className="inventory-product-list">
      {safeItems.map((item) => (
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
            <p>{[item.category, item.subcategory].map(cleanDisplayText).filter(Boolean).join(" Â· ")}</p>
            <div className="inventory-inline-meta">
              <span className="stock-chip">{item.quantity} em estoque</span>
              <span className="inventory-visual-tag">{item.variant_count || item.variants?.length || 0} variaÃ§Ãµes</span>
              <strong>A partir de {currency.format(item.sale_value || 0)}</strong>
            </div>
            <div className="card-actions">
              {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Entrada"); }}>Entrada</button>}
              {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "SaÃ­da"); }}>SaÃ­da</button>}
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
  const apiItems = asArray(data);
  const items = apiItems;
  const safeOptions = asObject(options);
  const rawInventoryOptions = asObject(safeOptions.inventoryOptions);
  const inventoryOptions = {
    category: asArray(rawInventoryOptions.category),
    size: asArray(rawInventoryOptions.size),
    thickness: asArray(rawInventoryOptions.thickness)
  };
const optionJewelry = asArray(safeOptions.jewelry);
const safeOptionJewelry = asArray(optionJewelry);
const inventoryJewelry = asArray(safeOptions.inventoryJewelry || []);
const catalogJewelry = asArray(safeOptions.catalogJewelry || []);
const safeInventoryJewelry = asArray(inventoryJewelry);
const safeCatalogJewelry = asArray(catalogJewelry);

const fallbackJewelry = [...safeInventoryJewelry, ...safeCatalogJewelry];
const allJewelry = safeOptionJewelry.length
    ? safeOptionJewelry
    : fallbackJewelry.length
      ? fallbackJewelry
      : items;

const allVariants = asArray(allJewelry).flatMap((item) =>
  asArray(item?.variants)
);
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
    if (effectiveStatus === "critico" || effectiveStatus === "crÃ­tico") return inventoryStockState(item) === "critical";
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
          <nav className="inventory-breadcrumb" aria-label="NavegaÃ§Ã£o do estoque">
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
            <p>Produtos, variaÃ§Ãµes e movimentaÃ§Ãµes em uma navegaÃ§Ã£o simples.</p>
          </div>
          <div className="inventory-hero-actions">
            <button className="primary-button" type="button" onClick={openNewProduct}><Gem size={16} /> Nova Joia</button>
          </div>
        </header>

        <nav className="inventory-module-tabs" aria-label="MÃ³dulos do estoque">
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
              <nav className="inventory-list-breadcrumb" aria-label="NavegaÃ§Ã£o por categoria">
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
                  <input placeholder="Buscar joia, SKU ou variaÃ§Ã£o..." value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
                </label>
                <Select label="Categoria" value={filters.category} onChange={(value) => setFilters({ ...filters, category: value })}>
                  <option value="">Categoria</option>
                  {catalogFilterOptions(allJewelry).categories.map((option) => <option key={option}>{option}</option>)}
                </Select>
                <Select label="Status" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })}>
                  <option value="">Status</option>
                  <option value="ativos">Ativos</option>
                  <option value="critico">CrÃ­tico</option>
                  <option value="esgotados">Esgotados</option>
                </Select>
                <button type="button" className={`advanced-filter-toggle ${showAdvancedFilters ? "active" : ""}`} onClick={() => setShowAdvancedFilters((value) => !value)}>
                  <SlidersHorizontal size={17} /> Filtros AvanÃ§ados
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
                  <Select label="ObservaÃ§Ã£o de Cor" value={filters.color} onChange={(value) => setFilters({ ...filters, color: value })}>
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
                  <Select label="DiÃ¢metro" value={filters.diameter} onChange={(value) => setFilters({ ...filters, diameter: value })}>
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
                  <strong>Nenhuma joia cadastrada ainda.</strong>
                  <span>Cadastre uma nova joia ou ajuste os filtros para continuar.</span>
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
                  <span>Organize categorias, tamanhos, espessuras e profissionais sem sair desta pÃ¡gina.</span>
                </div>
                <button className="secondary-button" type="button" onClick={() => setShowManagement((value) => !value)}>
                  {showManagement ? "Ocultar cadastros" : "Abrir cadastros"}
                </button>
              </div>
              <div className="inventory-summary-grid compact">
                <Metric label="Categorias" value={String(inventoryOptions.category?.length || 0)} />
                <Metric label="Tamanhos" value={String(inventoryOptions.size?.length || 0)} />
                <Metric label="Espessuras" value={String(inventoryOptions.thickness?.length || 0)} />
                <Metric label="Profissionais" value={String(asArray(safeOptions.professionals).length)} />
              </div>
              {showManagement && <InventoryManagement options={inventoryOptions} professionals={asArray(safeOptions.professionals)} onChanged={refreshOptions} />}
            </div>
          )}

          {sectionTab === "unidades" && (
            <div className="inventory-section-card">
              <div className="panel-heading">
                <div>
                  <h2>Unidades e visÃ£o rÃ¡pida</h2>
                  <span>Resumo por peÃ§a com foco no que importa primeiro.</span>
                </div>
              </div>
              <div className="inventory-summary-grid compact">
                <Metric label="Total de peÃ§as" value={String(stockSummary.totalPieces)} />
                <Metric label="Total de produtos" value={String(stockSummary.totalProducts)} />
                <Metric label="CrÃ­ticas" value={String(stockSummary.critical)} />
                <Metric label="Esgotados" value={String(stockSummary.soldOut)} />
                <Metric label="Valor investido" value={currency.format(stockSummary.invested)} />
                <Metric label="Venda potencial" value={currency.format(stockSummary.potential)} />
                <Metric label="Lucro potencial" value={currency.format(stockSummary.potential - stockSummary.invested)} />
              </div>
              <div className="inventory-quick-flags">
                <span><strong>Ativos no CatÃ¡logo</strong><small>{allJewelry.filter((item) => Boolean(Number(item.is_catalog_active))).length} peÃ§as visÃ­veis na vitrine</small></span>
                <span><strong>Destaques Comerciais</strong><small>LanÃ§amentos, promoÃ§Ãµes e Ãºltimas unidades ficam na Loja Virtual</small></span>
                <span><strong>Alertas</strong><small>Criticidade e reposiÃ§Ã£o continuam no fluxo interno</small></span>
              </div>
              <div className="inventory-mini-list">
                {allJewelry.slice(0, 6).map((item) => (
                  <div key={item.id} className="inventory-mini-row">
                    <img src={catalogImageUrl(item.photo_url)} alt={item.name} />
                    <div>
                      <strong>{item.name}</strong>
                      <small>{[item.category, item.material].filter(Boolean).join(" Â· ")}</small>
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
                  <span>PeÃ§as com maior valor total em estoque.</span>
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
      is_published: Boolean(form.is_published),
      is_featured: Boolean(form.is_featured),
      is_new: Boolean(form.is_new),
      is_most_wanted: Boolean(form.is_most_wanted),
      is_promotion: Boolean(form.is_promotion),
      is_last_units: Boolean(form.is_last_units),
      image_url: form.image_url
    };
    const response = await apiFetch(`/jewelry${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "NÃ£o foi possÃ­vel salvar a joia.");
    setForm(defaultJewelry());
    onSaved(json);
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
    if (form.variants.length === 1) return setError("O produto precisa ter ao menos uma variaÃ§Ã£o.");
    setForm((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }));
  }

  return (
    <form className="panel jewelry-editor stock-editor" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Categoria â†’ Produto â†’ VariaÃ§Ãµes</span>
          <h2>{editing ? "Editar Produto" : "Novo Produto"}</h2>
          <span>Cadastre a joia uma vez e controle cada medida separadamente.</span>
        </div>
      </div>

      <nav className="editor-tabs">
        {[
          ["dados", "Dados"],
          ["variacoes", `VariaÃ§Ãµes (${form.variants.length})`],
          ["movimentacao", "MovimentaÃ§Ã£o"],
          ["comercial", "Comercial"],
          ["virtual", "CatÃ¡logo"]
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
            <textarea value={form.gallery_urls} onChange={(event) => setForm({ ...form, gallery_urls: event.target.value })} placeholder={"Cole uma URL por linha.\nCada imagem aparece no catÃ¡logo como galeria."} />
          </label>
          <div className="form-grid">
            <Input label="Pedra" value={form.stone} onChange={(value) => setForm({ ...form, stone: value })} />
            <Input label="IndicaÃ§Ã£o de Uso" value={form.piercing_type} onChange={(value) => setForm({ ...form, piercing_type: value })} />
          </div>
          <label>DescriÃ§Ã£o curta
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label>ObservaÃ§Ãµes internas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
        </div>
      )}

      {editorTab === "variacoes" && (
        <div className="editor-section">
          <div className="variant-editor-heading">
            <div>
              <h3>VariaÃ§Ãµes do Produto</h3>
              <p>Cada combinaÃ§Ã£o possui SKU, preÃ§o e estoque prÃ³prios.</p>
            </div>
            <button type="button" className="primary-button" onClick={addVariant}>+ Nova VariaÃ§Ã£o</button>
          </div>
          <div className="variant-editor-list">
            {form.variants.map((variant, index) => {
              const measure = variant.diameter
                ? `DiÃ¢metro ${variant.diameter}`
                : variant.length
                  ? `Comprimento ${variant.length}`
                  : variant.size
                    ? `Tamanho ${variant.size}`
                    : variant.variation_name || `VariaÃ§Ã£o ${index + 1}`;
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
                      : <span>Configure as especificaÃ§Ãµes</span>}
                  </div>
                  <div className="variant-card-business">
                    <span><small>Estoque</small><strong>{Number(variant.quantity || 0)} un</strong></span>
                    <span><small>PreÃ§o</small><strong>{currency.format(variant.sale_value || 0)}</strong></span>
                    <span><small>SKU</small><strong>{variant.sku || "NÃ£o informado"}</strong></span>
                  </div>
                  <div className="variant-card-actions">
                    <button type="button" aria-label="Editar VariaÃ§Ã£o" title="Editar VariaÃ§Ã£o" onClick={() => setEditingVariantIndex(index)}><Pencil size={16} /></button>
                    <button type="button" aria-label="Excluir VariaÃ§Ã£o" title="Excluir VariaÃ§Ã£o" onClick={() => removeVariant(index)}><Trash2 size={16} /></button>
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
              <h3>MovimentaÃ§Ã£o de Estoque</h3>
              <p>Registre entradas e saÃ­das sem misturar o histÃ³rico com o cadastro das variaÃ§Ãµes.</p>
            </div>
            {editing?.id && (
              <div className="product-movement-actions">
                <button type="button" className="secondary-button" onClick={() => onMovementOpen?.(editing, "Entrada")}>Registrar Entrada</button>
                <button type="button" className="secondary-button" onClick={() => onMovementOpen?.(editing, "SaÃ­da")}>Registrar SaÃ­da</button>
              </div>
            )}
          </div>
          {editing?.id
            ? <StockMovementHistory jewelryId={editing.id} />
            : <p className="empty-state">Salve o produto antes de registrar movimentaÃ§Ãµes.</p>}
        </div>
      )}

      {editorTab === "comercial" && (
        <div className="editor-section">
          <div className="form-grid">
            <Input label="LocalizaÃ§Ã£o FÃ­sica" value={form.physical_location} onChange={(value) => setForm({ ...form, physical_location: value })} />
          </div>
          <div className="inventory-stat-box">
            <div><span>VariaÃ§Ãµes Ativas</span><strong>{form.variants.length}</strong></div>
            <div><span>Total de PeÃ§as</span><strong>{form.variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0)}</strong></div>
            <div><span>Lucro Potencial</span><strong>{currency.format(potentialProfit)}</strong></div>
          </div>
          <div className="chip-toggle-grid">
            <ToggleChip label="Ativo no catÃ¡logo" checked={form.is_catalog_active} onChange={(value) => setForm({ ...form, is_catalog_active: value })} />
            <ToggleChip label="Destaque" checked={form.is_featured} onChange={(value) => setForm({ ...form, is_featured: value })} />
            <ToggleChip label="PromoÃ§Ã£o" checked={form.is_promotion} onChange={(value) => setForm({ ...form, is_promotion: value })} />
            <ToggleChip label="LanÃ§amento" checked={form.is_new} onChange={(value) => setForm({ ...form, is_new: value })} />
            <ToggleChip label="Mais desejado" checked={form.is_most_wanted} onChange={(value) => setForm({ ...form, is_most_wanted: value })} />
            <ToggleChip label="Ãšltimas unidades" checked={form.is_last_units} onChange={(value) => setForm({ ...form, is_last_units: value })} />
          </div>
        </div>
      )}

      {editorTab === "virtual" && (
        <div className="editor-section">
          <div className="form-grid">
            <Toggle label="Loja virtual ativa" checked={form.virtual_store_active} onChange={(value) => setForm({ ...form, virtual_store_active: value })} />
            <Toggle label="Publicar no catÃ¡logo pÃºblico" checked={form.is_published} onChange={(value) => setForm({ ...form, is_published: value })} />
          </div>
          {Boolean(form.virtual_store_active) && (
            <>
              <div className="form-grid">
                <Input label="URL da imagem (para catÃ¡logo)" value={form.image_url} onChange={(value) => setForm({ ...form, image_url: value })} placeholder="https://..." />
                <Input type="number" label="Peso para envio (g)" value={form.weight_grams} onChange={(value) => setForm({ ...form, weight_grams: value })} />
                <Input type="number" label="Comprimento da embalagem (cm)" value={form.package_length_cm} onChange={(value) => setForm({ ...form, package_length_cm: value })} />
                <Input type="number" label="Largura da embalagem (cm)" value={form.package_width_cm} onChange={(value) => setForm({ ...form, package_width_cm: value })} />
                <Input type="number" label="Altura da embalagem (cm)" value={form.package_height_cm} onChange={(value) => setForm({ ...form, package_height_cm: value })} />
                <Input label="Tipo de embalagem" value={form.package_type} onChange={(value) => setForm({ ...form, package_type: value })} />
                <Input type="number" label="Prazo de preparaÃ§Ã£o (dias)" value={form.preparation_days} onChange={(value) => setForm({ ...form, preparation_days: value })} />
              </div>
              <label>InformaÃ§Ãµes de frete / envio
                <textarea value={form.shipping_info} onChange={(event) => setForm({ ...form, shipping_info: event.target.value })} placeholder="Ex.: Envio para todo o Brasil, cÃ¡lculo por Correios ou transportadora, embalagem protegida." />
              </label>
              <label>ObservaÃ§Ãµes de frete e envio
                <textarea value={form.freight_notes} onChange={(event) => setForm({ ...form, freight_notes: event.target.value })} placeholder="Ex.: proteger pedra ou opala, usar caixa pequena, separar por variaÃ§Ãµes." />
              </label>
              <div className="form-grid">
                <Input label="SEO tÃ­tulo" value={form.seo_title} onChange={(value) => setForm({ ...form, seo_title: value })} />
                <Input label="SEO descriÃ§Ã£o" value={form.seo_description} onChange={(value) => setForm({ ...form, seo_description: value })} />
              </div>
            </>
          )}
        </div>
      )}

      {error && <span className="form-error">{error}</span>}
      <div className="modal-actions">
        {editing && <button type="button" className="secondary-button" onClick={onCancel}>Cancelar ediÃ§Ã£o</button>}
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
          <div><h2>Editar VariaÃ§Ã£o</h2><p>Configure apenas as especificaÃ§Ãµes necessÃ¡rias para {category || "esta categoria"}.</p></div>
          <button type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="variant-modal-fields">
          <Input label="Nome da VariaÃ§Ã£o" value={variant.variation_name} onChange={(value) => onChange({ variation_name: value })} />
          {usesSize && <Input label="Tamanho / Medida" value={variant.size} onChange={(value) => onChange({ size: value })} />}
          {usesDiameter && <Input label="DiÃ¢metro" value={variant.diameter} onChange={(value) => onChange({ diameter: value })} />}
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
            <option>TitÃ¢nio ASTM F136</option><option>Ouro 14k</option><option>Ouro 18k</option><option>AÃ§o</option><option>Outro</option>
          </Select>
          <fieldset className="anodization-fieldset">
            <legend>ObservaÃ§Ãµes de Cor / AnodizaÃ§Ã£o</legend>
            <p>Selecione todas as cores que o cliente poderÃ¡ solicitar para esta mesma joia.</p>
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
            <option value="">NÃ£o se aplica</option><option>Direito</option><option>Esquerdo</option><option>Universal</option>
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
            <Input type="number" label="Estoque MÃ­nimo" value={variant.low_stock_threshold} onChange={(value) => onChange({ low_stock_threshold: value })} />
          </div>
          <Toggle label="VariaÃ§Ã£o Ativa" checked={variant.is_active} onChange={(value) => onChange({ is_active: value })} />
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="primary-button" onClick={onClose}>Salvar VariaÃ§Ã£o</button></footer>
      </section>
    </div>
  );
}

function StockMovementHistory({ jewelryId }) {
  const { data } = useFetch(`/jewelry/${jewelryId}/movements`);
  const movements = data || [];
  return (
    <div className="movement-history">
      <h3>HistÃ³rico de movimentaÃ§Ã£o</h3>
      <div className="movement-history-list">
        {movements.slice(0, 6).map((movement) => (
          <div key={movement.id}>
            <strong>{movement.movement_type}</strong>
            <span>{movement.quantity} un Â· {formatDate(movement.movement_date)}</span>
            {movement.notes && <small>{movement.notes}</small>}
          </div>
        ))}
        {!movements.length && <p className="empty-state">Nenhuma movimentaÃ§Ã£o registrada.</p>}
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
          <span>{initialType === "SaÃ­da" ? "SaÃ­da rÃ¡pida" : "Entrada rÃ¡pida"}</span>
        </div>
        <div className="form-grid">
          <Select label="VariaÃ§Ã£o" value={form.variant_id} onChange={(value) => setForm({ ...form, variant_id: value })} required>
            {(item.variants || []).map((variant) => (
              <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} Â· {variant.quantity} un</option>
            ))}
          </Select>
          <Input type="number" label="Quantidade" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} required />
          <Select label="Tipo" value={form.movement_type} onChange={(value) => setForm({ ...form, movement_type: value })} required>
            <option>Entrada</option>
            <option>SaÃ­da</option>
            <option>Venda</option>
            <option>Ajuste</option>
            <option>Perda</option>
          </Select>
        </div>
        <label>ObservaÃ§Ã£o
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <p className="movement-date-hint">Data automÃ¡tica: {new Date().toLocaleDateString("pt-BR")}</p>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button">Salvar movimentaÃ§Ã£o</button>
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

  const safeData = asObject(data);
  const products = asArray(safeData.products);
  const customizationOptions = asObject(safeData.inventoryOptions);
  const categoryOptions = [
    ...asArray(customizationOptions.category).map((item) => item.name),
    ...new Set(products.map((item) => item.category).filter(Boolean))
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  async function save(path = "/catalog-customization", success = "AlteraÃ§Ãµes salvas.") {
    setError("");
    setMessage("");
    const payload = serializeCatalogCustomization(form);
    const response = await apiFetch(path, {
      method: "POST" === path.split("/").at(-1) ? "POST" : path.includes("publish") || path.includes("reset") ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: path.includes("reset") ? undefined : JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "NÃ£o foi possÃ­vel salvar.");
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
            <h2>PersonalizaÃ§Ã£o do CatÃ¡logo</h2>
            <p>Edite aparÃªncia, banners, categorias, produtos, promoÃ§Ãµes e textos sem mexer no cÃ³digo.</p>
          </div>
          <div>
            <button className="secondary-button" type="button" onClick={() => save("/catalog-customization/reset", "PadrÃ£o restaurado.")}>Restaurar padrÃ£o</button>
            <button className="primary-button" type="button" onClick={() => save("/catalog-customization/publish", "CatÃ¡logo publicado.")}>Publicar</button>
          </div>
        </header>

        <nav className="customization-tabs">
          {[
            ["aparencia", "AparÃªncia"],
            ["banners", "Banners"],
            ["componentes", "Componentes"],
            ["categorias", "Categorias"],
            ["produtos", "Produtos"],
            ["promocoes", "PromoÃ§Ãµes"],
            ["exibicao", "ExibiÃ§Ã£o"],
            ["textos", "Textos"],
            ["contato", "Contato"],
            ["seo", "SEO"]
          ].map(([id, label]) => (
            <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)}>{label}</button>
          ))}
        </nav>

        {activeSection === "aparencia" && (
          <CustomizationCard title="AparÃªncia do catÃ¡logo">
            <div className="form-grid">
              <ImageUploadField label="Logo" value={form.theme.logo_url} onChange={(value) => setForm(updateTheme(form, { logo_url: value }))} />
              <div className="form-grid compact-fields">
                <Input label="Nome da marca" value={form.theme.brand_name} onChange={(value) => setForm(updateTheme(form, { brand_name: value }))} />
                <Input label="Slogan" value={form.theme.slogan} onChange={(value) => setForm(updateTheme(form, { slogan: value }))} />
                <Input type="color" label="Cor principal" value={form.theme.primary_color} onChange={(value) => setForm(updateTheme(form, { primary_color: value }))} />
                <Input type="color" label="Cor secundÃ¡ria" value={form.theme.secondary_color} onChange={(value) => setForm(updateTheme(form, { secondary_color: value }))} />
                <Input type="color" label="Cor dos botÃµes" value={form.theme.button_color} onChange={(value) => setForm(updateTheme(form, { button_color: value }))} />
                <Input type="color" label="Cor do fundo" value={form.theme.background_color} onChange={(value) => setForm(updateTheme(form, { background_color: value }))} />
                <Select label="Fonte do tÃ­tulo" value={form.theme.title_font} onChange={(value) => setForm(updateTheme(form, { title_font: value }))}>
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
                    <Input label="TÃ­tulo" value={banner.title} onChange={(value) => setForm(updateList(form, "banners", index, { title: value }))} />
                    <Input label="SubtÃ­tulo" value={banner.subtitle} onChange={(value) => setForm(updateList(form, "banners", index, { subtitle: value }))} />
                  <Input label="Texto do botÃ£o" value={banner.button_text} onChange={(value) => setForm(updateList(form, "banners", index, { button_text: value }))} />
                  <Input label="Link do botÃ£o" value={banner.button_link} onChange={(value) => setForm(updateList(form, "banners", index, { button_link: value }))} />
                  <Input type="number" label="Altura do banner (px)" value={banner.banner_height} onChange={(value) => setForm(updateList(form, "banners", index, { banner_height: value }))} />
                  <Input type="number" label="Largura mÃ¡xima (px)" value={banner.banner_width} onChange={(value) => setForm(updateList(form, "banners", index, { banner_width: value }))} />
                  <Select label="Enquadramento" value={banner.banner_fit || "cover"} onChange={(value) => setForm(updateList(form, "banners", index, { banner_fit: value }))}>
                    <option value="cover">Cobrir Ã¡rea</option>
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
          <CustomizationCard title="Componentes do catÃ¡logo" action={<button type="button" onClick={() => setForm({ ...form, contentSections: [...form.contentSections, defaultContentSection(form.contentSections.length + 1)] })}>Novo componente</button>}>
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
                    <Input label="TÃ­tulo" value={section.title} onChange={(value) => setForm(updateList(form, "contentSections", index, { title: value }))} />
                    <Input type="number" label="Ordem" value={section.order} onChange={(value) => setForm(updateList(form, "contentSections", index, { order: value }))} />
                    <Select label="Tipo de mÃ­dia" value={section.media_type} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_type: value }))}>
                      <option value="image">foto</option>
                      <option value="video">vÃ­deo</option>
                      <option value="none">sem mÃ­dia</option>
                    </Select>
                    <Input label="Texto do botÃ£o" value={section.button_text} onChange={(value) => setForm(updateList(form, "contentSections", index, { button_text: value }))} />
                    <Input label="Link do botÃ£o" value={section.button_link} onChange={(value) => setForm(updateList(form, "contentSections", index, { button_link: value }))} />
                  </div>
                  {section.media_type === "image" ? <ImageUploadField label="Foto do componente" value={section.media_url} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_url: value }))} /> : <Input label="URL do vÃ­deo incorporado" value={section.media_url} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_url: value }))} />}
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
                    <Input label="Nome pÃºblico" value={category.public_name} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { public_name: value }))} />
                    <Select label="Ãcone" value={category.icon} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { icon: value }))}>
                      <option value="gem">diamante</option><option value="heart">coraÃ§Ã£o</option><option value="star">estrela</option><option value="sparkles">brilho</option><option value="shield">escudo</option>
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
                      <option value="">Sem selo</option><option value="LanÃ§amento">LanÃ§amento</option><option value="Mais vendido">Mais vendido</option><option value="PromoÃ§Ã£o">PromoÃ§Ã£o</option>
                    </Select>
                    <Input type="number" label="Ordem" value={product.sort_order} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { sort_order: value }))} />
                    <Toggle label="Ativo no catÃ¡logo" checked={product.is_active} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { is_active: value }))} />
                  </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "featuredProducts", index))}>Remover produto</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "promocoes" && (
          <CustomizationCard title="PromoÃ§Ãµes" action={<button type="button" onClick={() => setForm({ ...form, promotions: [...form.promotions, defaultPromotion()] })}>Nova promoÃ§Ã£o</button>}>
            <div className="custom-list">
              {form.promotions.map((promotion, index) => (
                <article key={index}>
                  <div className="form-grid">
                    <Input label="Nome da promoÃ§Ã£o" value={promotion.name} onChange={(value) => setForm(updateList(form, "promotions", index, { name: value }))} />
                    <Select label="Tipo de desconto" value={promotion.discount_type} onChange={(value) => setForm(updateList(form, "promotions", index, { discount_type: value }))}>
                      <option value="percent">porcentagem</option><option value="fixed">valor fixo</option>
                    </Select>
                    <Input type="number" label="Desconto" value={promotion.discount_value} onChange={(value) => setForm(updateList(form, "promotions", index, { discount_value: value }))} />
                    <Input type="date" label="Data inicial" value={promotion.start_date} onChange={(value) => setForm(updateList(form, "promotions", index, { start_date: value }))} />
                    <Input type="date" label="Data final" value={promotion.end_date} onChange={(value) => setForm(updateList(form, "promotions", index, { end_date: value }))} />
                    <Select label="Aplicar em" value={promotion.applies_to} onChange={(value) => setForm(updateList(form, "promotions", index, { applies_to: value }))}>
                      <option value="products">produtos especÃ­ficos</option><option value="categories">categorias especÃ­ficas</option><option value="all">todo catÃ¡logo</option>
                    </Select>
                    <Input label="IDs de produtos" value={promotion.product_ids} onChange={(value) => setForm(updateList(form, "promotions", index, { product_ids: value }))} />
                    <Input label="Categorias" value={promotion.category_ids} onChange={(value) => setForm(updateList(form, "promotions", index, { category_ids: value }))} />
                    <Toggle label="PromoÃ§Ã£o ativa" checked={promotion.is_active} onChange={(value) => setForm(updateList(form, "promotions", index, { is_active: value }))} />
                  </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "promotions", index))}>Remover promoÃ§Ã£o</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "exibicao" && (
          <CustomizationCard title="ConfiguraÃ§Ãµes de exibiÃ§Ã£o">
            <div className="toggle-grid">
              <Toggle label="Mostrar produtos sem estoque" checked={form.theme.show_out_of_stock} onChange={(value) => setForm(updateTheme(form, { show_out_of_stock: value }))} />
              <Toggle label="Mostrar quantidade em estoque" checked={form.theme.show_stock_quantity} onChange={(value) => setForm(updateTheme(form, { show_stock_quantity: value }))} />
              <Toggle label="Mostrar botÃ£o WhatsApp" checked={form.theme.show_whatsapp_button} onChange={(value) => setForm(updateTheme(form, { show_whatsapp_button: value }))} />
              <Toggle label="Mostrar botÃ£o Agendar" checked={form.theme.show_schedule_button} onChange={(value) => setForm(updateTheme(form, { show_schedule_button: value }))} />
              <Toggle label="Mostrar botÃ£o Comprar agora" checked={form.theme.show_buy_button} onChange={(value) => setForm(updateTheme(form, { show_buy_button: value }))} />
              <Toggle label="Mostrar favoritos" checked={form.theme.show_favorites} onChange={(value) => setForm(updateTheme(form, { show_favorites: value }))} />
            </div>
            <Select label="Texto de estoque" value={form.theme.stock_display_mode} onChange={(value) => setForm(updateTheme(form, { stock_display_mode: value }))}>
              <option value="status">Em estoque / Poucas unidades / IndisponÃ­vel</option>
              <option value="quantity">Mostrar quantidade</option>
              <option value="hidden">Ocultar estoque</option>
            </Select>
          </CustomizationCard>
        )}

        {activeSection === "textos" && (
          <CustomizationCard title="Textos do catÃ¡logo">
            <div className="form-grid">
              <Input label="TÃ­tulo da pÃ¡gina" value={form.settings.page_title} onChange={(value) => setForm(updateSettings(form, { page_title: value }))} />
              <Input label="SubtÃ­tulo" value={form.settings.subtitle} onChange={(value) => setForm(updateSettings(form, { subtitle: value }))} />
              <Input label="Mensagem indisponÃ­vel" value={form.settings.unavailable_message} onChange={(value) => setForm(updateSettings(form, { unavailable_message: value }))} />
              <Input label="Mensagem poucas unidades" value={form.settings.low_stock_message} onChange={(value) => setForm(updateSettings(form, { low_stock_message: value }))} />
            </div>
            <label>Texto institucional
              <textarea value={form.settings.institutional_text} onChange={(event) => setForm(updateSettings(form, { institutional_text: event.target.value }))} />
            </label>
            <label>Texto do rodapÃ©
              <textarea value={form.theme.footer_text} onChange={(event) => setForm(updateTheme(form, { footer_text: event.target.value }))} />
            </label>
          </CustomizationCard>
        )}

        {activeSection === "contato" && (
          <CustomizationCard title="Contato e InformaÃ§Ãµes da Empresa">
            <p className="customization-help">Estes dados aparecem no rodapÃ© do catÃ¡logo e nos botÃµes de atendimento ao cliente.</p>
            <div className="form-grid">
              <Input label="WhatsApp com DDD" value={form.settings.whatsapp_phone} onChange={(value) => setForm(updateSettings(form, { whatsapp_phone: value }))} />
              <Input label="Instagram" value={form.settings.company_instagram} onChange={(value) => setForm(updateSettings(form, { company_instagram: value }))} />
              <Input type="email" label="E-mail" value={form.settings.company_email} onChange={(value) => setForm(updateSettings(form, { company_email: value }))} />
              <Input label="HorÃ¡rio de Atendimento" value={form.settings.company_hours} onChange={(value) => setForm(updateSettings(form, { company_hours: value }))} />
            </div>
            <label>EndereÃ§o
              <textarea value={form.settings.company_address} onChange={(event) => setForm(updateSettings(form, { company_address: event.target.value }))} placeholder="Rua, nÃºmero, bairro, cidade e estado" />
            </label>
            <label>Mensagem Inicial do WhatsApp
              <textarea value={form.settings.whatsapp_message} onChange={(event) => setForm(updateSettings(form, { whatsapp_message: event.target.value }))} />
            </label>
          </CustomizationCard>
        )}

        {activeSection === "seo" && (
          <CustomizationCard title="SEO e compartilhamento">
            <div className="form-grid">
              <Input label="TÃ­tulo para Google" value={form.settings.seo_title} onChange={(value) => setForm(updateSettings(form, { seo_title: value }))} />
              <Input label="DescriÃ§Ã£o para Google" value={form.settings.seo_description} onChange={(value) => setForm(updateSettings(form, { seo_description: value }))} />
              <Input label="Texto padrÃ£o WhatsApp" value={form.settings.product_share_text} onChange={(value) => setForm(updateSettings(form, { product_share_text: value }))} />
              <ImageUploadField label="Imagem de compartilhamento" value={form.settings.share_image_url} onChange={(value) => setForm(updateSettings(form, { share_image_url: value }))} />
            </div>
          </CustomizationCard>
        )}

        {error && <span className="form-error">{error}</span>}
        {message && <span className="form-success">{message}</span>}
        <button className="primary-button customization-save" type="button" onClick={() => save()}>Salvar alteraÃ§Ãµes</button>
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
  const safeForm = asObject(form);
  const theme = { ...defaultCatalogCustomization().theme, ...asObject(safeForm.theme) };
  const activeBanner = [...asArray(safeForm.banners)].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).find((banner) => Boolean(Number(banner.is_active))) || defaultCatalogBanner(1);
  const previewProducts = asArray(products).slice(0, 4);
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
        <strong>PrÃ©-visualizaÃ§Ã£o em tempo real</strong>
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
  const safeData = asObject(data);
  const defaults = defaultCatalogCustomization();
  const settings = { ...defaults.settings, ...asObject(safeData.settings) };
  return {
    settings,
    theme: { ...defaults.theme, ...asObject(safeData.theme) },
    banners: (asArray(safeData.banners).length ? asArray(safeData.banners) : [defaultCatalogBanner(1)]).map((banner, index) => ({
      ...defaultCatalogBanner(index + 1),
      ...normalizeBooleanRecord(banner)
    })).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    contentSections: catalogContentSections(settings.content_sections),
    featuredCategories: (asArray(safeData.featuredCategories).length ? asArray(safeData.featuredCategories) : defaults.featuredCategories).map(normalizeBooleanRecord),
    featuredProducts: asArray(safeData.featuredProducts).map(normalizeBooleanRecord),
    promotions: asArray(safeData.promotions).map(normalizeBooleanRecord)
  };
}

function serializeCatalogCustomization(form) {
  return {
    ...form,
    settings: {
      ...form.settings,
      content_sections: JSON.stringify(asArray(form.contentSections).map((section, index) => ({
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
  return { ...form, [key]: asArray(form?.[key]).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) };
}

function removeListItem(form, key, index) {
  return { ...form, [key]: asArray(form?.[key]).filter((_, itemIndex) => itemIndex !== index) };
}

function moveListItem(list, index, direction) {
  const safeList = asArray(list);
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= safeList.length) return safeList;
  const copy = [...safeList];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item);
  return copy.map((entry, itemIndex) => ({ ...entry, sort_order: itemIndex + 1, order: itemIndex + 1 }));
}

function normalizeSortOrder(list, mode = "asc") {
  const sorted = [...asArray(list)].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const arranged = mode === "desc" ? sorted.reverse() : sorted;
  return arranged.map((entry, index) => ({ ...entry, sort_order: index + 1 }));
}

function defaultCatalogBanner(order) {
  return {
    title: "Escolha a joia perfeita para vocÃª",
    subtitle: "Joias de alta qualidade para realÃ§ar sua essÃªncia.",
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
    title: "Escolha sua joia com orientaÃ§Ã£o profissional",
    text: "Use este espaÃ§o para explicar materiais, cuidados, medidas, anodizaÃ§Ã£o, curadoria ou diferenciais da Aura Clinic.",
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
      page_title: "CatÃ¡logo Online",
      title: "Escolha a joia perfeita para vocÃª",
      subtitle: "Curadoria premium da Aura Clinic Piercing",
      institutional_text: "Joias selecionadas com cuidado, seguranÃ§a e estÃ©tica premium.",
      unavailable_message: "Produto indisponÃ­vel no momento.",
      low_stock_message: "Poucas unidades",
      footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.",
      seo_title: "Aura Clinic Piercing | CatÃ¡logo Online",
      seo_description: "Escolha joias premium para piercing na Aura Clinic.",
      share_image_url: "",
      product_share_text: "Olha essa joia da Aura Clinic:",
      content_sections: JSON.stringify([defaultContentSection(1)]),
      categories: `Todos,${JEWELRY_CATEGORY_OPTIONS.join(",")}`,
      whatsapp_phone: "",
      whatsapp_message: "OlÃ¡! Vim pelo catÃ¡logo online da Aura Clinic e quero ajuda para escolher uma joia.",
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

  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiFetch("/uploads", {
      method: "POST",
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Upload invalido.");
    onChange(data.url);
  } catch (err) {
    console.error(err);
    setError("NÃ£o foi possÃ­vel enviar a imagem.");
  } finally {
    setUploading(false);
    event.target.value = "";
  }
}
  return (
    <label className="image-upload-field">{label}
      <div className="image-upload-preview">
        <img src={catalogImageUrl(value)} alt={label} />
        <span><ImageIcon size={18} /> PrÃ©via da imagem</span>
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
        <p className="manager-help">Estrutura fixa para evitar produtos duplicados e manter o catÃ¡logo organizado.</p>
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
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel salvar.");
    setName("");
    setEditing(null);
    onChanged();
  }

  async function remove(item) {
    setError("");
    const response = await apiFetch(`/inventory-options/${item.id}`, { method: "DELETE" });
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel apagar.");
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
        {asArray(items).map((item) => (
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
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel salvar.");
    setForm({ name: "", specialty: "" });
    setEditing(null);
    onChanged();
  }

  async function remove(professional) {
    setError("");
    const response = await apiFetch(`/professionals/${professional.id}`, { method: "DELETE" });
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel apagar.");
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
        {asArray(professionals).map((professional) => (
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
  const safeItems = asArray(items);
  return (
    <div className="table-wrap inventory-admin-table compact-inventory-table">
      <table>
        <thead><tr><th>Produto</th><th>VariaÃ§Ãµes</th><th>Estoque Total</th><th>Status</th><th>Venda</th><th>AÃ§Ãµes</th></tr></thead>
        <tbody>{safeItems.map((item) => (
          <tr className="clickable-product-row" key={item.id} onClick={() => onOpen?.(item)}>
            <td>
              <div className="inventory-product-cell">
                <img src={catalogImageUrl(item.photo_url)} alt={elegantProductName(item.name)} />
                <span><strong>{elegantProductName(item.name)}</strong><small>{[item.category, item.subcategory].map(cleanDisplayText).filter(Boolean).join(" Â· ")}</small></span>
              </div>
            </td>
            <td>{item.variant_count || item.variants?.length || 0}</td>
            <td>{item.quantity}</td>
            <td><span className={`inventory-status ${inventoryStatusClass(item)}`}>{inventoryStatusLabel(item)}</span></td>
            <td>A partir de {currency.format(item.sale_value || 0)}</td>
            <td>
              <div className="table-actions">
                {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Entrada"); }}>Entrada</button>}
                {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "SaÃ­da"); }}>SaÃ­da</button>}
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
  if (data.error) return <ApiError message={data.error} />;
  const safeData = asObject(data);
  const totals = asObject(safeData.totals);
  const forecast = asObject(safeData.forecast);
  const methods = asArray(safeData.methods);
  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Recebido hoje" value={currency.format(asNumber(totals.day_total))} />
        <Metric label="Recebido na semana" value={currency.format(asNumber(totals.week_total))} />
        <Metric label="Recebido no mÃªs" value={currency.format(asNumber(totals.month_total))} />
        <Metric label="Total previsto" value={currency.format(asNumber(forecast.total))} />
        <Metric label="Total pendente" value={currency.format(asNumber(forecast.pending))} />
        <Metric label="Pagamento mais usado" value={safeData.mostUsedMethod || "Sem registros"} />
      </div>
      <div className="panel">
        <div className="panel-heading">
          <h2>RelatÃ³rio Financeiro</h2>
          <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.csv", "relatorio-aura-clinic.csv")}><Download size={16} /> Exportar CSV</button>
        </div>
        <div className="payment-bars">
          {methods.map((item) => <div key={item.method || item.name}><span>{item.method || "NÃ£o informado"}</span><strong>{asNumber(item.total)}</strong></div>)}
        </div>
      </div>
    </section>
  );
}

function Clients() {
  const { data } = useFetch("/clients");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const clients = asArray(data);
  return (
    <section className="client-grid">
      {clients.map((client) => (
        <article className="panel client-card" key={client.id}>
          <h2>{client.full_name}</h2>
          <p>{client.whatsapp} Â· {client.instagram}</p>
          {client.birth_date && <small>AniversÃ¡rio: {formatLongDate(client.birth_date)}</small>}
          <span>{client.notes}</span>
          <h3>HistÃ³rico</h3>
          {asArray(client.history).map((item) => <div className="history-item" key={item.id}><strong>{formatDate(item.appointment_date)}</strong><span>{item.procedure} Â· {item.jewelry_name || "sem joia"}</span><small>{item.status} Â· {currency.format(asNumber(item.total_value))}</small></div>)}
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
  if (data.error) return <ApiError message={data.error} />;
  const safeData = asObject(data);
  const totals = asObject(safeData.totals);
  const deposits = asObject(safeData.deposits);
  const forecast = asObject(safeData.forecast);
  const profit = asObject(safeData.profit);
  const expensesSummary = asObject(safeData.expensesSummary);
  const methods = asArray(safeData.methods);
  const expenses = asArray(safeData.expenses);
  const monthlyRevenue = asArray(safeData.monthlyRevenue);

  async function saveExpense(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expense)
    });
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel salvar a despesa.");
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
        <Metric label="Faturamento diÃ¡rio" value={currency.format(asNumber(totals.day_total))} />
        <Metric label="Faturamento semanal" value={currency.format(asNumber(totals.week_total))} />
        <Metric label="Faturamento mensal" value={currency.format(asNumber(totals.month_total))} />
        <Metric label="Sinais recebidos" value={currency.format(asNumber(deposits.monthTotal))} />
        <Metric label="Valores pendentes" value={currency.format(asNumber(forecast.pending))} />
        <Metric label="Lucro estimado" value={currency.format(asNumber(profit.estimated))} />
        <Metric label="Despesas fixas" value={currency.format(asNumber(expensesSummary.fixed_total))} />
        <Metric label="Despesas variÃ¡veis" value={currency.format(asNumber(expensesSummary.variable_total))} />
        <Metric label="Pagamento mais usado" value={safeData.mostUsedMethod || "Sem registros"} />
      </div>

      <div className="finance-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>GrÃ¡fico de faturamento mensal</h2>
            <span>Ãšltimos meses registrados</span>
          </div>
          <MonthlyChart data={monthlyRevenue} />
        </div>
        <div className="panel">
          <div className="panel-heading">
            <h2>Formas de pagamento</h2>
            <span>Mais usadas</span>
          </div>
          <div className="payment-bars">
            {methods.map((item) => <div key={item.method || item.name}><span>{item.method || "NÃ£o informado"}</span><strong>{asNumber(item.total)} Â· {currency.format(asNumber(item.amount))}</strong></div>)}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>RelatÃ³rios exportÃ¡veis</h2>
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
            <span>Fixa ou variÃ¡vel</span>
          </div>
          <div className="form-grid">
            <Input label="DescriÃ§Ã£o" value={expense.description} onChange={(value) => setExpense({ ...expense, description: value })} required />
            <Select label="Tipo" value={expense.expense_type} onChange={(value) => setExpense({ ...expense, expense_type: value })}>
              <option value="fixa">fixa</option>
              <option value="variavel">variÃ¡vel</option>
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
          <label>ObservaÃ§Ãµes
            <textarea value={expense.notes} onChange={(event) => setExpense({ ...expense, notes: event.target.value })} />
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button">Salvar despesa</button>
        </form>

        <div className="panel">
          <div className="panel-heading">
            <h2>Despesas lanÃ§adas</h2>
            <span>{currency.format(asNumber(expensesSummary.total))} no mÃªs</span>
          </div>
          <div className="expense-list">
            {expenses.map((item) => (
              <article key={item.id} className="expense-row">
                <div>
                  <strong>{item.description}</strong>
                  <span>{item.expense_type} Â· {item.category || "sem categoria"} Â· {formatDate(item.due_date)}</span>
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
  const { data: procedures } = useFetch("/procedures");
  const { data: jewelry } = useFetch("/jewelry");
  const { data: appointments } = useFetch("/appointments");
  const [tab, setTab] = useState("produto");
  const [form, setForm] = useState(defaultSalesOrderForm());
  const [line, setLine] = useState(defaultSalesLine());
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const safeOrders = asArray(orders);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(jewelry);
  const safeAppointments = asArray(appointments);

  useEffect(() => {
    setLine((current) => ({ ...current, item_type: tab === "servico" ? "servico" : "produto" }));
  }, [tab]);

  useEffect(() => {
    if (safeJewelry.length && tab !== "servico" && !line.product_id) {
      setLine((current) => ({ ...current, product_id: String(safeJewelry[0].id), item_name: safeJewelry[0].name, unit_price: safeJewelry[0].sale_value || 0 }));
    }
  }, [safeJewelry.length]);

  useEffect(() => {
    if (safeServices.length && (tab === "servico" || tab === "ordem")) {
      setLine((current) => ({ ...current, service_id: String(safeServices[0].id), item_name: safeServices[0].name, unit_price: safeServices[0].base_price || safeServices[0].price || 0 }));
    }
  }, [safeServices.length, tab]);

  if (!orders || !services || !jewelry || !appointments) return <Loading />;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthOrders = safeOrders.filter((order) => String(order?.created_at || "").startsWith(currentMonth) && order?.status !== "cancelada");
  const summary = {
    total: monthOrders.reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    products: monthOrders.filter((order) => order.order_type === "produto").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    services: monthOrders.filter((order) => order.order_type === "servico").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    mixed: monthOrders.filter((order) => order.order_type === "ordem_servico").reduce((sum, order) => sum + Number(order.total_value || 0), 0)
  };

  function addLineItem() {
    const quantity = Math.max(1, Number(line.quantity || 1));
    const entry = line.item_type === "servico" ?
       safeServices.find((item) => String(item.id) === String(line.service_id))
      : safeJewelry.find((item) => String(item.id) === String(line.product_id));
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
      setError("Adicione ao menos um item Ã  venda.");
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
      setError((await response.json()).error || "NÃ£o foi possÃ­vel salvar a venda.");
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
        <Metric label="Vendas no mÃªs" value={currency.format(summary.total)} />
        <Metric label="Produtos" value={currency.format(summary.products)} />
        <Metric label="ServiÃ§os" value={currency.format(summary.services)} />
        <Metric label="Ordens de serviÃ§o" value={currency.format(summary.mixed)} />
      </div>

      <div className="customization-tabs sales-tabs">
        {[
          ["produto", "Venda de produto"],
          ["servico", "Venda de serviÃ§o"],
          ["ordem", "Ordem de serviÃ§o"],
          ["historico", "HistÃ³rico"]
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab !== "historico" && (
        <div className="split-layout">
          <form className="panel appointment-form" onSubmit={saveOrder}>
            <div className="panel-heading">
              <h2>{tab === "ordem" ? "Nova ordem de serviÃ§o" : tab === "servico" ? "Venda de serviÃ§o" : "Venda de produto"}</h2>
              <span>Cadastro interno com baixa financeira</span>
            </div>
            <div className="form-grid">
              <Input label="Cliente" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              <Select label="Agendamento vinculado" value={form.appointment_id} onChange={(value) => setForm({ ...form, appointment_id: value })}>
                <option value="">Sem vÃ­nculo</option>
                {safeAppointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.full_name} Â· {formatDate(appointment.appointment_date)} Â· {appointment.appointment_time}
                  </option>
                ))}
              </Select>
              <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
                <option>Pix</option>
                <option>Dinheiro</option>
                <option>CartÃ£o de crÃ©dito</option>
                <option>CartÃ£o de dÃ©bito</option>
              </Select>
              <Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
                <option value="concluida">concluÃ­da</option>
                <option value="aberta">aberta</option>
                <option value="cancelada">cancelada</option>
              </Select>
            </div>

            <div className="sales-line-builder">
              <div className="sales-line-header">
                <strong>{tab === "servico" ? "Selecionar serviÃ§o" : "Selecionar joia"}</strong>
                <span>Adicione os itens da venda.</span>
              </div>
              <div className="form-grid">
                <Select label="Tipo do item" value={line.item_type} onChange={(value) => setLine({ ...line, item_type: value })}>
                  <option value="produto">produto</option>
                  <option value="servico">serviÃ§o</option>
                </Select>
                {line.item_type === "servico" ? (
                  <Select label="ServiÃ§o" value={line.service_id} onChange={(value) => {
                    const selected = safeServices.find((item) => String(item.id) === String(value));
                    setLine({
                      ...line,
                      service_id: value,
                      item_name: selected?.name || "",
                      unit_price: selected?.price || 0
                    });
                  }}>
                    {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </Select>
                ) : (
                  <Select label="Joia" value={line.product_id} onChange={(value) => {
                    const selected = safeJewelry.find((item) => String(item.id) === String(value));
                    setLine({
                      ...line,
                      product_id: value,
                      item_name: selected?.name || "",
                      unit_price: selected?.sale_value || 0
                    });
                  }}>
                    {safeJewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                )}
                <Input type="number" label="Quantidade" value={line.quantity} onChange={(value) => setLine({ ...line, quantity: value })} />
                <Input type="number" label="Valor unitÃ¡rio" value={line.unit_price} onChange={(value) => setLine({ ...line, unit_price: value })} />
              </div>
              <label>ObservaÃ§Ãµes do item
                <textarea value={line.notes} onChange={(event) => setLine({ ...line, notes: event.target.value })} />
              </label>
              <button className="secondary-button" type="button" onClick={addLineItem}>Adicionar item</button>
            </div>

            <div className="sales-items-list">
              {items.length ? items.map((item, index) => (
                <article key={`${item.item_name}-${index}`}>
                  <div>
                    <strong>{item.item_name}</strong>
                    <span>{saleItemLabel(item.item_type)} Â· {item.quantity}x Â· {currency.format(item.unit_price)}</span>
                    {item.notes && <small>{item.notes}</small>}
                  </div>
                  <button type="button" onClick={() => removeLine(index)}>Remover</button>
                </article>
              )) : <p className="empty-state">Nenhum item adicionado ainda.</p>}
            </div>

            <label>ObservaÃ§Ãµes da venda
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
            {error && <span className="form-error">{error}</span>}
            <button className="primary-button">Salvar venda</button>
          </form>

          <div className="panel">
            <div className="panel-heading">
              <h2>Atalhos e referÃªncia</h2>
              <span>{safeAppointments.length} agendamentos disponÃ­veis</span>
            </div>
            <div className="sales-quick-reference">
              <div>
                <strong>Produtos</strong>
                <small>Venda direta de joia, com baixa simples de estoque.</small>
              </div>
              <div>
                <strong>ServiÃ§os</strong>
                <small>Venda de procedimento avulso, sem depender de agenda.</small>
              </div>
              <div>
                <strong>Ordens de serviÃ§o</strong>
                <small>Registro interno com vÃ­nculo ao atendimento ou cliente.</small>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "historico" && (
        <div className="panel">
          <div className="panel-heading">
            <h2>HistÃ³rico de vendas</h2>
            <span>Pedidos do mÃªs com status e valor</span>
          </div>
          <div className="sales-history-list">
            {safeOrders.map((order) => (
              <article key={order.id} className="sales-history-row">
                <div>
                  <strong>{order.full_name}</strong>
                  <span>{saleOrderTypeLabel(order.order_type)} Â· {order.source} Â· {formatDate(order.created_at.slice(0, 10))}</span>
                  <small>{asArray(order.items).map((item) => `${item.quantity}x ${item.item_name}`).join(" Â· ")}</small>
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
            {!safeOrders.length && <p className="empty-state">Nenhuma venda registrada ainda.</p>}
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
  if (data.error) return <ApiError message={data.error} />;
  const users = asArray(data);

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/users${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel salvar o usuÃ¡rio.");
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
      setResetMessage(payload.error || "NÃ£o foi possÃ­vel limpar os dados.");
      return;
    }
    setResetConfirmation("");
    setResetMessage(payload.message || "Dados de demonstraÃ§Ã£o removidos.");
  }

  return (
    <section className="stack">
      <div className="split-layout">
        <form className="panel appointment-form" onSubmit={save}>
          <div className="panel-heading">
            <h2>{editing ? "Editar Acesso" : "Novo Acesso"}</h2>
            <span>NÃ­veis administrativos</span>
          </div>
          <div className="form-grid">
            <Input label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Input label="E-mail" value={form.email} onChange={(value) => setForm({ ...form, email: value })} required />
            <Input type="password" label={editing ? "Nova Senha Opcional" : "Senha"} value={form.password} onChange={(value) => setForm({ ...form, password: value })} required={!editing} />
            <Select label="NÃ­vel de Acesso" value={form.role} onChange={(value) => setForm({ ...form, role: value })}>
              <option value="admin">Administrador Geral</option>
              <option value="piercer">Body Piercer</option>
              <option value="reception">RecepÃ§Ã£o</option>
              <option value="finance">Financeiro</option>
            </Select>
          </div>
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button">{editing ? "Salvar AlteraÃ§Ãµes" : "Criar UsuÃ¡rio"}</button>
        </form>
        <div className="panel">
          <div className="panel-heading">
            <h2>UsuÃ¡rios</h2>
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/backup.sqlite", `backup-aura-clinic.sqlite`)}>Backup SQLite</button>
          </div>
          <div className="access-list">
            {users.map((user) => (
              <article className="access-row" key={user.id}>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email} Â· {roleLabel(user.role)}</span>
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
          <span className="eyebrow">PreparaÃ§Ã£o para Uso Real</span>
          <h2>Limpar Dados de DemonstraÃ§Ã£o</h2>
          <p>Remove clientes, produtos, variaÃ§Ãµes, agendamentos, vendas, despesas e lanÃ§amentos financeiros. UsuÃ¡rios, categorias e configuraÃ§Ãµes permanecem.</p>
        </div>
        <div className="admin-reset-action">
          <Input label="Digite RESETAR para confirmar" value={resetConfirmation} onChange={setResetConfirmation} />
          <button
            type="button"
            className="danger-button"
            disabled={resetConfirmation !== "RESETAR" || resetLoading}
            onClick={resetDemoData}
          >
            {resetLoading ? "Limpando..." : "Limpar Dados FictÃ­cios"}
          </button>
        </div>
        {resetMessage && <span className="admin-reset-message">{resetMessage}</span>}
      </article>
    </section>
  );
}

function BookingAdmin() {
  const { data: services, refresh: refreshServices } = useFetch("/services");
  const { data: procedures, refresh: refreshProcedures } = useFetch("/procedures");
  const { data: options } = useFetch("/options");
  const { data: availability, refresh: refreshAvailability } = useFetch("/availability");
  const { data: blocks, refresh: refreshBlocks } = useFetch("/schedule-blocks");
  const { data: appointments, refresh: refreshAppointments } = useFetch("/appointments?status=pendente");
  const [tab, setTab] = useState("servicos");
  const [serviceForm, setServiceForm] = useState(defaultServiceForm());
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [procedureForm, setProcedureForm] = useState(defaultProcedureForm());
  const [editingProcedureId, setEditingProcedureId] = useState(null);
  const [serviceError, setServiceError] = useState("");
  const [procedureError, setProcedureError] = useState("");
  const [blockForm, setBlockForm] = useState(defaultScheduleBlock());
  const professionals = asArray(asObject(options).professionals);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeAvailability = asArray(availability);
  const safeBlocks = asArray(blocks);
  const safeAppointments = asArray(appointments);

  if (services == null || procedures == null || availability == null || blocks == null || appointments == null) return <Loading />;

  function validateServiceForm() {
    if (!serviceForm.name.trim()) return "Informe o nome do serviço.";
    if (Number(serviceForm.base_price || 0) < 0) return "Preço não pode ser negativo.";
    if (Number(serviceForm.duration_minutes || 0) <= 0) return "Duração deve ser um número positivo.";
    return "";
  }

  function validateProcedureForm() {
    if (!procedureForm.name.trim()) return "Informe o nome do procedimento.";
    if (!procedureForm.service_id) return "Procedimento precisa ter um serviço vinculado.";
    if (Number(procedureForm.price || 0) < 0) return "Preço não pode ser negativo.";
    if (Number(procedureForm.duration_minutes || 0) <= 0) return "Duração deve ser um número positivo.";
    return "";
  }

  async function saveService(event) {
    event.preventDefault();
    setServiceError("");
    const error = validateServiceForm();
    if (error) return setServiceError(error);
    const response = await apiFetch(editingServiceId ? `/services/${editingServiceId}` : "/services", {
      method: editingServiceId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serviceForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setServiceError(payload.error || "Não foi possível salvar o serviço.");
    }
    setServiceForm(defaultServiceForm());
    setEditingServiceId(null);
    refreshServices();
  }

  function editService(service) {
    setEditingServiceId(service.id);
    setServiceError("");
    setServiceForm({
      name: service.name || "",
      description: service.description || "",
      base_price: service.base_price || 0,
      duration_minutes: service.duration_minutes || 40,
      is_active: Boolean(service.is_active)
    });
  }

  async function removeService(service) {
    if (!window.confirm(`Excluir ${service.name}?`)) return;
    const response = await apiFetch(`/services/${service.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setServiceError(payload.error || "Não foi possível excluir o serviço.");
    }
    if (editingServiceId === service.id) {
      setEditingServiceId(null);
      setServiceForm(defaultServiceForm());
    }
    refreshServices();
    refreshProcedures();
  }

  async function saveProcedure(event) {
    event.preventDefault();
    setProcedureError("");
    const error = validateProcedureForm();
    if (error) return setProcedureError(error);
    const response = await apiFetch(editingProcedureId ? `/procedures/${editingProcedureId}` : "/procedures", {
      method: editingProcedureId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(procedureForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setProcedureError(payload.error || "Não foi possível salvar o procedimento.");
    }
    setProcedureForm(defaultProcedureForm());
    setEditingProcedureId(null);
    refreshProcedures();
  }

  function editProcedure(procedure) {
    setEditingProcedureId(procedure.id);
    setProcedureError("");
    setProcedureForm({
      service_id: procedure.service_id || "",
      name: procedure.name || "",
      body_area: procedure.body_area || "",
      description: procedure.description || "",
      price: procedure.price || 0,
      duration_minutes: procedure.duration_minutes || 40,
      aftercare_instructions: procedure.aftercare_instructions || "",
      is_active: Boolean(procedure.is_active)
    });
  }

  async function removeProcedure(procedure) {
    if (!window.confirm(`Excluir ${procedure.name}?`)) return;
    const response = await apiFetch(`/procedures/${procedure.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setProcedureError(payload.error || "Não foi possível excluir o procedimento.");
    }
    if (editingProcedureId === procedure.id) {
      setEditingProcedureId(null);
      setProcedureForm(defaultProcedureForm());
    }
    refreshProcedures();
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
          <p>Configure serviÃ§os, horÃ¡rios, bloqueios e solicitaÃ§Ãµes vindas do link pÃºblico.</p>
        </div>
        <a className="primary-button" href="/agendar" target="_blank" rel="noreferrer">Abrir link pÃºblico</a>
      </header>
      <nav className="customization-tabs">
        {[
          ["servicos", "ServiÃ§os"],
          ["horarios", "Disponibilidade"],
          ["bloqueios", "Bloqueios"],
          ["solicitacoes", "SolicitaÃ§Ãµes pendentes"]
        ].map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

      {tab === "servicos" && (
        <div className="booking-admin-grid">
          <form className="panel" onSubmit={saveService}>
            <div className="panel-heading">
              <h2>{editingServiceId ? "Editar serviço" : "Novo serviço"}</h2>
              <span>Cadastro real no PostgreSQL</span>
            </div>
            <div className="form-grid">
              <Input label="Nome" value={serviceForm.name} onChange={(value) => setServiceForm({ ...serviceForm, name: value })} required />
              <Input type="number" label="Duração em minutos" value={serviceForm.duration_minutes} onChange={(value) => setServiceForm({ ...serviceForm, duration_minutes: value })} />
              <Input type="number" label="Preço base" value={serviceForm.base_price} onChange={(value) => setServiceForm({ ...serviceForm, base_price: value })} />
            </div>
            <label>Descrição<textarea value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} /></label>
            <Toggle label="Serviço ativo" checked={serviceForm.is_active} onChange={(value) => setServiceForm({ ...serviceForm, is_active: value })} />
            {serviceError && <span className="form-error">{serviceError}</span>}
            <div className="modal-actions">
              {editingServiceId && <button type="button" className="secondary-button" onClick={() => { setEditingServiceId(null); setServiceForm(defaultServiceForm()); setServiceError(""); }}>Cancelar</button>}
              <button className="primary-button">Salvar serviço</button>
            </div>
          </form>

          <div className="panel">
            <div className="panel-heading"><h2>Serviços cadastrados</h2></div>
            <div className="service-list">
              {safeServices.map((service) => (
                <article key={service.id}>
                  <strong>{service.name}</strong>
                  <span>{service.duration_minutes} min · {currency.format(service.base_price || 0)}</span>
                  <small>{service.is_active ? "Ativo" : "Inativo"}</small>
                  <div className="table-actions">
                    <button type="button" onClick={() => editService(service)}>Editar</button>
                    <button type="button" className="danger-link" onClick={() => removeService(service)}>Excluir</button>
                  </div>
                </article>
              ))}
              {!safeServices.length && <p className="empty-state">Você ainda não possui serviços cadastrados.</p>}
            </div>
          </div>

          <form className="panel" onSubmit={saveProcedure}>
            <div className="panel-heading">
              <h2>{editingProcedureId ? "Editar procedimento" : "Novo procedimento"}</h2>
              <span>Vincule a um serviço</span>
            </div>
            <div className="form-grid">
              <Select label="Serviço" value={procedureForm.service_id} onChange={(value) => setProcedureForm({ ...procedureForm, service_id: value })} required>
                <option value="">Selecione</option>
                {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </Select>
              <Input label="Nome" value={procedureForm.name} onChange={(value) => setProcedureForm({ ...procedureForm, name: value })} required />
              <Input label="Área do corpo" value={procedureForm.body_area} onChange={(value) => setProcedureForm({ ...procedureForm, body_area: value })} />
              <Input type="number" label="Preço" value={procedureForm.price} onChange={(value) => setProcedureForm({ ...procedureForm, price: value })} />
              <Input type="number" label="Duração em minutos" value={procedureForm.duration_minutes} onChange={(value) => setProcedureForm({ ...procedureForm, duration_minutes: value })} />
            </div>
            <label>Descrição<textarea value={procedureForm.description} onChange={(event) => setProcedureForm({ ...procedureForm, description: event.target.value })} /></label>
            <label>Orientações pós-atendimento<textarea value={procedureForm.aftercare_instructions} onChange={(event) => setProcedureForm({ ...procedureForm, aftercare_instructions: event.target.value })} /></label>
            <Toggle label="Procedimento ativo" checked={procedureForm.is_active} onChange={(value) => setProcedureForm({ ...procedureForm, is_active: value })} />
            {procedureError && <span className="form-error">{procedureError}</span>}
            <div className="modal-actions">
              {editingProcedureId && <button type="button" className="secondary-button" onClick={() => { setEditingProcedureId(null); setProcedureForm(defaultProcedureForm()); setProcedureError(""); }}>Cancelar</button>}
              <button className="primary-button">Salvar procedimento</button>
            </div>
          </form>

          <div className="panel">
            <div className="panel-heading"><h2>Procedimentos cadastrados</h2></div>
            <div className="service-list">
              {safeProcedures.map((procedure) => (
                <article key={procedure.id}>
                  <strong>{procedure.name}</strong>
                  <span>{procedure.service_name || "Sem serviço"} · {procedure.body_area || "Sem área"} · {procedure.duration_minutes} min · {currency.format(procedure.price || 0)}</span>
                  <small>{procedure.is_active ? "Ativo" : "Inativo"}</small>
                  <div className="table-actions">
                    <button type="button" onClick={() => editProcedure(procedure)}>Editar</button>
                    <button type="button" className="danger-link" onClick={() => removeProcedure(procedure)}>Excluir</button>
                  </div>
                </article>
              ))}
              {!safeProcedures.length && <p className="empty-state">Você ainda não possui procedimentos cadastrados.</p>}
            </div>
          </div>
        </div>
      )}
      {tab === "horarios" && (
        <div className="availability-grid">
          {safeAvailability.map((item) => (
            <article className="panel availability-card" key={item.id}>
              <div className="panel-heading"><h2>{weekdayLabel(item.weekday)}</h2><span>{item.professional_name}</span></div>
              <Toggle label="Atende neste dia" checked={item.is_active} onChange={(value) => updateAvailability(item, { is_active: value })} />
              <div className="form-grid">
                <Input label="InÃ­cio" value={item.start_time} onChange={(value) => updateAvailability(item, { start_time: value })} />
                <Input label="Final" value={item.end_time} onChange={(value) => updateAvailability(item, { end_time: value })} />
                <Input label="AlmoÃ§o inÃ­cio" value={item.lunch_start || ""} onChange={(value) => updateAvailability(item, { lunch_start: value })} />
                <Input label="AlmoÃ§o final" value={item.lunch_end || ""} onChange={(value) => updateAvailability(item, { lunch_end: value })} />
                <Input type="number" label="DuraÃ§Ã£o padrÃ£o" value={item.duration_minutes} onChange={(value) => updateAvailability(item, { duration_minutes: value })} />
                <Input type="number" label="Intervalo" value={item.buffer_minutes} onChange={(value) => updateAvailability(item, { buffer_minutes: value })} />
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === "bloqueios" && (
        <div className="booking-admin-grid">
          <form className="panel" onSubmit={saveBlock}>
            <div className="panel-heading"><h2>Novo bloqueio</h2><span>NÃ£o aparece para o cliente</span></div>
            <div className="form-grid">
              <Select label="Profissional" value={blockForm.professional_id} onChange={(value) => setBlockForm({ ...blockForm, professional_id: value })}>
                <option value="">Selecione</option>
                {professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
              </Select>
              <Input label="Motivo" value={blockForm.reason} onChange={(value) => setBlockForm({ ...blockForm, reason: value })} />
              <Input type="datetime-local" label="InÃ­cio" value={blockForm.start_datetime} onChange={(value) => setBlockForm({ ...blockForm, start_datetime: value })} />
              <Input type="datetime-local" label="Final" value={blockForm.end_datetime} onChange={(value) => setBlockForm({ ...blockForm, end_datetime: value })} />
            </div>
            <Toggle label="Dia inteiro" checked={blockForm.is_full_day} onChange={(value) => setBlockForm({ ...blockForm, is_full_day: value })} />
            <Toggle label="Recorrente" checked={blockForm.is_recurring} onChange={(value) => setBlockForm({ ...blockForm, is_recurring: value })} />
            <label>ObservaÃ§Ã£o<textarea value={blockForm.notes} onChange={(event) => setBlockForm({ ...blockForm, notes: event.target.value })} /></label>
            <button className="primary-button">Salvar bloqueio</button>
          </form>
          <div className="panel">
            <div className="panel-heading"><h2>Bloqueios cadastrados</h2></div>
            <div className="service-list">
              {safeBlocks.map((block) => (
                <article key={block.id}>
                  <strong>{block.reason}</strong>
                  <span>{block.professional_name} Â· {new Date(block.start_datetime).toLocaleString("pt-BR")} atÃ© {new Date(block.end_datetime).toLocaleString("pt-BR")}</span>
                  <button className="danger-link" onClick={async () => { await apiFetch(`/schedule-blocks/${block.id}`, { method: "DELETE" }); refreshBlocks(); }}>Apagar</button>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "solicitacoes" && (
        <div className="panel">
          <div className="panel-heading"><h2>SolicitaÃ§Ãµes pendentes</h2><span>Confirme ou recuse manualmente</span></div>
          <div className="appointment-list">
            {safeAppointments.map((item) => (
              <article className="appointment-row" key={item.id}>
                <div className="time-box"><strong>{item.appointment_time}</strong><span>{formatDate(item.appointment_date)}</span></div>
                <div><h3>{item.full_name}</h3><p>{item.procedure} Â· {currency.format(item.deposit_value || 0)} de sinal</p><small>{item.professional_name} Â· {item.whatsapp}</small></div>
                <div className="row-actions">
                  <button onClick={() => updateRequest(item.id, "confirmado")}>Confirmar</button>
                  <button onClick={() => updateRequest(item.id, "recusado")}>Recusar</button>
                </div>
              </article>
            ))}
            {!safeAppointments.length && <p className="empty-state">Nenhuma solicitaÃ§Ã£o pendente.</p>}
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
  const [creatingClient, setCreatingClient] = useState(false);
  const [error, setError] = useState("");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const clients = asArray(data);
  const filteredClients = clients.filter((client) => matchesClientSearch(client, search));

  async function removeClient(client) {
    if (!window.confirm(`Excluir ${client.name}?`)) return;
    setError("");
    const response = await apiFetch(`/clients/${client.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || "Não foi possível excluir o cliente.");
      return;
    }
    if (editingClientId === client.id) setEditingClientId(null);
    refresh();
  }

  return (
    <section className="medical-client-list simplified-client-list">
      <div className="panel-heading">
        <label className="client-search">
          <Search size={17} />
          <input placeholder="Pesquisar cliente, WhatsApp ou Instagram" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="button" className="primary-button" onClick={() => setCreatingClient(true)}>
          <Plus size={16} /> Novo cliente
        </button>
      </div>
      {creatingClient && (
        <article className="panel medical-card simplified-client-card">
          <ClientEditForm
            onCancel={() => setCreatingClient(false)}
            onSaved={() => {
              setCreatingClient(false);
              refresh();
            }}
          />
        </article>
      )}
      {error && <span className="form-error">{error}</span>}
      {filteredClients.map((client) => (
        <article className="panel medical-card simplified-client-card" key={client.id}>
          <div className="medical-header compact">
            <div>
              <h2>{client.name}</h2>
              <p>{client.whatsapp} Â· {client.instagram || "sem Instagram"}</p>
            </div>
            <div className="header-actions">
              <span className="status-badge status-atendido">Cliente Aura</span>
              <a className="secondary-button" href={whatsappUrl(client.whatsapp, `Ola ${client.name}, tudo bem Aqui e da Aura Clinic.`)} target="_blank" rel="noreferrer">WhatsApp</a>
              <button type="button" className="secondary-button" onClick={() => setEditingClientId(editingClientId === client.id ? null : client.id)}>Editar</button>
              <button type="button" className="danger-link" onClick={() => removeClient(client)}>Excluir</button>
            </div>
          </div>
          {client.birth_date && <small className="client-birth">AniversÃ¡rio: {formatLongDate(client.birth_date)}</small>}
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
            <span>Telefone: {client.phone || "Sem registro"}</span>
            <span>E-mail: {client.email || "Sem registro"}</span>
            <span>CPF: {client.cpf || "Sem registro"}</span>
          </div>
        </article>
      ))}
      {!clients.length && !creatingClient && <p className="empty-state">Você ainda não possui clientes cadastrados.</p>}
      {clients.length > 0 && !filteredClients.length && <p className="empty-state">Nenhum cliente encontrado.</p>}
    </section>
  );
}

function ClientEditForm({ client, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: client?.name || "",
    phone: client?.phone || "",
    whatsapp: client?.whatsapp || "",
    instagram: client?.instagram || "",
    email: client?.email || "",
    birth_date: dateInputValue(client?.birth_date),
    cpf: client?.cpf || "",
    notes: client?.notes || ""
  });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(client?.id ? `/clients/${client.id}` : "/clients", {
      method: client?.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel salvar o cliente.");
    onSaved();
  }

  return (
    <form className="client-edit-form" onSubmit={submit}>
      <div className="form-grid">
        <Input label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
        <Input label="Telefone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} />
        <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
        <Input label="E-mail" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
        <Input label="CPF" value={form.cpf} onChange={(value) => setForm({ ...form, cpf: value })} />
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

  const safeAppointments = asArray(appointments);
  const safeTerms = asArray(terms);
  const selectedAppointment = safeAppointments.find((item) => String(item.id) === String(form.appointment_id));

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
    if (!form.signature_data_url) return setError("Assinatura digital obrigatÃ³ria.");
    const response = await apiFetch(`/digital-terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "NÃ£o foi possÃ­vel salvar o termo.");
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
          <span>{safeAppointments.length} agendamento(s)</span>
        </div>

        <div className="term-intro">
          <strong>Estrutura clÃ­nica fiel ao documento fÃ­sico.</strong>
          <p>Dados pessoais, histÃ³rico de saÃºde, estilo de vida, consentimento, autorizaÃ§Ã£o para menores e assinatura digital.</p>
        </div>

        <div className="term-chip-row">
          <span>Dados Pessoais</span>
          <span>HistÃ³rico De SaÃºde</span>
          <span>Estilo De Vida</span>
          <span>Consentimento</span>
          <span>Assinatura Digital</span>
        </div>

        <section className="term-section">
          <h3>Agendamento Vinculado</h3>
          <Select label="Agendamento" value={form.appointment_id} onChange={(value) => updateField("appointment_id", value)} required>
            <option value="">Selecione</option>
            {safeAppointments.map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)}  {item.appointment_time}  {item.full_name}  {item.procedure}</option>)}
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
          <Input label="EndereÃ§o" value={form.address} onChange={(value) => updateField("address", value)} />
        </section>

        <section className="term-section">
          <h3>HistÃ³rico De SaÃºde</h3>
          <div className="term-check-grid">
            {DIGITAL_TERM_HEALTH_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`term-check-item ${form.form_data.health_history[item.key] ? "active" : ""}`}
                onClick={() => toggleHealthItem(item.key)}
              >
                <span>{form.form_data.health_history[item.key] ? "Sim" : "NÃ£o"}</span>
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
                  <option value="">NÃ£o Informado</option>
                  <option value="Sim">Sim</option>
                  <option value="NÃ£o">NÃ£o</option>
                  <option value="Ã€s Vezes">Ã€s Vezes</option>
                  {item.key === "blood_pressure" && <option value="Normal">Normal</option>}
                  {item.key === "blood_pressure" && <option value="Alterada">Alterada</option>}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="term-section">
          <h3>InformaÃ§Ãµes do Atendimento</h3>
          <div className="form-grid">
            <Input label="Procedimento" value={form.procedure} onChange={(value) => updateField("procedure", value)} />
            <Input label="RegiÃ£o da PerfuraÃ§Ã£o" value={form.piercing_region} onChange={(value) => updateField("piercing_region", value)} />
            <Input label="Local da AplicaÃ§Ã£o" value={form.form_data.information.application_location} onChange={(value) => updateFormData("information", "application_location", value)} />
            <Input label="Joia" value={form.form_data.information.jewelry} onChange={(value) => updateFormData("information", "jewelry", value)} />
            <Input label="Valor" value={form.form_data.information.value} onChange={(value) => updateFormData("information", "value", value)} />
          </div>
          <label className="term-notes">
            ObservaÃ§Ã£o
            <textarea
              value={form.form_data.information.observation}
              onChange={(event) => updateFormData("information", "observation", event.target.value)}
              placeholder="Alergias, medicamentos, gestaÃ§Ã£o, queloide, observaÃ§Ãµes clÃ­nicas ou qualquer detalhe importante."
            />
          </label>
          <label className="term-notes">
            DeclaraÃ§Ã£o de SaÃºde e ObservaÃ§Ãµes
            <textarea
              value={form.health_declaration}
              onChange={(event) => updateField("health_declaration", event.target.value)}
              placeholder="Texto complementar livre, se necessÃ¡rio."
            />
          </label>
        </section>

        <section className="term-section term-consent-section">
          <label className="checkbox-line">
            <input type="checkbox" checked={form.orientations_confirmed} onChange={(event) => updateField("orientations_confirmed", event.target.checked)} />
            Confirmo que recebi orientaÃ§Ãµes sobre cuidados, higienizaÃ§Ã£o, riscos, cicatrizaÃ§Ã£o e retornos.
          </label>
          <p>Declaro que recebi todas as informaÃ§Ãµes referentes ao procedimento e que os materiais utilizados sÃ£o devidamente esterilizados, lacrados e descartados apÃ³s o atendimento.</p>
        </section>

        <section className="term-section">
          <div className="term-section-heading">
          <h3>AutorizaÃ§Ã£o para Menores</h3>
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
              <Input label="Nome do ResponsÃ¡vel" value={form.form_data.minor.responsible_name} onChange={(value) => updateFormData("minor", "responsible_name", value)} />
              <Input label="Documento Do ResponsÃ¡vel" value={form.form_data.minor.responsible_document} onChange={(value) => updateFormData("minor", "responsible_document", value)} />
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
          <span>{safeTerms.length} registro(s)</span>
        </div>
        <div className="terms-list">
          {safeTerms.map((term) => (
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
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel resgatar desconto.");
    setRedeem({ points_used: 10, discount_value: 0, notes: "" });
    onChanged();
  }

  return (
    <div className="loyalty-panel">
      <div className="loyalty-summary">
        <div>
          <span className="eyebrow">Programa de fidelidade</span>
          <h3>{loyalty.level}</h3>
          <p>{loyalty.availablePoints} pontos disponÃ­veis Â· {loyalty.totalEarned} pontos acumulados</p>
        </div>
        <span className="status-badge status-confirmado">{loyalty.redeemedPoints} pontos resgatados</span>
      </div>
      <div className="loyalty-grid">
        <div>
          <h4>BenefÃ­cios por nÃ­vel</h4>
          <ul className="benefit-list">
            {asArray(loyalty.benefits).map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </div>
        <form onSubmit={submit} className="redeem-form">
          <h4>Resgatar desconto</h4>
          <div className="form-grid">
            <Input type="number" label="Pontos" value={redeem.points_used} onChange={(value) => setRedeem({ ...redeem, points_used: value })} />
            <Input type="number" label="Desconto R$" value={redeem.discount_value} onChange={(value) => setRedeem({ ...redeem, discount_value: value })} />
          </div>
          <Input label="ObservaÃ§Ã£o" value={redeem.notes} onChange={(value) => setRedeem({ ...redeem, notes: value })} />
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button">Resgatar</button>
        </form>
      </div>
      <div className="loyalty-history">
        <div>
          <h4>HistÃ³rico de pontos</h4>
          {(loyalty.history || []).slice(0, 5).map((item) => <p key={item.id}><strong>+{item.points}</strong> {item.description}</p>)}
          {!loyalty.history?.length && <small>Sem pontos registrados ainda.</small>}
        </div>
        <div>
          <h4>Resgates</h4>
          {(loyalty.redemptions || []).slice(0, 5).map((item) => <p key={item.id}><strong>-{item.points_used}</strong> {currency.format(item.discount_value)} Â· {item.notes || "desconto"}</p>)}
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
  if (data.error) return <ApiError message={data.error} />;
  const followups = asArray(data);
  const items = followups.filter((item) => {
    const text = `${item.full_name} ${item.whatsapp} ${item.procedure} ${item.piercing_region} ${item.jewelry_name} ${item.healing_status}`.toLowerCase();
    return (!search.trim() || text.includes(search.toLowerCase())) && (!status || item.status === status);
  });
  const dueCount = followups.filter((item) => item.status !== "concluido" && item.due_date <= new Date().toISOString().slice(0, 10)).length;

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Lembretes totais" value={followups.length} />
        <Metric label="Pendentes ou vencidos" value={dueCount} />
        <Metric label="Fotos recebidas" value={followups.filter((item) => item.client_photo_url).length} />
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
          <option value="concluido">concluÃ­do</option>
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
          <p>{item.whatsapp} Â· {item.instagram || "sem Instagram"}</p>
        </div>
        <span className={`status-badge ${isDue ? "status-pendente" : "status-atendido"}`}>{formatDate(item.due_date)}</span>
      </header>
      <dl>
        <div><dt>Procedimento</dt><dd>{item.procedure}</dd></div>
        <div><dt>RegiÃ£o</dt><dd>{item.piercing_region}</dd></div>
        <div><dt>Joia</dt><dd>{item.jewelry_name || "sem joia"}</dd></div>
        <div><dt>Profissional</dt><dd>{item.professional_name}</dd></div>
      </dl>
      {item.client_photo_url && <img className="post-care-photo" src={`${API_ORIGIN}${item.client_photo_url}`} alt="Foto enviada pelo cliente" />}
      <form onSubmit={save} className="post-care-form">
        <label>Mensagem personalizada de cuidados
          <textarea value={form.care_message} onChange={(event) => setForm({ ...form, care_message: event.target.value })} />
        </label>
        <div className="form-grid">
          <Select label="Status da cicatrizaÃ§Ã£o" value={form.healing_status} onChange={(value) => setForm({ ...form, healing_status: value })}>
            <option>aguardando retorno</option>
            <option>cicatrizaÃ§Ã£o normal</option>
            <option>atenÃ§Ã£o necessÃ¡ria</option>
            <option>intercorrÃªncia</option>
            <option>cicatrizaÃ§Ã£o concluÃ­da</option>
          </Select>
          <Select label="Status do lembrete" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
            <option value="pendente">pendente</option>
            <option value="mensagem enviada">mensagem enviada</option>
            <option value="foto recebida">foto recebida</option>
            <option value="concluido">concluÃ­do</option>
          </Select>
        </div>
        <label>ObservaÃ§Ãµes do cliente
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
  { key: "alteracoes_hormonais", label: "AlteraÃ§Ãµes Hormonais" },
  { key: "doencas_cardiacas", label: "DoenÃ§as CardÃ­acas" },
  { key: "queloide", label: "Queloide" },
  { key: "ists", label: "IST's" },
  { key: "hepatite", label: "Hepatite" },
  { key: "dermatite", label: "Dermatite" },
  { key: "anemia", label: "Anemia" }
];

const DIGITAL_TERM_LIFESTYLE_ITEMS = [
  { key: "eats_well", label: "Alimenta-Se Bem?" },
  { key: "sleep_regular", label: "Tem Sono Regular?" },
  { key: "physical_activity", label: "Pratica Atividade FÃ­sica?" },
  { key: "alcohol", label: "Bebe Ãlcool?" },
  { key: "smokes", label: "Fuma?" },
  { key: "health_problem", label: "Algum Problema De SaÃºde?" },
  { key: "medication", label: "Usa Algum Medicamento?" },
  { key: "treatment", label: "Faz Algum Tratamento?" },
  { key: "phobia", label: "Tem Alguma Fobia?" },
  { key: "blood_pressure", label: "PressÃ£o SanguÃ­nea" }
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
    if (!response.ok) return setError((await response.json()).error || "NÃ£o foi possÃ­vel salvar o prontuÃ¡rio.");
    setRecord(defaultMedicalRecord());
    setFiles({ before_photo: null, after_photo: null });
    event.currentTarget.reset();
    onSaved();
  }

  return (
    <form className="medical-form" onSubmit={submit}>
      <h3>Novo registro de prontuÃ¡rio</h3>
      <div className="form-grid">
        <Input type="date" label="Data do registro" value={record.record_date} onChange={(value) => setRecord({ ...record, record_date: value })} />
        <Select label="Atendimento vinculado" value={record.appointment_id} onChange={(value) => setRecord({ ...record, appointment_id: value })}>
          <option value="">Sem vÃ­nculo</option>
          {asArray(client.history).map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} Â· {item.procedure}</option>)}
        </Select>
      </div>
      <label>HistÃ³rico de perfuraÃ§Ãµes
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
      <label>IntercorrÃªncias
        <textarea value={record.occurrences} onChange={(event) => setRecord({ ...record, occurrences: event.target.value })} />
      </label>
      <label>OrientaÃ§Ãµes passadas
        <textarea value={record.guidance} onChange={(event) => setRecord({ ...record, guidance: event.target.value })} />
      </label>
      <label>Alergias ou observaÃ§Ãµes importantes
        <textarea value={record.allergies_notes} onChange={(event) => setRecord({ ...record, allergies_notes: event.target.value })} />
      </label>
      <label>EvoluÃ§Ã£o da cicatrizaÃ§Ã£o
        <textarea value={record.healing_evolution} onChange={(event) => setRecord({ ...record, healing_evolution: event.target.value })} />
      </label>
      <label>Retornos realizados
        <textarea value={record.returns_done} onChange={(event) => setRecord({ ...record, returns_done: event.target.value })} />
      </label>
      {error && <span className="form-error">{error}</span>}
      <button className="primary-button">Salvar prontuÃ¡rio</button>
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
      <h3>ProntuÃ¡rio individual</h3>
      <div className="medical-timeline">
        {asArray(client.medicalRecords).length ? asArray(client.medicalRecords).map((record) => (
          <article className="record-entry" key={record.id}>
            <header>
              <div>
                <strong>{formatLongDate(record.record_date)}</strong>
                <span>{record.procedure || "Registro avulso"} Â· {record.piercing_region || "sem regiÃ£o vinculada"}</span>
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
              <div><dt>Joias usadas</dt><dd>{record.jewelry_used || record.appointment_jewelry || "NÃ£o informado"}</dd></div>
              <div><dt>IntercorrÃªncias</dt><dd>{record.occurrences || "Sem intercorrÃªncias registradas"}</dd></div>
              <div><dt>OrientaÃ§Ãµes</dt><dd>{record.guidance || "NÃ£o informado"}</dd></div>
              <div><dt>Alergias/observaÃ§Ãµes</dt><dd>{record.allergies_notes || client.notes || "NÃ£o informado"}</dd></div>
              <div><dt>EvoluÃ§Ã£o</dt><dd>{record.healing_evolution || "NÃ£o informado"}</dd></div>
              <div><dt>Retornos</dt><dd>{record.returns_done || "NÃ£o informado"}</dd></div>
            </dl>
          </article>
        )) : <p className="empty-state">Nenhum registro de prontuÃ¡rio ainda.</p>}
      </div>
    </div>
  );
}

function MonthlyChart({ data = [] }) {
  const safeData = asArray(data);
  const max = Math.max(...safeData.map((item) => asNumber(item?.total)), 1);
  if (!safeData.length) return <p className="empty-state">Sem faturamento registrado para montar o grÃ¡fico.</p>;
  return (
    <div className="monthly-chart">
      {safeData.map((item, index) => (
        <div className="chart-column" key={item?.month || index}>
          <div style={{ height: `${Math.max((asNumber(item?.total) / max) * 100, 6)}%` }} />
          <span>{String(item?.month || "").slice(5)}/{String(item?.month || "").slice(2, 4)}</span>
          <small>{currency.format(asNumber(item?.total))}</small>
        </div>
      ))}
    </div>
  );
}

function AppointmentList({ appointments = [], onChanged, compact }) {
  const safeAppointments = asArray(appointments);
  if (!safeAppointments.length) return <p className="empty-state">Nenhum atendimento encontrado.</p>;
  return (
    <div className="appointment-list">
      {safeAppointments.map((item) => (
        <article className="appointment-row" key={item.id}>
          <div className="time-box"><strong>{item.appointment_time}</strong><span>{formatDate(item.appointment_date)}</span></div>
          <div>
            <h3>{item.full_name}</h3>
            <p>{item.procedure} Â· {item.piercing_region}</p>
            <small>{item.professional_name} Â· {item.jewelry_name || "sem joia vinculada"}</small>
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

function LegacyLoading() {
  return <div className="loading">Carregando Aura Clinic...</div>;
}

function LegacyApiError({ message }) {
  return (
    <section className="panel erp-error">
      <span className="eyebrow">Aura Clinic</span>
      <h2>NÃ£o foi possÃ­vel carregar os dados.</h2>
      <p>{message || "Tente atualizar a pÃ¡gina ou entrar novamente."}</p>
    </section>
  );
}

function legacyReadStoredSession() {
  try {
    const storedSession = JSON.parse(localStorage.getItem("aura-session") || "null");
    if (storedSession) return storedSession;
    return SHOULD_AUTO_LOGIN_LOCAL ? { user: { id: 1, name: "Administrador Aura", email: "admin@auraclinic.com", role: "admin" } } : null;
  } catch {
    localStorage.removeItem("aura-session");
    return SHOULD_AUTO_LOGIN_LOCAL ? { user: { id: 1, name: "Administrador Aura", email: "admin@auraclinic.com", role: "admin" } } : null;
  }
}

function legacyAuthToken() {
  try {
    return JSON.parse(localStorage.getItem("aura-session") || "null")?.token || "";
  } catch {
    localStorage.removeItem("aura-session");
    return "";
  }
}

function legacyApiFetch(path, options = {}) {
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

async function legacyDownloadApiFile(path, filename) {
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

function legacyUseFetch(path) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    apiFetch(`${path}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json.error || "NÃ£o foi possÃ­vel carregar os dados." };
        return json;
      })
      .then((json) => active && setData(json))
      .catch(() => active && setData({ error: "NÃ£o foi possÃ­vel conectar com a API." }));
    return () => { active = false; };
  }, [path, tick]);
  return { data, refresh: () => setTick((value) => value + 1) };
}

function legacyUsePublicFetch(path) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    fetch(`${API}${path}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json.error || "NÃ£o foi possÃ­vel carregar os dados." };
        return json;
      })
      .then((json) => active && setData(json))
      .catch(() => active && setData({ error: "NÃ£o foi possÃ­vel conectar com a API." }));
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

function legacyLocalDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function defaultServiceForm() {
  return {
    name: "",
    description: "",
    base_price: 0,
    duration_minutes: 40,
    is_active: true
  };
}

function defaultProcedureForm() {
  return {
    service_id: "",
    name: "",
    body_area: "",
    description: "",
    price: 0,
    duration_minutes: 40,
    aftercare_instructions: "",
    is_active: true
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
    image_url: "",
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
    is_published: false,
    notes: "",
    status: "disponÃ­vel",
    variants: [defaultJewelryVariant()]
  };
}

function defaultJewelryVariant(index = 1) {
  return {
    id: null,
    sku: "",
    variation_name: `VariaÃ§Ã£o ${index}`,
    material: "TitÃ¢nio ASTM F136",
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
    status: "disponÃ­vel",
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
    title: "Escolha a joia perfeita para vocÃª",
    subtitle: "Curadoria premium da Aura Clinic Piercing",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realÃ§ar sua essÃªncia",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: `Todos, ${JEWELRY_CATEGORY_OPTIONS.join(", ")}`,
    whatsapp_phone: "",
    whatsapp_message: "OlÃ¡! Vim pelo catÃ¡logo online da Aura Clinic e quero ajuda para escolher uma joia.",
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
  return ["Domingo", "Segunda", "TerÃ§a", "Quarta", "Quinta", "Sexta", "SÃ¡bado"][Number(day)] || "Dia";
}

function legacyFormatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function legacyFormatLongDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function formatRevenueLabel(item, mode) {
  const label = item.label || item.month || "";
  if (mode === "diario" && label) return formatDate(label);
  if (mode === "semanal") return label.replace("-W", " semana ");
  if (label.length === 7) return `${label.slice(5)}/${label.slice(0, 4)}`;
  return label || "PerÃ­odo";
}

function formatRevenueAxisLabel(item, mode) {
  const label = item.label || item.month || "";
  if (mode === "diario" && label) return label.slice(8, 10);
  if (mode === "semanal" && label) return label.slice(-2);
  if (label.length === 7) return label.slice(5);
  return label.slice(0, 4);
}

function legacyFirstName(name = "") {
  return String(name).trim().split(" ")[0] || "Aura";
}

function legacyInitials(name = "") {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
}

function matchesClientSearch(client, search) {
  const safeClient = asObject(client);
  const term = String(search || "").trim().toLowerCase();
  if (!term) return true;
  return `${safeClient.name || ""} ${safeClient.phone || ""} ${safeClient.whatsapp || ""} ${safeClient.instagram || ""} ${safeClient.email || ""} ${safeClient.cpf || ""} ${safeClient.notes || ""}`.toLowerCase().includes(term);
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
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message || "OlÃ¡! Vim pelo catÃ¡logo online da Aura Clinic.")}`;
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
    "TitÃ¢nio": CircleDollarSign,
    Titanio: CircleDollarSign,
    Opalas: Gem,
    "LanÃ§amentos": Star,
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
  if (state === "critical") return "CrÃ­tico";
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

function subcategoryOptions(category = "") {
  const normalized = removeAccents(String(category).toLowerCase());
  if (normalized.includes("nariz")) return ["Nostril", "D-Ring", "Segment Clicker", "Argola Clicker", "Screw", "L Shape", "Septo"];
  if (normalized.includes("orelha")) return ["HÃ©lix", "Tragus", "Conch", "Daith", "Rook", "Flat", "Forward Helix", "LÃ³bulo", "Anti-HÃ©lix"];
  if (normalized.includes("boca")) return ["Labret", "Side Labret", "Medusa", "Monroe", "Ashley", "Vertical Labret"];
  if (normalized.includes("corpo")) return ["Umbigo", "Mamilo", "Surface", "Microdermal", "Sobrancelha"];
  if (normalized.includes("joias premium")) return ["Ouro 14k", "Ouro 18k", "TitÃ¢nio ASTM F136", "Cluster", "Trinity", "Opala", "Navete", "Correntes"];
  if (normalized.includes("acessor")) return ["Hastes", "Discos", "Topos", "Bases de Microdermal", "Correntes", "Extensores"];
  return [];
}

function generateLocalSku(item = {}) {
  const materialCode = {
    "titÃ¢nio grau implante": "TIT",
    "titanio grau implante": "TIT",
    "titanio astm f136": "TIT",
    "ouro 14k": "G14",
    "ouro 18k": "G18",
    aco: "ACO",
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

function variantCatalogLabel(variant = {}) {
  const measurement = variant.length
    ? `Comprimento ${variant.length}`
    : variant.diameter
      ? `DiÃ¢metro ${variant.diameter}`
      : variant.size
        ? `Tamanho ${variant.size}`
        : variant.variation_name || variant.sku || "VariaÃ§Ã£o";
  return [
    measurement,
    variant.thickness,
    variant.material && elegantProductName(variant.material),
    variant.thread_type && `Rosca ${elegantProductName(variant.thread_type)}`
  ].filter(Boolean).join(" Â· ");
}

function readCatalogStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    if (Array.isArray(fallback)) return asArray(parsed);
    if (fallback && typeof fallback === "object") return asObject(parsed);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function countAlerts(alerts) {
  const safeAlerts = asObject(alerts);
  if (Array.isArray(safeAlerts.items)) return safeAlerts.items.length;
  return [safeAlerts.lowStockJewelry, safeAlerts.birthdays, safeAlerts.topClients].reduce((total, list) => total + asArray(list).length, 0);
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

function buildCalendar(items, mode, currentDate) {
  const safeItems = asArray(items);
  const base = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const days = mode === "mensal" ? buildMonthDays(base) : mode === "semanal" ? buildWeekDays(base) : [base];
  const mappedDays = days.map((date) => {
    const key = dateKey(date);
    return {
      date,
      key,
      isOutside: mode === "mensal" && date.getMonth() !== base.getMonth(),
      isToday: key === dateKey(new Date()),
      items: safeItems
        .filter((item) => item?.appointment_date === key)
        .sort((a, b) => String(a?.appointment_time || "").localeCompare(String(b?.appointment_time || "")))
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
  const safeItems = asArray(items);
  const baseHours = Array.from({ length: 11 }, (_, index) => `${String(index + 8).padStart(2, "0")}:00`);
  const eventHours = safeItems.map((item) => `${String(item?.appointment_time || "00").slice(0, 2)}:00`);
  return [...new Set([...baseHours, ...eventHours])].sort().map((hour) => ({
    hour,
    items: safeItems.filter((item) => String(item?.appointment_time || "").slice(0, 2) === hour.slice(0, 2))
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
auraRoot.render(<AppErrorBoundary><App /></AppErrorBoundary>);

