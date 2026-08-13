// --- Vocabulário de papéis e páginas ----------------------------------------
//
// Papel e página circulam como string solta por todo o app (rota, menu, guarda
// de acesso, título). Um erro de digitação — "recepcao" no lugar de "reception",
// "client_center" no lugar de "client-center" — não quebra nada em tempo de
// execução: simplesmente cai no fallback e a tela some do menu, em silêncio.
// Os unions abaixo são a rede para isso: com `checkJs` ligado no arquivo que
// consome, o editor recusa a string errada na hora.

/**
 * Papéis de usuário DA CLÍNICA. Espelha a coluna `users.role` no backend.
 * Papel desconhecido não é erro em runtime: cai no fallback de acesso mínimo
 * em `allowedPagesForRole`.
 * @typedef {"admin" | "reception" | "finance" | "piercer"} Role
 */

/**
 * Páginas do app autenticado.
 * @typedef {"dashboard" | "agenda" | "communications" | "catalog" | "products" | "inventory"
 *   | "catalog-customization" | "sales" | "finance" | "receivables" | "payables" | "reports" | "client-center"
 *   | "clients" | "terms" | "postcare" | "admin" | "integrations" | "support"
 *   | "meu-plano" | "settings" | "onboarding"} Page
 */

/**
 * Código de feature de plano (assinatura). Espelha `backend/src/services/plans.js`.
 * @typedef {string} Feature
 */

// "integrations" fica SÓ em `admin`, nem em `finance`: ali se cadastra a chave
// do gateway, e quem a troca redireciona o faturamento inteiro da clínica para
// outra conta. É a mesma regra do backend (routes/integrations.js só aceita
// `admin`) — afrouxar aqui só criaria um item de menu que morre em 403.
/**
 * Páginas liberadas para o papel, na ordem do menu (a primeira é a página inicial).
 * @param {Role | string | undefined} role
 * @returns {Page[]}
 */
export function allowedPagesForRole(role) {
  /** @type {Record<Role, Page[]>} */
  const byRole = {
    admin: ["dashboard", "agenda", "communications", "products", "inventory", "catalog", "catalog-customization", "sales", "receivables", "payables", "reports", "client-center", "clients", "terms", "postcare", "admin", "integrations", "onboarding", "support", "meu-plano", "settings"],
    reception: ["agenda", "communications", "sales", "reports", "client-center", "clients", "settings"],
    finance: ["receivables", "payables", "reports", "sales", "settings"],
    piercer: ["agenda", "communications", "sales", "client-center", "clients", "terms", "postcare", "settings"]
  };
  // Fallback SEGURO para papéis desconhecidos: acesso mínimo, sem áreas
  // administrativas (admin/finance).
  return byRole[role] || ["dashboard", "agenda", "client-center", "clients", "settings"];
}

// Espelha PAGE_FEATURE do backend (backend/src/services/plans.js): página -> feature
// exigida. Páginas ausentes daqui são liberadas em qualquer plano — é o caso de
// "support": deliberadamente FORA de PAGE_FEATURE. Trancar o atendimento atrás
// do plano impediria justamente quem tem problema de cobrança de falar com a
// Monitence — e um cliente sem canal de suporte é um cliente que cancela.
//
// "integrations": configurar o gateway é PRÉ-REQUISITO da cobrança online, então
// trancá-la atrás do plano criaria o ciclo "não posso configurar porque não tenho
// o recurso que só funciona configurado" (o backend a serve com `withDb`, não com
// `withFeature`, pelo mesmo motivo).
/** @type {Partial<Record<Page, Feature>>} */
export const PAGE_FEATURE = {
  finance: "basic_finance",
  receivables: "advanced_finance",
  payables: "advanced_finance",
  terms: "digital_terms",
  postcare: "automatic_followup",
  communications: "message_templates",
  products: "basic_catalog",
  inventory: "basic_catalog",
  reports: "basic_reports",
  catalog: "public_catalog_customization",
  "catalog-customization": "public_catalog_customization",
  sales: "basic_catalog"
};

// A página está incluída no plano atual? (features = subscription.features)
/**
 * @param {Feature[] | unknown} features Lista de features da assinatura.
 * @param {Page | string} page
 * @returns {boolean}
 */
export function planAllowsPage(features, page) {
  const required = PAGE_FEATURE[page];
  if (!required) return true;
  return Array.isArray(features) && features.includes(required);
}

/**
 * @param {Role | string | undefined} role
 * @param {Page | string} page
 * @returns {boolean}
 */
export function canAccessPage(role, page) {
  return allowedPagesForRole(role).includes(/** @type {Page} */ (page));
}

/**
 * @param {Role | string | undefined} role
 * @returns {Page} Página de entrada após o login.
 */
export function defaultPageForRole(role) {
  return allowedPagesForRole(role)[0] || "dashboard";
}

/**
 * Título exibido no cabeçalho. Página desconhecida cai no nome do produto.
 * @param {Page | string} page
 * @returns {string}
 */
export function pageTitle(page) {
  /** @type {Record<Page, string>} */
  const titles = {
    dashboard: "Dashboard",
    agenda: "Agenda",
    communications: "Comunicações",
    catalog: "Catálogo",
    products: "Produtos",
    inventory: "Estoque",
    "catalog-customization": "Personalização do Catálogo",
    sales: "Vendas e ordens",
    finance: "Administrativo Financeiro",
    receivables: "Contas a receber",
    payables: "Contas a pagar",
    reports: "Relatórios",
    "client-center": "Clientes",
    clients: "Clientes",
    terms: "Termos digitais",
    postcare: "Pós-atendimento",
    admin: "Acessos administrativos",
    integrations: "Integrações",
    support: "Suporte",
    "meu-plano": "Meu plano",
    settings: "Configurações",
    onboarding: "Onboarding"
  };
  return titles[page] || "Aura Clinic";
}
