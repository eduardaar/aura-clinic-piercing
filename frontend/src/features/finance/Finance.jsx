// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useState } from "react";
import { Download } from "lucide-react";
import { Button, Input, Metric, PaymentSelect, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, ConfirmDeleteModal } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { apiFetch, downloadApiFile, useApiInvalidate, useFetch } from "../../lib/api";
import { defaultExpense } from "../../lib/defaultForms";
import { currency } from "../../features/shared/helpers";
import { FINANCE_ENTRY_LABELS, FINANCE_STATUS_LABELS, financeLabel } from "../../lib/financeLabels";

// `formatDate` de lib/utils devolve dd/MM sem ano: em listas financeiras com
// vencimentos de anos diferentes as linhas ficariam indistinguíveis.
function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

const EXPENSE_TYPE_LABELS = { fixa: "fixa", variavel: "variável" };

const ENTRY_TYPE_LABELS = FINANCE_ENTRY_LABELS;
const ENTRY_STATUS_LABELS = FINANCE_STATUS_LABELS;

// Sentinela para filtrar lançamentos sem centro de custo (o select do DataView
// usa string vazia como "Todos").
const NO_COST_CENTER = "__sem_centro__";

// Opções vindas das próprias linhas: nenhum filtro oferecido devolve lista vazia.
const distinctOptions = (rows, pick, label = (value) => value) =>
  [...new Set(rows.map(pick).filter(Boolean))].sort().map((value) => ({ value, label: label(value) }));

export function FinanceAdmin() {
  const { data } = useFetch("/finance");
  // Despesa mexe no resumo, no razão e nos indicadores do painel.
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/finance", "/dashboard");
  const [expense, setExpense] = useState(defaultExpense());
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [editingId, setEditingId] = useState(null);
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
  const expenseCategories = [...new Set(expenses.map((item) => item.category || "sem categoria"))].sort();
  const expenseTypeOptions = distinctOptions(expenses, (item) => item.expense_type, (value) => EXPENSE_TYPE_LABELS[value] || value);
  const expenseStatusOptions = distinctOptions(expenses, (item) => item.status);

  function openNew() {
    setExpense(defaultExpense());
    setEditingId(null);
    setError("");
    setModalOpen(true);
  }

  function openEdit(item) {
    setExpense({ ...defaultExpense(), ...item, paid_at: item.paid_at ? String(item.paid_at).slice(0, 10) : "" });
    setEditingId(item.id);
    setError("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function saveExpense(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(editingId ? `/expenses/${editingId}` : `/expenses`, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expense)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar a despesa.");
    setExpense(defaultExpense());
    setEditingId(null);
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
        <DataView
          rows={expenses}
          defaultSort={{ key: "due_date", dir: "desc" }}
          searchPlaceholder="Buscar por descrição, categoria ou status"
          filters={[
            { key: "expense_type", label: "Tipo", type: "select", options: expenseTypeOptions },
            { key: "status", label: "Status", type: "select", options: expenseStatusOptions },
            {
              key: "category",
              label: "Categoria",
              type: "select",
              options: expenseCategories,
              match: (item, value) => (item.category || "sem categoria") === value
            },
            {
              key: "due_from",
              label: "Vencimento a partir de",
              type: "date",
              match: (item, value) => String(item.due_date || "").slice(0, 10) >= value
            },
            {
              key: "due_to",
              label: "Vencimento até",
              type: "date",
              match: (item, value) => String(item.due_date || "").slice(0, 10) <= value
            }
          ]}
          columns={[
            { key: "description", label: "Descrição" },
            { key: "expense_type", label: "Tipo" },
            { key: "category", label: "Categoria", value: (item) => item.category || "sem categoria", render: (item) => item.category || "sem categoria" },
            { key: "amount", label: "Valor", align: "right", value: (item) => asNumber(item.amount), render: (item) => currency.format(item.amount) },
            { key: "due_date", label: "Vencimento", value: (item) => String(item.due_date || "").slice(0, 10), render: (item) => formatDateWithYear(item.due_date) },
            { key: "status", label: "Status", value: (item) => item.status || "", render: (item) => <StatusBadge status={item.status} tone={item.status === "paga" ? "ok" : "warn"} /> }
          ]}
          actions={(item) => (
            <>
              <button type="button" onClick={() => openEdit(item)}>Editar</button>
              {item.status !== "paga" && <button type="button" onClick={async () => { await apiFetch(`/expenses/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paga", paid_at: new Date().toISOString() }) }); refresh(); }}>Marcar como paga</button>}
              {item.status === "paga" && <button type="button" onClick={async () => { await apiFetch(`/expenses/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "pendente" }) }); refresh(); }}>Desfazer pagamento</button>}
              <button type="button" onClick={() => setDeleting({ message: `Excluir esta despesa?`, run: () => removeExpense(item.id) })}>Excluir</button>
            </>
          )}
          empty="Nenhuma despesa lançada ainda."
        />
      </div>

      <Modal
        open={modalOpen}
        title={editingId ? "Editar despesa" : "Nova despesa"}
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
              <option value="vencida">vencida</option>
              <option value="cancelada">cancelada</option>
            </Select>
            <PaymentSelect label="Forma de pagamento" value={expense.payment_method} onChange={(value) => setExpense({ ...expense, payment_method: value })} />
            <Input label="Conta ou caixa" value={expense.payment_account} onChange={(value) => setExpense({ ...expense, payment_account: value })} />
            {expense.status === "paga" && <Input type="date" label="Data do pagamento" value={expense.paid_at} onChange={(value) => setExpense({ ...expense, paid_at: value })} />}
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
      <AdvancedFinance />
    </section>
  );
}

