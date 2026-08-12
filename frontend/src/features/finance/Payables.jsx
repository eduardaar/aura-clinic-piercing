import { useMemo, useState } from "react";
import { Button, Input, Metric, PaymentSelect, Select, StatusBadge } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { currency } from "../shared/helpers";
import { financeLabel } from "../../lib/financeLabels";

const today = () => new Date().toISOString().slice(0, 10);
const dateWithYear = (value) => {
  const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
};

const categoryOptions = [
  "Aluguel", "Água", "Energia elétrica", "Internet e telefone", "Fornecedores",
  "Empréstimo", "Impostos e taxas", "Marketing", "Manutenção", "Salários", "Outros"
];

function emptyPayable() {
  return {
    entry_type: "payable", description: "", category: "Outros", amount: "", due_date: today(),
    payment_method: "Pix", payment_account: "", cost_center_id: "", installment_count: "1",
    recurrence: "", notes: ""
  };
}

/** Lista operacional de obrigações manuais da clínica (não mistura recebíveis). */
export function PayablesAdmin() {
  const initialFrom = `${new Date().getFullYear() - 1}-01-01`;
  const initialTo = `${new Date().getFullYear() + 1}-12-31`;
  const [period, setPeriod] = useState({ from: initialFrom, to: initialTo });
  const query = new URLSearchParams({ ...period, entry_type: "payable" }).toString();
  const { data } = useFetch(`/finance/ledger?${query}`);
  const { data: centers } = useFetch("/finance/cost-centers");
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/finance", "/finance/ledger", "/dashboard");
  const [form, setForm] = useState(emptyPayable());
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [payment, setPayment] = useState(null);
  const [lifecycle, setLifecycle] = useState(null);
  const [error, setError] = useState("");

  const ledger = asObject(data);
  const entries = asArray(ledger.entries);
  const statusOptions = useMemo(() => [...new Set(entries.map((entry) => entry.status).filter(Boolean))]
    .map((value) => ({ value, label: financeLabel(value) })), [entries]);
  const categories = useMemo(() => [...new Set([...categoryOptions, ...entries.map((entry) => entry.category).filter(Boolean)])]
    .sort(), [entries]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const openNew = () => {
    setForm(emptyPayable());
    setEditing(null);
    setError("");
    setModalOpen(true);
  };
  const openEdit = (entry) => {
    setForm({ ...emptyPayable(), ...entry, entry_type: "payable", installment_count: String(entry.installment_count || 1) });
    setEditing(entry);
    setError("");
    setModalOpen(true);
  };
  const save = async (event) => {
    event.preventDefault();
    setError("");
    const payload = { ...form, amount: Number(form.amount), installment_count: Number(form.installment_count || 1) };
    const response = await apiFetch(editing ? `/finance/entries/${editing.id}` : "/finance/entries", {
      method: editing ? "PATCH" : "POST", body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError(result.error || "Não foi possível salvar a conta a pagar.");
    setModalOpen(false);
    refresh();
  };
  const registerPayment = async (event) => {
    event.preventDefault();
    const response = await apiFetch(`/finance/entries/${payment.item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ paid_amount: asNumber(payment.item.paid_amount) + Number(payment.value), payment_method: payment.item.payment_method || "Pix" })
    });
    if (!response.ok) return;
    setPayment(null);
    refresh();
  };
  const updateLifecycle = async () => {
    const response = await apiFetch(`/finance/entries/${lifecycle.item.id}/lifecycle`, {
      method: "POST", body: JSON.stringify({ action: lifecycle.action, reason: lifecycle.reason })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setLifecycle((current) => ({ ...current, error: result.error || "Não foi possível atualizar." }));
    setLifecycle(null);
    refresh();
  };

  const pending = entries.filter((entry) => !["paid", "canceled", "refunded"].includes(entry.status));
  const overdue = entries.filter((entry) => entry.status === "overdue");
  const openTotal = pending.reduce((total, entry) => total + Math.max(0, asNumber(entry.amount) - asNumber(entry.paid_amount)), 0);

  return <section className="stack">
    <div className="metric-grid">
      <Metric label="Em aberto" value={currency.format(openTotal)} />
      <Metric label="Vencidas" value={currency.format(overdue.reduce((total, entry) => total + Math.max(0, asNumber(entry.amount) - asNumber(entry.paid_amount)), 0))} />
      <Metric label="A vencer" value={String(pending.length - overdue.length)} />
    </div>
    <section className="panel stack">
      <CrudHeader title="Contas a pagar" subtitle="Despesas, empréstimos, parcelas e contas operacionais." actionLabel="Nova conta a pagar" onAction={openNew} />
      <div className="form-grid finance-period-filter">
        <Input type="date" label="De" value={period.from} onChange={(from) => setPeriod((current) => ({ ...current, from }))} />
        <Input type="date" label="Até" value={period.to} onChange={(to) => setPeriod((current) => ({ ...current, to }))} />
      </div>
      <DataView
        rows={entries}
        defaultSort={{ key: "due_date", dir: "asc" }}
        searchPlaceholder="Buscar por descrição ou categoria"
        filters={[
          { key: "status", label: "Status", type: "select", options: statusOptions },
          { key: "category", label: "Categoria", type: "select", options: categories },
          { key: "due_from", label: "Vencimento a partir de", type: "date", match: (item, value) => String(item.due_date || "").slice(0, 10) >= value },
          { key: "due_to", label: "Vencimento até", type: "date", match: (item, value) => String(item.due_date || "").slice(0, 10) <= value }
        ]}
        columns={[
          { key: "description", label: "Conta" },
          { key: "category", label: "Categoria", render: (item) => item.category || "—" },
          { key: "installment_number", label: "Parcela", render: (item) => Number(item.installment_count || 1) > 1 ? `${item.installment_number}/${item.installment_count}` : "À vista" },
          { key: "due_date", label: "Vencimento", value: (item) => String(item.due_date || ""), render: (item) => dateWithYear(item.due_date) },
          { key: "amount", label: "Valor", align: "right", value: (item) => asNumber(item.amount), render: (item) => currency.format(item.amount) },
          { key: "paid_amount", label: "Pago", align: "right", value: (item) => asNumber(item.paid_amount), render: (item) => currency.format(item.paid_amount) },
          { key: "status", label: "Status", render: (item) => <StatusBadge status={item.status}>{financeLabel(item.status)}</StatusBadge> }
        ]}
        actions={(item) => <RowActions actions={[
          !item.source_key && { label: "Editar", onClick: () => openEdit(item) },
          !["paid", "canceled", "refunded"].includes(item.status) && { label: "Registrar pagamento", onClick: () => setPayment({ item, value: String(Math.max(0, asNumber(item.amount) - asNumber(item.paid_amount))) }) },
          (item.lifecycle_status || "active") === "active" && { label: "Cancelar conta", onClick: () => setLifecycle({ item, action: "cancel", reason: "" }), danger: true }
        ].filter(Boolean)} />}
        empty="Nenhuma conta a pagar no período."
      />
    </section>

    <Modal open={modalOpen} title={editing ? "Editar conta a pagar" : "Nova conta a pagar"} subtitle="Parcelas são distribuídas automaticamente a cada mês." onClose={() => setModalOpen(false)}
      footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" form="payable-form">Salvar conta</Button></>}>
      <form id="payable-form" onSubmit={save} className="stack">
        <div className="form-grid">
          <Input label="Descrição" value={form.description} onChange={(value) => setForm({ ...form, description: value })} required />
          <Select label="Categoria" value={form.category} onChange={(value) => setForm({ ...form, category: value })}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</Select>
          <Input type="number" label="Valor total" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} required />
          <Input type="date" label="Primeiro vencimento" value={String(form.due_date || "").slice(0, 10)} onChange={(value) => setForm({ ...form, due_date: value })} required />
          {!editing && <Input type="number" label="Parcelas" value={form.installment_count} onChange={(value) => setForm({ ...form, installment_count: value })} required />}
          {!editing && <Select label="Recorrência" value={form.recurrence} onChange={(value) => setForm({ ...form, recurrence: value })}><option value="">Sem recorrência</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></Select>}
          <Select label="Centro de custo" value={form.cost_center_id || ""} onChange={(value) => setForm({ ...form, cost_center_id: value })}><option value="">Sem centro</option>{asArray(centers).map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</Select>
          <PaymentSelect label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })} />
          <Input label="Conta ou caixa" value={form.payment_account || ""} onChange={(value) => setForm({ ...form, payment_account: value })} />
        </div>
        <label>Observações (ex.: juros, número do contrato ou fornecedor)<textarea value={form.notes || ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        {error && <span className="form-error">{error}</span>}
      </form>
    </Modal>

    <Modal open={!!payment} title="Registrar pagamento" subtitle={payment?.item?.description} size="sm" onClose={() => setPayment(null)}
      footer={<><Button variant="secondary" onClick={() => setPayment(null)}>Cancelar</Button><Button type="submit" form="payable-payment-form">Confirmar pagamento</Button></>}>
      <form id="payable-payment-form" onSubmit={registerPayment} className="stack">
        <Input type="number" label="Valor pago" value={payment?.value || ""} onChange={(value) => setPayment((current) => ({ ...current, value }))} required />
        <p className="empty-state">Restante: {currency.format(Math.max(0, asNumber(payment?.item?.amount) - asNumber(payment?.item?.paid_amount)))}.</p>
      </form>
    </Modal>

    {lifecycle && <Modal open title="Motivo do cancelamento" size="sm" onClose={() => setLifecycle(null)} footer={<><Button variant="secondary" onClick={() => setLifecycle(null)}>Voltar</Button><Button onClick={updateLifecycle}>Cancelar conta</Button></>}>
      <label>Justificativa obrigatória<textarea required value={lifecycle.reason} onChange={(event) => setLifecycle((current) => ({ ...current, reason: event.target.value }))} /></label>
      {lifecycle.error && <span className="form-error">{lifecycle.error}</span>}
    </Modal>}
  </section>;
}
