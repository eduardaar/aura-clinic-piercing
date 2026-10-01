// Extrato de comissões (por profissional, período, serviço e atendimento) e o
// resumo de comissão de um atendimento.
//
// A fonte é o livro de lançamentos `commission_entries` (GET /api/commissions):
// cada linha já vem com a base completa (bruto, desconto e ajuste rateados,
// base líquida) e a regra aplicada. A tela NÃO recalcula comissão — só exibe o
// que o backend gravou, e os totais vêm prontos do servidor (somados em SQL).
// Quando a resposta não trouxer `totals`, somamos em centavos inteiros para não
// acumular erro de ponto flutuante.
//
// Permissões: `commission.view_all` (ou `commission.edit`, que no backend
// também enxerga tudo) vê todos os profissionais; `commission.view_own` vê só o
// profissional vinculado ao usuário (o backend força o filtro — a tela apenas
// esconde o seletor de profissional).
import { useEffect, useMemo, useState } from "react";
import { Input, Select, StatusBadge } from "../../components/common/Ui";
import { DataView } from "../../components/common/DataView";
import { PlanUpgradeNotice } from "../../components/common/PlanUpgradeNotice";
import { TransactionTotals } from "../../components/common/TransactionFields";
import { apiFetch, readStoredSession } from "../../lib/api";
import { can } from "../../lib/permissions";
import { asArray, asNumber, asObject, localDateValue } from "../../lib/utils";
import { fromCents, toCents } from "../../lib/operationTotals";
import { currency } from "../shared/helpers";
import "./commissions.css";

const KIND_LABELS = { servico: "Serviço", produto: "Produto/joia" };
const SCOPE_LABELS = { servico_padrao: "Padrão de serviços", servico: "Regra do serviço", produto_padrao: "Padrão de produtos" };
const STATUS_LABELS = { ativa: "Ativa", estornada: "Estornada" };

/** Lista da API nos dois formatos aceitos (array puro ou envelope `{ items }`). */
function listFrom(payload) {
  return asArray(payload).length ? asArray(payload) : asArray(asObject(payload).items);
}

function formatDate(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "—";
  return new Date(`${text}T12:00:00`).toLocaleDateString("pt-BR");
}

const money = (value) => currency.format(asNumber(value));

/** Ajuste é assinado: acréscimo (+) ou abatimento (−). */
function signedMoney(value) {
  const amount = asNumber(value);
  if (amount === 0) return money(0);
  return `${amount > 0 ? "+" : "−"} ${currency.format(Math.abs(amount))}`;
}