function AdvancedFinance() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [period, setPeriod] = useState({ from: monthStart, to: today });
  const query = new URLSearchParams(period).toString();
  const { data } = useFetch(`/finance/ledger?${query}`);
  const { data: centers } = useFetch("/finance/cost-centers");
  const { data: goals } = useFetch("/finance/goals");
  // "/finance" cobre resumo, razão, centros de custo e metas de uma vez — o
  // razão precisa recarregar em qualquer período consultado, não só no atual.
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/finance", "/dashboard");
  const refreshCenters = () => invalidate("/finance/cost-centers");
  const refreshGoals = () => invalidate("/finance/goals");
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    entry_type: "payable", description: "", category: "", amount: "", paid_amount: 0,
    due_date: today, status: "pending", payment_method: "Pix", payment_account: "",
    cost_center_id: "", installment_count: 1, recurrence: "", notes: ""
  });
  // Baixa de valor, centro de custo e meta usavam window.prompt no meio do fluxo.
  const [payment, setPayment] = useState(null);
  const [centerForm, setCenterForm] = useState(null);
  const [goalForm, setGoalForm] = useState(null);
  const [details, setDetails] = useState(null);
  const [lifecycle, setLifecycle] = useState(null);

  if (!data) return <Loading />;
  if (data.error) {
    return <section className="panel"><div className="panel-heading"><h2>Financeiro 2.0</h2><span>Fluxo de caixa, DRE e conciliação estão disponíveis no plano Studio.</span></div></section>;
  }
  const ledger = asObject(data);
  const cashflow = asObject(ledger.cashflow);
  const dre = asObject(ledger.dre);
  const entries = asArray(ledger.entries);
  const centerOptions = [...new Set(entries.map((item) => item.cost_center_name || NO_COST_CENTER))]
    .sort()
    .map((name) => ({ value: name, label: name === NO_COST_CENTER ? "Sem centro" : name }));
  const entryTypeOptions = distinctOptions(entries, (item) => item.entry_type, (value) => ENTRY_TYPE_LABELS[value] || value);
  const entryStatusOptions = distinctOptions(entries, (item) => item.status, (value) => ENTRY_STATUS_LABELS[value] || value);

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch("/finance/entries", { method: "POST", body: JSON.stringify(form) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível salvar o lançamento.");
    setModalOpen(false);
    refresh();
  }

  function openPayment(item) {
    setPayment({ item, value: String(Math.max(0, asNumber(item.amount) - asNumber(item.paid_amount))) });
  }

  async function registerPayment(event) {
    event.preventDefault();
    const { item, value } = payment;
    await apiFetch(`/finance/entries/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ paid_amount: Number(item.paid_amount || 0) + Number(value), payment_method: item.payment_method || "Pix" })
    });
    setPayment(null);
    refresh();
  }

  async function createCenter(event) {
    event.preventDefault();
    const name = String(centerForm?.name || "").trim();
    if (!name) return;
    await apiFetch("/finance/cost-centers", { method: "POST", body: JSON.stringify({ name }) });
    setCenterForm(null);
    refreshCenters();
  }

  async function createGoal(event) {
    event.preventDefault();
    const name = String(goalForm?.name || "").trim();
    if (!name) return;
    await apiFetch("/finance/goals", { method: "POST", body: JSON.stringify({ name, target_amount: Number(goalForm.target), period_start: period.from, period_end: period.to, goal_type: "revenue" }) });
    setGoalForm(null);
    refreshGoals();
  }

  async function processRecurrences() {
    await apiFetch("/finance/recurrences/process", { method: "POST", body: JSON.stringify({ horizon_days: 90 }) });
    refresh();
  }

  async function openDetails(item) {
    setDetails({ loading: true, ...item });
    const response = await apiFetch(`/finance/entries/${item.id}/details`);
    const payload = await response.json().catch(() => ({}));
    setDetails(response.ok ? payload : { ...item, error: payload.error || "Não foi possível abrir os detalhes." });
  }

  async function submitLifecycle(event) {
    event.preventDefault();
    const response = await apiFetch(`/finance/entries/${lifecycle.item.id}/lifecycle`, {
      method: "POST", body: JSON.stringify({ action: lifecycle.action, reason: lifecycle.reason })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setLifecycle((current) => ({ ...current, error: payload.error }));
    setLifecycle(null);
    setDetails(null);
    refresh();
  }

  return (
    <>
      <section className="panel stack">
        <div className="panel-heading">
          <div><h2>Financeiro 2.0</h2><span>Contas a pagar e receber, fluxo de caixa, DRE e inadimplência.</span></div>
          <div className="export-actions">
            <Button variant="secondary" onClick={processRecurrences}>Gerar recorrências</Button>
            <Button variant="secondary" onClick={() => setGoalForm({ name: "", target: "10000" })}>Nova meta</Button>
            <Button variant="secondary" onClick={() => setCenterForm({ name: "" })}>Novo centro de custo</Button>
            <Button variant="primary" onClick={() => setModalOpen(true)}>Novo lançamento</Button>
          </div>
        </div>
        <div className="form-grid">
          <Input type="date" label="De" value={period.from} onChange={(value) => setPeriod({ ...period, from: value })} />
          <Input type="date" label="Até" value={period.to} onChange={(value) => setPeriod({ ...period, to: value })} />
        </div>
        <div className="metric-grid">
          <Metric label="Recebido" value={currency.format(asNumber(cashflow.received))} />
          <Metric label="Pago" value={currency.format(asNumber(cashflow.paid))} />
          <Metric label="Saldo de caixa" value={currency.format(asNumber(cashflow.balance))} />
          <Metric label="Contas a receber" value={currency.format(asNumber(ledger.receivable))} />
          <Metric label="Contas a pagar" value={currency.format(asNumber(ledger.payable))} />
          <Metric label="Inadimplência" value={currency.format(asNumber(ledger.delinquency))} />
          <Metric label="Resultado DRE" value={currency.format(asNumber(dre.result))} />
          <Metric label="Metas do período" value={String(asArray(goals).filter((goal) => goal.period_start <= period.to && goal.period_end >= period.from).length)} />
        </div>
        <DataView
          rows={entries}
          defaultSort={{ key: "due_date", dir: "desc" }}
          searchPlaceholder="Buscar por lançamento, categoria ou centro de custo"
          filters={[
            { key: "entry_type", label: "Tipo de lançamento", type: "select", options: entryTypeOptions },
            { key: "status", label: "Status", type: "select", options: entryStatusOptions },
            {
              key: "cost_center",
              label: "Centro de custo",
              type: "select",
              options: centerOptions,
              match: (item, value) => (item.cost_center_name || NO_COST_CENTER) === value
            }
          ]}
          columns={[
            { key: "description", label: "Lançamento" },
            { key: "entry_type", label: "Tipo", render: (item) => financeLabel(item.entry_type) },
            { key: "cost_center_name", label: "Centro", value: (item) => item.cost_center_name || "", render: (item) => item.cost_center_name || "—" },
            { key: "due_date", label: "Vencimento", value: (item) => String(item.due_date || "").slice(0, 10), render: (item) => formatDateWithYear(item.due_date) },
            { key: "amount", label: "Valor", align: "right", value: (item) => asNumber(item.amount), render: (item) => currency.format(item.amount) },
            { key: "paid_amount", label: "Liquidado", align: "right", value: (item) => asNumber(item.paid_amount), render: (item) => currency.format(item.paid_amount) },
            { key: "status", label: "Status", value: (item) => item.status || "", render: (item) => <StatusBadge status={item.status}>{financeLabel(item.status)}</StatusBadge> },
            { key: "lifecycle_status", label: "Uso nos indicadores", render: (item) => financeLabel(item.lifecycle_status || "active") }
          ]}
          actions={(item) => (
            <>
              <button type="button" onClick={() => openDetails(item)}>Detalhes</button>
              {(item.lifecycle_status || "active") === "active" && <button type="button" onClick={() => setLifecycle({ item, action: "test", reason: "" })}>Marcar teste</button>}
              {(item.lifecycle_status || "active") !== "active" && <button type="button" onClick={() => setLifecycle({ item, action: "restore", reason: "" })}>Restaurar</button>}
              {!["paid", "canceled", "refunded"].includes(item.status) && (item.lifecycle_status || "active") === "active" && <button type="button" onClick={() => openPayment(item)}>Baixar valor</button>}
            </>
          )}
          empty="Nenhum lançamento no período."
        />
      </section>
      <Modal open={!!details} title="Detalhes da movimentação" onClose={() => setDetails(null)}>
        {details?.loading ? <Loading /> : <div className="stack">
          {details?.error && <span className="form-error">{details.error}</span>}
          <div className="form-grid">
            <div><small>Descrição</small><strong>{details?.description}</strong></div>
            <div><small>Origem</small><strong>{financeLabel(details?.source_type || "manual")}</strong></div>
            <div><small>Valor</small><strong>{currency.format(asNumber(details?.amount))}</strong></div>
            <div><small>Pago</small><strong>{currency.format(asNumber(details?.paid_amount))}</strong></div>
            <div><small>Forma</small><strong>{details?.payment_method || "Não informada"}</strong></div>
            <div><small>Responsável</small><strong>{details?.responsible_user_name || "Não informado"}</strong></div>
          </div>
          <h3>Histórico de alterações</h3>
          {asArray(details?.audit).map((item) => <p key={item.id}><strong>{financeLabel(item.action)}</strong> · {item.user_name || "Sistema"} · {item.created_at}</p>)}
        </div>}
      </Modal>
      <Modal open={!!lifecycle} title={lifecycle?.action === "restore" ? "Restaurar movimentação" : "Marcar como teste"}
        onClose={() => setLifecycle(null)} footer={<><Button variant="secondary" onClick={() => setLifecycle(null)}>Voltar</Button><Button type="submit" form="lifecycle-form">Confirmar</Button></>}>
        <form id="lifecycle-form" onSubmit={submitLifecycle} className="stack">
          <p>O registro será preservado na auditoria e {lifecycle?.action === "restore" ? "voltará aos indicadores" : "será desconsiderado de caixa, DRE e metas"}.</p>
          <label>Justificativa obrigatória<textarea required value={lifecycle?.reason || ""} onChange={(event) => setLifecycle((current) => ({ ...current, reason: event.target.value }))} /></label>
          {lifecycle?.error && <span className="form-error">{lifecycle.error}</span>}
        </form>
      </Modal>
      <Modal open={modalOpen} title="Novo lançamento financeiro" subtitle="Parcelas são criadas mês a mês." onClose={() => setModalOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" form="ledger-form">Salvar</Button></>}>
        <form id="ledger-form" onSubmit={save} className="stack">
          <div className="form-grid">
            <Select label="Tipo" value={form.entry_type} onChange={(value) => setForm({ ...form, entry_type: value })}>
              <option value="payable">Conta a pagar</option><option value="receivable">Conta a receber</option>
              <option value="expense">Despesa</option><option value="income">Receita</option>
            </Select>
            <Input label="Descrição" value={form.description} onChange={(value) => setForm({ ...form, description: value })} required />
            <Input label="Categoria" value={form.category} onChange={(value) => setForm({ ...form, category: value })} />
            <Input type="number" label="Valor total" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} required />
            <Input type="date" label="Primeiro vencimento" value={form.due_date} onChange={(value) => setForm({ ...form, due_date: value })} required />
            <Input type="number" label="Parcelas" value={form.installment_count} onChange={(value) => setForm({ ...form, installment_count: value })} />
            <Select label="Recorrência" value={form.recurrence} onChange={(value) => setForm({ ...form, recurrence: value })}>
              <option value="">Sem recorrência</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option>
            </Select>
            <Select label="Centro de custo" value={form.cost_center_id} onChange={(value) => setForm({ ...form, cost_center_id: value })}>
              <option value="">Sem centro</option>{asArray(centers).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </Select>
            <PaymentSelect label="Forma" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })} />
            <Input label="Conta/caixa" value={form.payment_account} onChange={(value) => setForm({ ...form, payment_account: value })} />
          </div>
          <label>Observações<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <Modal
        open={!!payment}
        title="Baixar valor"
        subtitle={payment?.item?.description}
        size="sm"
        onClose={() => setPayment(null)}
        footer={<><Button variant="secondary" onClick={() => setPayment(null)}>Cancelar</Button><Button type="submit" form="ledger-payment-form" variant="primary">Registrar baixa</Button></>}
      >
        <form id="ledger-payment-form" onSubmit={registerPayment}>
          <Input
            type="number"
            label="Valor pago/recebido"
            value={payment?.value ?? ""}
            onChange={(value) => setPayment((current) => ({ ...current, value }))}
            required
          />
          <p className="empty-state">
            Já liquidado: {currency.format(asNumber(payment?.item?.paid_amount))} de {currency.format(asNumber(payment?.item?.amount))}.
          </p>
        </form>
      </Modal>

      <Modal
        open={!!centerForm}
        title="Novo centro de custo"
        size="sm"
        onClose={() => setCenterForm(null)}
        footer={<><Button variant="secondary" onClick={() => setCenterForm(null)}>Cancelar</Button><Button type="submit" form="cost-center-form" variant="primary">Salvar</Button></>}
      >
        <form id="cost-center-form" onSubmit={createCenter}>
          <Input
            label="Nome do centro de custo"
            value={centerForm?.name ?? ""}
            onChange={(value) => setCenterForm((current) => ({ ...current, name: value }))}
            required
          />
        </form>
      </Modal>

      <Modal
        open={!!goalForm}
        title="Nova meta"
        subtitle={`Período de ${formatDateWithYear(period.from)} a ${formatDateWithYear(period.to)}`}
        size="sm"
        onClose={() => setGoalForm(null)}
        footer={<><Button variant="secondary" onClick={() => setGoalForm(null)}>Cancelar</Button><Button type="submit" form="finance-goal-form" variant="primary">Salvar meta</Button></>}
      >
        <form id="finance-goal-form" onSubmit={createGoal}>
          <div className="form-grid">
            <Input
              label="Nome da meta"
              value={goalForm?.name ?? ""}
              onChange={(value) => setGoalForm((current) => ({ ...current, name: value }))}
              required
            />
            <Input
              type="number"
              label="Valor da meta"
              value={goalForm?.target ?? ""}
              onChange={(value) => setGoalForm((current) => ({ ...current, target: value }))}
              required
            />
          </div>
        </form>
      </Modal>
    </>
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
