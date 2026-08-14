// Rotas internas do painel da clínica. URLs públicas continuam em seus próprios
// caminhos (/catalogo, /agendar, /comprar, /cadastro e /plataforma) para não
// misturar navegação autenticada com páginas compartilháveis.
const ROUTES = {
  dashboard: "/app/dashboard",
  agenda: "/app/agenda",
  "client-center": "/app/clientes",
  clients: "/app/clientes/lista",
  terms: "/app/clientes/termos",
  postcare: "/app/clientes/pos-atendimento",
  products: "/app/produtos",
  inventory: "/app/produtos/estoque",
  catalog: "/app/catalogo",
  "catalog-customization": "/app/catalogo/personalizar",
  sales: "/app/vendas",
  communications: "/app/comunicacoes",
  finance: "/app/financeiro",
  receivables: "/app/financeiro/receber",
  payables: "/app/financeiro/pagar",
  reports: "/app/relatorios",
  admin: "/app/acessos",
  integrations: "/app/integracoes",
  onboarding: "/app/onboarding",
  support: "/app/suporte",
  "meu-plano": "/app/meu-plano",
  settings: "/app/configuracoes",
};

const PATH_TO_PAGE = Object.fromEntries(Object.entries(ROUTES).map(([page, path]) => [path, page]));

export function appPathForPage(page) {
  return ROUTES[page] || ROUTES.dashboard;
}

export function pageForAppPath(pathname = window.location.pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (normalized === "/" || normalized === "/app") return "dashboard";
  return PATH_TO_PAGE[normalized] || null;
}

export function isAppPath(pathname = window.location.pathname) {
  return String(pathname || "").startsWith("/app");
}
