import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Bell, Calendar, ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings as SettingsIcon, UserRound } from "lucide-react";
import "./styles.css";
import "./styles/topnav.css";
import "./styles/landing.css";
import "./styles/legal.css";
import "./styles/auth.css";
import "./styles/directory.css";
import "./styles/settings.css";
// Por último de propósito: é a camada que define o layout do shell autenticado.
import "./styles/appshell.css";
import "./styles/catalog-v2.css";
// Ajustes responsivos específicos das telas internas; carregado por último para
// manter a adaptação de cada módulo coesa sem aumentar o CSS legado global.
import "./styles/operations-responsive.css";
// Última camada: invariantes responsivas compartilhadas por todo o produto.
import "./styles/responsive.css";
import { Login } from "./components/auth/Login";
import { Sidebar } from "./components/layout/Sidebar";
import { Loading } from "./components/common/Feedback";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
import { asArray, asNumber } from "./lib/utils";
import { API_ORIGIN, apiFetch, readStoredSession } from "./lib/api";
import { queryClient } from "./lib/queryClient";
import { installGlobalErrorReporting } from "./lib/errorReporter";
import { canAccessPage, defaultPageForRole, pageTitle } from "./lib/permissions";
import { roleLabel } from "./features/shared/helpers";
import { applyUiTheme, readUiTheme, saveUiTheme } from "./lib/uiTheme";
import { appPathForPage, isAppPath, pageForAppPath } from "./lib/appRoutes";

if (typeof __AURA_BUILD__ !== "undefined") {
  console.info("Aura Clinic", __AURA_BUILD__);
}

