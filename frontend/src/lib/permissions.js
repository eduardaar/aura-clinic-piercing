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
 * @typedef {"dashboard" | "agenda" | "services" | "communications" | "catalog" | "products" | "inventory" | "consumables"
 *   | "catalog-customization" | "sales" | "purchases" | "receivables" | "payables" | "suppliers" | "finance-categories" | "cost-centers" | "reports" | "client-center"
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
    admin: ["dashboard", "agenda", "services", "communications", "products", "purchases", "inventory", "consumables", "catalog", "catalog-customization", "sales", "receivables", "payables", "suppliers", "finance-categories", "cost-centers", "reports", "client-center", "clients", "terms", "postcare", "admin", "integrations", "onboarding", "support", "meu-plano", "settings"],
    reception: ["agenda", "services", "communications", "products", "inventory", "consumables", "sales", "reports", "client-center", "clients", "settings"],
    finance: ["receivables", "payables", "purchases", "suppliers", "finance-categories", "cost-centers", "reports", "sales", "settings"],
    piercer: ["agenda", "services", "communications", "products", "inventory", "consumables", "sales", "client-center", "clients", "terms", "postcare", "settings"]
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
  services: "procedures",
  receivables: "basic_finance",
  payables: "basic_finance",
  purchases: "basic_finance",
  suppliers: "basic_finance",
  "finance-categories": "basic_finance",
  "cost-centers": "basic_finance",
  terms: "digital_terms",
  postcare: "automatic_followup",
  communications: "message_templates",
  products: "basic_inventory",
  inventory: "basic_inventory",
  consumables: "basic_inventory",
  reports: "basic_reports",
  catalog: "basic_catalog",
  "catalog-customization": "public_catalog_customization",
  sales: "basic_catalog"
};

// Algumas telas são úteis em planos mais simples, mas uma ação dentro delas
// produz dados de um módulo contratado separadamente. A venda continua
// disponível no Start; somente a geração de títulos financeiros exige o
// Financeiro básico do Profissional.
export const ACTION_FEATURE = Object.freeze({
  "sales.generate_receivables": "basic_finance",
  "appointments.generate_receivables": "basic_finance"
});

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
 * @param {Feature[] | unknown} features Lista de features da assinatura.
 * @param {keyof typeof ACTION_FEATURE | string} action
 * @returns {boolean}
 */
export function planAllowsAction(features, action) {
  const required = ACTION_FEATURE[action];
  if (!required) return true;
  return Array.isArray(features) && features.includes(required);
}

/**
 * @param {Role | string | undefined | { role?: Role | string, granted_permissions?: string[], denied_permissions?: string[] }} role
 * @param {Page | string} page
 * @returns {boolean}
 */
export function canAccessPage(role, page) {
  const value = /** @type {any} */ (role);
  const actualRole = value && typeof value === "object" ? value.role : value;
  if (page === "reports") return ["reports.view_own", "reports.view_financial", "reports.view_all"].some((permission) => can(role, permission));
  const permission = PAGE_PERMISSION[page];
  return permission ? can(role, permission) : allowedPagesForRole(actualRole).includes(/** @type {Page} */ (page));
}

export const PAGE_PERMISSION = Object.freeze({
  dashboard: "dashboard.view", agenda: "appointments.view", communications: "communication.view",
  products: "inventory.view", inventory: "inventory.view", sales: "sales.view", purchases: "finance.create",
  receivables: "finance.view", payables: "finance.expenses", suppliers: "finance.edit",
  "finance-categories": "finance.edit", "cost-centers": "finance.edit",
  "client-center": "clients.view", clients: "clients.view", terms: "anamnesis.view", postcare: "clinical_files.view",
  admin: "users.view", settings: "settings.view"
});

