import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button, Input, Select, StatusBadge } from "../../components/common/Ui";
import { DataView } from "../../components/common/DataView";
import { asArray, asObject } from "../../lib/utils";
import { downloadApiFile, useFetch } from "../../lib/api";
import { currency } from "../shared/helpers";

const FALLBACK_REPORTS = [
  { type: "appointments", label: "Agendamentos", category: "Atendimento", filters: ["from", "to", "status", "professional_id"] },
  { type: "services", label: "Serviços executados", category: "Atendimento", filters: ["from", "to"] },
  { type: "clients", label: "Clientes", category: "Clientes e clínico", filters: [] },
  { type: "sales", label: "Vendas", category: "Comercial", filters: ["from", "to", "status"] },
  { type: "stock", label: "Posição de estoque", category: "Estoque e compras", filters: [] },
  { type: "financial", label: "Financeiro", category: "Financeiro", filters: ["from", "to"] },
  { type: "professionals", label: "Profissionais", category: "Gestão e auditoria", filters: ["from", "to", "professional_id"] }
];

// `formatDate` de lib/utils devolve dd/MM sem ano, e um relatório pode ser
// pedido para um período que atravessa a virada do ano.
function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

// Rótulos por NOME DE COLUNA, e não por relatório. Os 13 relatórios são 13
// consultas diferentes, mas reaproveitam os mesmos nomes de coluna (status,
// client, amount, id, created_at…), então um dicionário único cobre todos sem
// 13 configurações paralelas — e uma coluna nova, que o backend passe a
// devolver amanhã, aparece com rótulo derivado do nome em vez de sumir da tela.
const COLUMN_LABELS = {
  id: "ID",
  // Financeiro
  entry_type: "Tipo de lançamento",
  description: "Descrição",
  category: "Categoria",
  amount: "Valor",
  paid_amount: "Valor pago",
  due_date: "Vencimento",
  status: "Status",
  payment_method: "Forma de pagamento",
  source_type: "Origem",
  // Vendas
  client: "Cliente",
  order_type: "Tipo de venda",
  source: "Origem",
  total_value: "Valor total",
  created_at: "Criada em",
  // Estoque
  name: "Nome",
  sku: "SKU",
  material: "Material",
  color: "Cor",
  quantity: "Quantidade",
  cost_value: "Custo",
  sale_value: "Preço de venda",
  supplier: "Fornecedor",
  abc_class: "Classe ABC",
  units_out: "Saídas",
  movement_value: "Valor movimentado",
  daily_demand: "Demanda diária",
  days_to_stockout: "Previsão de ruptura (dias)",
  // Serviços
  service: "Serviço",
  appointments: "Atendimentos",
  revenue: "Faturamento",
  average_ticket: "Ticket médio",
  // Clientes
  full_name: "Nome",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  birth_date: "Nascimento",
  lifetime_value: "Total gasto",
  last_visit: "Última visita",
  // Profissionais e comissões
  professional: "Profissional",
  commission_percentage: "Comissão",
  commission: "Valor da comissão",
  worked_days: "Dias trabalhados",
  available_hours: "Horas disponíveis",
  occupied_hours: "Horas ocupadas",
  completed_appointments: "Atendimentos finalizados",
  cancellations: "Cancelamentos",
  no_shows: "Faltas",
  jewelry_sold: "Joias vendidas",
  products_sold: "Produtos vendidos",
  service_revenue: "Faturamento em serviços",
  jewelry_revenue: "Faturamento em joias",
  occupancy_rate: "Taxa de ocupação",
  attendance_rate: "Taxa de comparecimento",
  // Agendamentos e cancelamentos
  appointment_date: "Data",
  appointment_time: "Hora",
  procedure: "Procedimento",
  deposit_value: "Sinal",
  remaining_value: "Restante",
  // Promoções e cupons
  code: "Código",
  discount_type: "Tipo de desconto",
  discount_value: "Desconto",
  discount_total: "Desconto concedido",
  start_date: "Início",
  end_date: "Fim",
  usage_limit: "Limite de uso",
  uses: "Usos",
  // Pagamentos
  payment_type: "Tipo",
  method: "Forma",
  paid_at: "Pago em",
  // Conversão do catálogo
  event_type: "Evento",
  events: "Eventos",
  unique_sessions: "Sessões únicas"
};

