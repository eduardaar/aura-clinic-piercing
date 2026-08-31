import { lazy } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  Calendar,
  ContactRound,
  Gem,
  Home,
  Newspaper,
  Package,
  PackagePlus,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Table2,
  UsersRound
} from "lucide-react";

const lazyNamed = (loader, exportName) => lazy(() => loader().then((module) => ({ default: module[exportName] })));

// Registro único de navegação. Rotas, títulos, menu, permissões, features e
// componentes devem ser declarados aqui; os consumidores apenas derivam visões.
export const APP_PAGES = Object.freeze([
  {
    id: "dashboard", path: "/app/dashboard", aliases: ["/", "/app"], title: "Dashboard",
    group: "Início", icon: Home, menu: true, menuRank: 0, roleRank: { admin: 0 },
    permission: "dashboard.view",
    component: lazyNamed(() => import("../features/dashboard/Dashboard"), "Dashboard")
  },
  {
    id: "agenda", path: "/app/agenda", title: "Agenda", group: "Atendimento", icon: Calendar, menu: true, menuRank: 0,
    roleRank: { admin: 1, reception: 0, piercer: 0 }, permission: "appointments.view",
    component: lazyNamed(() => import("../features/agenda/Agenda"), "AgendaWorkspace")
  },
  {
    id: "services", path: "/app/servicos", title: "Procedimentos da Agenda", group: null, icon: Sparkles, menu: false, menuRank: 1,
    roleRank: { admin: 2, reception: 1, piercer: 1 }, feature: "procedures",
    component: lazyNamed(() => import("../features/services/Services"), "ServicesWorkspace")
  },
  {
    id: "communications", path: "/app/comunicacoes", title: "Comunicações", group: "Atendimento", icon: MessageSquare, menu: true, menuRank: 3,
    roleRank: { admin: 3, reception: 2, piercer: 2 }, permission: "communication.view", feature: "message_templates",
    component: lazyNamed(() => import("../features/communications/Communications"), "Communications")
  },
  {
    id: "products", path: "/app/produtos", title: "Itens de estoque", group: null, icon: Package, menu: false, menuRank: 0,
    roleRank: { admin: 4, reception: 3, piercer: 3 }, permission: "inventory.view", feature: "basic_inventory",
    component: lazyNamed(() => import("../features/inventory/Inventory"), "CatalogWorkspace")
  },
  {
    id: "purchases", path: "/app/compras", title: "Compras", group: "Estoque e compras", icon: PackagePlus, menu: true, menuRank: 3,
    roleRank: { admin: 5, finance: 2 }, permission: "finance.create", feature: "basic_finance",
    component: lazyNamed(() => import("../features/purchases/Purchases"), "Purchases")
  },
  {
    id: "inventory", path: "/app/produtos/estoque", title: "Estoque", group: "Estoque e compras", icon: Table2, menu: true, menuRank: 0,
    roleRank: { admin: 6, reception: 4, piercer: 4 }, permission: "inventory.view", feature: "basic_inventory",
    menuChildren: [
      { id: "inventory-all", label: "Todos os itens", page: "inventory", target: "todos" },
      { id: "inventory-products", label: "Produtos e joias", page: "inventory", target: "vendaveis" },
      { id: "inventory-materials", label: "Materiais de procedimento", page: "inventory", target: "materiais" },
      { id: "inventory-lots", label: "Lotes e validades", page: "inventory", target: "lotes" },
      { id: "inventory-movements", label: "Movimentações", page: "inventory", target: "movimentacoes" }
    ],
    component: lazyNamed(() => import("../features/inventory/Inventory"), "CatalogWorkspace")
  },
  {
    id: "consumables", path: "/app/materiais", title: "Materiais de procedimento", menuTitle: "Materiais", group: null, icon: Package, menu: false, menuRank: 2,
    roleRank: { admin: 7, reception: 5, piercer: 5 }, feature: "basic_inventory",
    component: lazyNamed(() => import("../features/inventory/Inventory"), "InventoryMaterialsWorkspace")
  },
  {
    id: "catalog", path: "/app/catalogo", title: "Catálogo", group: "Comercial", icon: Gem, menu: true, menuRank: 0,
    roleRank: { admin: 8 }, feature: "basic_catalog",
    menuChildren: [
      { id: "catalog-online", label: "Catálogo online", page: "catalog" },
      { id: "catalog-personalization", label: "Personalização", page: "catalog-customization", target: "layout" },
      { id: "catalog-promotions", label: "Promoções", page: "catalog-customization", target: "promocoes", feature: "campaigns" },
      { id: "catalog-coupons", label: "Cupons", page: "catalog-customization", target: "cupons", feature: "coupons" }
    ],
    component: lazyNamed(() => import("../features/inventory/Inventory"), "CatalogWorkspace")
  },
  {
    id: "catalog-customization", path: "/app/catalogo/personalizar", title: "Personalização do Catálogo", group: null, menu: false,
    roleRank: { admin: 9 }, feature: "public_catalog_customization",
    component: lazyNamed(() => import("../pages/CatalogCustomization"), "CatalogCustomization")
  },
  {
    id: "sales", path: "/app/vendas", title: "Vendas", menuTitle: "Vendas", group: "Comercial", icon: ShoppingCart, menu: true, menuRank: 1,
    roleRank: { admin: 10, reception: 6, finance: 7, piercer: 6 }, permission: "sales.view", feature: "basic_catalog",
    menuChildren: [
      { id: "sales-new", label: "Nova venda", page: "sales", target: "nova" },
      { id: "sales-open", label: "Vendas em aberto", page: "sales", target: "aberto", queue: true },
      { id: "sales-history", label: "Histórico de vendas", page: "sales", target: "historico" }
    ],
    component: lazyNamed(() => import("../features/sales/Sales"), "SalesWorkspace")
  },
  {
    id: "receivables", path: "/app/financeiro/receber", aliases: ["/app/financeiro"], title: "Contas a receber",
    menuTitle: "Financeiro", group: "Financeiro", icon: ArrowDownToLine, menu: true, menuRank: 0, roleRank: { admin: 11, finance: 0 },
    permission: "finance.view", feature: "basic_finance",
    menuChildren: [
      { id: "finance-overview", label: "Visão financeira", page: "receivables", target: "visao" },
      { id: "finance-cash", label: "Caixa", page: "receivables", target: "caixa" },
      { id: "finance-receivables", label: "Contas a receber", page: "receivables" },
      { id: "finance-payables", label: "Contas a pagar", page: "payables" },
      { id: "finance-categories", label: "Categorias", page: "finance-categories" },
      { id: "finance-cost-centers", label: "Centros de custo", page: "cost-centers" }
    ],
    component: lazyNamed(() => import("../features/finance/FinanceWorkspace"), "FinanceWorkspace")
  },
  {
    id: "payables", path: "/app/financeiro/pagar", title: "Contas a pagar", group: null, icon: ArrowUpFromLine, menu: false, menuRank: 1,
    roleRank: { admin: 12, finance: 1 }, permission: "finance.expenses", feature: "basic_finance",
    component: lazyNamed(() => import("../features/finance/Payables"), "PayablesAdmin")
  },
  {
    id: "suppliers", path: "/app/fornecedores", aliases: ["/app/financeiro/cadastros"], title: "Fornecedores",
    group: "Estoque e compras", icon: ContactRound, menu: true, menuRank: 4, roleRank: { admin: 13, finance: 3 },
    permission: "finance.edit", feature: "basic_finance",
    component: lazyNamed(() => import("../features/finance/FinanceRegistries"), "FinanceRegistries")
  },
  {
    id: "finance-categories", path: "/app/financeiro/categorias", title: "Categorias financeiras", group: null, menu: false,
    roleRank: { admin: 14, finance: 4 }, permission: "finance.edit", feature: "basic_finance",
    component: lazyNamed(() => import("../features/finance/FinanceRegistries"), "FinanceRegistries")
  },
  {
    id: "cost-centers", path: "/app/financeiro/centros-de-custo", title: "Centros de custo", group: null, menu: false,
    roleRank: { admin: 15, finance: 5 }, permission: "finance.edit", feature: "basic_finance",
    component: lazyNamed(() => import("../features/finance/FinanceRegistries"), "FinanceRegistries")
  },
  {
    id: "reports", path: "/app/relatorios", title: "Relatórios", group: "Gestão", icon: BarChart3, menu: true, menuRank: 0,
    roleRank: { admin: 16, reception: 7, finance: 6 },
    permission: ["reports.view_own", "reports.view_financial", "reports.view_all"], feature: "basic_reports",
    component: lazyNamed(() => import("../features/reports/Reports"), "Reports")
  },
  {
    id: "audit", path: "/app/auditoria", title: "Auditoria", group: "Gestão", icon: ScrollText, menu: true, menuRank: 1,
    roleRank: { admin: 16.5, finance: 6.5 }, permission: "audit.view",
    component: lazyNamed(() => import("../features/access/AuditAdmin"), "AuditAdmin")
  },
  {
    id: "client-center", path: "/app/clientes", title: "Clientes", group: "Atendimento", icon: UsersRound, menu: true, menuRank: 2,
    roleRank: { admin: 17, reception: 8, piercer: 7 }, permission: "clients.view",
    component: lazyNamed(() => import("../features/clients/ClientsMedical"), "ClientWorkspace")
  },
  {
    id: "clients", path: "/app/clientes/lista", title: "Clientes", group: null, menu: false,
    roleRank: { admin: 18, reception: 9, piercer: 8 }, permission: "clients.view",
    component: lazyNamed(() => import("../features/clients/ClientsMedical"), "ClientsMedical")
  },
  {
    id: "terms", path: "/app/clientes/termos", title: "Termos digitais", group: null, menu: false,
    roleRank: { admin: 19, piercer: 9 }, permission: "anamnesis.view", feature: "digital_terms",
    component: lazyNamed(() => import("../features/terms/DigitalTerms"), "DigitalTerms")
  },
  {
    id: "postcare", path: "/app/clientes/pos-atendimento", title: "Pós-atendimento", group: null, menu: false,
    roleRank: { admin: 20, piercer: 10 }, permission: "clinical_files.view", feature: "automatic_followup",
    component: lazyNamed(() => import("../features/postcare/PostCare"), "PostCare")
  },
  {
    id: "admin", path: "/app/acessos", title: "Usuários e permissões", menuTitle: "Usuários e permissões", group: null, icon: ShieldCheck, menu: false, menuRank: 1,
    roleRank: { admin: 21 }, permission: "users.view",
    component: lazyNamed(() => import("../features/access/AccessAdmin"), "AccessAdmin")
  },
  {
    id: "integrations", path: "/app/integracoes", title: "Integrações", group: null, icon: Sparkles, menu: false, menuRank: 2,
    roleRank: { admin: 22 },
    component: lazyNamed(() => import("../features/integrations/Integrations"), "Integrations")
  },
  {
    id: "onboarding", path: "/app/onboarding", title: "Onboarding", group: "Início", icon: Sparkles, menu: true, menuRank: 1,
    roleRank: { admin: 23 },
    component: lazyNamed(() => import("../features/onboarding/Onboarding"), "Onboarding")
  },
  {
    id: "support", path: "/app/suporte", title: "Suporte", group: null, menu: false,
    roleRank: { admin: 24 },
    component: lazyNamed(() => import("../features/support/Support"), "Support")
  },
  {
    id: "manual", path: "/app/ajuda/manual", title: "Manual do usuário", group: null, icon: BookOpen, menu: false,
    roleRank: { admin: 24.1, reception: 10.1, finance: 8.1, piercer: 11.1 },
    component: lazyNamed(() => import("../features/help/HelpCenter"), "UserManual")
  },
  {
    id: "product-news", path: "/app/ajuda/novidades", title: "Novidades", group: null, icon: Newspaper, menu: false,
    roleRank: { admin: 24.2, reception: 10.2, finance: 8.2, piercer: 11.2 },
    component: lazyNamed(() => import("../features/help/HelpCenter"), "ProductNews")
  },
  {
    id: "meu-plano", path: "/app/meu-plano", title: "Meu plano", group: null, icon: Sparkles, menu: false, menuRank: 3,
    roleRank: { admin: 25 },
    component: lazyNamed(() => import("../features/platform/MyPlan"), "MyPlan")
  },
  {
    id: "settings", path: "/app/configuracoes", title: "Dados e preferências", menuTitle: "Configurações", group: "Configurações", icon: Sparkles, menu: true, menuRank: 0,
    roleRank: { admin: 26, reception: 10, finance: 8, piercer: 11 }, permission: "settings.view",
    menuChildren: [
      { id: "settings-clinic", label: "Dados da clínica", page: "settings" },
      { id: "settings-users", label: "Usuários e permissões", page: "admin" },
      { id: "settings-integrations", label: "Integrações e automações", page: "integrations" },
      { id: "settings-plan", label: "Meu plano", page: "meu-plano" }
    ],
    component: lazyNamed(() => import("../features/settings/Settings"), "Settings")
  },

  // Páginas públicas também ficam registradas aqui para impedir que aliases e
  // regras de correspondência voltem a se espalhar pelo bootstrap do app.
  { id: "landing", path: "/", title: "Aura Clinic", public: true, match: "exact", component: lazyNamed(() => import("../pages/Landing"), "Landing") },
  { id: "about", path: "/sobre", title: "Sobre", public: true, match: "exact", component: lazyNamed(() => import("../pages/Landing"), "AboutPage") },
  { id: "plans", path: "/planos", title: "Planos", public: true, match: "exact", redirect: "/#planos" },
  { id: "login", path: "/login", title: "Entrar", public: true, match: "prefix", component: lazyNamed(() => import("../components/auth/Login"), "Login") },
  { id: "public-catalog", path: "/catalogo", title: "Catálogo", public: true, match: "prefix", component: lazyNamed(() => import("../pages/PublicExperience"), "PublicCatalog") },
  { id: "catalog-directory", path: "/catalogo", title: "Clínicas", public: true, virtual: true, component: lazyNamed(() => import("../pages/PublicDirectory"), "CatalogDirectory") },
  { id: "public-booking", path: "/agendar", title: "Agendar", public: true, match: "prefix", component: lazyNamed(() => import("../pages/PublicExperience"), "PublicBooking") },
  { id: "booking-directory", path: "/agendar", title: "Clínicas", public: true, virtual: true, component: lazyNamed(() => import("../pages/PublicDirectory"), "BookingDirectory") },
  { id: "public-checkout", path: "/comprar", title: "Comprar", public: true, match: "prefix", component: lazyNamed(() => import("../pages/PublicExperience"), "PublicCheckout") },
  { id: "signup", path: "/cadastro", title: "Cadastro", public: true, match: "prefix", component: lazyNamed(() => import("../features/platform/Signup"), "Signup") },
  { id: "platform", path: "/plataforma", title: "Acesso restrito", public: true, match: "prefix", component: lazyNamed(() => import("../features/platform/PlatformAdmin"), "PlatformAdmin") },
  { id: "terms-of-use", path: "/termos-de-uso", title: "Termos de uso", public: true, match: "exact", documentKey: "terms_of_use", component: lazyNamed(() => import("../pages/LegalDocument"), "LegalDocument") },
  { id: "privacy-policy", path: "/politica-de-privacidade", title: "Política de privacidade", public: true, match: "exact", documentKey: "privacy_policy", component: lazyNamed(() => import("../pages/LegalDocument"), "LegalDocument") },
  { id: "news", path: "/novidades", title: "Notícias e novidades", public: true, match: "prefix", component: lazyNamed(() => import("../pages/News"), "NewsPage") }
]);

export const INTERNAL_APP_PAGES = Object.freeze(APP_PAGES.filter((page) => !page.public));
export const PUBLIC_APP_PAGES = Object.freeze(APP_PAGES.filter((page) => page.public));

export function appPageById(id) {
  return APP_PAGES.find((page) => page.id === id) || null;
}

export function publicPageForPath(pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "") || "/";
  return PUBLIC_APP_PAGES.find((page) => !page.virtual && (
    page.match === "prefix" ? normalized === page.path || normalized.startsWith(`${page.path}/`) : normalized === page.path
  )) || null;
}

export function menuPages({ onboardingAtBottom = false, onboardingComplete = false } = {}) {
  const groupOrder = ["Início", "Atendimento", "Comercial", "Estoque e compras", "Financeiro", "Gestão", "Configurações"];
  return groupOrder.map((group) => ({
    group,
    pages: INTERNAL_APP_PAGES.filter((page) => page.menu && !(onboardingComplete && page.id === "onboarding") && (page.id === "onboarding"
      ? group === (onboardingAtBottom ? "Configurações" : "Início")
      : page.group === group)).sort((left, right) => left.menuRank - right.menuRank)
  })).filter(({ pages }) => pages.length > 0);
}
