import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { AlertBlock, BookingChoiceGrid, Input, Metric, PaymentSelect, Select, StatusSelect } from "./components/common/Ui";
import { asArray, asNumber, asObject, removeAccents, firstName, initials, formatDate, formatLongDate, localDateValue, dateInputValue } from "./lib/utils";
import { API, API_ORIGIN, apiFetch, downloadApiFile, readStoredSession, useFetch, usePublicFetch } from "./lib/api";
import { installGlobalErrorReporting } from "./lib/errorReporter";
import { canAccessPage, defaultPageForRole, pageTitle } from "./lib/permissions";
import { buildCalendar, buildTimeSlots, dateKey, movePeriod } from "./lib/calendarUtils";
import { ANODIZATION_COLOR_OPTIONS, DIGITAL_TERM_HEALTH_ITEMS, DIGITAL_TERM_LIFESTYLE_ITEMS, JEWELRY_CATEGORY_OPTIONS, JEWELRY_LENGTH_OPTIONS, JEWELRY_THICKNESS_OPTIONS, JEWELRY_THREAD_OPTIONS, defaultAccessUser, defaultAppointment, defaultCatalogSettings, defaultDigitalTerm, defaultExpense, defaultJewelry, defaultJewelryVariant, defaultMedicalRecord, defaultProcedureForm, defaultSalesLine, defaultSalesOrderForm, defaultScheduleBlock, defaultServiceForm, normalizeJewelryForm, parseGalleryUrls } from "./lib/defaultForms";
import { catalogCategoryTerms, catalogFilterOptions, catalogPromotionForItem, catalogStockText, cleanDisplayText, elegantProductName, normalizeJewelryMaterial, normalizeJewelryThread, promotionalPrice, splitColorOptions } from "./features/catalog/catalogUtils";
import { calcRemaining, catalogImageUrl, currency, formatRevenueAxisLabel, formatRevenueLabel, inventoryStatusClass, inventoryStatusLabel, inventoryStockState, jewelrySkuBase, matchesClientSearch, roleLabel, saleItemLabel, saleOrderTypeLabel, statusClass, statuses, weekdayLabel, whatsappUrl } from "./features/shared/helpers";

if (typeof __AURA_BUILD__ !== "undefined") {
  console.info("Aura Clinic ERP", __AURA_BUILD__);
}