// O tipo do dado também sai do nome da coluna: sufixo `_date`/`_at` é data,
// `_value`/`_amount`/`_total` é dinheiro, `_percentage` é percentual. Este mapa
// lista os nomes que o sufixo não resolve: `id` é número mas não leva separador
// de milhar, `discount_value` é R$ ou % conforme o tipo do desconto, as colunas
// de vocabulário fechado (`enum`) não têm sufixo próprio, e as contagens chegam
// do Postgres como texto (COUNT devolve bigint) — logo, nem `typeof` ajudaria.
const COLUMN_KINDS = {
  id: "text",
  appointment_time: "time",
  last_visit: "date",
  entry_type: "enum",
  source_type: "enum",
  order_type: "enum",
  source: "enum",
  payment_type: "enum",
  event_type: "enum",
  discount_type: "enum",
  discount_value: "discount",
  commission: "money",
  revenue: "money",
  average_ticket: "money",
  appointments: "count",
  quantity: "count",
  units_out: "count",
  daily_demand: "count",
  days_to_stockout: "count",
  usage_limit: "count",
  uses: "count",
  events: "count",
  unique_sessions: "count",
  worked_days: "count", available_hours: "count", occupied_hours: "count",
  completed_appointments: "count", cancellations: "count", no_shows: "count",
  jewelry_sold: "count", products_sold: "count", occupancy_rate: "percent", attendance_rate: "percent",
  service_revenue: "money", jewelry_revenue: "money"
};

const NUMERIC_KINDS = new Set(["money", "count", "percent", "discount"]);

// Os relatórios saem direto do banco, então trazem o vocabulário do banco. Os
// valores que já estão em português passam adiante sem tradução; aqui ficam só
// os que apareceriam em inglês ou em código na tela.
const VALUE_LABELS = {
  // Tipos de lançamento e origens
  expense: "Despesa", payable: "A pagar", income: "Receita", receivable: "A receber",
  payment: "Pagamento", appointment: "Agendamento", sales_order: "Venda",
  balcao: "Balcão", site: "Site", catalogo: "Catálogo", whatsapp: "WhatsApp",
  public_booking: "Agendamento online", manual: "Manual",
  produto: "Produto", servico: "Serviço", ordem_servico: "Ordem de serviço", mista: "Mista",
  sinal: "Sinal", restante: "Restante", total: "Total",
  // Status. Os que já vêm em português entram só para a coluna inteira sair
  // com a mesma caixa (e para "concluida" ganhar o acento).
  paid: "Paga", partially_paid: "Parcialmente paga", overdue: "Vencida", pending: "Pendente",
  active: "Ativa", inactive: "Inativa", paused: "Pausada", ended: "Encerrada",
  concluida: "Concluída", cancelada: "Cancelada", aberta: "Aberta", pago: "Pago",
  atendido: "Atendido", cancelado: "Cancelado", recusado: "Recusado",
  confirmado: "Confirmado", pendente: "Pendente", remarcado: "Remarcado",
  esgotado: "Esgotado", disponível: "Disponível", "baixo estoque": "Baixo estoque", crítico: "Crítico",
  // Tipos de desconto
  percent: "Percentual", fixed: "Valor fixo", fixed_price: "Preço fixo",
  buy_x_pay_y: "Leve X, pague Y", progressive: "Progressivo", quantity: "Por quantidade",
  // Eventos do catálogo público
  product_view: "Produto visto", catalog_view: "Catálogo aberto",
  product_selected: "Produto selecionado", checkout_started: "Checkout iniciado",
  booking_created: "Agendamento criado"
};

