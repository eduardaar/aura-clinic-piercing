// "erp" e "error-logs" NÃO entram em nenhum papel: são ferramentas da plataforma,
// não da clínica. O Aura ERP exibe conteúdo fictício embutido no código
// (backend/src/routes/erp.js) e o Monitor de erros expõe stack traces e caminhos
// internos do servidor — nada disso é informação do cliente. Quem precisa disso
// é a equipe da Monitence, pelo painel de plataforma.
export function allowedPagesForRole(role) {
  return {
    admin: ["dashboard", "agenda", "communications", "catalog", "catalog-customization", "sales", "finance", "reports", "client-center", "clients", "terms", "postcare", "admin", "meu-plano"],
    reception: ["agenda", "communications", "sales", "reports", "client-center", "clients"],
    finance: ["finance", "reports", "sales"],
    piercer: ["agenda", "sales", "client-center", "clients", "postcare"]
    // Fallback SEGURO para papéis desconhecidos: acesso mínimo, sem áreas
    // administrativas (admin/finance).
  }[role] || ["dashboard", "agenda", "client-center", "clients"];
}

// Espelha PAGE_FEATURE do backend (backend/src/services/plans.js): página -> feature
// exigida. Páginas ausentes daqui são liberadas em qualquer plano.
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
export function planAllowsPage(features, page) {
  const required = PAGE_FEATURE[page];
  if (!required) return true;
  return Array.isArray(features) && features.includes(required);
}

export function canAccessPage(role, page) {
  return allowedPagesForRole(role).includes(page);
}

export function defaultPageForRole(role) {
  return allowedPagesForRole(role)[0] || "dashboard";
}

export function pageTitle(page) {
  return {
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
    "error-logs": "Monitor de erros",
    "meu-plano": "Meu plano"
  }[page] || "Aura Clinic";
}
