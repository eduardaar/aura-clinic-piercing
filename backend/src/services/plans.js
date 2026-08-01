// Planos, features e limites.
//
// ---------------------------------------------------------------------------
// A fonte da verdade agora é o BANCO (platform.subscription_plans); o que está
// aqui é SEMENTE e REDE DE SEGURANÇA.
// ---------------------------------------------------------------------------
//
// Antes o código mandava, de propósito, para o gating nunca depender de um seed
// desatualizado. Isso caiu porque o super-admin precisa editar plano, preço,
// features e limites pelo painel. A troca é feita sem abrir mão da garantia
// antiga, através de três decisões:
//
//   1. Um REGISTRO em memória, carregado do banco no boot e recarregado a cada
//      escrita. Com isso `planByCode()` continua SÍNCRONO — ele é usado em seis
//      arquivos, e torná-lo async espalharia `await` por todo o projeto sem
//      nenhum ganho.
//   2. Se o banco estiver vazio ou inacessível, o registro fica com os planos
//      daqui. Uma falha de leitura NUNCA pode virar "nenhuma clínica tem
//      feature nenhuma" — isso trancaria todo mundo fora do sistema de uma vez.
//   3. O CATÁLOGO de features e limites continua sendo código, e só ele. Cada
//      feature corresponde a uma rota realmente protegida por `withFeature`;
//      uma feature inventada no painel não protegeria nada e daria ao
//      super-admin a falsa impressão de ter liberado algo.
export const SUBSCRIPTION_STATUSES = ["trial_active", "trial_expired", "active", "overdue", "canceled", "suspended"];

// Tudo que pode ser marcado num plano. `key` é o que `withFeature("...")` exige
// nas rotas; `label` é o que o painel mostra. Agrupado para a tela de edição
// não virar uma lista de 35 caixinhas sem hierarquia.
//
// Ao criar uma feature nova: acrescente aqui E use em alguma rota. Uma entrada
// sem rota correspondente é decoração — pior que nada, porque promete acesso.
export const FEATURE_CATALOG = [
  { key: "clients", label: "Clientes", group: "Essencial" },
  { key: "agenda", label: "Agenda", group: "Essencial" },
  { key: "procedures", label: "Procedimentos", group: "Essencial" },
  { key: "manual_reminders", label: "Lembretes manuais", group: "Essencial" },
  { key: "basic_inventory", label: "Estoque básico", group: "Essencial" },

  { key: "basic_catalog", label: "Catálogo básico", group: "Catálogo e vendas" },
  { key: "whatsapp_link", label: "Link de WhatsApp", group: "Catálogo e vendas" },
  { key: "public_catalog_customization", label: "Personalizar catálogo público", group: "Catálogo e vendas" },
  { key: "advanced_catalog", label: "Catálogo avançado", group: "Catálogo e vendas" },
  { key: "featured_products", label: "Produtos em destaque", group: "Catálogo e vendas" },
  { key: "promotional_banner", label: "Banner promocional", group: "Catálogo e vendas" },
  { key: "coupons", label: "Cupons", group: "Catálogo e vendas" },
  { key: "returns", label: "Devoluções", group: "Catálogo e vendas" },
  { key: "visual_search", label: "Busca visual", group: "Catálogo e vendas" },

  { key: "online_booking", label: "Agendamento online", group: "Atendimento" },
  { key: "anamnese", label: "Anamnese", group: "Atendimento" },
  { key: "anamnesis", label: "Ficha de anamnese", group: "Atendimento" },
  { key: "digital_terms", label: "Termos digitais", group: "Atendimento" },
  { key: "automatic_followup", label: "Pós-atendimento automático", group: "Atendimento" },
  { key: "message_templates", label: "Modelos de mensagem", group: "Atendimento" },
  { key: "campaigns", label: "Campanhas", group: "Atendimento" },
  { key: "full_client_history", label: "Histórico completo do cliente", group: "Atendimento" },

  { key: "basic_finance", label: "Financeiro básico", group: "Financeiro" },
  { key: "advanced_finance", label: "Financeiro avançado", group: "Financeiro" },
  { key: "deposits", label: "Sinal de agendamento", group: "Financeiro" },
  { key: "commissions", label: "Comissões", group: "Financeiro" },

  { key: "basic_reports", label: "Relatórios básicos", group: "Relatórios" },
  { key: "monthly_reports", label: "Relatórios mensais", group: "Relatórios" },
  { key: "jewelry_sales_report", label: "Relatório de venda de joias", group: "Relatórios" },

  { key: "stock_alerts", label: "Alertas de estoque", group: "Operação" },
  { key: "variation_inventory", label: "Estoque por variação", group: "Operação" },
  { key: "alert_center", label: "Central de alertas", group: "Operação" },
  { key: "multi_user", label: "Vários usuários", group: "Operação" },
  { key: "courses", label: "Cursos", group: "Operação" },
  { key: "priority_support", label: "Suporte prioritário", group: "Operação" }
];