const valueLabel = (value) => VALUE_LABELS[String(value)] || String(value);

function columnKind(key) {
  if (COLUMN_KINDS[key]) return COLUMN_KINDS[key];
  if (key === "status") return "status";
  if (/(_date|_at)$/.test(key)) return "date";
  if (/(_percentage|_percent)$/.test(key)) return "percent";
  if (/^(amount|total|price|value|revenue)$/.test(key) || /(_value|_amount|_total|_price)$/.test(key)) return "money";
  return "text";
}

function columnLabel(key) {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  const text = String(key).replace(/_/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : String(key);
}

const isBlank = (value) => value === null || value === undefined || value === "";
const asFinite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const money = (value) => {
  const number = asFinite(value);
  return number === null ? String(value) : currency.format(number);
};

const percent = (value) => {
  const number = asFinite(value);
  return number === null ? String(value) : `${number.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
};

const count = (value) => {
  const number = asFinite(value);
  return number === null ? String(value) : number.toLocaleString("pt-BR");
};

// O que aparece na célula.
function renderCell(kind, value, row) {
  if (isBlank(value)) return "—";
  if (kind === "money") return money(value);
  if (kind === "percent") return percent(value);
  if (kind === "count") return count(value);
  if (kind === "date") return formatDateWithYear(value) || String(value);
  if (kind === "time") return String(value).slice(0, 5);
  // A cor do selo continua saindo do valor cru; só o texto é traduzido.
  if (kind === "status") return <StatusBadge status={String(value)}>{valueLabel(value)}</StatusBadge>;
  if (kind === "enum") return valueLabel(value);
  // Desconto de promoção/cupom: o mesmo campo guarda 15 (%) ou 15,00 (R$).
  if (kind === "discount") return row.discount_type === "percent" ? percent(value) : money(value);
  return String(value);
}

// O que a busca e a ordenação enxergam. Sem isto, ordenar "Valor total"
// compararia "1.234,50" como texto e datas em dd/MM/aaaa sairiam fora de ordem.
function sortValue(kind, value) {
  if (isBlank(value)) return "";
  if (NUMERIC_KINDS.has(kind)) return asFinite(value) ?? String(value);
  // A data ISO ordena certo e o formato exibido deixa a busca achar "27/07".
  if (kind === "date") return `${String(value).slice(0, 10)} ${formatDateWithYear(value)}`;
  // Busca e ordenação pelo texto que está na tela, não pelo código do banco.
  if (kind === "enum" || kind === "status") return valueLabel(value);
  return String(value);
}

// As colunas saem da primeira linha, como antes — é o que faz um único
// componente atender aos 13 relatórios. O que mudou é que cada coluna agora
// leva rótulo, alinhamento e formatação decididos pelo nome do campo.
function buildColumns(rows) {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  return keys.map((key) => {
    const kind = columnKind(key);
    const numeric = NUMERIC_KINDS.has(kind);
    return {
      key,
      label: columnLabel(key),
      align: numeric ? "right" : undefined,
      // Buscar por valor numérico gera mais falso positivo do que acerto.
      searchable: !numeric,
      value: (row) => sortValue(kind, row[key]),
      render: (row) => renderCell(kind, row[key], row)
    };
  });
}

export function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ type: "sales", from: `${today.slice(0, 7)}-01`, to: today, status: "", professional_id: "" });
  const { data: catalogData } = useFetch("/reports");
  const reportDefinitions = asArray(asObject(catalogData).reports).length ? asArray(asObject(catalogData).reports) : FALLBACK_REPORTS;
  const selectedReport = reportDefinitions.find((report) => report.type === filters.type) || reportDefinitions[0];
  const selectedFilters = asArray(selectedReport?.filters);
  const reportGroups = useMemo(() => reportDefinitions.reduce((groups, reportDefinition) => {
    const category = reportDefinition.category || "Outros";
    return { ...groups, [category]: [...(groups[category] || []), reportDefinition] };
  }, {}), [reportDefinitions]);
  useEffect(() => {
    if (selectedReport?.type && selectedReport.type !== filters.type) {
      setFilters((current) => ({ ...current, type: selectedReport.type }));
    }
  }, [filters.type, selectedReport?.type]);
  const { data: professionals } = useFetch("/professionals");
  const params = new URLSearchParams({
    ...(selectedFilters.includes("from") ? { from: filters.from } : {}),
    ...(selectedFilters.includes("to") ? { to: filters.to } : {}),
    ...(selectedFilters.includes("status") && filters.status ? { status: filters.status } : {}),
    ...(selectedFilters.includes("professional_id") && filters.professional_id ? { professional_id: filters.professional_id } : {})
  });
  // Período e status continuam sendo filtro de servidor: mudam a consulta e o
  // arquivo exportado. A DataView cuida só do que já veio (busca, ordenação e
  // paginação), por isso mode="client".
  const { data, loading, error } = useFetch(`/reports/${selectedReport?.type || filters.type}?${params}`);
  const report = asObject(data);
  const reportRows = asArray(report.rows);

  const columns = useMemo(() => buildColumns(reportRows), [reportRows]);

  // Nem todo relatório traz `id` (serviços, financeiro e conversão são
  // agregações), então a chave da linha vem da posição quando falta.
  const rows = useMemo(
    () => reportRows.map((row, index) => ({ ...row, __rowKey: row?.id ?? index })),
    [reportRows]
  );

  const download = (format) => downloadApiFile(`/reports/${selectedReport.type}?${params}&format=${format}`, `${selectedReport.type}-${filters.from}-${filters.to}.${format}`);
  return (
    <section className="stack reports-page">
      <div className="panel">
        <div className="panel-heading">
          <div><h2>Central de relatórios</h2><span>Relatórios agrupados por área, com filtros próprios e uma única fonte para tela e exportação.</span></div>
          <div className="export-actions">
            {(selectedReport?.formats || ["pdf", "xlsx", "csv", "txt"]).map((format) => <Button key={format} variant="secondary" onClick={() => download(format)}><Download size={15} /> {format.toUpperCase()}</Button>)}
          </div>
        </div>
        <div className="form-grid">
          <Select label="Relatório" value={filters.type} onChange={(value) => setFilters({ ...filters, type: value })}>
            {Object.entries(reportGroups).map(([category, reports]) => (
              <optgroup label={category} key={category}>{reports.map((item) => <option value={item.type} key={item.type}>{item.label}</option>)}</optgroup>
            ))}
          </Select>
          {selectedFilters.includes("from") && <Input type="date" label="De" value={filters.from} onChange={(value) => setFilters({ ...filters, from: value })} />}
          {selectedFilters.includes("to") && <Input type="date" label="Até" value={filters.to} onChange={(value) => setFilters({ ...filters, to: value })} />}
          {selectedFilters.includes("status") && <Input label="Status (opcional)" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} />}
          {selectedFilters.includes("professional_id") && <Select label="Profissional" value={filters.professional_id} onChange={(value) => setFilters({ ...filters, professional_id: value })}><option value="">Todos</option>{asArray(professionals).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select>}
        </div>
      </div>
      <div className="panel">
        <div className="panel-heading">
          <h2>{selectedReport?.label}</h2>
          <span>{loading ? "Carregando…" : `${report.total_rows || 0} registro(s)`}</span>
        </div>
        <DataView
          // Cada relatório tem colunas próprias: remontar zera busca e ordenação
          // ao trocar de tipo, em vez de herdar uma coluna que não existe mais.
          key={filters.type}
          rows={rows}
          columns={columns}
          rowKey={(row) => row.__rowKey}
          loading={loading}
          error={error}
          searchPlaceholder="Buscar no resultado"
          empty="Nenhum dado para o período selecionado."
          emptyFiltered="Nenhum registro corresponde à busca."
        />
      </div>
    </section>
  );
}
