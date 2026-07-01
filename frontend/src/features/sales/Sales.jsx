// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useState } from "react";
import { Instagram } from "lucide-react";
import { Input, Metric, Select } from "../../components/common/Ui";
import { Loading } from "../../components/common/Feedback";
import { asArray, formatDate } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { defaultSalesLine, defaultSalesOrderForm } from "../../lib/defaultForms";
import { currency, saleItemLabel, saleOrderTypeLabel } from "../../features/shared/helpers";

export function SalesWorkspace() {
  const { data: orders, refresh: refreshOrders } = useFetch("/sales-orders");
  const { data: services } = useFetch("/services");
  const { data: procedures } = useFetch("/procedures");
  const { data: jewelry } = useFetch("/jewelry");
  const { data: appointments } = useFetch("/appointments");
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
      unit_price: Number(line.unit_price || entry.sale_value || entry.price || 0),
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

      <div className="customization-tabs sales-tabs">
        {[
          ["produto", "Venda de produto"],
          ["servico", "Venda de serviço"],
          ["ordem", "Ordem de serviço"],
          ["historico", "Histórico"]
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab !== "historico" && (
        <div className="split-layout">
          <form className="panel appointment-form" onSubmit={saveOrder}>
            <div className="panel-heading">
              <h2>{tab === "ordem" ? "Nova ordem de serviço" : tab === "servico" ? "Venda de serviço" : "Venda de produto"}</h2>
              <span>Cadastro interno com baixa financeira</span>
            </div>
            <div className="form-grid">
              <Input label="Cliente" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
              <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
              <Select label="Agendamento vinculado" value={form.appointment_id} onChange={(value) => setForm({ ...form, appointment_id: value })}>
                <option value="">Sem vínculo</option>
                {safeAppointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.full_name} · {formatDate(appointment.appointment_date)} · {appointment.appointment_time}
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
                      unit_price: selected?.price || 0
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
              <button className="secondary-button" type="button" onClick={addLineItem}>Adicionar item</button>
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
            <button className="primary-button">Salvar venda</button>
          </form>

          <div className="panel">
            <div className="panel-heading">
              <h2>Atalhos e referência</h2>
              <span>{safeAppointments.length} agendamentos disponíveis</span>
            </div>
            <div className="sales-quick-reference">
              <div>
                <strong>Produtos</strong>
                <small>Venda direta de joia, com baixa simples de estoque.</small>
              </div>
              <div>
                <strong>Serviços</strong>
                <small>Venda de procedimento avulso, sem depender de agenda.</small>
              </div>
              <div>
                <strong>Ordens de serviço</strong>
                <small>Registro interno com vínculo ao atendimento ou cliente.</small>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "historico" && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Histórico de vendas</h2>
            <span>Pedidos do mês com status e valor</span>
          </div>
          <div className="sales-history-list">
            {safeOrders.map((order) => (
              <article key={order.id} className="sales-history-row">
                <div>
                  <strong>{order.full_name}</strong>
                  <span>{saleOrderTypeLabel(order.order_type)} · {order.source} · {formatDate(order.created_at.slice(0, 10))}</span>
                  <small>{asArray(order.items).map((item) => `${item.quantity}x ${item.item_name}`).join(" · ")}</small>
                </div>
                <div className="sales-history-money">
                  <strong>{currency.format(order.total_value || 0)}</strong>
                  <span>{order.payment_method || "Pix"}</span>
                </div>
                <div className="sales-history-actions">
                  <span className={`status-badge ${order.status === "cancelada" ? "status-cancelado" : order.status === "aberta" ? "status-pendente" : "status-atendido"}`}>{order.status}</span>
                  <button type="button" onClick={() => updateStatus(order.id, "concluida")}>Concluir</button>
                  <button type="button" onClick={() => updateStatus(order.id, "cancelada")}>Cancelar</button>
                </div>
              </article>
            ))}
            {!safeOrders.length && <p className="empty-state">Nenhuma venda registrada ainda.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

