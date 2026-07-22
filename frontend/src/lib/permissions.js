export function allowedPagesForRole(role) {
  return {
    admin: ["dashboard", "erp", "agenda", "catalog", "catalog-customization", "sales", "finance", "client-center", "clients", "terms", "postcare", "admin", "error-logs", "meu-plano"],
    reception: ["agenda", "sales", "client-center", "clients"],
    finance: ["finance", "sales"],
    piercer: ["agenda", "sales", "client-center", "clients", "postcare"]
    // Fallback SEGURO para papéis desconhecidos: acesso mínimo, sem áreas
    // administrativas (erp/admin/finance). O "Aura ERP" só aparece para admin.
  }[role] || ["dashboard", "agenda", "client-center", "clients"];
}

// Espelha PAGE_FEATURE do backend (backend/src/services/plans.js): página -> feature
// exigida. Páginas ausentes daqui são liberadas em qualquer plano.
export const PAGE_FEATURE = {
  finance: "basic_finance",
  terms: "digital_terms",
  postcare: "automatic_followup",
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
    catalog: "Catálogo",
    "catalog-customization": "Personalização do Catálogo",
    sales: "Vendas e ordens",
    finance: "Administrativo Financeiro",
    "client-center": "Clientes",
    clients: "Clientes",
    terms: "Termos digitais",
    postcare: "Pós-atendimento",
    admin: "Acessos administrativos",
    "error-logs": "Monitor de erros",
    "meu-plano": "Meu plano"
  }[page] || "Aura Clinic";
}