/** "10%" ou "R$ 15,00 fixo", com o escopo da regra aplicada. */
export function commissionRuleLabel(entry = {}) {
  const rate = entry.rate_type === "valor_fixo"
    ? `${money(entry.rate_value)} fixo`
    : `${asNumber(entry.rate_value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  const scope = SCOPE_LABELS[entry.rule_scope];
  return scope ? `${rate} · ${scope}` : rate;
}

function sumCents(rows, key) {
  return fromCents(rows.reduce((total, row) => total + toCents(row[key]), 0));
}

/** Totais do servidor; sem eles, soma das linhas recebidas em centavos inteiros. */
function totalsFrom(payload, rows) {
  const totals = asObject(asObject(payload).totals);
  if (Object.keys(totals).length) return totals;
  return {
    gross: sumCents(rows, "gross_amount"),
    discount: sumCents(rows, "discount_amount"),
    adjustment: sumCents(rows, "adjustment_amount"),
    base: sumCents(rows, "base_amount"),
    commission: sumCents(rows, "commission_amount")
  };
}

function firstDayOfMonth() {
  const today = new Date();
  return localDateValue(new Date(today.getFullYear(), today.getMonth(), 1));
}

/** Permissões de leitura de comissão do usuário da sessão. */
export function commissionAccess(user = readStoredSession()?.user || {}) {
  const canEdit = can(user, "commission.edit");
  // Mesma regra do backend (routes/commissions.js): quem edita comissão também vê todas.
  const viewAll = canEdit || can(user, "commission.view_all");
  const viewOwn = can(user, "commission.view_own");
  return { viewAll, viewOwn, canView: viewAll || viewOwn, canEdit };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function isPlanBlock(response, payload) {
  return response.status === 403 && asObject(payload).code === "plan_upgrade_required";
}

function CommissionPlanNotice({ onUpgrade }) {
  return (
    <PlanUpgradeNotice title="Comissões fazem parte do plano Studio" planName="Studio" onUpgrade={onUpgrade}>
      O extrato de comissões por profissional, com a base de cada atendimento e a regra aplicada, está disponível no plano Studio.
    </PlanUpgradeNotice>
  );
}

/**
 * Extrato de comissões com filtros e totais.
 * @param {{ features?: string[], onUpgrade?: () => void }} props
 */
export function CommissionStatement({ features = [], onUpgrade }) {
  const access = commissionAccess();
  const planAllowed = Array.isArray(features) && features.includes("commissions");

  if (!planAllowed) return <CommissionPlanNotice onUpgrade={onUpgrade} />;
  if (!access.canView) {
    return (
      <p className="empty-state" role="note">
        Você não tem permissão para ver comissões. Peça ao administrador do estúdio a permissão “Ver comissões”.
      </p>
    );
  }
  return <CommissionStatementContent viewAll={access.viewAll} onUpgrade={onUpgrade} />;
}

function CommissionStatementContent({ viewAll, onUpgrade }) {
  const [filters, setFilters] = useState(() => ({
    professional_id: "",
    service_id: "",
    appointment_id: "",
    date_from: firstDayOfMonth(),
    date_to: localDateValue(new Date()),
    status: "ativa"
  }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [state, setState] = useState({ loading: true, error: "", payload: null, planBlocked: false });
  const [professionals, setProfessionals] = useState([]);
  const [services, setServices] = useState([]);

  // Opções dos filtros. Falha aqui não impede o extrato: o filtro só fica vazio.
  useEffect(() => {
    let active = true;
    const load = async (path, setter) => {
      try {
        const response = await apiFetch(path);
        const payload = await readJson(response);
        if (active && response.ok) setter(listFrom(payload));
      } catch { /* filtro sem opções */ }
    };
    if (viewAll) load("/professionals", setProfessionals);
    load("/services", setServices);
    return () => { active = false; };
  }, [viewAll]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (key === "professional_id" && !viewAll) continue;
      if (String(value ?? "").trim()) params.set(key, String(value).trim());
    }
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    return params.toString();
  }, [filters, page, pageSize, viewAll]);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    (async () => {
      try {
        const response = await apiFetch(`/commissions?${query}`);
        const payload = await readJson(response);
        if (!active) return;
        if (isPlanBlock(response, payload)) return setState({ loading: false, error: "", payload: null, planBlocked: true });
        if (!response.ok) {
          return setState({ loading: false, error: asObject(payload).error || "Não foi possível carregar o extrato de comissões.", payload: null, planBlocked: false });
        }
        setState({ loading: false, error: "", payload, planBlocked: false });
      } catch {
        if (active) setState({ loading: false, error: "Não foi possível conectar com a API.", payload: null, planBlocked: false });
      }
    })();
    return () => { active = false; };
  }, [query]);

  if (state.planBlocked) return <CommissionPlanNotice onUpgrade={onUpgrade} />;

  const rows = listFrom(state.payload);
  const envelope = asObject(state.payload);
  // Modo da tabela conforme a resposta: com `total` o servidor pagina; sem ele
  // (array puro) a lista veio inteira e a paginação é feita em memória.
  const serverMode = Number.isFinite(Number(envelope.total)) && envelope.total !== null && envelope.total !== undefined;
  const totals = totalsFrom(state.payload, rows);
  const showStatus = filters.status !== "ativa";

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  const sortable = !serverMode;
  const columns = [
    { key: "reference_date", label: "Data", sortable, value: (row) => row.reference_date, render: (row) => formatDate(row.reference_date) },
    { key: "appointment_id", label: "Atendimento", sortable, value: (row) => asNumber(row.appointment_id), render: (row) => (row.appointment_id ? `#${row.appointment_id}` : "—") },
    { key: "client_name", label: "Cliente", sortable, render: (row) => row.client_name || "—" },
    { key: "professional_name", label: "Profissional", sortable, render: (row) => row.professional_name || "—" },
    { key: "item_description", label: "Item", sortable, render: (row) => row.item_description || row.service_name || "—" },
    { key: "item_kind", label: "Tipo", sortable, value: (row) => KIND_LABELS[row.item_kind] || row.item_kind, render: (row) => KIND_LABELS[row.item_kind] || row.item_kind || "—" },
    { key: "gross_amount", label: "Bruto", align: /** @type {const} */ ("right"), sortable, value: (row) => asNumber(row.gross_amount), render: (row) => money(row.gross_amount) },
    { key: "discount_amount", label: "Desconto", align: /** @type {const} */ ("right"), sortable, value: (row) => asNumber(row.discount_amount), render: (row) => (asNumber(row.discount_amount) ? `− ${money(row.discount_amount)}` : money(0)) },
    { key: "adjustment_amount", label: "Ajuste", align: /** @type {const} */ ("right"), sortable, value: (row) => asNumber(row.adjustment_amount), render: (row) => signedMoney(row.adjustment_amount) },
    { key: "base_amount", label: "Base", align: /** @type {const} */ ("right"), sortable, value: (row) => asNumber(row.base_amount), render: (row) => money(row.base_amount) },
    { key: "rule", label: "Regra", sortable, value: (row) => commissionRuleLabel(row), render: (row) => commissionRuleLabel(row) },
    { key: "commission_amount", label: "Comissão", align: /** @type {const} */ ("right"), sortable, value: (row) => asNumber(row.commission_amount), render: (row) => <strong>{money(row.commission_amount)}</strong> },
    ...(showStatus ? [{
      key: "status", label: "Situação", sortable,
      value: (row) => STATUS_LABELS[row.status] || row.status,
      render: (row) => <StatusBadge status={row.status} tone={row.status === "estornada" ? "danger" : "ok"}>{STATUS_LABELS[row.status] || row.status}</StatusBadge>
    }] : [])
  ];

  return (
    <div className="commission-statement stack">
      <fieldset className="commission-filters" aria-label="Filtros do extrato de comissões">
        {viewAll ? (
          <Select label="Profissional" value={filters.professional_id} onChange={(value) => changeFilter("professional_id", value)}>
            <option value="">Todos os profissionais</option>
            {professionals.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
          </Select>
        ) : (
          <p className="field-hint commission-own-hint">Você vê apenas as suas comissões.</p>
        )}
        <Input type="date" label="De" value={filters.date_from} max={filters.date_to || undefined} onChange={(value) => changeFilter("date_from", value)} />
        <Input type="date" label="Até" value={filters.date_to} min={filters.date_from || undefined} onChange={(value) => changeFilter("date_to", value)} />
        <Select label="Serviço" value={filters.service_id} onChange={(value) => changeFilter("service_id", value)}>
          <option value="">Todos os serviços</option>
          {services.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
        </Select>
        <Input
          label="Atendimento nº"
          inputMode="numeric"
          placeholder="Ex.: 120"
          value={filters.appointment_id}
          onChange={(value) => changeFilter("appointment_id", value.replace(/\D/g, ""))}
        />
        <Select label="Situação" value={filters.status} onChange={(value) => changeFilter("status", value)}>
          <option value="ativa">Ativas</option>
          <option value="estornada">Estornadas</option>
          <option value="todas">Todas</option>
        </Select>
      </fieldset>

      {!state.loading && !state.error && filters.status !== "ativa" && (
        <p className="field-hint" role="note">
          {filters.status === "todas"
            ? "Os totais somam só os lançamentos ativos: somar os estornados contaria o mesmo item duas vezes."
            : "Os totais somam os lançamentos estornados (já não valem como comissão a pagar)."}
        </p>
      )}
      {!state.loading && !state.error && (
        <TransactionTotals
          ariaLabel="Totais das comissões"
          rows={[
            { id: "gross", label: "Bruto", value: money(totals.gross) },
            { id: "discount", label: "Descontos", value: `− ${money(totals.discount)}` },
            { id: "adjustment", label: "Ajustes", value: signedMoney(totals.adjustment) },
            { id: "base", label: "Base (líquido)", value: money(totals.base) },
            { id: "commission", label: "Comissão", value: money(totals.commission), emphasis: true }
          ]}
        />
      )}

      <DataView
        mode={serverMode ? "server" : "client"}
        rows={rows}
        columns={columns}
        loading={state.loading}
        error={state.error}
        searchable={false}
        defaultSort={serverMode ? null : { key: "reference_date", dir: "desc" }}
        {...(serverMode
          ? { page, pageSize, total: Number(envelope.total), onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }
          : {})}
        caption="Lançamentos de comissão"
        empty="Nenhuma comissão no período e nos filtros escolhidos."
      />
    </div>
  );
}

/**
 * Lançamentos de comissão ativos de um atendimento (detalhe "Atendimento realizado").
 * O título visível ("Comissão") é do pai, que já mostra o bloco só a quem tem
 * permissão de comissão. Recusas esperadas do backend — plano sem o recurso,
 * assinatura inativa, profissional de outra pessoa (403) ou usuário sem vínculo
 * com profissional (409) — viram uma linha de aviso discreta, não um erro.
 * Sem nenhuma permissão de comissão, não renderiza nada.
 * @param {{ appointmentId?: number|string|null }} props
 */
export function AppointmentCommissionSummary({ appointmentId }) {
  const { canView } = commissionAccess();
  const [state, setState] = useState({ loading: true, error: "", notice: "", rows: [] });

  useEffect(() => {
    if (!appointmentId || !canView) return undefined;
    let active = true;
    setState({ loading: true, error: "", notice: "", rows: [] });
    (async () => {
      try {
        const params = new URLSearchParams({ appointment_id: String(appointmentId), status: "ativa", page_size: "100" });
        const response = await apiFetch(`/commissions?${params.toString()}`);
        const payload = await readJson(response);
        if (!active) return;
        if (isPlanBlock(response, payload)) {
          return setState({ loading: false, error: "", notice: "Comissões fazem parte do plano Studio.", rows: [] });
        }
        if ([402, 403, 409].includes(response.status)) {
          return setState({ loading: false, error: "", notice: asObject(payload).error || "Você não tem acesso às comissões deste atendimento.", rows: [] });
        }
        if (!response.ok) return setState({ loading: false, error: asObject(payload).error || "Não foi possível carregar a comissão.", notice: "", rows: [] });
        setState({ loading: false, error: "", notice: "", rows: listFrom(payload) });
      } catch {
        if (active) setState({ loading: false, error: "Não foi possível conectar com a API.", notice: "", rows: [] });
      }
    })();
    return () => { active = false; };
  }, [appointmentId, canView]);

  if (!appointmentId || !canView) return null;

  const total = sumCents(state.rows, "commission_amount");
  return (
    <div className="commission-summary stack">
      {state.loading ? (
        <p className="field-hint" aria-live="polite">Carregando comissão…</p>
      ) : state.notice ? (
        <p className="field-hint" role="note">{state.notice}</p>
      ) : state.error ? (
        <p className="form-error" role="alert">{state.error}</p>
      ) : state.rows.length === 0 ? (
        <p className="field-hint">Nenhuma comissão lançada para este atendimento.</p>
      ) : (
        <ul className="commission-summary-list">
          {state.rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.item_description || KIND_LABELS[row.item_kind] || "Item"}</strong>
                <small>
                  {[KIND_LABELS[row.item_kind], row.professional_name, `Base ${money(row.base_amount)}`, commissionRuleLabel(row)].filter(Boolean).join(" · ")}
                </small>
              </div>
              <strong>{money(row.commission_amount)}</strong>
            </li>
          ))}
        </ul>
      )}
      {!state.loading && !state.notice && !state.error && state.rows.length > 0 && (
        <p className="commission-summary-total">Total da comissão: {money(total)}</p>
      )}
    </div>
  );
}
