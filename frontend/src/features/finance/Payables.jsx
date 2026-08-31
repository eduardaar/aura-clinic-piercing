import { useMemo, useState } from "react";
import { Landmark, Tags } from "lucide-react";
import { Button, Input, Metric, PaymentSelect, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { CollapsibleIndicators } from "../../components/common/CollapsibleIndicators";
import { ApiError, Loading } from "../../components/common/Feedback";
import { InstallmentGrid } from "../../components/common/InstallmentGrid";
import { SelectWithCreate } from "../../components/common/SelectWithCreate";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { installmentSummary, installmentsForPayload } from "../../lib/installments";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { currency } from "../shared/helpers";
import { financeLabel } from "../../lib/financeLabels";

const today = () => new Date().toISOString().slice(0, 10);
const dateWithYear = (value) => {
  const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
};

function emptyPayable() {
  return {
    entry_type: "payable", description: "", category: "", amount: "", due_date: today(),
    payment_method: "Pix", payment_account: "", cost_center_id: "", supplier_id: "", installment_count: "1",
    recurrence: "", notes: "",
    idempotency_key: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `payable-${Date.now()}-${Math.random()}`
  };
}

/** Lista operacional de obrigações manuais da clínica (não mistura recebíveis). */
export function PayablesAdmin({ onNavigate }) {
  const initialFrom = `${new Date().getFullYear() - 1}-01-01`;
  const initialTo = `${new Date().getFullYear() + 1}-12-31`;
  const [listFilters, setListFilters] = useState({ period_from: initialFrom, period_to: initialTo });
  const query = new URLSearchParams({ from: listFilters.period_from || "", to: listFilters.period_to || "" }).toString();
  const { data } = useFetch(`/finance/ledger?${query}`);
  const { data: centers } = useFetch("/finance/cost-centers");
  const { data: categoryList } = useFetch("/finance/categories");
  const { data: supplierList } = useFetch("/finance/suppliers");
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/finance", "/finance/ledger", "/dashboard");
  const refreshCategories = () => invalidate("/finance/categories");
  const refreshSuppliers = () => invalidate("/finance/suppliers");
  const [form, setForm] = useState(emptyPayable());
  const [installments, setInstallments] = useState([]);
  const [automaticInstallments, setAutomaticInstallments] = useState(true);
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [payment, setPayment] = useState(null);
  const [lifecycle, setLifecycle] = useState(null);
  const [error, setError] = useState("");

  const ledger = asObject(data);
  // Despesas cadastradas antes da separação são expostas pelo razão como
  // `expense`; ambas representam obrigações e pertencem a esta mesma lista.
  const entries = asArray(ledger.entries).filter((entry) => ["payable", "expense"].includes(entry.entry_type));
  const statusOptions = useMemo(() => [...new Set(entries.map((entry) => entry.status).filter(Boolean))]
    .map((value) => ({ value, label: financeLabel(value) })), [entries]);
  // O filtro aceita tanto o cadastro quanto categoria usada em lançamento
  // antigo que não tenha migrado para o cadastro (não deveria acontecer após
  // o backfill, mas a lista não pode simplesmente esconder o que já existe).
  const categories = useMemo(() => [...new Set([
    ...asArray(categoryList).map((item) => item.name),
    ...entries.map((entry) => entry.category).filter(Boolean)
  ])].sort(), [categoryList, entries]);

  async function createCategory(name) {
    const response = await apiFetch("/finance/categories", { method: "POST", body: JSON.stringify({ name }) });
    const created = await response.json().catch(() => null);
    refreshCategories();
    // `category` é texto livre no lançamento (não FK) — o valor do select é
    // o nome, igual ao mapeamento usado em `options` logo abaixo.
    return created?.name ? { id: created.name, name: created.name } : created;
  }

  async function createSupplier(name) {
    const response = await apiFetch("/finance/suppliers", { method: "POST", body: JSON.stringify({ name }) });
    const created = await response.json().catch(() => null);
    refreshSuppliers();
    return created;
  }

  async function createCenter(name) {
    const response = await apiFetch("/finance/cost-centers", { method: "POST", body: JSON.stringify({ name }) });
    const created = await response.json().catch(() => null);
    invalidate("/finance/cost-centers");
    return created;
  }

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const openNew = () => {
    setForm(emptyPayable());
    setInstallments([]);
    setAutomaticInstallments(true);
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
    const installmentCount = Number(form.installment_count || 1);
    if (!editing) {
      const schedule = installmentSummary(form.amount, installments, installmentCount);
      if (!schedule.isValid) {
        return setError("Revise as parcelas: a soma deve coincidir com o valor total e todos os campos são obrigatórios.");
      }
    }
    const payload = {
      ...form,
      amount: Number(form.amount),
      installment_count: installmentCount,
      recurrence: installmentCount > 1 ? "" : form.recurrence,
      ...(!editing ? { installments: installmentsForPayload(installments) } : {})
    };
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

  return <section className="stack payables-page">
    <CollapsibleIndicators screenId="finance-payables"><div className="metric-grid">
      <Metric label="Em aberto" value={currency.format(openTotal)} />
      <Metric label="Vencidas" value={currency.format(overdue.reduce((total, entry) => total + Math.max(0, asNumber(entry.amount) - asNumber(entry.paid_amount)), 0))} />
      <Metric label="A vencer" value={String(pending.length - overdue.length)} />
    </div></CollapsibleIndicators>
    <section className="panel stack">
      <CrudHeader
        title="Contas a pagar"
        subtitle="Despesas, empréstimos, parcelas e contas operacionais."
        actions={[
          { label: "Visão financeira", onClick: () => onNavigate?.("receivables", { target: "visao" }) },
          { label: "Caixa", onClick: () => onNavigate?.("receivables", { target: "caixa" }) },
          { label: "Contas a receber", onClick: () => onNavigate?.("receivables") },
          { label: "Categorias", icon: Tags, onClick: () => onNavigate?.("finance-categories") },
          { label: "Centros de custo", icon: Landmark, onClick: () => onNavigate?.("cost-centers") }
        ]}
        actionLabel="Nova conta a pagar"
        onAction={openNew}
      />
      <DataView
        rows={entries}
        defaultSort={{ key: "due_date", dir: "asc" }}
        searchPlaceholder="Buscar por descrição ou categoria"
        filterValues={listFilters}
        onFilterChange={setListFilters}
        filters={[
          { key: "period_from", label: "Período a partir de", type: "date", match: (item, value) => String(item.due_date || "").slice(0, 10) >= value },
          { key: "period_to", label: "Período até", type: "date", match: (item, value) => String(item.due_date || "").slice(0, 10) <= value },
          { key: "status", label: "Status", type: "select", options: statusOptions },
          { key: "category", label: "Categoria", type: "select", options: categories }
        ]}
        columns={[
          { key: "description", label: "Conta" },
          { key: "category", label: "Categoria", render: (item) => item.category || "—" },
          { key: "supplier_name", label: "Fornecedor", render: (item) => item.supplier_name || "—" },
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

    <Modal open={modalOpen} title={editing ? "Editar conta a pagar" : "Nova conta a pagar"} subtitle={editing ? "Altere somente esta parcela." : "Empréstimos e outras obrigações podem ser distribuídos automaticamente e ajustados linha a linha."} size="lg" onClose={() => setModalOpen(false)}
      footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" form="payable-form">Salvar conta</Button></>}>
      <form id="payable-form" onSubmit={save} className="stack">
        <div className="form-grid">
          <Input label="Descrição" value={form.description} onChange={(value) => setForm({ ...form, description: value })} required />
          <SelectWithCreate
            label="Categoria" value={form.category} onChange={(value) => setForm({ ...form, category: value })}
            options={asArray(categoryList).map((item) => ({ id: item.name, name: item.name }))}
            emptyLabel="Sem categoria" createTitle="Nova categoria" createLabel="Nome da categoria" onCreate={createCategory}
          />
          <Input type="number" label="Valor total" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} required />
          <Input type="date" label="Primeiro vencimento" value={String(form.due_date || "").slice(0, 10)} onChange={(value) => setForm({ ...form, due_date: value })} required />
          {!editing && <Input type="number" label="Parcelas" value={form.installment_count} onChange={(value) => setForm({ ...form, installment_count: value })} required />}
          {!editing && Number(form.installment_count || 1) === 1 && <Select label="Recorrência" value={form.recurrence} onChange={(value) => setForm({ ...form, recurrence: value })}><option value="">Sem recorrência</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></Select>}
          <SelectWithCreate
            label="Centro de custo" value={form.cost_center_id || ""} onChange={(value) => setForm({ ...form, cost_center_id: value })}
            options={asArray(centers)} emptyLabel="Sem centro" createTitle="Novo centro de custo" createLabel="Nome do centro de custo" onCreate={createCenter}
          />
          <SelectWithCreate
            label="Fornecedor" value={form.supplier_id || ""} onChange={(value) => setForm({ ...form, supplier_id: value })}
            options={asArray(supplierList)} emptyLabel="Sem fornecedor" createTitle="Novo fornecedor" createLabel="Nome do fornecedor" onCreate={createSupplier}
          />
          <PaymentSelect label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })} />
          <Input label="Conta ou caixa" value={form.payment_account || ""} onChange={(value) => setForm({ ...form, payment_account: value })} />
        </div>
        {!editing && (
          <InstallmentGrid
            total={form.amount}
            count={form.installment_count}
            firstDueDate={String(form.due_date || "").slice(0, 10)}
            paymentMethod={form.payment_method}
            installments={installments}
            onChange={setInstallments}
            automatic={automaticInstallments}
            onAutomaticChange={setAutomaticInstallments}
            title="Parcelas da conta a pagar"
          />
        )}
        <Textarea label="Observações (ex.: juros, número do contrato)" value={form.notes || ""} onChange={(notes) => setForm({ ...form, notes })} />
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
      <Textarea label="Justificativa obrigatória" required value={lifecycle.reason} onChange={(reason) => setLifecycle((current) => ({ ...current, reason }))} />
      {lifecycle.error && <span className="form-error">{lifecycle.error}</span>}
    </Modal>}
  </section>;
}
