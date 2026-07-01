// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { Download } from "lucide-react";
import { Button, Input, Metric, PaymentSelect, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, DataTable, ConfirmDeleteModal } from "../../components/common/Crud";
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
          <Button variant="secondary" type="button" onClick={() => downloadApiFile("/finance/export.csv", "relatorio-aura-clinic.csv")}><Download size={16} /> Exportar CSV</Button>
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
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
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

  function openNew() {
    setExpense(defaultExpense());
    setError("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

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
    setModalOpen(false);
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
            <Button variant="secondary" type="button" onClick={() => downloadApiFile("/finance/export.pdf", "relatorio-Financeiro-aura.pdf")}><Download size={16} /> PDF</Button>
            <Button variant="secondary" type="button" onClick={() => downloadApiFile("/finance/export.xlsx", "relatorio-Financeiro-aura.xlsx")}><Download size={16} /> Excel</Button>
            <Button variant="secondary" type="button" onClick={() => downloadApiFile("/finance/export.csv", "relatorio-aura-clinic.csv")}><Download size={16} /> CSV</Button>
          </div>
        </div>
      </div>

      <div className="panel">
        <CrudHeader
          title="Despesas lançadas"
          subtitle={`${currency.format(asNumber(expensesSummary.total))} no mês`}
          actionLabel="Nova despesa"
          onAction={openNew}
        />
        <DataTable
          rows={expenses}
          columns={[
            { key: "description", label: "Descrição" },
            { key: "expense_type", label: "Tipo" },
            { key: "category", label: "Categoria", render: (item) => item.category || "sem categoria" },
            { key: "amount", label: "Valor", align: "right", render: (item) => currency.format(item.amount) },
            { key: "due_date", label: "Vencimento", render: (item) => formatDate(item.due_date) },
            { key: "status", label: "Status", render: (item) => <StatusBadge status={item.status} tone={item.status === "paga" ? "ok" : "warn"} /> }
          ]}
          actions={(item) => (
            <button type="button" onClick={() => setDeleting({ message: `Apagar esta despesa?`, run: () => removeExpense(item.id) })}>Apagar</button>
          )}
          empty="Nenhuma despesa lançada ainda."
        />
      </div>

      <Modal
        open={modalOpen}
        title="Nova despesa"
        subtitle="Fixa ou variável"
        onClose={closeModal}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeModal}>Cancelar</Button>
            <Button type="submit" form="expense-form" variant="primary">Salvar despesa</Button>
          </>
        )}
      >
        <form id="expense-form" onSubmit={saveExpense}>
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
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
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

