// Rótulos das features de plano, compartilhados entre a landing e o cadastro.
// Antes cada tela tinha sua própria cópia parcial do dicionário e os códigos que
// faltavam vazavam crus na interface (ex.: "manual_reminders").
export const featureLabels = {
  // Base
  clients: "Clientes",
  agenda: "Agenda",
  procedures: "Procedimentos",
  full_client_history: "Histórico do cliente",
  // Estoque e catálogo
  basic_inventory: "Estoque simples",
  variation_inventory: "Estoque por variação",
  stock_alerts: "Alertas de estoque",
  basic_catalog: "Catálogo simples",
  advanced_catalog: "Catálogo avançado",
  public_catalog_customization: "Catálogo personalizado",
  featured_products: "Produtos em destaque",
  promotional_banner: "Banner promocional",
  // Agendamento e relacionamento
  online_booking: "Agendamento online",
  whatsapp_link: "Link WhatsApp",
  manual_reminders: "Lembretes manuais",
  message_templates: "Modelos de mensagem",
  automatic_followup: "Pós-atendimento automático",
  campaigns: "Campanhas",
  coupons: "Cupons",
  // Atendimento
  anamnesis: "Anamnese digital",
  digital_terms: "Termo digital",
  courses: "Cursos",
  // Financeiro
  basic_finance: "Financeiro básico",
  advanced_finance: "Financeiro avançado",
  deposits: "Sinais e depósitos",
  returns: "Devoluções",
  commissions: "Comissões",
  // Relatórios e operação
  basic_reports: "Relatórios básicos",
  monthly_reports: "Relatórios mensais",
  jewelry_sales_report: "Relatório de vendas de joias",
  alert_center: "Central de alertas",
  multi_user: "Multiusuários",
  priority_support: "Suporte prioritário"
};

// Rede de segurança: uma feature nova no backend vira "Novo Recurso" em vez de
// "novo_recurso" aparecer cru na tela até alguém lembrar de atualizar o mapa.
export function featureLabel(code) {
  if (featureLabels[code]) return featureLabels[code];
  return String(code || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}
