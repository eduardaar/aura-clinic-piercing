// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useState } from "react";
import { Button, Input, Metric, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, DataTable } from "../../components/common/Crud";
import { Loading } from "../../components/common/Feedback";
import { asArray, formatDate } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { defaultSalesLine, defaultSalesOrderForm } from "../../lib/defaultForms";
import { currency, personName, saleItemLabel, saleOrderTypeLabel } from "../../features/shared/helpers";

export function SalesWorkspace() {
  const { data: orders, refresh: refreshOrders } = useFetch("/sales-orders");
  const { data: services } = useFetch("/services");
  const { data: procedures } = useFetch("/procedures");
  const { data: jewelry } = useFetch("/jewelry");
  const { data: appointments } = useFetch("/appointments");
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("produto");
  const [form, setForm] = useState(defaultSalesOrderForm());
  const [line, setLine] = useState(defaultSalesLine());
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const safeOrders = asArray(orders);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(jewelry);
  const safeAppointments = asArray(appointments);

  useEffect(() => {
    setLine((current) => ({ ...current, item_type: tab === "servico" ? "servico" : "produto" }));
  }, [tab]);

  useEffect(() => {
    if (safeJewelry.length && tab !== "servico" && !line.product_id) {
      setLine((current) => ({ ...current, product_id: String(safeJewelry[0].id), item_name: safeJewelry[0].name, unit_price: safeJewelry[0].sale_value || 0 }));
    }
  }, [safeJewelry.length]);

  useEffect(() => {
    if (safeServices.length && (tab === "servico" || tab === "ordem")) {
      setLine((current) => ({ ...current, service_id: String(safeServices[0].id), item_name: safeServices[0].name, unit_price: safeServices[0].base_price || safeServices[0].price || 0 }));
    }
  }, [safeServices.length, tab]);

  if (!orders || !services || !jewelry || !appointments) return <Loading />;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthOrders = safeOrders.filter((order) => String(order?.created_at || "").startsWith(currentMonth) && order?.status !== "cancelada");
  const summary = {
    total: monthOrders.reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    products: monthOrders.filter((order) => order.order_type === "produto").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    services: monthOrders.filter((order) => order.order_type === "servico").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    mixed: monthOrders.filter((order) => order.order_type === "ordem_servico").reduce((sum, order) => sum + Number(order.total_value || 0), 0)
  };

  function openNew() {
    setForm(defaultSalesOrderForm());
    setItems([]);
    setLine(defaultSalesLine());
    setTab("produto");
    setError("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function addLineItem() {
    const quantity = Math.max(1, Number(line.quantity || 1));
    const entry = line.item_type === "servico" ?
       safeServices.find((item) => String(item.id) === String(line.service_id))
      : safeJewelry.find((item) => String(item.id) === String(line.product_id));
    if (!entry) return;
    setItems((current) => [...current, {
      item_type: line.item_type,
      product_id: line.item_type === "produto" ? Number(entry.id) : null,
      service_id: line.item_type === "servico" ? Number(entry.id) : null,
      item_name: entry.name,
      quantity,
      product_variant_id: line.item_type === "produto" && line.product_variant_id ? Number(line.product_variant_id) : null,
      unit_price: Number(line.unit_price || entry.sale_value || entry.base_price || entry.price || 0),
      notes: line.notes || ""
    }]);
    setLine((current) => ({ ...current, quantity: 1, notes: "" }));
  }

  function removeLine(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveOrder(event) {
    event.preventDefault();
    setError("");
    if (!items.length) {
      setError("Adicione ao menos um item à venda.");
      return;
    }
    const response = await apiFetch("/sales-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        order_type: tab === "ordem" ? "ordem_servico" : tab,
        source: "interno",
        items
      })
    });
    if (!response.ok) {
      setError((await response.json()).error || "Não foi possível salvar a venda.");
      return;
    }
    setForm(defaultSalesOrderForm());
    setItems([]);
    setLine(defaultSalesLine());
    setTab("produto");
    setModalOpen(false);
    refreshOrders();
  }

  async function updateStatus(id, status) {
    await apiFetch(`/sales-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    refreshOrders();
  }

  return (
    <section className="sales-page stack">
      <div className="metric-grid">
        <Metric label="Vendas no mês" value={currency.format(summary.total)} />
        <Metric label="Produtos" value={currency.format(summary.products)} />
        <Metric label="Serviços" value={currency.format(summary.services)} />
        <Metric label="Ordens de serviço" value={currency.format(summary.mixed)} />
      </div>

      <div className="panel">
        <CrudHeader
          title="Vendas"
          subtitle="Pedidos internos com baixa financeira"
          actionLabel="Nova venda"
          onAction={openNew}
        />
        <DataTable
          rows={safeOrders}
          columns={[
            {
              key: "full_name",
              label: "Cliente",
              render: (order) => (
                <div>
                  <strong>{order.full_name}</strong>
                  <br />
                  <small>{asArray(order.items).map((item) => `${item.quantity}x ${item.item_name}`).join(" · ")}</small>
                </div>
              )
            },
            { key: "order_type", label: "Tipo", render: (order) => saleOrderTypeLabel(order.order_type) },
            { key: "total_value", label: "Valor", align: "right", render: (order) => currency.format(order.total_value || 0) },
            { key: "payment_method", label: "Pagamento", render: (order) => order.payment_method || "Pix" },
            {
              key: "status",
              label: "Status",
              render: (order) => (
                <StatusBadge status={order.status} tone={order.status === "cancelada" ? "danger" : order.status === "aberta" ? "warn" : "ok"} />
              )
            },
            { key: "created_at", label: "Data", render: (order) => formatDate(String(order.created_at || "").slice(0, 10)) }
          ]}
          actions={(order) => (
            <>
              <button type="button" onClick={() => updateStatus(order.id, "concluida")}>Concluir</button>
              <button type="button" onClick={() => updateStatus(order.id, "cancelada")}>Cancelar</button>
            </>
          )}
          empty="Nenhuma venda registrada ainda."
        />
      </div>

      <Modal
        open={modalOpen}
        title={tab === "ordem" ? "Nova ordem de serviço" : tab === "servico" ? "Venda de serviço" : "Venda de produto"}
        subtitle="Cadastro interno com baixa financeira"
        size="lg"
        onClose={closeModal}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeModal}>Cancelar</Button>
            <Button type="submit" form="sales-order-form" variant="primary">Salvar venda</Button>
          </>
        )}
      >
        <div className="customization-tabs sales-tabs">
          {[
            ["produto", "Venda de produto"],
            ["servico", "Venda de serviço"],
            ["ordem", "Ordem de serviço"]
          ].map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        <form id="sales-order-form" onSubmit={saveOrder}>
          <div className="form-grid">
            <Input label="Cliente" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
            <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
            <Select label="Agendamento vinculado" value={form.appointment_id} onChange={(value) => {
              const appointment = safeAppointments.find((item) => String(item.id) === String(value));
              setForm({
                ...form,
                appointment_id: value,
                full_name: appointment ? personName(appointment) : form.full_name,
                whatsapp: appointment?.whatsapp || form.whatsapp,
                instagram: appointment?.instagram || form.instagram
              });
            }}>
              <option value="">Sem vínculo</option>
              {safeAppointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {personName(appointment)} · {formatDate(appointment.appointment_date)} · {appointment.appointment_time}
                </option>
              ))}
            </Select>
            <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
              <option>Pix</option>
              <option>Dinheiro</option>
              <option>Cartão de crédito</option>
              <option>Cartão de débito</option>
            </Select>
            <Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
              <option value="concluida">concluída</option>
              <option value="aberta">aberta</option>
              <option value="cancelada">cancelada</option>
            </Select>
          </div>

          <div className="sales-line-builder">
            <div className="sales-line-header">
              <strong>{tab === "servico" ? "Selecionar serviço" : "Selecionar joia"}</strong>
              <span>Adicione os itens da venda.</span>
            </div>
            <div className="form-grid">
              <Select label="Tipo do item" value={line.item_type} onChange={(value) => setLine({ ...line, item_type: value })}>
                <option value="produto">produto</option>
                <option value="servico">serviço</option>
              </Select>
              {line.item_type === "servico" ? (
                <Select label="Serviço" value={line.service_id} onChange={(value) => {
                  const selected = safeServices.find((item) => String(item.id) === String(value));
                  setLine({
                    ...line,
                    service_id: value,
                    item_name: selected?.name || "",
                    unit_price: selected?.base_price || selected?.price || 0
                  });
                }}>
                  {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </Select>
              ) : (
                <Select label="Joia" value={line.product_id} onChange={(value) => {
                  const selected = safeJewelry.find((item) => String(item.id) === String(value));
                  setLine({
                    ...line,
                    product_id: value,
                    item_name: selected?.name || "",
                    unit_price: selected?.sale_value || 0
                  });
                }}>
                  {safeJewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              )}
              <Input type="number" label="Quantidade" value={line.quantity} onChange={(value) => setLine({ ...line, quantity: value })} />
              <Input type="number" label="Valor unitário" value={line.unit_price} onChange={(value) => setLine({ ...line, unit_price: value })} />
            </div>
            <label>Observações do item
              <textarea value={line.notes} onChange={(event) => setLine({ ...line, notes: event.target.value })} />
            </label>
            <Button variant="secondary" type="button" onClick={addLineItem}>Adicionar item</Button>
          </div>

          <div className="sales-items-list">
            {items.length ? items.map((item, index) => (
              <article key={`${item.item_name}-${index}`}>
                <div>
                  <strong>{item.item_name}</strong>
                  <span>{saleItemLabel(item.item_type)} · {item.quantity}x · {currency.format(item.unit_price)}</span>
                  {item.notes && <small>{item.notes}</small>}
                </div>
                <button type="button" onClick={() => removeLine(index)}>Remover</button>
              </article>
            )) : <p className="empty-state">Nenhum item adicionado ainda.</p>}
          </div>

          <label>Observações da venda
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
    </section>
  );
}
