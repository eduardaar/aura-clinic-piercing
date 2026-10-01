import { inventoryIntelligence } from "./inventoryIntelligence.js";
import { syncFinanceSources } from "./financeLedger.js";
import { hasPermission } from "./permissionService.js";
import { P } from "../config/permissions.js";
import { CLINIC_TIME_ZONE, localDate } from "./utils.js";

const filter = (key, label, type = "text", options) => Object.freeze({ key, label, type, ...(options ? { options } : {}) });
const option = (value, label) => Object.freeze({ value, label });
const PERIOD_FILTERS = [filter("from", "De", "date"), filter("to", "Até", "date")];
const STATUS_FILTER = filter("status", "Status", "text");
const PROFESSIONAL_FILTER = filter("professional_id", "Profissional", "professional");
const columns = (...items) => items.map(([key, label, kind]) => Object.freeze({ key, label, ...(kind ? { kind } : {}) }));

// Data local da clínica a partir de um TIMESTAMPTZ. `::date` puro usaria o fuso
// da sessão do banco (que ninguém configura) e jogaria o que acontece depois
// das 21h em São Paulo para o dia seguinte.
const LOCAL_DATE = (column) => `timezone('${CLINIC_TIME_ZONE}', ${column})::date`;
const LOCAL_DATETIME = (column) => `to_char(timezone('${CLINIC_TIME_ZONE}', ${column}), 'YYYY-MM-DD HH24:MI')`;

// Composição do valor da OPERAÇÃO (atendimento ou venda), igual ao resumo
// financeiro da tela: bruto − desconto (cupom/promoção + manual) ± ajustes =
// líquido. `discount_value` é o desconto TOTAL; a parte de cupom é o total
// menos o manual. Linhas antigas sem `subtotal_value` reconstroem o bruto a
// partir do líquido (mesma regra do cálculo de comissão), para o desconto não
// ser abatido duas vezes.
const APPOINTMENT_GROSS = (a) => `CASE WHEN COALESCE(${a}.subtotal_value,0) > 0 THEN ${a}.subtotal_value
  ELSE COALESCE(${a}.total_value,0) + COALESCE(${a}.discount_value,0) - COALESCE(${a}.adjustment_total,0) END`;
const APPOINTMENT_COUPON = (a) => `GREATEST(COALESCE(${a}.discount_value,0) - COALESCE(${a}.manual_discount_value,0), 0)`;
const SALE_GROSS = (so) => `CASE WHEN COALESCE(${so}.subtotal_value,0) > 0 THEN ${so}.subtotal_value
  ELSE COALESCE(${so}.total_value,0) + COALESCE(${so}.discount_value,0) END`;
const SALE_COUPON = (so) => `GREATEST(COALESCE(${so}.discount_value,0) - COALESCE(${so}.manual_discount_value,0), 0)`;

// Pagamentos que entram como dinheiro recebido. `credito_aplicado` reaproveita
// um valor que já entrou antes (sinal convertido em crédito, devolução) e não é
// caixa novo; pendente, cancelado e estornado também não são "recebido".
const RECEIVED_PAYMENT_STATUSES = "('pago','confirmado')";
const CANCELED_SALE_STATUSES = "('cancelado','cancelada')";

const MONEY_BREAKDOWN_COLUMNS = [
  ["gross_value", "Bruto", "money"], ["coupon_discount", "Desconto (cupom/promoção)", "money"],
  ["manual_discount", "Desconto manual", "money"], ["discount_total", "Desconto total", "money"]
];

