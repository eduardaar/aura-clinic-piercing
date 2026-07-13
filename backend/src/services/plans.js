export const SUBSCRIPTION_STATUSES = ["trial_active", "trial_expired", "active", "overdue", "canceled", "suspended"];

export const PLAN_FEATURES = {
  essencial: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory"],
  start: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports"],
  profissional: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports", "online_booking", "anamnesis", "digital_terms", "basic_finance", "deposits", "stock_alerts", "automatic_followup", "message_templates", "public_catalog_customization"],
  studio: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports", "online_booking", "anamnesis", "digital_terms", "basic_finance", "deposits", "stock_alerts", "automatic_followup", "message_templates", "public_catalog_customization", "multi_user", "commissions", "monthly_reports", "coupons", "returns", "full_client_history", "jewelry_sales_report"],
  premium: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports", "online_booking", "anamnesis", "digital_terms", "basic_finance", "deposits", "stock_alerts", "automatic_followup", "message_templates", "public_catalog_customization", "multi_user", "commissions", "monthly_reports", "coupons", "returns", "full_client_history", "jewelry_sales_report", "advanced_catalog", "featured_products", "promotional_banner", "campaigns", "advanced_finance", "variation_inventory", "alert_center", "courses", "priority_support"]
};

export const SUBSCRIPTION_PLANS = [
  {
    code: "essencial",
    name: "Pacote Essencial",
    price_cents: 1990,
    audience: "Piercers iniciantes",
    trial_days: 7,
    highlight: false,
    features: PLAN_FEATURES.essencial
  },
  {
    code: "start",
    name: "Pacote Start",
    price_cents: 3990,
    audience: "Piercers iniciantes ou autônomos",
    trial_days: 7,
    highlight: false,
    features: PLAN_FEATURES.start
  },
  {
    code: "profissional",
    name: "Pacote Profissional",
    price_cents: 6990,
    audience: "Estúdios que querem agendamento online e ficha digital",
    trial_days: 7,
    highlight: true,
    badge: "Mais recomendado",
    features: PLAN_FEATURES.profissional
  },
  {
    code: "studio",
    name: "Pacote Studio",
    price_cents: 9990,
    audience: "Estúdios com equipe e venda de joias",
    trial_days: 7,
    highlight: false,
    features: PLAN_FEATURES.studio
  },
  {
    code: "premium",
    name: "Pacote Premium",
    price_cents: 14990,
    audience: "Operações completas com catálogo avançado",
    trial_days: 7,
    highlight: false,
    features: PLAN_FEATURES.premium
  }
];

export function normalizePlanCode(code, fallback = "profissional") {
  const normalized = String(code || "").trim().toLowerCase();
  return SUBSCRIPTION_PLANS.some((plan) => plan.code === normalized) ? normalized : fallback;
}

export function planByCode(code) {
  const planCode = normalizePlanCode(code);
  return SUBSCRIPTION_PLANS.find((plan) => plan.code === planCode) || SUBSCRIPTION_PLANS[2];
}

export function trialWindow(days = 7) {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + Number(days || 7));
  return {
    trial_started_at: start.toISOString(),
    trial_ends_at: end.toISOString()
  };
}