// Code-splitting: telas pesadas carregadas sob demanda via React.lazy().
// Todos os componentes usam named export, por isso mapeamos para { default } no wrapper.
const Dashboard = lazy(() => import("./features/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const AlertsPopup = lazy(() => import("./features/dashboard/Dashboard").then((m) => ({ default: m.AlertsPopup })));
const AgendaWorkspace = lazy(() => import("./features/agenda/Agenda").then((m) => ({ default: m.AgendaWorkspace })));
const CatalogWorkspace = lazy(() => import("./features/inventory/Inventory").then((m) => ({ default: m.CatalogWorkspace })));
const SalesWorkspace = lazy(() => import("./features/sales/Sales").then((m) => ({ default: m.SalesWorkspace })));
const FinanceAdmin = lazy(() => import("./features/finance/Finance").then((m) => ({ default: m.FinanceAdmin })));
const AccessAdmin = lazy(() => import("./features/access/AccessAdmin").then((m) => ({ default: m.AccessAdmin })));
const AuraERP = lazy(() => import("./features/access/AccessAdmin").then((m) => ({ default: m.AuraERP })));
const ClientWorkspace = lazy(() => import("./features/clients/ClientsMedical").then((m) => ({ default: m.ClientWorkspace })));
const ClientsMedical = lazy(() => import("./features/clients/ClientsMedical").then((m) => ({ default: m.ClientsMedical })));
const DigitalTerms = lazy(() => import("./features/terms/DigitalTerms").then((m) => ({ default: m.DigitalTerms })));
const PostCare = lazy(() => import("./features/postcare/PostCare").then((m) => ({ default: m.PostCare })));
const PublicCatalog = lazy(() => import("./pages/PublicExperience").then((m) => ({ default: m.PublicCatalog })));
const PublicBooking = lazy(() => import("./pages/PublicExperience").then((m) => ({ default: m.PublicBooking })));
const PublicCheckout = lazy(() => import("./pages/PublicExperience").then((m) => ({ default: m.PublicCheckout })));
const CatalogCustomization = lazy(() => import("./pages/CatalogCustomization").then((m) => ({ default: m.CatalogCustomization })));
const Signup = lazy(() => import("./features/platform/Signup").then((m) => ({ default: m.Signup })));
const PlatformAdmin = lazy(() => import("./features/platform/PlatformAdmin").then((m) => ({ default: m.PlatformAdmin })));
const MyPlan = lazy(() => import("./features/platform/MyPlan").then((m) => ({ default: m.MyPlan })));
const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const CatalogDirectory = lazy(() => import("./pages/CatalogDirectory").then((m) => ({ default: m.CatalogDirectory })));
const ErrorLogs = lazy(() => import("./features/errors/ErrorLogs").then((m) => ({ default: m.ErrorLogs })));

function App() {
  const [session, setSession] = useState(readStoredSession);
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsData, setAlertsData] = useState({ count: 0, items: [] });
  const [alertsLoading, setAlertsLoading] = useState(false);
  // Identidade da clínica logada (nome + logo), para o app exibir a marca do
  // tenant atual em vez de "Aura" fixo. Vem de GET /api/store-identity.
  const [identity, setIdentity] = useState(null);
  // Assinatura (plano/features/dias de trial) e catálogo de planos — para o
  // gating por plano, o banner de trial e a tela "Meu plano".
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);

  // Verificação de autenticação administrativa
  const isAdminAuthenticated = session?.user?.id ? true : false;
  const planFeatures = Array.isArray(subscription?.features) ? subscription.features : [];
  const trialDays = subscription?.status === "trial_active" ? Number(subscription?.days_left ?? 0) : null;
  const subscriptionInactive = !!subscription
    && subscription.status !== "active"
    && !(subscription.status === "trial_active" && Number(subscription?.days_left ?? 0) > 0);

  // Monta a URL do logo do tenant (arquivos em /uploads são servidos pelo backend).
  const brandLogoUrl = identity?.logo_url
    ? (identity.logo_url.startsWith("/uploads") ? `${API_ORIGIN}${identity.logo_url}` : identity.logo_url)
    : "";
  const brandName = identity?.store_name || "Aura Clinic Piercing";
  
  // Verificar pathname atual (para renderizar apenas login em /login)
  const currentPathname = window.location.pathname;
  const isLoginPath = currentPathname === "/login" || currentPathname.startsWith("/login?");
  
  const isPublicCatalog = currentPathname.startsWith("/catalogo");
  const isPublicBooking = currentPathname.startsWith("/agendar");
  const isPublicCheckout = currentPathname.startsWith("/comprar");
  const isSignup = currentPathname.startsWith("/cadastro");
  const isPlatform = currentPathname.startsWith("/plataforma");
  // Landing de marketing: raiz "/" sem sessão. Com sessão, "/" é o app.
  const isLanding = currentPathname === "/";
  
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
      console.error("Não foi possível carregar os alertas:", error);
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

  // Carrega identidade (nome/logo) + assinatura (plano/trial) + catálogo de
  // planos da clínica logada. Reutilizável para recarregar após troca de plano.
  const loadStoreIdentity = React.useCallback(async () => {
    try {
      const response = await apiFetch("/store-identity");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setIdentity(payload.identity || null);
      setSubscription(payload.subscription || null);
      setPlans(Array.isArray(payload.plans) ? payload.plans : []);
    } catch { /* mantém fallback "Aura" */ }
  }, []);

  useEffect(() => {
    if (!isAdminAuthenticated) {
      setIdentity(null);
      setSubscription(null);
      return;
    }
    loadStoreIdentity();
  }, [isAdminAuthenticated, loadStoreIdentity]);

  // Se está em /login mas já autenticado, redirecionar para home
  useEffect(() => {
    if (isLoginPath && isAdminAuthenticated) {
      window.location.href = "/";
    }
  }, [isLoginPath, isAdminAuthenticated]);

  // Se não tem sessão e não está em rota pública (nem na landing "/"),
  // redireciona para login.
  useEffect(() => {
    if (!normalizedSession && !isLanding && !isPublicCatalog && !isPublicBooking && !isPublicCheckout && !isSignup && !isPlatform && !isLoginPath) {
      window.location.href = "/login";
    }
  }, [normalizedSession, isLanding, isPublicCatalog, isPublicBooking, isPublicCheckout, isSignup, isPlatform, isLoginPath]);

  // Landing pública na raiz "/" quando não há sessão.
  if (isLanding && !normalizedSession) {
    return <Suspense fallback={<Loading />}><Landing /></Suspense>;
  }

  // Se está em /login, renderizar APENAS login (sem app shell)
  if (isLoginPath) {
    return <Login onLogin={setSession} />;
  }

  // Rotas públicas: sempre acessíveis (carregadas sob demanda).
  // /catalogo SEM ?t=<slug> → diretório de clínicas (busca); com ?t → catálogo da clínica.
  if (isPublicCatalog) {
    const params = new URLSearchParams(window.location.search);
    const hasTenant = ["t", "tenant", "clinic"].some((key) => params.get(key));
    return hasTenant
      ? <Suspense fallback={<Loading />}><PublicCatalog /></Suspense>
      : <Suspense fallback={<Loading />}><CatalogDirectory /></Suspense>;
  }
  if (isPublicBooking) return <Suspense fallback={<Loading />}><PublicBooking /></Suspense>;
  if (isPublicCheckout) return <Suspense fallback={<Loading />}><PublicCheckout /></Suspense>;
  if (isSignup) return <Suspense fallback={<Loading />}><Signup /></Suspense>;
  if (isPlatform) return <Suspense fallback={<Loading />}><PlatformAdmin /></Suspense>;
  
  // Se não tem sessão, renderizar nada (useEffect acima vai redirecionar)
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
          brand={{ name: identity?.store_name || "", short: identity?.short_name || identity?.slogan || "", logoUrl: brandLogoUrl }}
          features={planFeatures}
          trialDays={trialDays}
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
      {isAdminAuthenticated && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">{brandName}</span>
            <h1>{activePage === "dashboard" ? `Olá, ${firstName(normalizedSession.user?.name || "Usuário")}!` : pageTitle(activePage)}</h1>
            {activePage === "dashboard" && <p>Bem-vindo(a) ao painel administrativo{identity?.store_name ? ` da ${identity.store_name}` : ""}.</p>}
          </div>
          <div className="topbar-actions">
            <button className="notification-button" aria-label="Notificações" onClick={openAlerts}>
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
            {normalizedSession.user?.name || "Usuário"} · {roleLabel(normalizedSession.user?.role)}
          </div>
          </div>
        </header>
        {(trialDays !== null || subscriptionInactive) && activePage !== "meu-plano" && (
          <div className={`plan-banner ${subscriptionInactive ? "danger" : "warn"}`}>
            <span>
              {subscriptionInactive
                ? "Seu período de teste terminou. Escolha um plano para continuar usando todos os recursos."
                : `Teste grátis: ${trialDays} dia(s) restante(s).`}
            </span>
            <button type="button" onClick={() => setPage("meu-plano")}>Ver planos</button>
          </div>
        )}
        <Suspense fallback={<Loading />}>
          {activePage === "meu-plano" && <MyPlan subscription={subscription} plans={plans} onChanged={loadStoreIdentity} />}
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
          {activePage === "error-logs" && <ErrorLogs />}
        </Suspense>
      </main>
    </div>
  );
}

installGlobalErrorReporting();
const auraRoot = window.__auraReactRoot || createRoot(document.getElementById("root"));
window.__auraReactRoot = auraRoot;
auraRoot.render(<AppErrorBoundary><App /></AppErrorBoundary>);