export const REPORT_CATALOG = Object.freeze([
  {
    type: "appointments", label: "Agendamentos", category: "Atendimento",
    filters: [...PERIOD_FILTERS, STATUS_FILTER, PROFESSIONAL_FILTER],
    columns: columns(["id", "ID"], ["appointment_date", "Data", "date"], ["appointment_time", "Hora", "time"], ["client", "Cliente"],
      ["professional", "Profissional"], ["procedure", "Procedimento"], ["status", "Status", "status"], ["source", "Origem", "enum"],
      ...MONEY_BREAKDOWN_COLUMNS, ["adjustment_total", "Ajustes", "money"], ["net_value", "Líquido", "money"],
      ["deposit_value", "Sinal", "money"], ["remaining_value", "Restante", "money"])
  },
  {
    type: "services", label: "Serviços executados", category: "Atendimento",
    filters: [...PERIOD_FILTERS, PROFESSIONAL_FILTER],
    columns: columns(["service", "Serviço"], ["executions", "Atendimentos", "count"], ["quantity", "Quantidade", "count"],
      ["gross_revenue", "Faturamento bruto do serviço", "money"], ["average_ticket", "Média por atendimento", "money"])
  },
  {
    type: "cancellations", label: "Cancelamentos, recusas e ausências", category: "Atendimento",
    filters: [...PERIOD_FILTERS, filter("status", "Desfecho", "select", [option("cancelado", "Cancelado"), option("recusado", "Recusado"), option("nao_compareceu", "Não compareceu")]), PROFESSIONAL_FILTER],
    columns: columns(["id", "ID"], ["appointment_date", "Data do agendamento", "date"], ["appointment_time", "Hora", "time"],
      ["event_date", "Data do desfecho", "date"], ["client", "Cliente"], ["professional", "Profissional"], ["procedure", "Procedimento"],
      ["status", "Desfecho", "status"], ["reason", "Motivo"], ["deposit_resolution", "Resolução do sinal"],
      ["deposit_amount", "Sinal recebido", "money"], ["refund_method", "Forma do reembolso"])
  },
  { type: "digital_terms", label: "Termos digitais", category: "Clientes e clínico", pagination: "server", filters: [...PERIOD_FILTERS, filter("procedure", "Procedimento")], columns: columns(["id", "ID"], ["signed_at", "Assinado em", "date"], ["client", "Cliente"], ["document_number", "CPF/documento"], ["procedure", "Procedimento"], ["piercing_region", "Região"], ["orientations_confirmed", "Orientações confirmadas", "boolean"], ["appointment_id", "Agendamento"]) },
  { type: "postcare", label: "Pós-atendimento", category: "Clientes e clínico", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("healing_status", "Cicatrização")], columns: columns(["id", "ID"], ["due_date", "Data prevista", "date"], ["client", "Cliente"], ["reminder_day", "Dia do lembrete", "count"], ["healing_status", "Cicatrização"], ["status", "Status", "status"], ["updated_at", "Atualizado em", "date"]) },
  {
    type: "biosafety", label: "Biossegurança e rastreabilidade clínica", category: "Clientes e clínico", pagination: "server",
    filters: [...PERIOD_FILTERS, PROFESSIONAL_FILTER],
    columns: columns(["id", "Execução"], ["execution_date", "Data", "date"], ["client", "Cliente"], ["appointment_id", "Atendimento"],
      ["professional", "Profissional"], ["procedure", "Procedimento"], ["sterilization_cycle", "Ciclo de esterilização"],
      ["sterilization_record", "Registro/comprovante"], ["applied_jewelry", "Joia aplicada"], ["material_lots", "Materiais/lotes"],
      ["indicators", "Indicadores químicos", "count"], ["indicators_approved", "Aprovados", "count"], ["indicators_failed", "Reprovados", "count"],
      ["indicator_lots", "Lote/identificação dos indicadores"], ["indicator_photo", "Foto do indicador", "boolean"])
  },
  {
    type: "chemical_indicators", label: "Indicadores químicos por procedimento", category: "Clientes e clínico", pagination: "server",
    filters: [...PERIOD_FILTERS, PROFESSIONAL_FILTER,
      filter("result", "Resultado", "select", [option("aprovado", "Aprovado"), option("reprovado", "Reprovado"), option("nao_informado", "Não informado")]),
      filter("status", "Situação", "select", [option("ativo", "Ativo"), option("anulado", "Anulado")])],
    columns: columns(["id", "ID"], ["procedure_date", "Data", "date"], ["client", "Cliente"], ["appointment_id", "Atendimento"],
      ["professional", "Profissional"], ["procedure", "Procedimento"], ["body_region", "Região"], ["jewelry", "Joia"],
      ["indicator_type", "Tipo"], ["indicator_brand", "Marca"], ["indicator_lot", "Lote"], ["indicator_date", "Data do indicador", "date"],
      ["identification", "Identificação"], ["result", "Resultado", "status"], ["has_photo", "Foto", "boolean"], ["status", "Situação", "status"],
      ["registered_by", "Registrado por"], ["registered_at", "Registrado em", "datetime"], ["void_reason", "Motivo da anulação"])
  },
  {
    type: "clients", label: "Clientes", category: "Clientes e clínico", filters: [],
    columns: columns(["id", "ID"], ["full_name", "Nome"], ["whatsapp", "WhatsApp"], ["instagram", "Instagram"], ["birth_date", "Nascimento", "date"],
      ["appointments", "Atendimentos realizados", "count"], ["services_value", "Total em atendimentos", "money"],
      ["sales_value", "Total em vendas", "money"], ["lifetime_value", "Total gasto", "money"], ["last_visit", "Última visita", "date"])
  },
  {
    type: "sales", label: "Vendas", category: "Comercial",
    filters: [...PERIOD_FILTERS, filter("status", "Status", "select", [option("aberta", "Aberta"), option("pendente", "Pendente"), option("pago", "Pago"), option("concluida", "Concluída"), option("devolvida", "Devolvida"), option("cancelado", "Cancelada")])],
    columns: columns(["id", "ID"], ["sale_date", "Data", "date"], ["client", "Cliente"], ["order_type", "Tipo de venda", "enum"],
      ["source", "Origem", "enum"], ["status", "Status", "status"], ["payment_method", "Forma de pagamento"],
      ...MONEY_BREAKDOWN_COLUMNS, ["net_value", "Líquido", "money"], ["returned_value", "Devolvido", "money"],
      ["final_value", "Valor final da venda", "money"])
  },
  { type: "promotions", label: "Promoções", category: "Comercial", filters: PERIOD_FILTERS, columns: columns(["id", "ID"], ["name", "Promoção"], ["discount_type", "Tipo de desconto", "enum"], ["discount_value", "Desconto", "discount"], ["status", "Status", "status"], ["start_date", "Início", "date"], ["end_date", "Fim", "date"], ["usage_limit", "Limite de uso", "count"], ["uses", "Usos", "count"], ["discount_total", "Desconto concedido", "money"]) },
  { type: "coupons", label: "Cupons", category: "Comercial", filters: PERIOD_FILTERS, columns: columns(["id", "ID"], ["code", "Código"], ["name", "Cupom"], ["status", "Status", "status"], ["discount_type", "Tipo de desconto", "enum"], ["discount_value", "Desconto", "discount"], ["usage_limit", "Limite de uso", "count"], ["uses", "Usos", "count"], ["discount_total", "Desconto concedido", "money"]) },
  { type: "catalog_conversion", label: "Conversão do catálogo", category: "Comercial", filters: PERIOD_FILTERS, columns: columns(["event_type", "Evento", "enum"], ["events", "Eventos", "count"], ["unique_sessions", "Sessões únicas", "count"]) },
  {
    type: "stock", label: "Posição de estoque", category: "Estoque e compras", filters: [filter("product_id", "Produto"), filter("category", "Categoria")],
    columns: columns(["id", "ID"], ["name", "Produto"], ["sku", "SKU"], ["category", "Categoria"], ["material", "Material"], ["color", "Cor"],
      ["quantity", "Quantidade", "count"], ["cost_value", "Custo", "money"], ["sale_value", "Preço de venda", "money"], ["status", "Status", "status"], ["supplier", "Fornecedor"])
  },
  { type: "stock_movements", label: "Movimentos de estoque", category: "Estoque e compras", pagination: "server", filters: [...PERIOD_FILTERS, filter("movement_type", "Tipo de movimento"), filter("item_type", "Tipo de item", "select", [{ value: "product", label: "Produto/joia" }, { value: "consumable", label: "Material de consumo" }])], columns: columns(["id", "ID"], ["movement_date", "Data", "date"], ["item_type", "Tipo de item", "enum"], ["item", "Item"], ["sku", "SKU"], ["movement_type", "Movimento"], ["quantity", "Quantidade", "count"], ["notes", "Observações"], ["purchase_order_id", "Compra"], ["sales_order_id", "Venda"]) },
  { type: "lots", label: "Lotes e validade", category: "Estoque e compras", pagination: "server", filters: [filter("expiry_from", "Validade de", "date"), filter("expiry_to", "Validade até", "date"), STATUS_FILTER, filter("consumable_id", "Material de consumo")], columns: columns(["id", "ID"], ["consumable", "Material de consumo"], ["batch_code", "Lote"], ["expiry_date", "Validade", "date"], ["received_quantity", "Quantidade recebida", "count"], ["remaining_quantity", "Saldo", "count"], ["unit_cost", "Custo unitário", "money"], ["status", "Status", "status"], ["purchase_order_id", "Compra"]) },
  { type: "abc", label: "Curva ABC de estoque", category: "Estoque e compras", filters: [filter("days", "Período em dias", "number")], columns: columns(["name", "Produto"], ["sku", "SKU"], ["abc_class", "Classe ABC"], ["units_out", "Saídas", "count"], ["movement_value", "Valor movimentado", "money"], ["daily_demand", "Demanda diária", "count"], ["days_to_stockout", "Previsão de ruptura (dias)", "count"]) },
  { type: "purchases", label: "Compras", category: "Estoque e compras", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("supplier_id", "Fornecedor")], columns: columns(["id", "ID"], ["purchase_date", "Data da compra", "date"], ["supplier", "Fornecedor"], ["status", "Status", "status"], ["total_value", "Valor total", "money"], ["payment_method", "Forma de pagamento"], ["installment_count", "Parcelas", "count"], ["confirmed_at", "Confirmada em", "date"], ["created_by", "Criada por"]) },
  { type: "suppliers", label: "Fornecedores", category: "Estoque e compras", pagination: "server", filters: [STATUS_FILTER, filter("person_type", "Tipo de pessoa", "select", [{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }]), filter("quality_status", "Homologação", "select", [{ value: "approved", label: "Aprovado" }, { value: "review", label: "Em análise" }, { value: "blocked", label: "Bloqueado" }])], columns: columns(["id", "ID"], ["name", "Fornecedor"], ["person_type", "Tipo", "enum"], ["document", "CPF/CNPJ"], ["contact_name", "Contato"], ["phone", "Telefone"], ["whatsapp", "WhatsApp"], ["email", "E-mail"], ["city", "Cidade"], ["state", "UF"], ["quality_status", "Homologação", "enum"], ["status", "Status", "status"], ["lead_time_days", "Prazo de entrega (dias)", "count"], ["minimum_order_value", "Pedido mínimo", "money"]) },
  {
    type: "financial", label: "Lançamentos financeiros", category: "Financeiro",
    filters: [...PERIOD_FILTERS,
      filter("status", "Status", "select", [option("pending", "Pendente"), option("overdue", "Vencido"), option("partially_paid", "Parcialmente pago"), option("paid", "Pago"), option("refunded", "Estornado"), option("canceled", "Cancelado")]),
      filter("entry_type", "Tipo", "select", [option("income", "Receita"), option("receivable", "A receber"), option("expense", "Despesa"), option("payable", "A pagar")])],
    columns: columns(["id", "ID"], ["competence_date", "Competência", "date"], ["due_date", "Vencimento", "date"], ["entry_type", "Tipo de lançamento", "enum"],
      ["description", "Descrição"], ["category", "Categoria"], ["source_type", "Origem", "enum"], ["operation", "Operação"],
      ["operation_gross", "Bruto da operação", "money"], ["operation_coupon_discount", "Desconto de cupom da operação", "money"],
      ["operation_manual_discount", "Desconto manual da operação", "money"], ["operation_adjustment", "Ajustes da operação", "money"],
      ["operation_net", "Líquido da operação", "money"], ["amount", "Valor do lançamento", "money"], ["paid_amount", "Valor pago", "money"],
      ["open_amount", "Saldo", "money"], ["status", "Status", "status"], ["payment_method", "Forma de pagamento"])
  },
  { type: "payables", label: "Contas a pagar", category: "Financeiro", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("supplier_id", "Fornecedor"), filter("category", "Categoria")], columns: columns(["id", "ID"], ["due_date", "Vencimento", "date"], ["description", "Descrição"], ["supplier", "Fornecedor"], ["category", "Categoria"], ["amount", "Valor", "money"], ["paid_amount", "Valor pago", "money"], ["open_amount", "Saldo", "money"], ["status", "Status", "status"], ["payment_method", "Forma de pagamento"], ["source_type", "Origem", "enum"]) },
  { type: "receivables", label: "Contas a receber", category: "Financeiro", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("category", "Categoria")], columns: columns(["id", "ID"], ["due_date", "Vencimento", "date"], ["description", "Descrição"], ["category", "Categoria"], ["amount", "Valor", "money"], ["paid_amount", "Valor recebido", "money"], ["open_amount", "Saldo", "money"], ["status", "Status", "status"], ["payment_method", "Forma de pagamento"], ["source_type", "Origem", "enum"]) },
  {
    type: "payments", label: "Pagamentos", category: "Financeiro",
    filters: [...PERIOD_FILTERS, filter("status", "Status", "select", [option("pago", "Pago"), option("confirmado", "Confirmado"), option("pendente", "Pendente"), option("credito_aplicado", "Crédito aplicado"), option("refunded", "Estornado"), option("cancelado", "Cancelado")])],
    columns: columns(["id", "ID"], ["payment_date", "Data", "date"], ["client", "Cliente"], ["operation", "Operação"], ["payment_type", "Tipo", "enum"],
      ["method", "Forma"], ["status", "Status", "status"], ["amount", "Valor", "money"], ["received_amount", "Recebido", "money"],
      ["fee_amount", "Taxa", "money"], ["net_received", "Recebido líquido", "money"])
  },
  {
    type: "value_adjustments", label: "Ajustes de valor", category: "Financeiro", pagination: "server",
    filters: [...PERIOD_FILTERS, PROFESSIONAL_FILTER,
      filter("adjustment_type", "Tipo", "select", [option("acrescimo", "Acréscimo"), option("abatimento", "Abatimento")]),
      filter("status", "Situação", "select", [option("ativo", "Ativo"), option("anulado", "Anulado")])],
    columns: columns(["id", "ID"], ["created_at_local", "Data/hora", "datetime"], ["appointment_id", "Atendimento"], ["client", "Cliente"],
      ["professional", "Profissional"], ["adjustment_type", "Tipo", "enum"], ["amount", "Valor", "money"], ["signed_amount", "Efeito no líquido", "money"],
      ["reason", "Motivo"], ["created_by", "Usuário"], ["status", "Situação", "status"], ["net_before", "Líquido antes", "money"],
      ["net_after", "Líquido depois", "money"], ["voided_by", "Anulado por"], ["voided_at_local", "Anulado em", "datetime"], ["void_reason", "Motivo da anulação"])
  },
  {
    type: "professionals", label: "Desempenho por profissional", category: "Gestão e auditoria",
    filters: [...PERIOD_FILTERS, PROFESSIONAL_FILTER],
    columns: columns(["id", "ID"], ["professional", "Profissional"], ["worked_days", "Dias trabalhados", "count"], ["available_hours", "Horas disponíveis", "count"],
      ["occupied_hours", "Horas ocupadas", "count"], ["appointments", "Agendamentos", "count"], ["completed_appointments", "Atendimentos finalizados", "count"],
      ["cancellations", "Cancelamentos", "count"], ["no_shows", "Faltas", "count"], ["products_sold", "Produtos/joias aplicados", "count"],
      ["service_revenue", "Bruto em serviços", "money"], ["jewelry_revenue", "Bruto em joias", "money"], ["discount_total", "Descontos", "money"],
      ["adjustment_total", "Ajustes", "money"], ["revenue", "Faturamento líquido", "money"], ["average_ticket", "Ticket médio", "money"],
      ["commission_base", "Base de comissão", "money"], ["commission", "Comissão", "money"],
      ["occupancy_rate", "Taxa de ocupação", "percent"], ["attendance_rate", "Taxa de comparecimento", "percent"])
  },
  {
    type: "commissions", label: "Comissões", category: "Gestão e auditoria", pagination: "server",
    filters: [...PERIOD_FILTERS, PROFESSIONAL_FILTER, filter("service_id", "Serviço", "service"), filter("appointment_id", "Atendimento", "number")],
    columns: columns(["id", "ID"], ["reference_date", "Data", "date"], ["appointment_id", "Atendimento"], ["client", "Cliente"], ["professional", "Profissional"],
      ["item", "Item"], ["item_kind", "Tipo"], ["quantity", "Quantidade", "count"], ["gross_amount", "Bruto", "money"], ["discount_amount", "Desconto", "money"],
      ["adjustment_amount", "Ajuste", "money"], ["base_amount", "Base (líquido)", "money"], ["rule_scope", "Regra aplicada"], ["rule", "Taxa"],
      ["commission_amount", "Comissão", "money"])
  },
  { type: "users", label: "Usuários", category: "Gestão e auditoria", pagination: "server", filters: [STATUS_FILTER, filter("role", "Papel"), filter("profile_id", "Perfil")], columns: columns(["id", "ID"], ["name", "Usuário"], ["email", "E-mail"], ["role", "Papel", "enum"], ["profile", "Perfil de acesso"], ["professional", "Profissional"], ["status", "Status", "status"], ["mfa_enabled", "MFA", "boolean"], ["created_at", "Criado em", "date"]) },
  { type: "access_profiles", label: "Perfis de acesso", category: "Gestão e auditoria", pagination: "server", filters: [STATUS_FILTER, filter("base_role", "Papel-base")], columns: columns(["id", "ID"], ["name", "Perfil"], ["description", "Descrição"], ["base_role", "Papel-base", "enum"], ["permissions", "Permissões", "count"], ["users", "Usuários", "count"], ["status", "Status", "status"], ["updated_at", "Atualizado em", "date"]) },
  { type: "permissions", label: "Permissões", category: "Gestão e auditoria", pagination: "server", filters: [filter("scope", "Origem", "select", [{ value: "user", label: "Exceção do usuário" }, { value: "profile", label: "Perfil de acesso" }]), filter("allowed", "Decisão", "select", [{ value: "true", label: "Permitida" }, { value: "false", label: "Negada" }]), filter("permission", "Permissão")], columns: columns(["id", "ID"], ["scope", "Origem", "enum"], ["owner", "Usuário/perfil"], ["permission", "Permissão"], ["allowed", "Permitida", "boolean"], ["updated_at", "Atualizada em", "date"]) },
  { type: "audit", label: "Auditoria", category: "Gestão e auditoria", pagination: "server", filters: [...PERIOD_FILTERS, filter("user_id", "Usuário"), filter("module", "Módulo"), filter("action", "Ação"), filter("severity", "Severidade", "select", [{ value: "info", label: "Informativa" }, { value: "warning", label: "Atenção" }, { value: "critical", label: "Crítica" }])], columns: columns(["id", "ID"], ["created_at", "Data e hora", "datetime"], ["actor", "Usuário"], ["actor_email", "E-mail"], ["module", "Módulo"], ["action", "Ação"], ["entity_type", "Entidade"], ["entity_id", "Registro"], ["reason", "Motivo"], ["severity", "Severidade", "enum"]) }
].map((report) => Object.freeze({ ...report, formats: ["pdf", "xlsx", "csv", "txt"] })));

