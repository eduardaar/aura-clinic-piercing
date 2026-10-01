import { Metric, StatusBadge } from "../../components/common/Ui";
import { CrudHeader } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { CollapsibleIndicators } from "../../components/common/CollapsibleIndicators";
import { ApiError, Loading } from "../../components/common/Feedback";
import { readStoredSession, useFetch } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { financeLabel } from "../../lib/financeLabels";
import { canAccessPage } from "../../lib/permissions";
import { currency } from "../shared/helpers";
import { AccountsReceivable } from "./Receivables";
import { CommissionStatement, commissionAccess } from "./CommissionStatement";

function formatDate(value) {
  const text = String(value || "").slice(0, 10);
  return text ? new Date(`${text}T12:00:00`).toLocaleDateString("pt-BR") : "—";
}

function FinancialSummary({ view, onNavigate }) {
  const year = new Date().getFullYear();
  const { data } = useFetch(`/finance/ledger?from=${year}-01-01&to=${year}-12-31`);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const ledger = asObject(data);
  const cashflow = asObject(ledger.cashflow);
  const dre = asObject(ledger.dre);
  const rows = asArray(ledger.entries);
  const cashRows = rows.filter((item) => asNumber(item.paid_amount) > 0 || item.status === "paid");
  const visibleRows = view === "caixa" ? cashRows : rows;

  return (
    <section className="stack finance-page">
      <CollapsibleIndicators screenId={`finance-${view}`}><div className="metric-grid">
        <Metric label="Recebido no período" value={currency.format(asNumber(cashflow.received))} />
        <Metric label="Pago no período" value={currency.format(asNumber(cashflow.paid))} />
        <Metric label="Saldo de caixa" value={currency.format(asNumber(cashflow.balance))} />
        {view !== "caixa" && <Metric label="Resultado" value={currency.format(asNumber(dre.result))} />}
      </div></CollapsibleIndicators>
      <section className="panel stack">
        <CrudHeader
          title={view === "caixa" ? "Caixa" : "Visão financeira"}
          subtitle={view === "caixa" ? "Entradas e saídas efetivamente pagas" : "Resumo do ano e lançamentos financeiros"}
          actions={[
            ...(view !== "visao" ? [{ label: "Visão financeira", onClick: () => onNavigate?.("receivables", { target: "visao" }) }] : []),
            ...(view !== "caixa" ? [{ label: "Caixa", onClick: () => onNavigate?.("receivables", { target: "caixa" }) }] : []),
            ...(commissionAccess(readStoredSession()?.user || {}).canView ? [{ label: "Comissões", onClick: () => onNavigate?.("receivables", { target: "comissoes" }) }] : []),
            { label: "Contas a receber", onClick: () => onNavigate?.("receivables") },
            { label: "Contas a pagar", onClick: () => onNavigate?.("payables") },
            { label: "Categorias", onClick: () => onNavigate?.("finance-categories") },
            { label: "Centros de custo", onClick: () => onNavigate?.("cost-centers") }
          ]}
        />
        <DataView
          rows={visibleRows}
          defaultSort={{ key: "due_date", dir: "desc" }}
          searchPlaceholder="Buscar lançamento, categoria ou origem"
          columns={[
            { key: "description", label: "Lançamento" },
            { key: "entry_type", label: "Tipo", render: (item) => financeLabel(item.entry_type) },
            { key: "due_date", label: view === "caixa" ? "Data" : "Vencimento", render: (item) => formatDate(item.paid_at || item.due_date) },
            { key: "amount", label: "Valor", align: "right", value: (item) => asNumber(item.amount), render: (item) => currency.format(asNumber(view === "caixa" ? item.paid_amount || item.amount : item.amount)) },
            { key: "status", label: "Status", render: (item) => <StatusBadge status={item.status}>{financeLabel(item.status)}</StatusBadge> }
          ]}
          empty={view === "caixa" ? "Nenhum movimento de caixa no período." : "Nenhum lançamento financeiro no período."}
        />
      </section>
    </section>
  );
}

// Área "Comissões" do Financeiro: extrato de lançamentos por profissional,
// período, serviço e atendimento. Plano e permissão são checados dentro do
// CommissionStatement (aviso de upgrade ou de permissão no lugar do extrato).
function CommissionsArea({ features, onUpgrade, onNavigate }) {
  // Quem chega aqui só com a permissão de comissão (rota /app/financeiro/comissoes)
  // não deve ver atalhos para telas do Financeiro que não pode abrir.
  const user = readStoredSession()?.user || {};
  const shortcuts = [
    { label: "Visão financeira", page: "receivables", target: "visao" },
    { label: "Caixa", page: "receivables", target: "caixa" },
    { label: "Contas a receber", page: "receivables" },
    { label: "Contas a pagar", page: "payables" }
  ].filter((item) => canAccessPage(user, item.page));
  return (
    <section className="stack finance-page">
      <section className="panel stack">
        <CrudHeader
          title="Comissões"
          subtitle="Extrato de comissões por profissional, com a base de cada atendimento e a regra aplicada"
          actions={shortcuts.map((item) => ({
            label: item.label,
            onClick: () => (item.target ? onNavigate?.(item.page, { target: item.target }) : onNavigate?.(item.page))
          }))}
        />
        <CommissionStatement features={features} onUpgrade={onUpgrade} />
      </section>
    </section>
  );
}

// Sem `features` vindas da página (rota antiga), lê o plano da identidade da
// loja — a mesma fonte do main.jsx — para não bloquear quem tem o recurso.
function CommissionsAreaWithPlan({ onUpgrade, onNavigate }) {
  const { data } = useFetch("/store-identity");
  if (!data) return <Loading />;
  // Falha ao ler o plano não pode virar "faça upgrade" para quem já tem o recurso.
  if (data.error) return <ApiError message={data.error} />;
  const features = asArray(asObject(asObject(data).subscription).features);
  return <CommissionsArea features={features} onUpgrade={onUpgrade} onNavigate={onNavigate} />;
}

/**
 * @param {{ initialView?: string, onNavigate?: (page: string, options?: Record<string, any>) => void, features?: string[], onUpgrade?: () => void }} props
 */
export function FinanceWorkspace({ initialView = "receivables", onNavigate, features, onUpgrade }) {
  if (initialView === "comissoes") {
    return Array.isArray(features)
      ? <CommissionsArea features={features} onUpgrade={onUpgrade} onNavigate={onNavigate} />
      : <CommissionsAreaWithPlan onUpgrade={onUpgrade} onNavigate={onNavigate} />;
  }
  if (initialView === "receivables") return <AccountsReceivable onNavigate={onNavigate} />;
  return <FinancialSummary view={initialView === "caixa" ? "caixa" : "visao"} onNavigate={onNavigate} />;
}
