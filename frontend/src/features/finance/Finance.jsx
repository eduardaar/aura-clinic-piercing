// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { Download } from "lucide-react";
import { Input, Metric, PaymentSelect, Select } from "../../components/common/Ui";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject, formatDate, formatLongDate } from "../../lib/utils";
import { apiFetch, downloadApiFile, useFetch } from "../../lib/api";
import { defaultExpense } from "../../lib/defaultForms";
import { currency } from "../../features/shared/helpers";

export function Finance() {
  const { data } = useFetch("/finance");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const safeData = asObject(data);
  const totals = asObject(safeData.totals);
  const forecast = asObject(safeData.forecast);
  const methods = asArray(safeData.methods);
  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Recebido hoje" value={currency.format(asNumber(totals.day_total))} />
        <Metric label="Recebido na semana" value={currency.format(asNumber(totals.week_total))} />
        <Metric label="Recebido no mês" value={currency.format(asNumber(totals.month_total))} />
        <Metric label="Total previsto" value={currency.format(asNumber(forecast.total))} />
        <Metric label="Total pendente" value={currency.format(asNumber(forecast.pending))} />
        <Metric label="Pagamento mais usado" value={safeData.mostUsedMethod || "Sem registros"} />
      </div>
      <div className="panel">
        <div className="panel-heading">
          <h2>Relatório Financeiro</h2>
          <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.csv", "relatorio-aura-clinic.csv")}><Download size={16} /> Exportar CSV</button>
        </div>
        <div className="payment-bars">
          {methods.map((item) => <div key={item.method || item.name}><span>{item.method || "Não informado"}</span><strong>{asNumber(item.total)}</strong></div>)}
        </div>
      </div>
    </section>
  );
}

export function Clients() {
  const { data } = useFetch("/clients");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const clients = asArray(data);
  return (
    <section className="client-grid">
      {clients.map((client) => (
        <article className="panel client-card" key={client.id}>
          <h2>{client.full_name}</h2>
          <p>{client.whatsapp} · {client.instagram}</p>
          {client.birth_date && <small>Aniversário: {formatLongDate(client.birth_date)}</small>}
          <span>{client.notes}</span>
          <h3>Histórico</h3>
          {asArray(client.history).map((item) => <div className="history-item" key={item.id}><strong>{formatDate(item.appointment_date)}</strong><span>{item.procedure} · {item.jewelry_name || "sem joia"}</span><small>{item.status} · {currency.format(asNumber(item.total_value))}</small></div>)}
        </article>
      ))}
    </section>
  );
}