const REPORT_TYPES = new Set(REPORT_CATALOG.map(({ type }) => type));

export function getReportDefinition(type) {
  return REPORT_CATALOG.find((report) => report.type === type) || null;
}

// O relatório básico abre a central; alguns tipos revelam dados ou ações de
// módulos vendidos separadamente e precisam conservar esses gates também em
// exportações assíncronas.
export const REPORT_FEATURE_REQUIREMENTS = Object.freeze({
  financial: ["basic_finance"],
  payables: ["basic_finance"],
  receivables: ["basic_finance"],
  purchases: ["basic_finance"],
  payments: ["basic_finance"],
  value_adjustments: ["basic_finance"],
  // Mesmo gate de /api/commissions: o recurso de comissões do plano.
  commissions: ["commissions"],
  promotions: ["campaigns"],
  coupons: ["coupons"],
  catalog_conversion: ["catalog_analytics"]
});

export function validReportType(type) {
  return REPORT_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Autorização única de relatório: a rota síncrona (/api/reports/:type), a
// listagem da central e a exportação assíncrona (/api/jobs) passam por aqui.
// Antes cada uma tinha a sua regra, e a fila deixava a recepção exportar
// relatórios financeiros que a tela bloqueava.
// ---------------------------------------------------------------------------

export const FINANCIAL_REPORT_TYPES = new Set(["financial", "payables", "receivables", "purchases", "payments", "value_adjustments"]);
export const OWN_REPORT_TYPES = new Set(["appointments", "cancellations", "services", "professionals", "biosafety", "chemical_indicators"]);
const COMMISSION_COLUMNS = new Set(["commission_base", "commission"]);
const COST_COLUMNS = new Set(["cost_value"]);

function commissionAccess(user) {
  const viewAll = hasPermission(user, P.COMMISSION_EDIT) || hasPermission(user, P.COMMISSION_VIEW_ALL);
  return { viewAll, viewOwn: viewAll || hasPermission(user, P.COMMISSION_VIEW_OWN) };
}

/**
 * Decide se `user` pode abrir/exportar o relatório `type` e com qual escopo.
 * O gate de PLANO fica com o chamador (requireFeature responde 403 com o
 * código de upgrade); `hasPlanFeature` aqui só decide colunas opcionais.
 *
 * Retorno: { allowed, status, error, ownProfessionalId, context }.
 * - ownProfessionalId: quando definido, o relatório É do profissional vinculado
 *   ao usuário e o filtro `professional_id` deve ser forçado para ele.
 * - context: opções que mudam colunas (comissão, custo), nunca vindas da query.
 */
export function resolveReportAccess(user, type, { hasPlanFeature = () => true } = {}) {
  const deny = (status, error) => ({ allowed: false, status, error, ownProfessionalId: null, context: {} });
  if (!validReportType(type)) return deny(404, "Relatório inválido.");
  const ownProfessionalId = Number(user?.professional_id) || null;
  const commission = commissionAccess(user);
  const canViewCost = hasPermission(user, P.INVENTORY_VIEW_COST);

  if (type === "commissions") {
    // Comissão obedece às permissões de comissão, não às de relatório: o
    // financeiro vê todos (view_all), o profissional só o próprio (view_own).
    if (commission.viewAll) return { allowed: true, status: 200, ownProfessionalId: null, context: { canViewCost } };
    if (!commission.viewOwn) return deny(403, "Você não tem permissão para visualizar comissões.");
    if (!ownProfessionalId) return deny(409, "Vincule este usuário a um profissional para ver as próprias comissões.");
    return { allowed: true, status: 200, ownProfessionalId, context: { canViewCost } };
  }
  if (FINANCIAL_REPORT_TYPES.has(type)) {
    if (!hasPermission(user, P.REPORTS_VIEW_FINANCIAL)) return deny(403, "Este relatório exige permissão para visualizar relatórios financeiros.");
    return { allowed: true, status: 200, ownProfessionalId: null, context: { canViewCost } };
  }
  let scopedProfessional = null;
  if (!hasPermission(user, P.REPORTS_VIEW_ALL)) {
    if (!hasPermission(user, P.REPORTS_VIEW_OWN)) return deny(403, "Você não tem permissão para visualizar relatórios.");
    if (!OWN_REPORT_TYPES.has(type)) return deny(403, "Este relatório exige permissão para visualizar dados de toda a clínica.");
    if (!ownProfessionalId) return deny(409, "Vincule este usuário a um profissional antes de habilitar relatórios próprios.");
    scopedProfessional = ownProfessionalId;
  }
  // Colunas de comissão no desempenho por profissional: só com o recurso do
  // plano e permissão de comissão — de todos, ou do próprio quando o relatório
  // já está restrito ao profissional do usuário.
  const commissionColumns = type === "professionals" && hasPlanFeature("commissions")
    && (commission.viewAll || (commission.viewOwn && scopedProfessional !== null));
  return { allowed: true, status: 200, ownProfessionalId: scopedProfessional, context: { canViewCost, commissionColumns } };
}

// Colunas efetivas do relatório para quem o pediu (tela e exportação usam a
// mesma lista, então nada aparece num lugar e some no outro).
export function reportColumns(type, context = {}) {
  const definition = getReportDefinition(type);
  return (definition?.columns || []).filter(({ key }) => {
    if (COMMISSION_COLUMNS.has(key) && type === "professionals" && !context.commissionColumns) return false;
    if (COST_COLUMNS.has(key) && type === "stock" && !context.canViewCost) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Exportação: rótulos e valores em pt-BR para CSV/TXT/XLSX/PDF (síncrono) e
// para o CSV da fila. Coluna sem declaração ainda sai legível, mas todo tipo
// do catálogo declara as suas.
// ---------------------------------------------------------------------------

export const REPORT_VALUE_LABELS = Object.freeze({
  active: "Ativo", inactive: "Inativo", approved: "Aprovado", review: "Em análise", blocked: "Bloqueado",
  draft: "Rascunho", confirmed: "Confirmada", cancelled: "Cancelada", pending: "Pendente", paid: "Pago",
  partially_paid: "Parcialmente pago", overdue: "Vencido", canceled: "Cancelado", refunded: "Estornado",
  product: "Produto/joia", consumable: "Material de consumo", expired: "Vencido", expiring: "Próximo do vencimento",
  exhausted: "Esgotado", available: "Disponível", info: "Informativa", warning: "Atenção", critical: "Crítica",
  payable: "A pagar", receivable: "A receber", income: "Receita", expense: "Despesa",
  payment: "Pagamento", service_execution: "Atendimento", sales_order: "Venda", appointment_cancellation: "Cancelamento",
  purchase_order: "Compra", recurrence: "Recorrência", manual: "Manual",
  pendente: "Pendente", confirmado: "Confirmado", pago: "Pago", cancelado: "Cancelado", recusado: "Recusado",
  remarcado: "Remarcado", atendido: "Atendido", nao_compareceu: "Não compareceu", awaiting_deposit_proof: "Aguardando comprovante",
  estornado: "Estornado", credito_aplicado: "Crédito aplicado", aberta: "Aberta", concluida: "Concluída", cancelada: "Cancelada",
  devolvida: "Devolvida", ativo: "Ativo", anulado: "Anulado", ativa: "Ativa", estornada: "Estornada",
  aprovado: "Aprovado", reprovado: "Reprovado", nao_informado: "Não informado", acrescimo: "Acréscimo", abatimento: "Abatimento",
  sinal: "Sinal", restante: "Restante", credito_cliente: "Crédito do cliente", produto: "Produto", servico: "Serviço",
  ordem_servico: "Ordem de serviço", mista: "Mista", balcao: "Balcão", site: "Site", catalogo: "Catálogo",
  public_booking: "Agendamento online", percent: "Percentual", fixed: "Valor fixo", user: "Exceção do usuário", profile: "Perfil de acesso",
  admin: "Administrador", reception: "Recepção", piercer: "Piercer", finance: "Financeiro",
  product_view: "Produto visto", catalog_view: "Catálogo aberto", product_selected: "Produto selecionado",
  checkout_started: "Checkout iniciado", booking_created: "Agendamento criado"
});

const TRANSLATED_KINDS = new Set(["status", "enum"]);
const fallbackLabel = (key) => String(key).replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function reportExportColumns(report) {
  const declared = Array.isArray(report?.columns) && report.columns.length ? report.columns : (getReportDefinition(report?.type)?.columns || []);
  const rowKeys = report?.rows?.length ? Object.keys(report.rows[0]) : [];
  if (!declared.length) return rowKeys.map((key) => ({ key, label: fallbackLabel(key) }));
  // As colunas declaradas mandam (ordem e rótulo); a linha só remove o que
  // não veio (por exemplo comissão para quem não pode vê-la).
  return declared.filter(({ key }) => !rowKeys.length || rowKeys.includes(key));
}

export function reportExportValue(column, value) {
  if (value === null || value === undefined || value === "") return "";
  if (column.kind === "boolean" || typeof value === "boolean") return value === true || value === 1 || value === "1" ? "Sim" : "Não";
  // TIMESTAMPTZ chega como Date: converte no fuso da clínica (String(Date)
  // sairia em inglês e toISOString() em UTC).
  if (value instanceof Date && (column.kind === "date" || column.kind === "datetime")) {
    if (Number.isNaN(value.getTime())) return "";
    if (column.kind === "date") return value.toLocaleDateString("pt-BR", { timeZone: CLINIC_TIME_ZONE });
    return value.toLocaleString("pt-BR", { timeZone: CLINIC_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");
  }
  if (column.kind === "date") {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("pt-BR");
  }
  if (column.kind === "datetime") {
    const text = String(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(text);
    if (match) return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
  }
  if (!column.kind || TRANSLATED_KINDS.has(column.kind)) return REPORT_VALUE_LABELS[String(value)] || value;
  return value;
}

// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Período padrão = mês corrente NO FUSO DA CLÍNICA. Com toISOString() (UTC),
// entre 21h e meia-noite o "hoje" já era amanhã.
function period(filters = {}) {
  const today = localDate();
  return {
    from: DATE_PATTERN.test(filters.from) ? filters.from : `${today.slice(0, 7)}-01`,
    to: DATE_PATTERN.test(filters.to) ? filters.to : today
  };
}

const toInteger = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;
const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
};

async function pagedQuery(db, baseSql, baseParams, filters, options) {
  const search = String(filters.search || "").trim();
  const searchColumns = options.searchColumns || [];
  const searchSql = search && searchColumns.length
    ? ` WHERE (${searchColumns.map((name) => `CAST(${name} AS TEXT) ILIKE ?`).join(" OR ")})`
    : "";
  const params = [...baseParams, ...(searchSql ? searchColumns.map(() => `%${search}%`) : [])];
  const requestedSort = String(filters.sort || "").split(":");
  const sortColumn = options.sortColumns?.[requestedSort[0]] || options.defaultSort;
  const direction = requestedSort[1] === "asc" ? "ASC" : "DESC";
  const order = `${sortColumn} ${direction}${sortColumn === "id" ? "" : ", id DESC"}`;
  const paginated = filters.paginated !== false;
  const limit = Math.min(Math.max(toInteger(filters.limit, 25), 1), 100);
  const offset = Math.max(toInteger(filters.offset, 0), 0);
  const countRow = await db.get(`SELECT COUNT(*) AS total_rows FROM (${baseSql}) report_rows${searchSql}`, params);
  const rows = await db.all(
    `SELECT * FROM (${baseSql}) report_rows${searchSql} ORDER BY ${order}${paginated ? " LIMIT ? OFFSET ?" : ""}`,
    paginated ? [...params, limit, offset] : params
  );
  return { rows, total_rows: Number(countRow?.total_rows || 0), limit: paginated ? limit : Number(countRow?.total_rows || 0), offset: paginated ? offset : 0 };
}

/**
 * Monta o relatório. `context` vem do servidor (resolveReportAccess), nunca da
 * query: liga colunas de comissão e custo. Sem contexto, o relatório sai na
 * forma mais restrita.
 */
export async function buildReport(db, type, filters = {}, context = {}) {
  if (!validReportType(type)) throw new Error("Relatório inválido.");
  const { from, to } = period(filters);
  const status = String(filters.status || "");
  const professionalId = positiveInteger(filters.professional_id);
  const productId = positiveInteger(filters.product_id);
  const category = String(filters.category || "");
  let rows = [];
  let pageMeta = null;
  let summary = null;
  const setPaged = async (sql, params, options) => {
    pageMeta = await pagedQuery(db, sql, params, filters, options);
    rows = pageMeta.rows;
  };
  if (type === "purchases") {
    const clauses = ["po.purchase_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (status) { clauses.push("po.status=?"); params.push(status); }
    const supplierId = toInteger(filters.supplier_id);
    if (supplierId) { clauses.push("po.supplier_id=?"); params.push(supplierId); }
    await setPaged(`
      SELECT po.id,po.purchase_date,s.name AS supplier,po.status,po.total_value,po.payment_method,
        po.installment_count,po.confirmed_at,u.name AS created_by
      FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
      LEFT JOIN users u ON u.id=po.created_by_user_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["supplier", "status", "payment_method", "created_by"], sortColumns: { id: "id", purchase_date: "purchase_date", supplier: "supplier", status: "status", total_value: "total_value" }, defaultSort: "purchase_date" });
  } else if (type === "suppliers") {
    const clauses = ["1=1"];
    const params = [];
    if (status) { clauses.push("s.is_active=?"); params.push(status === "active" || status === "ativo" ? 1 : 0); }
    if (filters.person_type) { clauses.push("s.person_type=?"); params.push(String(filters.person_type)); }
    if (filters.quality_status) { clauses.push("s.quality_status=?"); params.push(String(filters.quality_status)); }
    await setPaged(`
      SELECT s.id,s.name,s.person_type,s.document,s.contact_name,s.phone,s.whatsapp,s.email,s.city,s.state,
        s.quality_status,CASE WHEN s.is_active=1 THEN 'active' ELSE 'inactive' END AS status,
        s.lead_time_days,s.minimum_order_value
      FROM suppliers s WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["name", "document", "contact_name", "phone", "whatsapp", "email", "city", "state"], sortColumns: { id: "id", name: "name", status: "status", quality_status: "quality_status", city: "city" }, defaultSort: "name" });
  } else if (type === "payables" || type === "receivables") {
    const entryType = type === "payables" ? "payable" : "receivable";
    const clauses = ["fe.entry_type=?", "fe.due_date BETWEEN ? AND ?", "fe.lifecycle_status='active'"];
    const params = [entryType, from, to];
    // Sem filtro explícito, título cancelado não aparece como conta em aberto.
    if (status) { clauses.push("fe.status=?"); params.push(status); } else clauses.push("fe.status<>'canceled'");
    if (category) { clauses.push("fe.category=?"); params.push(category); }
    const supplierId = toInteger(filters.supplier_id);
    if (type === "payables" && supplierId) { clauses.push("fe.supplier_id=?"); params.push(supplierId); }
    await setPaged(`
      SELECT fe.id,fe.due_date,fe.description,s.name AS supplier,fe.category,fe.amount,fe.paid_amount,
        GREATEST(fe.amount-fe.paid_amount,0) AS open_amount,fe.status,fe.payment_method,fe.source_type
      FROM financial_entries fe LEFT JOIN suppliers s ON s.id=fe.supplier_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["description", "supplier", "category", "status", "payment_method", "source_type"], sortColumns: { id: "id", due_date: "due_date", description: "description", supplier: "supplier", amount: "amount", open_amount: "open_amount", status: "status" }, defaultSort: "due_date" });
  } else if (type === "stock_movements") {
    const movementType = String(filters.movement_type || "");
    const itemType = String(filters.item_type || "");
    const params = [from, to];
    let sql = `SELECT sm.id,sm.movement_date,
        CASE WHEN j.can_sell THEN 'product' ELSE 'consumable' END AS item_type,
        j.name AS item,COALESCE(v.sku,j.sku) AS sku,sm.movement_type,sm.quantity,
        sm.notes,sm.purchase_order_id,sm.sales_order_id
      FROM stock_movements sm JOIN jewelry_inventory j ON j.id=sm.jewelry_id
      LEFT JOIN jewelry_variants v ON v.id=sm.variant_id
      WHERE SUBSTRING(sm.movement_date,1,10) BETWEEN ? AND ?`;
    if (movementType) { sql += " AND sm.movement_type=?"; params.push(movementType); }
    if (itemType === "product") sql += " AND j.can_sell=true";
    if (itemType === "consumable") sql += " AND j.can_sell=false AND j.can_use_in_service=true";
    await setPaged(sql, params, { searchColumns: ["item", "sku", "movement_type", "notes"], sortColumns: { id: "id", movement_date: "movement_date", item: "item", item_type: "item_type", movement_type: "movement_type", quantity: "quantity" }, defaultSort: "movement_date" });
  } else if (type === "lots") {
    const clauses = ["1=1"];
    const params = [];
    if (DATE_PATTERN.test(filters.expiry_from || "")) { clauses.push("lot.expiry_date>=?"); params.push(filters.expiry_from); }
    if (DATE_PATTERN.test(filters.expiry_to || "")) { clauses.push("lot.expiry_date<=?"); params.push(filters.expiry_to); }
    const consumableId = toInteger(filters.consumable_id);
    if (consumableId) { clauses.push("lot.inventory_item_id=?"); params.push(consumableId); }
    const lotStatus = `CASE WHEN lot.active=false THEN 'inactive' WHEN lot.remaining_quantity=0 THEN 'exhausted' WHEN lot.expiry_date<CURRENT_DATE THEN 'expired' WHEN lot.expiry_date<=CURRENT_DATE+30 THEN 'expiring' ELSE 'available' END`;
    if (status) { clauses.push(`${lotStatus}=?`); params.push(status); }
    await setPaged(`
      SELECT lot.id,item.name AS consumable,lot.batch_code,lot.expiry_date,lot.received_quantity,lot.remaining_quantity,
        lot.unit_cost,${lotStatus} AS status,lot.purchase_order_id
      FROM inventory_item_lots lot JOIN jewelry_inventory item ON item.id=lot.inventory_item_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["consumable", "batch_code", "status"], sortColumns: { id: "id", consumable: "consumable", batch_code: "batch_code", expiry_date: "expiry_date", remaining_quantity: "remaining_quantity", status: "status" }, defaultSort: "expiry_date" });
  } else if (type === "digital_terms") {
    const clauses = ["SUBSTRING(dt.signed_at,1,10) BETWEEN ? AND ?"];
    const params = [from, to];
    if (filters.procedure) { clauses.push("dt.procedure ILIKE ?"); params.push(`%${String(filters.procedure).trim()}%`); }
    await setPaged(`
      SELECT dt.id,dt.signed_at,c.full_name AS client,dt.document_number,dt.procedure,dt.piercing_region,
        CASE WHEN dt.orientations_confirmed=1 THEN true ELSE false END AS orientations_confirmed,dt.appointment_id
      FROM digital_terms dt JOIN clients c ON c.id=dt.client_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "document_number", "procedure", "piercing_region"], sortColumns: { id: "id", signed_at: "signed_at", client: "client", procedure: "procedure" }, defaultSort: "signed_at" });
  } else if (type === "postcare") {
    const clauses = ["pc.due_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (status) { clauses.push("pc.status=?"); params.push(status); }
    if (filters.healing_status) { clauses.push("pc.healing_status ILIKE ?"); params.push(`%${String(filters.healing_status).trim()}%`); }
    await setPaged(`
      SELECT pc.id,pc.due_date,c.full_name AS client,pc.reminder_day,pc.healing_status,pc.status,pc.updated_at
      FROM post_care_followups pc JOIN clients c ON c.id=pc.client_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "healing_status", "status"], sortColumns: { id: "id", due_date: "due_date", client: "client", reminder_day: "reminder_day", status: "status", updated_at: "updated_at" }, defaultSort: "due_date" });
  } else if (type === "biosafety") {
    // A biossegurança registrada na FINALIZAÇÃO vive na execução
    // (service_executions.biosafety_snapshot) e nos indicadores químicos por
    // procedimento; o prontuário manual (client_medical_records) não é a fonte.
    // Toda execução concluída do período aparece — inclusive as sem registro,
    // que são justamente as lacunas de rastreabilidade a enxergar.
    const clauses = ["se.status='completed'", "a.appointment_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (professionalId) { clauses.push("se.professional_id=?"); params.push(professionalId); }
    await setPaged(`
      SELECT se.id, a.appointment_date AS execution_date, c.full_name AS client, se.appointment_id,
        p.name AS professional, COALESCE(s.name, a.procedure) AS procedure,
        NULLIF(btrim(se.biosafety_snapshot->>'sterilization_cycle'),'') AS sterilization_cycle,
        NULLIF(btrim(se.biosafety_snapshot->>'sterilization_record'),'') AS sterilization_record,
        j.name AS applied_jewelry,
        (SELECT string_agg(COALESCE(NULLIF(btrim(m->>'batch_code'),''), 'Lote #' || (m->>'inventory_item_lot_id')), ', ')
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(se.biosafety_snapshot->'material_lots')='array'
             THEN se.biosafety_snapshot->'material_lots' ELSE '[]'::jsonb END) m) AS material_lots,
        ind.indicators, ind.indicators_approved, ind.indicators_failed, ind.indicator_lots, ind.indicator_photo
      FROM service_executions se
      JOIN appointments a ON a.id=se.appointment_id
      JOIN clients c ON c.id=se.client_id
      JOIN professionals p ON p.id=se.professional_id
      LEFT JOIN services s ON s.id=se.service_id
      LEFT JOIN jewelry_inventory j ON j.id = CASE WHEN (se.biosafety_snapshot->>'applied_jewelry_id') ~ '^[0-9]+$'
        THEN (se.biosafety_snapshot->>'applied_jewelry_id')::integer END
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS indicators,
          COUNT(*) FILTER (WHERE pci.result='aprovado') AS indicators_approved,
          COUNT(*) FILTER (WHERE pci.result='reprovado') AS indicators_failed,
          string_agg(DISTINCT COALESCE(NULLIF(btrim(pci.indicator_lot),''), NULLIF(btrim(pci.identification),'')), ', ') AS indicator_lots,
          COALESCE(bool_or(pci.photo_filename IS NOT NULL), false) AS indicator_photo
        FROM procedure_chemical_indicators pci
        WHERE pci.status='ativo' AND (pci.service_execution_id=se.id
          OR (pci.service_execution_id IS NULL AND pci.appointment_id=se.appointment_id))
      ) ind ON true
      WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "professional", "procedure", "sterilization_cycle", "sterilization_record", "applied_jewelry", "material_lots", "indicator_lots"], sortColumns: { id: "id", execution_date: "execution_date", client: "client", professional: "professional", appointment_id: "appointment_id", indicators: "indicators" }, defaultSort: "execution_date" });
  } else if (type === "chemical_indicators") {
    const clauses = ["a.appointment_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (professionalId) { clauses.push("COALESCE(pci.professional_id, a.professional_id)=?"); params.push(professionalId); }
    if (["aprovado", "reprovado", "nao_informado"].includes(String(filters.result || ""))) { clauses.push("pci.result=?"); params.push(String(filters.result)); }
    if (["ativo", "anulado"].includes(status)) { clauses.push("pci.status=?"); params.push(status); }
    await setPaged(`
      SELECT pci.id, a.appointment_date AS procedure_date, c.full_name AS client, pci.appointment_id,
        p.name AS professional, pci.procedure_name AS procedure, pci.body_region, pci.jewelry_name AS jewelry,
        pci.indicator_type, pci.indicator_brand, pci.indicator_lot, pci.indicator_date, pci.identification, pci.result,
        (pci.photo_filename IS NOT NULL) AS has_photo, pci.status, u.name AS registered_by,
        ${LOCAL_DATETIME("pci.created_at")} AS registered_at, pci.void_reason
      FROM procedure_chemical_indicators pci
      JOIN appointments a ON a.id=pci.appointment_id
      JOIN clients c ON c.id=pci.client_id
      LEFT JOIN professionals p ON p.id=COALESCE(pci.professional_id, a.professional_id)
      LEFT JOIN users u ON u.id=pci.created_by_user_id
      WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "professional", "procedure", "body_region", "jewelry", "indicator_type", "indicator_brand", "indicator_lot", "identification"], sortColumns: { id: "id", procedure_date: "procedure_date", client: "client", professional: "professional", result: "result", indicator_date: "indicator_date", status: "status" }, defaultSort: "procedure_date" });
  } else if (type === "value_adjustments") {
    const clauses = [`${LOCAL_DATE("ava.created_at")} BETWEEN ?::date AND ?::date`];
    const params = [from, to];
    if (professionalId) { clauses.push("a.professional_id=?"); params.push(professionalId); }
    if (["acrescimo", "abatimento"].includes(String(filters.adjustment_type || ""))) { clauses.push("ava.adjustment_type=?"); params.push(String(filters.adjustment_type)); }
    if (["ativo", "anulado"].includes(status)) { clauses.push("ava.status=?"); params.push(status); }
    await setPaged(`
      SELECT ava.id, ${LOCAL_DATETIME("ava.created_at")} AS created_at_local, ava.appointment_id, c.full_name AS client,
        p.name AS professional, ava.adjustment_type, ava.amount,
        CASE WHEN ava.adjustment_type='abatimento' THEN -ava.amount ELSE ava.amount END AS signed_amount,
        ava.reason, cu.name AS created_by, ava.status, ava.net_before, ava.net_after,
        vu.name AS voided_by, ${LOCAL_DATETIME("ava.voided_at")} AS voided_at_local, ava.void_reason
      FROM appointment_value_adjustments ava
      JOIN appointments a ON a.id=ava.appointment_id
      JOIN clients c ON c.id=a.client_id
      LEFT JOIN professionals p ON p.id=a.professional_id
      LEFT JOIN users cu ON cu.id=ava.created_by_user_id
      LEFT JOIN users vu ON vu.id=ava.voided_by_user_id
      WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "professional", "reason", "created_by", "void_reason"], sortColumns: { id: "id", created_at_local: "created_at_local", appointment_id: "appointment_id", client: "client", amount: "amount", status: "status" }, defaultSort: "created_at_local" });
    summary = await db.get(`
      SELECT COALESCE(SUM(signed_amount) FILTER (WHERE status='ativo'),0) AS net_effect,
        COALESCE(SUM(amount) FILTER (WHERE status='ativo' AND adjustment_type='acrescimo'),0) AS increases,
        COALESCE(SUM(amount) FILTER (WHERE status='ativo' AND adjustment_type='abatimento'),0) AS decreases
      FROM (SELECT ava.amount, ava.status, ava.adjustment_type,
          CASE WHEN ava.adjustment_type='abatimento' THEN -ava.amount ELSE ava.amount END AS signed_amount
        FROM appointment_value_adjustments ava JOIN appointments a ON a.id=ava.appointment_id
        WHERE ${clauses.join(" AND ")}) adjustments
    `, params);
  } else if (type === "commissions") {
    // Lançamentos ATIVOS gravados no fechamento (base completa e regra
    // aplicada), nunca percentual atual × receita. Escopo próprio é forçado
    // pela rota via professional_id.
    const clauses = ["ce.status='ativa'", "ce.reference_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (professionalId) { clauses.push("ce.professional_id=?"); params.push(professionalId); }
    const serviceId = positiveInteger(filters.service_id);
    if (serviceId) { clauses.push("ce.service_id=?"); params.push(serviceId); }
    const appointmentId = positiveInteger(filters.appointment_id);
    if (appointmentId) { clauses.push("ce.appointment_id=?"); params.push(appointmentId); }
    await setPaged(`
      SELECT ce.id, ce.reference_date, ce.appointment_id, c.full_name AS client, p.name AS professional,
        ce.item_description AS item, CASE ce.item_kind WHEN 'servico' THEN 'Serviço' ELSE 'Produto' END AS item_kind,
        ce.quantity, ce.gross_amount, ce.discount_amount, ce.adjustment_amount, ce.base_amount,
        CASE ce.rule_scope WHEN 'servico' THEN 'Serviço específico' WHEN 'servico_padrao' THEN 'Padrão de serviços' ELSE 'Padrão de produtos' END AS rule_scope,
        CASE WHEN ce.rate_type='percentual'
          THEN 'Percentual · ' || REPLACE(TO_CHAR(ce.rate_value,'FM9999999990.00'),'.',',') || '%'
          ELSE 'Valor fixo · R$ ' || REPLACE(TO_CHAR(ce.rate_value,'FM9999999990.00'),'.',',') END AS rule,
        ce.commission_amount
      FROM commission_entries ce
      JOIN professionals p ON p.id=ce.professional_id
      JOIN appointments a ON a.id=ce.appointment_id
      LEFT JOIN clients c ON c.id=a.client_id
      WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "professional", "item", "rule_scope"], sortColumns: { id: "id", reference_date: "reference_date", appointment_id: "appointment_id", client: "client", professional: "professional", base_amount: "base_amount", commission_amount: "commission_amount" }, defaultSort: "reference_date" });
    // Totais do período inteiro (não da página), somados no Postgres.
    summary = await db.get(`
      SELECT COUNT(*)::int AS entries, COALESCE(SUM(ce.gross_amount),0) AS gross, COALESCE(SUM(ce.discount_amount),0) AS discount,
        COALESCE(SUM(ce.adjustment_amount),0) AS adjustment, COALESCE(SUM(ce.base_amount),0) AS base,
        COALESCE(SUM(ce.commission_amount),0) AS commission
      FROM commission_entries ce WHERE ${clauses.join(" AND ")}
    `, params);
  } else if (type === "users") {
    const clauses = ["1=1"];
    const params = [];
    if (status) { clauses.push("u.status=?"); params.push(status); }
    if (filters.role) { clauses.push("u.role=?"); params.push(String(filters.role)); }
    const profileId = toInteger(filters.profile_id);
    if (profileId) { clauses.push("u.access_profile_id=?"); params.push(profileId); }
    await setPaged(`
      SELECT u.id,u.name,u.email,u.role,ap.name AS profile,p.name AS professional,u.status,u.mfa_enabled,u.created_at
      FROM users u LEFT JOIN access_profiles ap ON ap.id=u.access_profile_id
      LEFT JOIN professionals p ON p.id=u.professional_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["name", "email", "role", "profile", "professional", "status"], sortColumns: { id: "id", name: "name", email: "email", role: "role", profile: "profile", status: "status", created_at: "created_at" }, defaultSort: "name" });
  } else if (type === "access_profiles") {
    const clauses = ["1=1"];
    const params = [];
    if (status) { clauses.push("ap.is_active=?"); params.push(status === "active" || status === "ativo"); }
    if (filters.base_role) { clauses.push("ap.base_role=?"); params.push(String(filters.base_role)); }
    await setPaged(`
      SELECT ap.id,ap.name,ap.description,ap.base_role,COUNT(DISTINCT app.permission) AS permissions,
        COUNT(DISTINCT u.id) AS users,CASE WHEN ap.is_active THEN 'active' ELSE 'inactive' END AS status,ap.updated_at
      FROM access_profiles ap LEFT JOIN access_profile_permissions app ON app.profile_id=ap.id AND app.allowed=true
      LEFT JOIN users u ON u.access_profile_id=ap.id WHERE ${clauses.join(" AND ")}
      GROUP BY ap.id,ap.name,ap.description,ap.base_role,ap.is_active,ap.updated_at
    `, params, { searchColumns: ["name", "description", "base_role", "status"], sortColumns: { id: "id", name: "name", base_role: "base_role", permissions: "permissions", users: "users", status: "status", updated_at: "updated_at" }, defaultSort: "name" });
  } else if (type === "permissions") {
    const permission = String(filters.permission || "").trim();
    const scope = String(filters.scope || "");
    const allowed = ["true", "false"].includes(String(filters.allowed)) ? String(filters.allowed) : "";
    const params = [];
    let sql = `SELECT * FROM (
      SELECT ('user:'||up.id::text) AS id,'user' AS scope,u.name AS owner,up.permission,up.allowed,up.updated_at
      FROM user_permissions up JOIN users u ON u.id=up.user_id
      UNION ALL
      SELECT ('profile:'||app.profile_id::text||':'||app.permission) AS id,'profile' AS scope,ap.name AS owner,app.permission,app.allowed,app.created_at AS updated_at
      FROM access_profile_permissions app JOIN access_profiles ap ON ap.id=app.profile_id
    ) permission_source WHERE 1=1`;
    if (scope) { sql += " AND scope=?"; params.push(scope); }
    if (allowed) { sql += " AND allowed=?"; params.push(allowed === "true"); }
    if (permission) { sql += " AND permission ILIKE ?"; params.push(`%${permission}%`); }
    await setPaged(sql, params, { searchColumns: ["owner", "permission", "scope"], sortColumns: { id: "id", scope: "scope", owner: "owner", permission: "permission", allowed: "allowed", updated_at: "updated_at" }, defaultSort: "updated_at" });
  } else if (type === "audit") {
    const clauses = [`${LOCAL_DATE("ae.created_at")} BETWEEN ?::date AND ?::date`];
    const params = [from, to];
    const userId = toInteger(filters.user_id);
    if (userId) { clauses.push("ae.actor_user_id=?"); params.push(userId); }
    for (const key of ["module", "action", "severity"]) {
      if (filters[key]) { clauses.push(`ae.${key}=?`); params.push(String(filters[key])); }
    }
    await setPaged(`
      SELECT ae.id,${LOCAL_DATETIME("ae.created_at")} AS created_at,COALESCE(ae.actor_name,u.name) AS actor,COALESCE(ae.actor_email,u.email) AS actor_email,
        ae.module,ae.action,ae.entity_type,ae.entity_id,ae.reason,ae.severity
      FROM audit_events ae LEFT JOIN users u ON u.id=ae.actor_user_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["actor", "actor_email", "module", "action", "entity_type", "entity_id", "reason", "severity"], sortColumns: { id: "id", created_at: "created_at", actor: "actor", module: "module", action: "action", entity_type: "entity_type", severity: "severity" }, defaultSort: "created_at" });
  } else if (type === "financial") {
    // Pagamentos e despesas só chegam a financial_entries pela sincronização
    // do razão; sem ela o relatório dependia de alguém ter aberto o Financeiro.
    await syncFinanceSources(db);
    const clauses = ["fe.competence_date BETWEEN ? AND ?", "COALESCE(fe.lifecycle_status,'active')='active'"];
    const params = [from, to];
    if (status) { clauses.push("fe.status=?"); params.push(status); } else clauses.push("fe.status<>'canceled'");
    if (["income", "receivable", "expense", "payable"].includes(String(filters.entry_type || ""))) { clauses.push("fe.entry_type=?"); params.push(String(filters.entry_type)); }
    rows = await db.all(`
      SELECT fe.id, fe.competence_date, fe.due_date, fe.entry_type, fe.description, fe.category, fe.source_type,
        CASE WHEN a.id IS NOT NULL THEN 'Atendimento #' || a.id WHEN so.id IS NOT NULL THEN 'Venda #' || so.id END AS operation,
        CASE WHEN a.id IS NOT NULL THEN ${APPOINTMENT_GROSS("a")} WHEN so.id IS NOT NULL THEN ${SALE_GROSS("so")} END AS operation_gross,
        CASE WHEN a.id IS NOT NULL THEN ${APPOINTMENT_COUPON("a")} WHEN so.id IS NOT NULL THEN ${SALE_COUPON("so")} END AS operation_coupon_discount,
        CASE WHEN a.id IS NOT NULL THEN COALESCE(a.manual_discount_value,0) WHEN so.id IS NOT NULL THEN COALESCE(so.manual_discount_value,0) END AS operation_manual_discount,
        CASE WHEN a.id IS NOT NULL THEN COALESCE(a.adjustment_total,0) WHEN so.id IS NOT NULL THEN 0 END AS operation_adjustment,
        CASE WHEN a.id IS NOT NULL THEN a.total_value WHEN so.id IS NOT NULL THEN so.total_value END AS operation_net,
        fe.amount, fe.paid_amount, GREATEST(fe.amount-fe.paid_amount,0) AS open_amount, fe.status, fe.payment_method
      FROM financial_entries fe
      LEFT JOIN service_executions se ON fe.source_type='service_execution' AND se.id=fe.source_id
      LEFT JOIN payments pay ON fe.source_type='payment' AND pay.id=fe.source_id
      LEFT JOIN appointments a ON a.id=COALESCE(se.appointment_id, pay.appointment_id)
      LEFT JOIN sales_orders so ON so.id=CASE WHEN fe.source_type='sales_order' THEN fe.source_id ELSE pay.sales_order_id END
      WHERE ${clauses.join(" AND ")}
      ORDER BY fe.due_date, fe.id
    `, params);
  } else if (type === "sales") {
    // Vendas de verdade: sem o espelho legado do atendimento (source='agenda',
    // que duplicaria o faturamento da agenda) e sem canceladas, salvo pedido
    // explícito pelo filtro. Devolução parcial abate o valor final.
    const clauses = ["SUBSTRING(so.created_at,1,10) BETWEEN ? AND ?", "so.source<>'agenda'"];
    const params = [from, to];
    if (status) { clauses.push("so.status=?"); params.push(status); } else clauses.push(`so.status NOT IN ${CANCELED_SALE_STATUSES}`);
    rows = await db.all(`
      SELECT so.id, SUBSTRING(so.created_at,1,10) AS sale_date, c.full_name AS client, so.order_type, so.source, so.status, so.payment_method,
        ${SALE_GROSS("so")} AS gross_value, ${SALE_COUPON("so")} AS coupon_discount,
        COALESCE(so.manual_discount_value,0) AS manual_discount, COALESCE(so.discount_value,0) AS discount_total,
        so.total_value AS net_value, COALESCE(ret.returned_value,0) AS returned_value,
        CASE WHEN so.status IN ${CANCELED_SALE_STATUSES} THEN 0
          ELSE GREATEST(so.total_value - COALESCE(ret.returned_value,0), 0) END AS final_value
      FROM sales_orders so JOIN clients c ON c.id=so.client_id
      LEFT JOIN (SELECT sales_order_id, SUM(total_value) AS returned_value FROM sales_returns GROUP BY sales_order_id) ret ON ret.sales_order_id=so.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY so.created_at DESC, so.id DESC
    `, params);
  } else if (type === "stock") {
    const clauses = ["j.status!='arquivado'"];
    const params = [];
    if (productId) { clauses.push("j.id=?"); params.push(productId); }
    if (category) { clauses.push("j.category=?"); params.push(category); }
    // Custo só para quem tem inventory.view_cost (mesma regra das telas de estoque).
    const cost = context.canViewCost ? " j.cost_value," : "";
    rows = await db.all(`SELECT j.id, j.name, j.sku, j.category, j.material, j.color, j.quantity,${cost} j.sale_value, j.status, j.supplier FROM jewelry_inventory j WHERE ${clauses.join(" AND ")} ORDER BY j.category,j.name`, params);
  } else if (type === "services") {
    // Serviços efetivamente EXECUTADOS: itens de serviço das execuções
    // concluídas de atendimentos atendidos. Antes contava agendamentos
    // pendentes/confirmados, somava a joia junto e atribuía tudo ao serviço
    // do primeiro item.
    const clauses = ["sei.item_type='service'", "se.status='completed'", "a.status='atendido'", "a.appointment_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (professionalId) { clauses.push("se.professional_id=?"); params.push(professionalId); }
    rows = await db.all(`
      SELECT COALESCE(s.name, sei.item_name) AS service, COUNT(DISTINCT se.id) AS executions,
        COALESCE(SUM(sei.quantity),0) AS quantity, COALESCE(SUM(sei.total_value),0) AS gross_revenue,
        COALESCE(ROUND(SUM(sei.total_value)/NULLIF(COUNT(DISTINCT se.id),0),2),0) AS average_ticket
      FROM service_execution_items sei
      JOIN service_executions se ON se.id=sei.service_execution_id
      JOIN appointments a ON a.id=se.appointment_id
      LEFT JOIN services s ON s.id=sei.service_id
      WHERE ${clauses.join(" AND ")}
      GROUP BY COALESCE(s.name, sei.item_name) ORDER BY gross_revenue DESC, service
    `, params);
  } else if (type === "clients") {
    // Mesma fonte do "Total gasto": atendimentos atendidos + vendas avulsas
    // concluídas, menos devoluções. Clientes excluídos, mesclados ou
    // anonimizados ficam fora.
    rows = await db.all(`
      WITH attended AS (
        SELECT client_id, COUNT(*) AS appointments, COALESCE(SUM(total_value),0) AS services_value, MAX(appointment_date) AS last_visit
        FROM appointments WHERE status='atendido' GROUP BY client_id
      ), returned AS (
        SELECT sales_order_id, SUM(total_value) AS returned_value FROM sales_returns GROUP BY sales_order_id
      ), sold AS (
        SELECT so.client_id, COALESCE(SUM(GREATEST(so.total_value - COALESCE(r.returned_value,0),0)),0) AS sales_value
        FROM sales_orders so LEFT JOIN returned r ON r.sales_order_id=so.id
        WHERE so.source<>'agenda' AND so.appointment_id IS NULL AND so.status IN ('concluida','pago','devolvida')
        GROUP BY so.client_id
      )
      SELECT c.id, c.full_name, c.whatsapp, c.instagram, c.birth_date,
        COALESCE(at.appointments,0) AS appointments, COALESCE(at.services_value,0) AS services_value,
        COALESCE(sd.sales_value,0) AS sales_value, COALESCE(at.services_value,0) + COALESCE(sd.sales_value,0) AS lifetime_value,
        at.last_visit
      FROM clients c LEFT JOIN attended at ON at.client_id=c.id LEFT JOIN sold sd ON sd.client_id=c.id
      WHERE c.deleted_at IS NULL AND c.merged_into_client_id IS NULL AND c.anonymized_at IS NULL
      ORDER BY lifetime_value DESC, c.full_name
    `);
  } else if (type === "professionals") {
    // Produção da agenda (contagens) por data do agendamento; faturamento a
    // partir das EXECUÇÕES concluídas (bruto de serviço e joia, desconto,
    // ajustes e líquido gravados no fechamento), na mesma competência dos
    // lançamentos de comissão. Comissão = soma dos lançamentos ativos — nunca
    // receita × percentual atual.
    const withCommission = Boolean(context.commissionColumns);
    const params = [from, to, from, to, from, to, from, to];
    if (withCommission) params.push(from, to);
    if (professionalId) params.push(professionalId);
    rows = await db.all(`
      WITH calendar AS (
        SELECT d::date AS work_date, EXTRACT(DOW FROM d)::integer AS weekday
        FROM generate_series(?::date, ?::date, interval '1 day') d
      ), availability AS (
        SELECT pa.professional_id,
          COUNT(DISTINCT c.work_date) AS availability_days,
          COALESCE(SUM(EXTRACT(EPOCH FROM (pa.end_time::time-pa.start_time::time))/3600
            - CASE WHEN pa.lunch_start IS NOT NULL AND pa.lunch_end IS NOT NULL
              THEN EXTRACT(EPOCH FROM (pa.lunch_end::time-pa.lunch_start::time))/3600 ELSE 0 END),0) AS available_hours
        FROM professional_availability pa JOIN calendar c ON c.weekday=pa.weekday
        WHERE pa.is_active=1 GROUP BY pa.professional_id
      ), production AS (
        SELECT a.professional_id,
          COUNT(*) AS appointments,
          COUNT(*) FILTER (WHERE a.status='atendido') AS completed_appointments,
          COUNT(*) FILTER (WHERE a.status IN ('cancelado','recusado')) AS cancellations,
          COUNT(*) FILTER (WHERE a.status IN ('falta','nao_compareceu')) AS no_shows,
          COUNT(DISTINCT a.appointment_date) AS appointment_days,
          COALESCE(SUM(a.duration_minutes) FILTER (WHERE a.status='atendido'),0)/60.0 AS occupied_hours
        FROM appointments a WHERE a.appointment_date BETWEEN ? AND ? GROUP BY a.professional_id
      ), executed AS (
        SELECT se.professional_id, COUNT(*) AS executions,
          COALESCE(SUM(se.service_subtotal),0) AS service_revenue, COALESCE(SUM(se.product_subtotal),0) AS jewelry_revenue,
          COALESCE(SUM(se.discount_total),0) AS discount_total, COALESCE(SUM(se.adjustment_total),0) AS adjustment_total,
          COALESCE(SUM(se.total_value),0) AS revenue
        FROM service_executions se JOIN appointments a ON a.id=se.appointment_id
        WHERE se.status='completed' AND a.status='atendido' AND a.appointment_date BETWEEN ? AND ?
        GROUP BY se.professional_id
      ), sold AS (
        SELECT se.professional_id, COALESCE(SUM(sei.quantity),0) AS products_sold
        FROM service_executions se
        JOIN appointments a ON a.id=se.appointment_id
        JOIN service_execution_items sei ON sei.service_execution_id=se.id AND sei.item_type='product'
        WHERE se.status='completed' AND a.status='atendido' AND a.appointment_date BETWEEN ? AND ?
        GROUP BY se.professional_id
      )${withCommission ? `, commission AS (
        SELECT professional_id, COALESCE(SUM(base_amount),0) AS commission_base, COALESCE(SUM(commission_amount),0) AS commission
        FROM commission_entries WHERE status='ativa' AND reference_date BETWEEN ? AND ? GROUP BY professional_id
      )` : ""}
      SELECT p.id, p.name AS professional,
        GREATEST(COALESCE(av.availability_days,0),COALESCE(pr.appointment_days,0)) AS worked_days,
        -- O ::numeric aqui NÃO é sobra da migração de dinheiro: estas duas
        -- colunas são HORAS, não reais, e continuam vindo de EXTRACT(EPOCH...),
        -- que devolve double precision no Postgres 13 e numeric a partir do 14.
        -- Como round(double precision, int) não existe, o cast é o que impede
        -- a query de quebrar conforme a versão do servidor. Mantê-lo.
        ROUND(COALESCE(av.available_hours,0)::numeric,2) AS available_hours,
        ROUND(COALESCE(pr.occupied_hours,0)::numeric,2) AS occupied_hours,
        COALESCE(pr.appointments,0) AS appointments,
        COALESCE(pr.completed_appointments,0) AS completed_appointments,
        COALESCE(pr.cancellations,0) AS cancellations, COALESCE(pr.no_shows,0) AS no_shows,
        COALESCE(s.products_sold,0) AS products_sold,
        COALESCE(ex.service_revenue,0) AS service_revenue, COALESCE(ex.jewelry_revenue,0) AS jewelry_revenue,
        COALESCE(ex.discount_total,0) AS discount_total, COALESCE(ex.adjustment_total,0) AS adjustment_total,
        COALESCE(ex.revenue,0) AS revenue,
        CASE WHEN COALESCE(ex.executions,0)>0 THEN ROUND(ex.revenue/ex.executions,2) ELSE 0 END AS average_ticket,
        ${withCommission ? "COALESCE(cm.commission_base,0) AS commission_base, COALESCE(cm.commission,0) AS commission," : ""}
        CASE WHEN COALESCE(av.available_hours,0)>0 THEN LEAST(100,pr.occupied_hours*100/av.available_hours) ELSE 0 END AS occupancy_rate,
        CASE WHEN COALESCE(pr.appointments,0)>0 THEN pr.completed_appointments*100.0/pr.appointments ELSE 0 END AS attendance_rate
      FROM professionals p LEFT JOIN availability av ON av.professional_id=p.id
      LEFT JOIN production pr ON pr.professional_id=p.id LEFT JOIN executed ex ON ex.professional_id=p.id
      LEFT JOIN sold s ON s.professional_id=p.id
      ${withCommission ? "LEFT JOIN commission cm ON cm.professional_id=p.id" : ""}
      ${professionalId ? "WHERE p.id=?" : ""} ORDER BY revenue DESC, p.name
    `, params);
  } else if (type === "appointments") {
    const clauses = ["a.appointment_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (status) { clauses.push("a.status=?"); params.push(status); }
    if (professionalId) { clauses.push("a.professional_id=?"); params.push(professionalId); }
    rows = await db.all(`
      SELECT a.id, a.appointment_date, a.appointment_time, c.full_name AS client, p.name AS professional,
        a.procedure, a.status, a.source,
        ${APPOINTMENT_GROSS("a")} AS gross_value, ${APPOINTMENT_COUPON("a")} AS coupon_discount,
        COALESCE(a.manual_discount_value,0) AS manual_discount, COALESCE(a.discount_value,0) AS discount_total,
        COALESCE(a.adjustment_total,0) AS adjustment_total, COALESCE(a.total_value,0) AS net_value,
        a.deposit_value, a.remaining_value
      FROM appointments a JOIN clients c ON c.id=a.client_id JOIN professionals p ON p.id=a.professional_id
      WHERE ${clauses.join(" AND ")} ORDER BY a.appointment_date,a.appointment_time,a.id
    `, params);
  } else if (type === "cancellations") {
    // Desfecho = cancelamento, recusa ou ausência (no-show), com a resolução
    // do sinal registrada no cancelamento. O período segue a data do desfecho
    // (quando foi cancelado); sem registro de cancelamento, a do agendamento.
    const eventDate = `COALESCE(to_char(timezone('${CLINIC_TIME_ZONE}', ac.created_at), 'YYYY-MM-DD'), a.appointment_date)`;
    const clauses = ["a.status IN ('cancelado','recusado','nao_compareceu')", `${eventDate} BETWEEN ? AND ?`];
    const params = [from, to];
    if (["cancelado", "recusado", "nao_compareceu"].includes(status)) { clauses.push("a.status=?"); params.push(status); }
    if (professionalId) { clauses.push("a.professional_id=?"); params.push(professionalId); }
    rows = await db.all(`
      SELECT a.id, a.appointment_date, a.appointment_time, ${eventDate} AS event_date, c.full_name AS client, p.name AS professional,
        a.procedure, a.status, ac.reason AS reason,
        CASE ac.resolution WHEN 'retain_deposit' THEN 'Sinal retido' WHEN 'client_credit' THEN 'Convertido em crédito'
          WHEN 'manual_refund' THEN 'Reembolso manual' WHEN 'no_payment' THEN 'Sem sinal recebido'
          ELSE 'Sem resolução registrada' END AS deposit_resolution,
        COALESCE(ac.deposit_amount,0) AS deposit_amount, ac.refund_method
      FROM appointments a JOIN clients c ON c.id=a.client_id JOIN professionals p ON p.id=a.professional_id
      LEFT JOIN appointment_cancellations ac ON ac.appointment_id=a.id
      WHERE ${clauses.join(" AND ")} ORDER BY event_date, a.appointment_time, a.id
    `, params);
  } else if (type === "promotions") {
    rows = await db.all(`
      SELECT p.id,p.name,p.discount_type,p.discount_value,p.status,p.start_date,p.end_date,p.usage_limit,
        COUNT(u.id) AS uses,COALESCE(SUM(u.discount_amount),0) AS discount_total
      FROM catalog_promotions p LEFT JOIN promotion_usages u ON u.promotion_id=p.id AND SUBSTRING(CAST(u.created_at AS TEXT),1,10) BETWEEN ? AND ?
      GROUP BY p.id ORDER BY uses DESC
    `, [from, to]);
  } else if (type === "coupons") {
    rows = await db.all(`
      SELECT c.id,c.code,c.internal_name AS name,c.status,c.discount_type,c.discount_value,c.usage_limit,
        COUNT(u.id) AS uses,COALESCE(SUM(u.discount_amount),0) AS discount_total
      FROM coupons c LEFT JOIN coupon_usages u ON u.coupon_id=c.id AND SUBSTRING(CAST(u.created_at AS TEXT),1,10) BETWEEN ? AND ?
      GROUP BY c.id ORDER BY uses DESC
    `, [from, to]);
  } else if (type === "payments") {
    // Status explícito em cada linha; "Recebido" só soma pago/confirmado.
    // Pendente, crédito aplicado (não é caixa novo) e estornado aparecem com o
    // status, mas valem 0 em "Recebido". Cancelado só com filtro explícito.
    const clauses = ["SUBSTRING(p.paid_at,1,10) BETWEEN ? AND ?"];
    const params = [from, to];
    if (status) { clauses.push("p.status=?"); params.push(status); } else clauses.push("p.status<>'cancelado'");
    rows = await db.all(`
      SELECT p.id, SUBSTRING(p.paid_at,1,10) AS payment_date, c.full_name AS client,
        CASE WHEN p.appointment_id IS NOT NULL THEN 'Atendimento #' || p.appointment_id
          WHEN p.sales_order_id IS NOT NULL THEN 'Venda #' || p.sales_order_id END AS operation,
        p.payment_type, p.method, p.status, p.amount,
        CASE WHEN p.status IN ${RECEIVED_PAYMENT_STATUSES} THEN p.amount ELSE 0 END AS received_amount,
        CASE WHEN p.status IN ${RECEIVED_PAYMENT_STATUSES} THEN COALESCE(p.fee_amount,0) ELSE 0 END AS fee_amount,
        CASE WHEN p.status IN ${RECEIVED_PAYMENT_STATUSES} THEN COALESCE(p.net_amount, p.amount - COALESCE(p.fee_amount,0)) ELSE 0 END AS net_received
      FROM payments p JOIN clients c ON c.id=p.client_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY p.paid_at DESC, p.id DESC
    `, params);
  } else if (type === "catalog_conversion") {
    rows = await db.all(`
      SELECT event_type,COUNT(*) AS events,COUNT(DISTINCT session_key) AS unique_sessions
      FROM catalog_events WHERE SUBSTRING(occurred_at,1,10) BETWEEN ? AND ?
      GROUP BY event_type ORDER BY events DESC
    `, [from, to]);
  } else if (type === "abc") {
    const days = Math.min(Math.max(Number(filters.days || 90), 1), 3650);
    const metrics = await inventoryIntelligence(db, days);
    rows = metrics.map(({ name, sku, abc_class, units_out, movement_value, daily_demand, days_to_stockout }) => ({
      name, sku, abc_class, units_out, movement_value, daily_demand, days_to_stockout
    }));
  }
  return {
    type, from, to, rows,
    columns: reportColumns(type, context),
    total_rows: pageMeta?.total_rows ?? rows.length,
    ...(pageMeta ? { limit: pageMeta.limit, offset: pageMeta.offset } : {}),
    ...(summary ? { summary } : {}),
    generated_at: new Date().toISOString()
  };
}
