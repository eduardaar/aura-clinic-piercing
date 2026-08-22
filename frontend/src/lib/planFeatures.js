// Rótulos das features de plano, compartilhados entre a landing e o cadastro.
// Antes cada tela tinha sua própria cópia parcial do dicionário e os códigos que
// faltavam vazavam crus na interface.
export const featureLabels = {
  // Base
  clients: "Clientes",
  agenda: "Agenda",
  procedures: "Procedimentos",
  // Estoque e catálogo
  basic_inventory: "Estoque simples",
  basic_catalog: "Catálogo simples",
  catalog_analytics: "Google Analytics no catálogo",
  public_catalog_customization: "Catálogo personalizado",
  // Agendamento e relacionamento
  online_booking: "Agendamento online",
  whatsapp_link: "Link WhatsApp",
  message_templates: "Modelos de mensagem",
  automatic_followup: "Pós-atendimento automático",
  campaigns: "Campanhas",
  coupons: "Cupons",
  // Atendimento
  digital_terms: "Anamnese e termos digitais",
  // Financeiro
  basic_finance: "Gestão financeira",
  deposits: "Sinais e depósitos",
  commissions: "Comissões",
  // Relatórios e operação
  basic_reports: "Relatórios básicos"
};

// Rede de segurança: uma feature nova no backend vira "Novo Recurso" em vez de
// "novo_recurso" aparecer cru na tela até alguém lembrar de atualizar o mapa.
export function featureLabel(code) {
  if (featureLabels[code]) return featureLabels[code];
  return String(code || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

// Os planos são cumulativos; mostrar sempre as primeiras features faria os
// três cards parecerem iguais. Esta seleção traz primeiro o diferencial que
// justifica cada faixa de preço e completa com a própria matriz do plano.
const PLAN_FEATURE_PRIORITY = Object.freeze({
  start: ["agenda", "clients", "basic_inventory", "basic_catalog", "basic_reports"],
  profissional: ["basic_finance", "online_booking", "digital_terms", "public_catalog_customization", "automatic_followup"],
  studio: ["commissions", "coupons", "campaigns", "catalog_analytics", "visual_search"]
});

export function highlightedPlanFeatures(plan, limit = 5) {
  const included = Array.isArray(plan?.features) ? plan.features : [];
  const priority = PLAN_FEATURE_PRIORITY[plan?.code] || [];
  return [...new Set([...priority.filter((feature) => included.includes(feature)), ...included])].slice(0, limit);
}