export const FEATURE_KEYS = FEATURE_CATALOG.map((item) => item.key);

// Cotas que um plano pode impor. Ausente ou `null` = ILIMITADO — e essa é a
// escolha certa como padrão: um limite que aparece do nada, por engano de
// digitação, bloqueia o trabalho de uma clínica pagante no meio do expediente.
export const LIMIT_CATALOG = [
  { key: "users", label: "Usuários", unit: "usuários", hint: "Quantas pessoas podem acessar o sistema da clínica." },
  { key: "clients", label: "Clientes cadastrados", unit: "clientes", hint: "Total de fichas de cliente." },
  { key: "appointments_month", label: "Agendamentos por mês", unit: "por mês", hint: "Conta os agendamentos criados no mês corrente." },
  { key: "jewelry_items", label: "Itens de estoque", unit: "itens", hint: "Joias cadastradas no estoque." },
  { key: "storage_mb", label: "Armazenamento", unit: "MB", hint: "Espaço somado de fotos e arquivos enviados." }
];

export const LIMIT_KEYS = LIMIT_CATALOG.map((item) => item.key);

export const PLAN_FEATURES = {
  essencial: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory"],
  start: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports"],
  profissional: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports", "online_booking", "anamnesis", "digital_terms", "basic_finance", "deposits", "stock_alerts", "automatic_followup", "message_templates", "public_catalog_customization"],
  studio: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports", "online_booking", "anamnesis", "digital_terms", "basic_finance", "deposits", "stock_alerts", "automatic_followup", "message_templates", "public_catalog_customization", "multi_user", "commissions", "monthly_reports", "coupons", "returns", "full_client_history", "jewelry_sales_report"],
  premium: ["clients", "agenda", "procedures", "manual_reminders", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports", "online_booking", "anamnesis", "digital_terms", "basic_finance", "deposits", "stock_alerts", "automatic_followup", "message_templates", "public_catalog_customization", "multi_user", "commissions", "monthly_reports", "coupons", "returns", "full_client_history", "jewelry_sales_report", "advanced_catalog", "featured_products", "promotional_banner", "campaigns", "advanced_finance", "variation_inventory", "visual_search", "alert_center", "courses", "priority_support"]
};

const DEFAULT_PLANS = [
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

// ---------------------------------------------------------------------------
// Registro vivo
// ---------------------------------------------------------------------------
//
// `SUBSCRIPTION_PLANS` é o MESMO array desde o boot, com o conteúdo trocado no
// lugar quando o banco é lido. Ele é importado direto por quatro arquivos —
// entre eles as rotas que servem a vitrine (`/api/plans`, `/api/store`) — e
// reatribuir a variável deixaria todos eles segurando a lista velha para
// sempre. Trocar o conteúdo é o que faz um plano editado no painel aparecer na
// landing sem reiniciar o servidor.
export const SUBSCRIPTION_PLANS = DEFAULT_PLANS.map((plan) => ({ ...plan }));

// Converte a linha do banco para o formato que o app já consome.
function fromRow(row) {
  const features = Array.isArray(row.features) ? row.features : [];
  return {
    code: row.code,
    name: row.name,
    price_cents: Number(row.price_cents || 0),
    audience: row.audience || "",
    description: row.description || "",
    trial_days: Number(row.trial_days ?? 7),
    // `is_recommended` é o nome da coluna; `highlight` é como a vitrine já lia.
    // Mantidos os dois para não quebrar o frontend existente.
    highlight: Boolean(row.is_recommended),
    is_recommended: Boolean(row.is_recommended),
    badge: row.badge || (row.is_recommended ? "Mais recomendado" : ""),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order || 0),
    // Só features do catálogo entram. Uma chave órfã no banco (feature removida
    // do código, plano não atualizado) não pode virar acesso a coisa nenhuma.
    features: features.filter((key) => FEATURE_KEYS.includes(key)),
    limits: row.limits && typeof row.limits === "object" ? row.limits : {}
  };
}

// Troca o conteúdo do registro, mantendo a identidade do array.
export function setPlansRegistry(rows) {
  const plans = rows.map(fromRow).sort((a, b) => a.sort_order - b.sort_order || a.price_cents - b.price_cents);
  if (!plans.length) return SUBSCRIPTION_PLANS;

  SUBSCRIPTION_PLANS.splice(0, SUBSCRIPTION_PLANS.length, ...plans);

  // PLAN_FEATURES também é importado direto (routes/platform.js), então precisa
  // acompanhar. Limpa antes de reescrever: um plano excluído tem que sumir
  // daqui, senão continuaria concedendo features a quem consultasse por código.
  for (const key of Object.keys(PLAN_FEATURES)) delete PLAN_FEATURES[key];
  for (const plan of plans) PLAN_FEATURES[plan.code] = plan.features;

  return SUBSCRIPTION_PLANS;
}

// Lê os planos do banco para o registro. Chamada no boot e depois de toda
// escrita no painel.
//
// Best-effort de propósito: em QUALQUER falha o registro fica como está (no
// boot, com os planos-semente daqui). Deixar a lista vazia significaria que
// nenhuma clínica tem feature nenhuma — todas trancadas fora do sistema de uma
// vez, por causa de uma indisponibilidade momentânea do banco.
export async function loadPlansFromDb() {
  try {
    const { query } = await import("../database/connection.js");
    const result = await query(
      `SELECT code, name, price_cents, audience, description, trial_days,
              features, limits, is_recommended, is_active, badge, sort_order
         FROM platform.subscription_plans
        ORDER BY sort_order, price_cents`
    );
    if (!result.rows.length) {
      console.warn("[plans] nenhum plano no banco; mantendo os planos-semente do código.");
      return SUBSCRIPTION_PLANS;
    }
    return setPlansRegistry(result.rows);
  } catch (error) {
    console.error(`[plans] falha ao carregar planos do banco: ${error.message}. Mantendo os do código.`);
    return SUBSCRIPTION_PLANS;
  }
}

// Todos os planos, inclusive os desativados (o painel precisa vê-los).
export function listPlans({ onlyActive = false } = {}) {
  return onlyActive ? SUBSCRIPTION_PLANS.filter((plan) => plan.is_active !== false) : SUBSCRIPTION_PLANS;
}

// Limite do plano para uma cota. `null` = ilimitado, e é o padrão para toda
// chave ausente: limite que aparece sozinho por engano de digitação bloquearia
// uma clínica pagante no meio do expediente.
export function planLimit(planCode, limitKey) {
  const plan = planByCode(planCode);
  const value = plan?.limits?.[limitKey];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// Mapa PÁGINA (do app) -> feature exigida. Páginas ausentes daqui são sempre
// liberadas (base de todo plano: dashboard, agenda, clientes, catálogo/estoque).
// Usado tanto pelo gating de menu no frontend quanto como referência do backend.
export const PAGE_FEATURE = {
  finance: "basic_finance",
  terms: "digital_terms",
  postcare: "automatic_followup",
  communications: "message_templates",
  reports: "basic_reports",
  "catalog-customization": "public_catalog_customization",
  sales: "basic_catalog"
};

// A página é acessível para este conjunto de features do plano?
export function pageAllowedByPlan(features, page) {
  const required = PAGE_FEATURE[page];
  if (!required) return true;
  return Array.isArray(features) && features.includes(required);
}

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
