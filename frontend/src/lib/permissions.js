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
 * Páginas do app. Inclui as duas da PLATAFORMA ("erp", "error-logs"), que
 * existem como página mas não pertencem a papel nenhum da clínica.
 * @typedef {"dashboard" | "erp" | "agenda" | "communications" | "catalog"
 *   | "catalog-customization" | "sales" | "finance" | "reports" | "client-center"
 *   | "clients" | "terms" | "postcare" | "admin" | "integrations" | "error-logs"
 *   | "meu-plano"} Page
 */

/**
 * Código de feature de plano (assinatura). Espelha `backend/src/services/plans.js`.
 * @typedef {string} Feature
 */

// "erp" e "error-logs" NÃO entram em nenhum papel: são ferramentas da plataforma,
// não da clínica. O Aura ERP exibe conteúdo fictício embutido no código
// (backend/src/routes/erp.js) e o Monitor de erros expõe stack traces e caminhos
// internos do servidor — nada disso é informação do cliente. Quem precisa disso
// é a equipe da Monitence, pelo painel de plataforma.
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
    admin: ["dashboard", "agenda", "communications", "catalog", "catalog-customization", "sales", "finance", "reports", "client-center", "clients", "terms", "postcare", "admin", "integrations", "meu-plano"],
    reception: ["agenda", "communications", "sales", "reports", "client-center", "clients"],
    finance: ["finance", "reports", "sales"],
    piercer: ["agenda", "sales", "client-center", "clients", "postcare"]
  };
  // Fallback SEGURO para papéis desconhecidos: acesso mínimo, sem áreas
  // administrativas (admin/finance).
  return byRole[role] || ["dashboard", "agenda", "client-center", "clients"];
}

// Espelha PAGE_FEATURE do backend (backend/src/services/plans.js): página -> feature
// exigida. Páginas ausentes daqui são liberadas em qualquer plano — é o caso de
// "integrations": configurar o gateway é PRÉ-REQUISITO da cobrança online, então
// trancá-la atrás do plano criaria o ciclo "não posso configurar porque não tenho
// o recurso que só funciona configurado" (o backend a serve com `withDb`, não com
// `withFeature`, pelo mesmo motivo).
/** @type {Partial<Record<Page, Feature>>} */
export const PAGE_FEATURE = {
  finance: "basic_finance",
  terms: "digital_terms",
  postcare: "automatic_followup",
  communications: "message_templates",
  reports: "basic_reports",
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
    erp: "Aura Clinic ERP",
    agenda: "Agenda",
    communications: "Comunicações",
    catalog: "Catálogo",
    "catalog-customization": "Personalização do Catálogo",
    sales: "Vendas e ordens",
    finance: "Administrativo Financeiro",
    reports: "Relatórios",
    "client-center": "Clientes",
    clients: "Clientes",
    terms: "Termos digitais",
    postcare: "Pós-atendimento",
    admin: "Acessos administrativos",
    integrations: "Integrações",
    "error-logs": "Monitor de erros",
    "meu-plano": "Meu plano"
  };
  return titles[page] || "Aura Clinic";
}
