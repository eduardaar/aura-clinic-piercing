import { Button, Metric, StatusBadge } from "../../components/common/Ui";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { useFetch } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { financeLabel } from "../../lib/financeLabels";
import { currency } from "../shared/helpers";
import { AccountsReceivable } from "./Receivables";

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
      <div className="metric-grid">
        <Metric label="Recebido no período" value={currency.format(asNumber(cashflow.received))} />
        <Metric label="Pago no período" value={currency.format(asNumber(cashflow.paid))} />
        <Metric label="Saldo de caixa" value={currency.format(asNumber(cashflow.balance))} />
        {view !== "caixa" && <Metric label="Resultado" value={currency.format(asNumber(dre.result))} />}
      </div>
      <section className="panel stack">
        <div className="panel-heading">
          <div>
            <h2>{view === "caixa" ? "Caixa" : "Visão financeira"}</h2>
            <span>{view === "caixa" ? "Entradas e saídas efetivamente pagas" : "Resumo do ano e lançamentos financeiros"}</span>
          </div>
          <div className="compact-actions">
            <Button variant="secondary" onClick={() => onNavigate?.("receivables")}>Contas a receber</Button>
            <Button variant="secondary" onClick={() => onNavigate?.("payables")}>Contas a pagar</Button>
          </div>
        </div>
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

export function FinanceWorkspace({ initialView = "receivables", onNavigate }) {
  if (initialView === "receivables") return <AccountsReceivable onNavigate={onNavigate} />;
  return <FinancialSummary view={initialView === "caixa" ? "caixa" : "visao"} onNavigate={onNavigate} />;
}
