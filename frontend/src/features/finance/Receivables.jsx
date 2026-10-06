import { useState } from "react";
import { Tags } from "lucide-react";
import { Button, Input, Metric, PaymentSelect, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { CollapsibleIndicators } from "../../components/common/CollapsibleIndicators";
import { ApiError, Loading } from "../../components/common/Feedback";
import { SelectWithCreate } from "../../components/common/SelectWithCreate";
import { apiFetch, readStoredSession, useApiInvalidate, useFetch } from "../../lib/api";
import { asArray, asNumber, asObject, localDateValue } from "../../lib/utils";
import { FINANCE_STATUS_LABELS, financeLabel } from "../../lib/financeLabels";
import { currency } from "../shared/helpers";
import { commissionAccess } from "./CommissionStatement";

function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

const distinctOptions = (rows, pick, label = (value) => value) =>
  [...new Set(rows.map(pick).filter(Boolean))].sort().map((value) => ({ value, label: label(value) }));

/** Lista operacional de recebíveis manuais e originados por vendas/serviços. */
export function AccountsReceivable({ onNavigate }) {
  const today = localDateValue(new Date());
  /** @type {[Record<string, any>, React.Dispatch<React.SetStateAction<Record<string, any>>>]} */
  const [listFilters, setListFilters] = useState({
    period_from: `${today.slice(0, 4)}-01-01`,
    period_to: `${Number(today.slice(0, 4)) + 1}-12-31`,
  });
  const query = new URLSearchParams({ from: listFilters.period_from || "", to: listFilters.period_to || "", date_field: "due_date" }).toString();
  const { data } = useFetch(`/finance/ledger?${query}`);
  const { data: categoryList } = useFetch("/finance/categories");
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/finance", "/dashboard", "/appointments", "/service-executions", "/clients", "/sales", "/sales-orders", "/reports", "/payments");

  async function createCategory(name) {
    const response = await apiFetch("/finance/categories", { method: "POST", body: JSON.stringify({ name }) });
    const created = await response.json().catch(() => null);
    invalidate("/finance/categories");
    return created?.name ? { id: created.name, name: created.name } : created;
  }

  /** @returns {Record<string, any>} */
  const initialForm = () => ({
    entry_type: "receivable",
    description: "",
    category: "",
    amount: "",
    paid_amount: 0,
    due_date: today,
    status: "pending",
    payment_method: "Pix",
    payment_account: "",
    installment_count: 1,
    notes: "",
  });
  const [form, setForm] = useState(initialForm);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [payment, setPayment] = useState(null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const ledger = asObject(data);
  const entries = asArray(ledger.entries).filter((item) => ["receivable", "income"].includes(item.entry_type));
  const statusOptions = distinctOptions(
    entries,
    (item) => item.status,
    (value) => FINANCE_STATUS_LABELS[value] || value,
  );
  const sourceOptions = distinctOptions(
    entries,
    (item) => item.source_type || "manual",
    (value) => financeLabel(value),
  );

  function openNew() {
    setForm(initialForm());
    setEditing(null);
    setError("");
    setModalOpen(true);
  }

  function openEdit(item) {
    const editableItem = { ...item };
    delete editableItem.cost_center_id;
    setForm({ ...initialForm(), ...editableItem, due_date: String(item.due_date || "").slice(0, 10), installment_count: 1 });
    setEditing(item);
    setError("");
    setModalOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(editing ? `/finance/entries/${editing.id}` : "/finance/entries", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify({ ...form, entry_type: "receivable" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível salvar a conta a receber.");
    setModalOpen(false);
    refresh();
  }

  async function registerPayment(event) {
    event.preventDefault();
    const { item, value } = payment;
    const response = await apiFetch(`/finance/entries/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        paid_amount: asNumber(item.paid_amount) + asNumber(value),
        payment_method: item.payment_method || "Pix",
      }),
    });
    if (!response.ok) return;
    setPayment(null);
    refresh();
  }

  async function openDetails(item) {
    setDetails({ loading: true, ...item });
    try {
      const response = await apiFetch(`/finance/entries/${item.id}/details`);
      const payload = await response.json().catch(() => ({}));
      setDetails((current) => current?.id === item.id ? response.ok ? payload : { ...item, error: payload.error || "Não foi possível abrir os detalhes." } : current);
    } catch {
      setDetails((current) => current?.id === item.id ? { ...item, error: "Sem conexão para abrir os detalhes. Tente novamente." } : current);
    }
  }

  return (
    <section className="stack finance-page">
      <CollapsibleIndicators screenId="finance-receivables"><div className="metric-grid">
        <Metric label="Em aberto" value={currency.format(asNumber(ledger.receivable))} />
        <Metric label="Recebido no período" value={currency.format(asNumber(ledger.cashflow?.received))} />
        <Metric label="Vencido" value={currency.format(asNumber(ledger.delinquency))} />
      </div></CollapsibleIndicators>
      <section className="panel stack">
        <CrudHeader
          title="Contas a receber"
          subtitle="Vendas integradas, serviços e lançamentos manuais"
          actions={[
            { label: "Visão financeira", onClick: () => onNavigate?.("receivables", { target: "visao" }) },
            { label: "Caixa", onClick: () => onNavigate?.("receivables", { target: "caixa" }) },
            // Contas a receber é a tela padrão do Financeiro: sem este atalho, o
            // extrato de comissões só aparecia em Visão financeira e Caixa.
            ...(commissionAccess(readStoredSession()?.user || {}).canView ? [{ label: "Comissões", onClick: () => onNavigate?.("receivables", { target: "comissoes" }) }] : []),
            { label: "Contas a pagar", onClick: () => onNavigate?.("payables") },
            { label: "Categorias", icon: Tags, onClick: () => onNavigate?.("finance-categories") },
            { label: "Centros de custo", onClick: () => onNavigate?.("cost-centers") }
          ]}
          actionLabel="Novo recebível"
          onAction={openNew}
        />
        <DataView
          rows={entries}
          defaultSort={{ key: "due_date", dir: "desc" }}
          searchPlaceholder="Buscar por venda, cliente, descrição ou categoria"
          filterValues={listFilters}
          onFilterChange={setListFilters}
          filters={[
            { key: "period_from", label: "Período a partir de", type: "date", match: (item, value) => String(item.due_date || "").slice(0, 10) >= value },
            { key: "period_to", label: "Período até", type: "date", match: (item, value) => String(item.due_date || "").slice(0, 10) <= value },
            { key: "status", label: "Status", type: "select", options: statusOptions },
            { key: "client_id", label: "Cliente", type: "select", options: entries.filter((item) => item.client_id).map((item) => ({ value: String(item.client_id), label: item.client_name })).filter((item, index, options) => options.findIndex((option) => option.value === item.value) === index) },
            { key: "professional_id", label: "Profissional", type: "select", options: entries.filter((item) => item.professional_id).map((item) => ({ value: String(item.professional_id), label: item.professional_name })).filter((item, index, options) => options.findIndex((option) => option.value === item.value) === index) },
            {
              key: "source_type",
              label: "Origem",
              type: "select",
              options: sourceOptions,
              match: (item, value) => (item.source_type || "manual") === value,
            },
          ]}
          columns={[
            { key: "description", label: "Recebível" },
            {
              key: "source_type",
              label: "Origem",
              value: (item) => [item.origin_label, item.client_name, item.professional_name, item.procedure, item.appointment_date, item.appointment_time, financeLabel(item.source_type || "manual")].filter(Boolean).join(" "),
              render: (item) => <div className="receivable-origin">
                <strong>{item.origin_label || financeLabel(item.source_type || "manual")}</strong>
                {item.client_name && <span>{item.client_name}</span>}
                {item.appointment_date && <small>{formatDateWithYear(item.appointment_date)} · {String(item.appointment_time || "").slice(0, 5)}</small>}
                {item.professional_name && <small>{item.professional_name}</small>}
                {item.procedure && <small>{item.procedure}</small>}
              </div>,
            },
            {
              key: "due_date",
              label: "Vencimento",
              value: (item) => String(item.due_date || "").slice(0, 10),
              render: (item) => formatDateWithYear(item.due_date),
            },
            {
              key: "installment",
              label: "Parcela",
              value: (item) => item.installment_number || 0,
              render: (item) =>
                item.installment_count > 1 ? `${item.installment_number}/${item.installment_count}` : "À vista",
            },
            {
              key: "amount",
              label: "Valor",
              align: "right",
              value: (item) => asNumber(item.amount),
              render: (item) => currency.format(asNumber(item.amount)),
            },
            {
              key: "balance",
              label: "Em aberto",
              align: "right",
              value: (item) => Math.max(0, asNumber(item.amount) - asNumber(item.paid_amount)),
              render: (item) => currency.format(Math.max(0, asNumber(item.amount) - asNumber(item.paid_amount))),
            },
            {
              key: "status",
              label: "Status",
              value: (item) => item.status || "",
              render: (item) => <StatusBadge status={item.status}>{financeLabel(item.status)}</StatusBadge>,
            },
          ]}
          actions={(item) => (
            <RowActions
              actions={[
                { label: "Detalhes", onClick: () => openDetails(item) },
                !["paid", "canceled", "refunded"].includes(item.status) && {
                  label: "Registrar recebimento",
                  onClick: () =>
                    setPayment({
                      item,
                      value: String(Math.max(0, asNumber(item.amount) - asNumber(item.paid_amount))),
                    }),
                },
                !item.source_key && { label: "Editar", onClick: () => openEdit(item) },
              ].filter(Boolean)}
            />
          )}
          empty="Nenhuma conta a receber no período."
        />
      </section>
      <Modal
        open={modalOpen}
        title={editing ? "Editar recebível" : "Novo recebível"}
        subtitle={editing ? "Altere apenas este lançamento." : "As parcelas são distribuídas mês a mês."}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="receivable-form">
              Salvar
            </Button>
          </>
        }
      >
        <form id="receivable-form" onSubmit={save} className="stack">
          <div className="form-grid">
            <Input
              label="Descrição"
              value={form.description}
              onChange={(value) => setForm({ ...form, description: value })}
              required
            />
            <SelectWithCreate
              label="Categoria"
              value={form.category}
              onChange={(value) => setForm({ ...form, category: value })}
              options={asArray(categoryList).map((item) => ({ id: item.name, name: item.name }))}
              emptyLabel="Sem categoria"
              createTitle="Nova categoria"
              createLabel="Nome da categoria"
              onCreate={createCategory}
            />
            <Input
              type="number"
              label="Valor total"
              value={form.amount}
              onChange={(value) => setForm({ ...form, amount: value })}
              required
            />
            <Input
              type="date"
              label="Primeiro vencimento"
              value={form.due_date}
              onChange={(value) => setForm({ ...form, due_date: value })}
              required
            />
            {!editing && (
              <Input
                type="number"
                min="1"
                label="Parcelas"
                value={form.installment_count}
                onChange={(value) => setForm({ ...form, installment_count: value })}
              />
            )}
            <PaymentSelect
              label="Forma de recebimento"
              value={form.payment_method}
              onChange={(value) => setForm({ ...form, payment_method: value })}
            />
            <Input
              label="Conta ou caixa"
              value={form.payment_account}
              onChange={(value) => setForm({ ...form, payment_account: value })}
            />
          </div>
          <Textarea label="Observações" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
      <Modal
        open={!!payment}
        title="Registrar recebimento"
        subtitle={payment?.item?.description}
        size="sm"
        onClose={() => setPayment(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayment(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="receivable-payment-form">
              Confirmar recebimento
            </Button>
          </>
        }
      >
        <form id="receivable-payment-form" onSubmit={registerPayment} className="stack">
          <Input
            type="number"
            label="Valor recebido"
            value={payment?.value ?? ""}
            onChange={(value) => setPayment((current) => ({ ...current, value }))}
            required
          />
          <p className="empty-state">
            Em aberto:{" "}
            {currency.format(Math.max(0, asNumber(payment?.item?.amount) - asNumber(payment?.item?.paid_amount)))}.
          </p>
        </form>
      </Modal>
      <Modal open={!!details} title="Detalhes do recebível" onClose={() => setDetails(null)}>
        {details?.loading ? (
          <Loading />
        ) : (
          <div className="stack">
            {details?.error && <span className="form-error">{details.error}</span>}
            <div className="form-grid receivable-detail-grid">
              <div>
                <small>Descrição</small>
                <strong>{details?.description}</strong>
              </div>
              <div>
                <small>Origem</small>
                <strong>{details?.origin?.label || details?.origin_label || financeLabel(details?.source_type || "manual")}</strong>
              </div>
              <div>
                <small>Valor</small>
                <strong>{currency.format(asNumber(details?.amount))}</strong>
              </div>
              <div>
                <small>Recebido</small>
                <strong>{currency.format(asNumber(details?.paid_amount))}</strong>
              </div>
              <div>
                <small>Forma</small>
                <strong>{details?.payment_method || "Não informada"}</strong>
              </div>
              <div>
                <small>Vencimento</small>
                <strong>{formatDateWithYear(details?.due_date)}</strong>
              </div>
            </div>
            {details?.origin && <ReceivableOrigin origin={details.origin} />}
          </div>
        )}
      </Modal>
    </section>
  );
}

function ReceivableOrigin({ origin }) {
  return <section className="stack" aria-label="Origem do recebível">
    <h3>Operação de origem</h3>
    <div className="form-grid receivable-detail-grid">
      <div><small>Cliente</small><strong>{origin.client || "Não informado"}</strong></div>
      <div><small>Data e horário</small><strong>{[formatDateWithYear(origin.date), String(origin.time || "").slice(0, 5)].filter(Boolean).join(" · ") || "Não informado"}</strong></div>
      <div><small>Profissional responsável</small><strong>{origin.professional || "Não se aplica"}</strong></div>
      <div><small>Procedimento/serviço</small><strong>{origin.procedure || asArray(origin.items).map((item) => item.service).filter(Boolean).join(", ") || "Não se aplica"}</strong></div>
      <div><small>Total da operação</small><strong>{currency.format(asNumber(origin.total_value))}</strong></div>
      <div><small>Sinal efetivamente pago</small><strong>{currency.format(asNumber(origin.deposit_paid))}</strong></div>
      <div><small>Outros recebimentos</small><strong>{currency.format(asNumber(origin.other_paid))}</strong></div>
      <div><small>Crédito aplicado</small><strong>{currency.format(asNumber(origin.credit_applied))}</strong></div>
      <div><small>Valor restante da operação</small><strong>{currency.format(asNumber(origin.remaining_value))}</strong></div>
    </div>
    {asArray(origin.items).length > 0 && <div className="stack"><h4>Serviços e produtos/joias</h4>{origin.items.map((item) => <div key={item.id}>{[item.service, item.product, item.region].filter(Boolean).join(" · ")} · {item.quantity} un.</div>)}</div>}
    <DataView rows={asArray(origin.payments)} searchable={false} paginated={false} caption="Pagamentos da operação" columns={[
      { key: "payment_type", label: "Pagamento", render: (item) => financeLabel(item.payment_type) },
      { key: "method", label: "Forma" },
      { key: "status", label: "Status", render: (item) => <StatusBadge status={item.status}>{financeLabel(item.status)}</StatusBadge> },
      { key: "amount", label: "Valor", align: "right", render: (item) => currency.format(asNumber(item.amount)) },
      { key: "paid_at", label: "Data", render: (item) => formatDateWithYear(item.paid_at) }
    ]} empty="Nenhum pagamento registrado na operação." />
    {asArray(origin.receivables).length > 0 && <DataView rows={origin.receivables} searchable={false} paginated={false} caption="Parcelas da operação" columns={[
      { key: "installment_number", label: "Parcela", render: (item) => `${item.installment_number}/${item.installment_count}` },
      { key: "due_date", label: "Vencimento", render: (item) => formatDateWithYear(item.due_date) },
      { key: "paid_amount", label: "Recebido no Financeiro", align: "right", render: (item) => currency.format(asNumber(item.paid_amount)) },
      { key: "status", label: "Status", render: (item) => <StatusBadge status={item.status}>{financeLabel(item.status)}</StatusBadge> }
    ]} />}
    <a className="secondary-button" href={origin.href}>Abrir {origin.type === "appointment" ? "atendimento" : "venda"} de origem</a>
  </section>;
}
