export function allowedPagesForRole(role) {
  return {
    admin: ["dashboard", "erp", "agenda", "catalog", "catalog-customization", "sales", "finance", "client-center", "clients", "terms", "postcare", "admin", "error-logs"],
    reception: ["agenda", "sales", "client-center", "clients"],
    finance: ["finance", "sales"],
    piercer: ["agenda", "sales", "client-center", "clients", "postcare"]
  }[role] || ["dashboard", "erp", "agenda", "catalog", "sales", "finance", "client-center", "clients", "terms", "postcare", "admin"];
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
    "error-logs": "Monitor de erros"
  }[page] || "Aura Clinic";
}
