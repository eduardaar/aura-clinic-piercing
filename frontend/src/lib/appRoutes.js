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
  purchases: "/app/compras",
  receivables: "/app/financeiro/receber",
  payables: "/app/financeiro/pagar",
  suppliers: "/app/fornecedores",
  "finance-categories": "/app/financeiro/categorias",
  "cost-centers": "/app/financeiro/centros-de-custo",
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
  // Compatibilidade com favoritos anteriores à separação do financeiro.
  if (normalized === "/app/financeiro") return "receivables";
  if (normalized === "/app/financeiro/cadastros") return "suppliers";
  return PATH_TO_PAGE[normalized] || null;
}

export function isAppPath(pathname = window.location.pathname) {
  return String(pathname || "").startsWith("/app");
}