// Code-splitting: telas pesadas carregadas sob demanda via React.lazy().
// Todos os componentes usam named export, por isso mapeamos para { default } no wrapper.
const Dashboard = lazy(() => import("./features/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const AlertsPopup = lazy(() => import("./features/dashboard/Dashboard").then((m) => ({ default: m.AlertsPopup })));
const AgendaWorkspace = lazy(() => import("./features/agenda/Agenda").then((m) => ({ default: m.AgendaWorkspace })));
const Communications = lazy(() => import("./features/communications/Communications").then((m) => ({ default: m.Communications })));
const CatalogWorkspace = lazy(() => import("./features/inventory/Inventory").then((m) => ({ default: m.CatalogWorkspace })));
const SalesWorkspace = lazy(() => import("./features/sales/Sales").then((m) => ({ default: m.SalesWorkspace })));
const FinanceAdmin = lazy(() => import("./features/finance/Finance").then((m) => ({ default: m.FinanceAdmin })));
const AccountsReceivable = lazy(() => import("./features/finance/Finance").then((m) => ({ default: m.AccountsReceivable })));
const PayablesAdmin = lazy(() => import("./features/finance/Payables").then((m) => ({ default: m.PayablesAdmin })));
const Reports = lazy(() => import("./features/reports/Reports").then((m) => ({ default: m.Reports })));
const AccessAdmin = lazy(() => import("./features/access/AccessAdmin").then((m) => ({ default: m.AccessAdmin })));
const Integrations = lazy(() => import("./features/integrations/Integrations").then((m) => ({ default: m.Integrations })));
const Support = lazy(() => import("./features/support/Support").then((m) => ({ default: m.Support })));
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
const AboutPage = lazy(() => import("./pages/Landing").then((m) => ({ default: m.AboutPage })));
const PlansPage = lazy(() => import("./pages/Landing").then((m) => ({ default: m.PlansPage })));
const LegalDocument = lazy(() => import("./pages/LegalDocument").then((m) => ({ default: m.LegalDocument })));
const CatalogDirectory = lazy(() => import("./pages/PublicDirectory").then((m) => ({ default: m.CatalogDirectory })));
const BookingDirectory = lazy(() => import("./pages/PublicDirectory").then((m) => ({ default: m.BookingDirectory })));
const Settings = lazy(() => import("./features/settings/Settings").then((m) => ({ default: m.Settings })));
const Onboarding = lazy(() => import("./features/onboarding/Onboarding").then((m) => ({ default: m.Onboarding })));

function App() {
  const [session, setSession] = useState(readStoredSession);
  const [page, setPage] = useState(() => pageForAppPath() || "dashboard");
  const [agendaTarget, setAgendaTarget] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Preferência de menu recolhido é por usuário e persiste entre sessões.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem("aura-nav-collapsed") === "true"; } catch { return false; }
  });
  function toggleNav() {
    // Em telas estreitas o menu é gaveta: o mesmo botão abre a gaveta.
    if (window.matchMedia("(max-width: 900px)").matches) return setSidebarOpen((open) => !open);
    setNavCollapsed((collapsed) => {
      const next = !collapsed;
      try { localStorage.setItem("aura-nav-collapsed", String(next)); } catch { /* storage indisponível */ }
      return next;
    });
  }
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const globalSearchRef = useRef(null);
  const [alertsData, setAlertsData] = useState({ count: 0, items: [] });
  const [alertsLoading, setAlertsLoading] = useState(false);
  // Identidade da clínica logada (nome + logo), para o app exibir a marca do
  // tenant atual em vez de "Aura" fixo. Vem de GET /api/store-identity.
  const [identity, setIdentity] = useState(null);
  // Assinatura (plano/features/dias de trial) e catálogo de planos — para o
  // gating por plano, o banner de trial e a tela "Meu plano".
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [uiTheme, setUiTheme] = useState(() => readUiTheme(session?.user?.id));

  // Verificação de autenticação administrativa
  const isAdminAuthenticated = Boolean(session?.user?.id);
  const planFeatures = Array.isArray(subscription?.features) ? subscription.features : [];
  const trialDays = subscription?.status === "trial_active" ? Number(subscription?.days_left ?? 0) : null;
  const subscriptionInactive = !!subscription && subscription.access_active === false;
  const subscriptionInGrace = subscription?.status === "overdue" && subscription?.access_active !== false;

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
  const isAbout = currentPathname === "/sobre";
  const isPlansPage = currentPathname === "/planos";
  const legalDocumentKey = currentPathname === "/termos-de-uso" ? "terms_of_use" : currentPathname === "/politica-de-privacidade" ? "privacy_policy" : null;
  const isLegalPage = Boolean(legalDocumentKey);
  const isPlatform = currentPathname.startsWith("/plataforma");
  const isInternalApp = isAppPath(currentPathname);
  // Landing de marketing: raiz "/" sem sessão. Com sessão, "/" é o app.
  const isLanding = currentPathname === "/";
  
  const normalizedSession = session?.user ? session : session ? { user: session } : null;

  useEffect(() => {
    setUiTheme(applyUiTheme(readUiTheme(normalizedSession?.user?.id)));
  }, [normalizedSession?.user?.id]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        globalSearchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function changeUiTheme(nextTheme) {
    setUiTheme(saveUiTheme(normalizedSession?.user?.id, nextTheme));
  }

  function changeNavCollapsed(next) {
    setNavCollapsed(next);
    try { localStorage.setItem("aura-nav-collapsed", String(next)); } catch { /* storage indisponível */ }
  }

  function changeUser(nextUser, nextToken) {
    const nextSession = {
      ...normalizedSession,
      ...(nextToken ? { token: nextToken } : {}),
      user: { ...normalizedSession.user, ...nextUser }
    };
    try { localStorage.setItem("aura-session", JSON.stringify(nextSession)); } catch { /* sessão atual segue em memória */ }
    setSession(nextSession);
  }

  function handleLogout() {
    // Revoga também o refresh HttpOnly da sessão ativa. A limpeza local
    // continua imediata, então o usuário não espera a rede para sair.
    void apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("aura-session");
    localStorage.removeItem("aura-admin-authenticated");
    setSession(null);
  }

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

  // O selo do sino precisa chegar antes do clique. Carregamos os alertas ao
  // entrar no painel e mantemos a mesma carga para a central quando ela abre.
  useEffect(() => {
    if (!isAdminAuthenticated || isPlatform) {
      setAlertsData({ count: 0, items: [] });
      return undefined;
    }
    let active = true;
    (async () => {
      try {
        const response = await apiFetch("/alerts");
        const payload = await response.json().catch(() => ({}));
        if (active) setAlertsData(response.ok ? {
          count: asNumber(payload?.count),
          items: asArray(payload?.items)
        } : { count: 0, items: [] });
      } catch {
        if (active) setAlertsData({ count: 0, items: [] });
      }
    })();
    return () => { active = false; };
  }, [isAdminAuthenticated, isPlatform, normalizedSession?.user?.id]);

  const navigate = useCallback((nextPage, { replace = false } = {}) => {
    const destination = appPathForPage(nextPage);
    if (window.location.pathname !== destination) {
      window.history[replace ? "replaceState" : "pushState"]({ auraPage: nextPage }, "", destination);
    }
    setPage(nextPage);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const nextPage = pageForAppPath();
      if (nextPage) setPage(nextPage);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (normalizedSession && !canAccessPage(normalizedSession.user, page)) {
      navigate(defaultPageForRole(normalizedSession.user), { replace: true });
    }
  }, [normalizedSession, navigate, page]);

  // Sessões antigas ainda podiam cair em `/`; quem abre um deep link inválido
  // também recebe uma tela válida, sem criar uma entrada extra no histórico.
  useEffect(() => {
    if (!normalizedSession || (!isLanding && !isInternalApp)) return;
    const pageDaUrl = pageForAppPath();
    if (!pageDaUrl || pageDaUrl !== page) navigate(page, { replace: true });
  }, [isInternalApp, isLanding, navigate, normalizedSession, page]);

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
      window.location.href = appPathForPage(defaultPageForRole(normalizedSession?.user));
    }
  }, [isLoginPath, isAdminAuthenticated, normalizedSession?.user]);

  // Se não tem sessão e não está em rota pública (nem na landing "/"),
  // redireciona para login.
  useEffect(() => {
    if (!normalizedSession && !isLanding && !isAbout && !isPlansPage && !isPublicCatalog && !isPublicBooking && !isPublicCheckout && !isSignup && !isPlatform && !isLegalPage && !isLoginPath) {
      window.location.href = "/login";
    }
  }, [normalizedSession, isLanding, isAbout, isPlansPage, isPublicCatalog, isPublicBooking, isPublicCheckout, isSignup, isPlatform, isLegalPage, isLoginPath]);

  // Landing pública na raiz "/" quando não há sessão.
  if (isLanding && !normalizedSession) {
    return <Suspense fallback={<Loading />}><Landing /></Suspense>;
  }
  if (isAbout) return <Suspense fallback={<Loading />}><AboutPage /></Suspense>;
  if (isPlansPage) return <Suspense fallback={<Loading />}><PlansPage /></Suspense>;

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
  // /agendar SEM ?t=<slug> → diretório de clínicas com agendamento online;
  // com ?t → a agenda daquela clínica.
  if (isPublicBooking) {
    const params = new URLSearchParams(window.location.search);
    const hasTenant = ["t", "tenant", "clinic"].some((key) => params.get(key));
    return hasTenant
      ? <Suspense fallback={<Loading />}><PublicBooking /></Suspense>
      : <Suspense fallback={<Loading />}><BookingDirectory /></Suspense>;
  }
  if (isPublicCheckout) return <Suspense fallback={<Loading />}><PublicCheckout /></Suspense>;
  if (legalDocumentKey) return <Suspense fallback={<Loading />}><LegalDocument documentKey={legalDocumentKey} /></Suspense>;
  if (isSignup) return <Suspense fallback={<Loading />}><Signup /></Suspense>;
  if (isPlatform) return <Suspense fallback={<Loading />}><PlatformAdmin /></Suspense>;
  
  // Se não tem sessão, renderizar nada (useEffect acima vai redirecionar)
  if (!normalizedSession) {
    return null;
  }
  
  const activePage = canAccessPage(normalizedSession.user, page) ? page : defaultPageForRole(normalizedSession.user);
  return (
    <div className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
      {/* Sidebar apenas renderizado se autenticado */}
      {isAdminAuthenticated && (
        <Sidebar
          page={activePage}
          role={normalizedSession.user?.role}
          user={normalizedSession.user}
          brand={{ name: identity?.store_name || "", short: identity?.short_name || identity?.slogan || "", logoUrl: brandLogoUrl }}
          features={planFeatures}
          trialDays={trialDays}
          setPage={(next) => {
            if (next !== "agenda") setAgendaTarget(null);
            navigate(next);
            setSidebarOpen(false);
          }}
          open={sidebarOpen}
          collapsed={navCollapsed}
        />
      )}
      {isAdminAuthenticated && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button nav-toggle"
            onClick={toggleNav}
            aria-label={navCollapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!navCollapsed}
            title={navCollapsed ? "Expandir menu" : "Recolher menu"}
          >
            <Menu size={20} className="nav-toggle-mobile" />
            {navCollapsed ? <PanelLeftOpen size={20} className="nav-toggle-desk" /> : <PanelLeftClose size={20} className="nav-toggle-desk" />}
          </button>
          <form className="global-search" role="search" onSubmit={(event) => event.preventDefault()}>
            <Search size={19} aria-hidden="true" />
            <input
              ref={globalSearchRef}
              type="search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Buscar cliente, agendamento, serviço…"
              aria-label="Busca global"
            />
            <kbd>⌘ K</kbd>
          </form>
          <div className="topbar-page-context">
            <span>{brandName}</span>
            <strong>{activePage === "dashboard" ? "Visão geral" : pageTitle(activePage)}</strong>
          </div>
          <div className="topbar-actions">
            <button className="notification-button" aria-label="Notificações" onClick={openAlerts}>
              <Bell size={19} />
              {asNumber(alertsData.count) > 0 && <span>{asNumber(alertsData.count)}</span>}
            </button>
            <button type="button" className="topbar-icon-action" onClick={() => navigate("agenda")} aria-label="Abrir agenda" title="Agenda"><Calendar size={20} /></button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="user-chip" title={`${normalizedSession.user?.name || "Usuário"} · ${roleLabel(normalizedSession.user?.role)}`}>
                <span className="user-avatar" aria-hidden="true"><UserRound size={18} /></span>
                <span className="user-chip-copy"><strong>{normalizedSession.user?.name || "Usuário"}</strong><small>{roleLabel(normalizedSession.user?.role)}</small></span>
                <ChevronDown size={16} aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="user-menu-popover" align="end" sideOffset={8}>
                  <DropdownMenu.Item onSelect={() => navigate("settings")}><SettingsIcon size={16} /> Configurações</DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item className="danger" onSelect={handleLogout}><LogOut size={16} /> Sair</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        {/* Único elemento com rolagem: o menu lateral e o topo ficam fixos. */}
        <div className="content-scroll">
        {(trialDays !== null || subscriptionInactive || subscriptionInGrace) && activePage !== "meu-plano" && (
          <div className={`plan-banner ${subscriptionInactive ? "danger" : "warn"}`}>
            <span>
              {subscriptionInactive
                ? subscription?.status === "suspended"
                  ? "Acesso bloqueado por pagamento pendente. Abra Meu plano para pagar e reativar."
                  : subscription?.status === "canceled"
                    ? "Sua recorrência foi cancelada. Abra Meu plano para contratar novamente."
                    : "Seu período de teste terminou. Escolha um plano para continuar usando todos os recursos."
                : subscriptionInGrace
                  ? `Pagamento pendente: ${Number(subscription?.grace_days_left || 0)} dia(s) de carência restante(s).`
                : `Teste grátis: ${trialDays} dia(s) restante(s).`}
            </span>
          </div>
        )}
        <Suspense fallback={<Loading />}>
          {activePage === "meu-plano" && <MyPlan subscription={subscription} plans={plans} onChanged={loadStoreIdentity} />}
          {activePage === "dashboard" && <Dashboard user={normalizedSession.user} setPage={navigate} alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen} alertsData={alertsData} alertsLoading={alertsLoading} />}
          {activePage !== "dashboard" && alertsOpen && <AlertsPopup alerts={alertsData} loading={alertsLoading} onClose={() => setAlertsOpen(false)} onAction={(nextPage) => { setAlertsOpen(false); navigate(nextPage); }} />}
          {activePage === "agenda" && <AgendaWorkspace initialScreen={agendaTarget ? "settings" : "agenda"} initialSettingsTab={agendaTarget} onSettingsClosed={() => setAgendaTarget(null)} />}
          {activePage === "onboarding" && <Onboarding onOpenAgendaSettings={(tab) => { setAgendaTarget(tab); navigate("agenda"); }} />}
          {activePage === "communications" && <Communications />}
          {activePage === "products" && <CatalogWorkspace area="produtos" />}
          {/* Compatibilidade com atalhos antigos: não há mais menu separado;
              quem ainda chegar em "inventory" abre a aba Estoque da mesma área. */}
          {activePage === "inventory" && <CatalogWorkspace area="produtos" initialTab="unidades" />}
          {activePage === "catalog" && <CatalogWorkspace area="catalogo" />}
          {activePage === "client-center" && <ClientWorkspace onNavigate={navigate} />}
          {activePage === "catalog-customization" && <CatalogCustomization />}
          {activePage === "sales" && <SalesWorkspace />}
          {activePage === "finance" && <FinanceAdmin />}
          {activePage === "receivables" && <AccountsReceivable />}
          {activePage === "payables" && <PayablesAdmin />}
          {activePage === "reports" && <Reports />}
          {activePage === "clients" && <ClientsMedical />}
          {activePage === "terms" && <DigitalTerms onBack={() => navigate("client-center")} />}
          {activePage === "postcare" && <PostCare onBack={() => navigate("client-center")} />}
          {activePage === "admin" && <AccessAdmin />}
          {activePage === "integrations" && <Integrations />}
          {activePage === "support" && <Support />}
          {activePage === "settings" && <Settings user={normalizedSession.user} theme={uiTheme} onThemeChange={changeUiTheme} navCollapsed={navCollapsed} onNavCollapsedChange={changeNavCollapsed} onUserChanged={changeUser} />}
        </Suspense>
        </div>
      </main>
    </div>
  );
}

// Bloqueia indexação da tela de acesso restrito antes de qualquer render.
// Deliberadamente NÃO usamos robots.txt: aquele arquivo é público, então listar
// o caminho lá teria o efeito contrário — anunciaria a URL a quem procura.
// O ideal é o header X-Robots-Tag no nginx (vale sem JS); isto aqui é a rede de
// segurança para quando o header não estiver configurado.
if (window.location.pathname.startsWith("/plataforma")) {
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow, noarchive, nosnippet";
  document.head.appendChild(robots);
  document.title = "Acesso restrito";
}

installGlobalErrorReporting();
const auraRoot = window.__auraReactRoot || createRoot(document.getElementById("root"));
window.__auraReactRoot = auraRoot;
// O provider envolve tudo (inclusive as rotas públicas): o cache é a camada de
// leitura do app inteiro.
auraRoot.render(
  <QueryClientProvider client={queryClient}>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </QueryClientProvider>
);