const ROLE_PERMISSIONS = {
  admin: ["*"],
  piercer: ["dashboard.view", "appointments.view", "appointments.create", "appointments.edit", "appointments.reschedule", "appointments.cancel", "appointments.review", "appointments.finalize", "appointments.apply_discount", "appointments.apply_coupon", "appointments.edit_final_value", "clients.view", "clients.create", "clients.edit", "anamnesis.view", "anamnesis.edit", "anamnesis.review", "clinical_files.view", "clinical_files.edit", "sales.view", "sales.create", "sales.edit_open", "inventory.view", "inventory.sell", "inventory.adjust", "cash.view", "cash.open", "cash.receive_payment", "cash.close", "communication.view", "communication.send", "coupons.view", "coupons.apply", "settings.view"],
  reception: ["dashboard.view", "appointments.view", "appointments.create", "appointments.edit", "appointments.reschedule", "appointments.cancel", "appointments.apply_discount", "appointments.apply_coupon", "clients.view", "clients.create", "clients.edit", "anamnesis.view", "anamnesis.edit", "sales.view", "sales.create", "sales.edit_open", "inventory.view", "inventory.sell", "cash.view", "cash.open", "cash.receive_payment", "communication.view", "communication.send", "coupons.view", "coupons.apply", "settings.view"],
  finance: ["dashboard.view", "dashboard.financial", "appointments.view", "clients.view", "sales.view", "sales.edit_closed", "sales.cancel", "inventory.view", "inventory.view_cost", "cash.view", "cash.open", "cash.receive_payment", "cash.close", "cash.withdraw", "cash.adjust", "finance.view", "finance.create", "finance.edit", "finance.cancel", "finance.mark_test", "finance.expenses", "finance.refund", "reports.view_financial", "commission.view_all", "audit.view", "settings.view"]
};

export function can(userOrRole, permission) {
  const user = typeof userOrRole === "object" ? userOrRole : { role: userOrRole };
  if (user?.role === "admin") return true;
  if ((user?.denied_permissions || []).includes(permission)) return false;
  return [...(ROLE_PERMISSIONS[user?.role] || []), ...(user?.granted_permissions || [])].includes(permission);
}

/**
 * @param {Role | string | undefined | { role?: Role | string, granted_permissions?: string[], denied_permissions?: string[] }} role
 * @returns {Page} Página de entrada após o login.
 */
export function defaultPageForRole(role) {
  const value = /** @type {any} */ (role);
  const actualRole = value && typeof value === "object" ? value.role : value;
  return allowedPagesForRole(actualRole).find((page) => canAccessPage(role, page)) || "dashboard";
}

/**
 * Página segura quando a rota pedida existe para o papel, mas não para o plano.
 * Preserva a ordem de entrada de cada papel e usa o dashboard como saída
 * neutra quando todos os módulos prioritários estiverem bloqueados.
 * @param {Role | string | undefined | { role?: Role | string }} userOrRole
 * @param {Feature[] | unknown} features
 * @returns {Page}
 */
export function defaultPageForPlan(userOrRole, features) {
  const value = /** @type {any} */ (userOrRole);
  const actualRole = value && typeof value === "object" ? value.role : value;
  const candidates = [...allowedPagesForRole(actualRole), "dashboard", "settings"];
  return /** @type {Page} */ (
    candidates.find((page, index) =>
      candidates.indexOf(page) === index &&
      canAccessPage(userOrRole, page) &&
      planAllowsPage(features, page)
    ) || "dashboard"
  );
}

/**
 * Resolve a rota autenticada considerando papel e plano. Uma página conhecida
 * mas fora da assinatura leva administradores para Meu plano; outros papéis
 * recebem uma página operacional permitida.
 * @param {Role | string | undefined | { role?: Role | string }} userOrRole
 * @param {Page | string} requestedPage
 * @param {Feature[] | unknown} features
 * @param {boolean} planResolved
 * @returns {Page | string}
 */
export function resolveAccessiblePage(userOrRole, requestedPage, features, planResolved = true) {
  const roleAllowed = canAccessPage(userOrRole, requestedPage);
  const planAllowed = !planResolved || planAllowsPage(features, requestedPage);
  if (roleAllowed && planAllowed) return requestedPage;
  if (roleAllowed && !planAllowed && canAccessPage(userOrRole, "meu-plano")) return "meu-plano";
  return planResolved
    ? defaultPageForPlan(userOrRole, features)
    : defaultPageForRole(userOrRole);
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
    services: "Serviços",
    communications: "Comunicações",
    catalog: "Catálogo",
    products: "Produtos",
    inventory: "Estoque",
    consumables: "Materiais de consumo",
    "catalog-customization": "Personalização do Catálogo",
    sales: "Vendas e ordens",
    purchases: "Compras",
    receivables: "Contas a receber",
    payables: "Contas a pagar",
    suppliers: "Fornecedores",
    "finance-categories": "Categorias financeiras",
    "cost-centers": "Centros de custo",
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