export function FinanceAdmin() {
  const { data, refresh } = useFetch("/finance");
  const [expense, setExpense] = useState(defaultExpense());
  const [error, setError] = useState("");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const safeData = asObject(data);
  const totals = asObject(safeData.totals);
  const deposits = asObject(safeData.deposits);
  const forecast = asObject(safeData.forecast);
  const profit = asObject(safeData.profit);
  const expensesSummary = asObject(safeData.expensesSummary);
  const methods = asArray(safeData.methods);
  const expenses = asArray(safeData.expenses);
  const monthlyRevenue = asArray(safeData.monthlyRevenue);

  async function saveExpense(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expense)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar a despesa.");
    setExpense(defaultExpense());
    refresh();
  }

  async function removeExpense(id) {
    await apiFetch(`/expenses/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Faturamento diário" value={currency.format(asNumber(totals.day_total))} />
        <Metric label="Faturamento semanal" value={currency.format(asNumber(totals.week_total))} />
        <Metric label="Faturamento mensal" value={currency.format(asNumber(totals.month_total))} />
        <Metric label="Sinais recebidos" value={currency.format(asNumber(deposits.monthTotal))} />
        <Metric label="Valores pendentes" value={currency.format(asNumber(forecast.pending))} />
        <Metric label="Lucro estimado" value={currency.format(asNumber(profit.estimated))} />
        <Metric label="Despesas fixas" value={currency.format(asNumber(expensesSummary.fixed_total))} />
        <Metric label="Despesas variáveis" value={currency.format(asNumber(expensesSummary.variable_total))} />
        <Metric label="Pagamento mais usado" value={safeData.mostUsedMethod || "Sem registros"} />
      </div>

      <div className="finance-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>Gráfico de faturamento mensal</h2>
            <span>Últimos meses registrados</span>
          </div>
          <MonthlyChart data={monthlyRevenue} />
        </div>
        <div className="panel">
          <div className="panel-heading">
            <h2>Formas de pagamento</h2>
            <span>Mais usadas</span>
          </div>
          <div className="payment-bars">
            {methods.map((item) => <div key={item.method || item.name}><span>{item.method || "Não informado"}</span><strong>{asNumber(item.total)} · {currency.format(asNumber(item.amount))}</strong></div>)}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Relatórios exportáveis</h2>
          <div className="export-actions">
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.pdf", "relatorio-Financeiro-aura.pdf")}><Download size={16} /> PDF</button>
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.xlsx", "relatorio-Financeiro-aura.xlsx")}><Download size={16} /> Excel</button>
            <button className="secondary-button" type="button" onClick={() => downloadApiFile("/finance/export.csv", "relatorio-aura-clinic.csv")}><Download size={16} /> CSV</button>
          </div>
        </div>
      </div>

      <div className="split-layout">
        <form className="panel appointment-form" onSubmit={saveExpense}>
          <div className="panel-heading">
            <h2>Nova despesa</h2>
            <span>Fixa ou variável</span>
          </div>
          <div className="form-grid">
            <Input label="Descrição" value={expense.description} onChange={(value) => setExpense({ ...expense, description: value })} required />
            <Select label="Tipo" value={expense.expense_type} onChange={(value) => setExpense({ ...expense, expense_type: value })}>
              <option value="fixa">fixa</option>
              <option value="variavel">variável</option>
            </Select>
            <Input label="Categoria" value={expense.category} onChange={(value) => setExpense({ ...expense, category: value })} />
            <Input type="number" label="Valor" value={expense.amount} onChange={(value) => setExpense({ ...expense, amount: value })} required />
            <Input type="date" label="Vencimento" value={expense.due_date} onChange={(value) => setExpense({ ...expense, due_date: value })} required />
            <Select label="Status" value={expense.status} onChange={(value) => setExpense({ ...expense, status: value })}>
              <option value="paga">paga</option>
              <option value="pendente">pendente</option>
            </Select>
            <PaymentSelect label="Forma de pagamento" value={expense.payment_method} onChange={(value) => setExpense({ ...expense, payment_method: value })} />
          </div>
          <label>Observações
            <textarea value={expense.notes} onChange={(event) => setExpense({ ...expense, notes: event.target.value })} />
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button">Salvar despesa</button>
        </form>

        <div className="panel">
          <div className="panel-heading">
            <h2>Despesas lançadas</h2>
            <span>{currency.format(asNumber(expensesSummary.total))} no mês</span>
          </div>
          <div className="expense-list">
            {expenses.map((item) => (
              <article key={item.id} className="expense-row">
                <div>
                  <strong>{item.description}</strong>
                  <span>{item.expense_type} · {item.category || "sem categoria"} · {formatDate(item.due_date)}</span>
                </div>
                <strong>{currency.format(item.amount)}</strong>
                <span className={`status-badge ${item.status === "paga" ? "status-atendido" : "status-pendente"}`}>{item.status}</span>
                <button onClick={() => removeExpense(item.id)}>Apagar</button>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function MonthlyChart({ data = [] }) {
  const safeData = asArray(data);
  const max = Math.max(...safeData.map((item) => asNumber(item?.total)), 1);
  if (!safeData.length) return <p className="empty-state">Sem faturamento registrado para montar o gráfico.</p>;
  return (
    <div className="monthly-chart">
      {safeData.map((item, index) => (
        <div className="chart-column" key={item?.month || index}>
          <div style={{ height: `${Math.max((asNumber(item?.total) / max) * 100, 6)}%` }} />
          <span>{String(item?.month || "").slice(5)}/{String(item?.month || "").slice(2, 4)}</span>
          <small>{currency.format(asNumber(item?.total))}</small>
        </div>
      ))}
    </div>
  );
}

