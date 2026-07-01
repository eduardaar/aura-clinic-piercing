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
import { canAccessPage, defaultPageForRole, pageTitle } from "./lib/permissions";
import { buildCalendar, buildTimeSlots, dateKey, movePeriod } from "./lib/calendarUtils";
import { ANODIZATION_COLOR_OPTIONS, DIGITAL_TERM_HEALTH_ITEMS, DIGITAL_TERM_LIFESTYLE_ITEMS, JEWELRY_CATEGORY_OPTIONS, JEWELRY_LENGTH_OPTIONS, JEWELRY_THICKNESS_OPTIONS, JEWELRY_THREAD_OPTIONS, defaultAccessUser, defaultAppointment, defaultCatalogSettings, defaultDigitalTerm, defaultExpense, defaultJewelry, defaultJewelryVariant, defaultMedicalRecord, defaultProcedureForm, defaultSalesLine, defaultSalesOrderForm, defaultScheduleBlock, defaultServiceForm, normalizeJewelryForm, parseGalleryUrls } from "./lib/defaultForms";
import { catalogCategoryTerms, catalogFilterOptions, catalogPromotionForItem, catalogStockText, cleanDisplayText, elegantProductName, normalizeJewelryMaterial, normalizeJewelryThread, promotionalPrice, splitColorOptions } from "./features/catalog/catalogUtils";
import { calcRemaining, catalogImageUrl, currency, formatRevenueAxisLabel, formatRevenueLabel, inventoryStatusClass, inventoryStatusLabel, inventoryStockState, jewelrySkuBase, matchesClientSearch, roleLabel, saleItemLabel, saleOrderTypeLabel, statusClass, statuses, weekdayLabel, whatsappUrl } from "./features/shared/helpers";

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

function App() {
  const [session, setSession] = useState(readStoredSession);
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsData, setAlertsData] = useState({ count: 0, items: [] });
  const [alertsLoading, setAlertsLoading] = useState(false);
  
  // Verificação de autenticação administrativa
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

  // Se está em /login mas já autenticado, redirecionar para home
  useEffect(() => {
    if (isLoginPath && isAdminAuthenticated) {
      window.location.href = "/";
    }
  }, [isLoginPath, isAdminAuthenticated]);

  // Se não tem sessão e não está em rota pública, redirecionar para login
  useEffect(() => {
    if (!normalizedSession && !isPublicCatalog && !isPublicBooking && !isPublicCheckout && !isLoginPath) {
      window.location.href = "/login";
    }
  }, [normalizedSession, isPublicCatalog, isPublicBooking, isPublicCheckout, isLoginPath]);

  // Se está em /login, renderizar APENAS login (sem app shell)
  if (isLoginPath) {
    return <Login onLogin={setSession} />;
  }

  // Rotas públicas: sempre acessíveis (carregadas sob demanda).
  if (isPublicCatalog) return <Suspense fallback={<Loading />}><PublicCatalog /></Suspense>;
  if (isPublicBooking) return <Suspense fallback={<Loading />}><PublicBooking /></Suspense>;
  if (isPublicCheckout) return <Suspense fallback={<Loading />}><PublicCheckout /></Suspense>;
  
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
            <h1>{activePage === "dashboard" ? `Olá, ${firstName(normalizedSession.user?.name || "Usuário")}!` : pageTitle(activePage)}</h1>
            {activePage === "dashboard" && <p>Bem-vinda ao painel administrativo da Aura Clinic.</p>}
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
        <Suspense fallback={<Loading />}>
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
        </Suspense>
      </main>
    </div>
  );
}

const auraRoot = window.__auraReactRoot || createRoot(document.getElementById("root"));
window.__auraReactRoot = auraRoot;
auraRoot.render(<AppErrorBoundary><App /></AppErrorBoundary>);

