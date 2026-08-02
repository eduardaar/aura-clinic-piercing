// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useEffect, useState } from "react";
import { Button, Input, Metric, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { asArray, formatDate } from "../../lib/utils";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { defaultSalesLine, defaultSalesOrderForm } from "../../lib/defaultForms";
import { currency, personName, saleItemLabel, saleOrderTypeLabel } from "../../features/shared/helpers";
import { SmartCombobox } from "../../components/common/SmartCombobox";

// `formatDate` de lib/utils devolve dd/MM sem ano: numa lista com histórico de
// vários anos duas vendas distantes ficariam idênticas na coluna.
function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

const ORDER_STATUS_LABELS = { concluida: "concluída", aberta: "aberta", cancelada: "cancelada" };

// Opções vindas dos próprios pedidos: nenhum filtro oferecido devolve lista vazia.
const distinctOptions = (rows, pick, label = (value) => value) =>
  [...new Set(rows.map(pick).filter(Boolean))].sort().map((value) => ({ value, label: label(value) }));

const orderItemsLabel = (order) =>
  asArray(order.items).map((item) => `${item.quantity}x ${item.item_name}`).join(" · ");

export function SalesWorkspace() {
  const { data: orders, loading: ordersLoading, error: ordersError } = useFetch("/sales-orders");
  const { data: services } = useFetch("/services");
  const { data: jewelry } = useFetch("/jewelry");
  const { data: appointments } = useFetch("/appointments");
  // Uma venda dá baixa no estoque e lança no financeiro: invalidar só a lista
  // de pedidos deixaria as outras telas mostrando o saldo anterior.
  const invalidate = useApiInvalidate();
  const refreshOrders = () => invalidate("/sales-orders", "/jewelry", "/finance", "/dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("produto");
  const [form, setForm] = useState(defaultSalesOrderForm());
  const [line, setLine] = useState(defaultSalesLine());
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [priceQuote, setPriceQuote] = useState(null);
  const [couponMessage, setCouponMessage] = useState("");
  const safeOrders = asArray(orders);
  const safeServices = asArray(services);
  const safeJewelry = asArray(jewelry);
  const safeAppointments = asArray(appointments);
  const statusOptions = distinctOptions(safeOrders, (order) => order.status, (value) => ORDER_STATUS_LABELS[value] || value);
  const typeOptions = distinctOptions(safeOrders, (order) => order.order_type, saleOrderTypeLabel);
  const paymentOptions = [...new Set(safeOrders.map((order) => order.payment_method || "Pix"))].sort();
  const selectedProduct = safeJewelry.find((item) => String(item.id) === String(line.product_id));
  const selectedVariants = asArray(selectedProduct?.variants).filter((variant) => Number(variant.is_active ?? 1));

  useEffect(() => {
    setLine((current) => ({ ...current, item_type: tab === "servico" ? "servico" : "produto" }));
  }, [tab]);

  useEffect(() => {
    if (safeJewelry.length && tab !== "servico" && !line.product_id) {
      const firstVariant = asArray(safeJewelry[0].variants).find((variant) => Number(variant.quantity || 0) > 0) || asArray(safeJewelry[0].variants)[0];
      setLine((current) => ({
        ...current,
        product_id: String(safeJewelry[0].id),
        product_variant_id: firstVariant?.id ? String(firstVariant.id) : "",
        item_name: safeJewelry[0].name,
        unit_price: firstVariant?.sale_value || safeJewelry[0].sale_value || 0
      }));
    }
  }, [safeJewelry.length]);

  useEffect(() => {
    if (safeServices.length && (tab === "servico" || tab === "ordem")) {
      setLine((current) => ({ ...current, service_id: String(safeServices[0].id), item_name: safeServices[0].name, unit_price: safeServices[0].base_price || safeServices[0].price || 0 }));
    }
  }, [safeServices.length, tab]);

  // A lista carrega sozinha: só a tabela espera pelos pedidos, o resto da tela
  // (métricas e modal de cadastro) não fica bloqueado pelos outros fetches.
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
    const variant = line.item_type === "produto"
      ? asArray(entry.variants).find((item) => String(item.id) === String(line.product_variant_id))
      : null;
    if (line.item_type === "produto" && variant && quantity > Number(variant.quantity || 0)) {
      setError("Quantidade maior que o estoque disponivel da variacao.");
      return;
    }
    setItems((current) => [...current, {
      item_type: line.item_type,
      product_id: line.item_type === "produto" ? Number(entry.id) : null,
      service_id: line.item_type === "servico" ? Number(entry.id) : null,
      item_name: variant ? `${entry.name} - ${variant.variation_name || variant.sku}` : entry.name,
      quantity,
      product_variant_id: variant ? Number(variant.id) : null,
      unit_price: Number(line.unit_price || variant?.sale_value || entry.sale_value || entry.base_price || entry.price || 0),
      notes: line.notes || ""
    }]);
    setLine((current) => ({ ...current, quantity: 1, notes: "" }));
  }

  function removeLine(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setPriceQuote(null);
  }

  const productSubtotal = items.filter((item) => item.item_type === "produto").reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
  const serviceSubtotal = items.filter((item) => item.item_type === "servico").reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
  const saleSubtotal = productSubtotal + serviceSubtotal;
  const saleTotal = priceQuote?.valid ? Number(priceQuote.final_amount) : saleSubtotal;

  async function applyCoupon() {
    setError(""); setCouponMessage("");
    const response = await apiFetch("/catalog/price-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coupon_code: form.coupon_code, items }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setPriceQuote(null); setError(payload.error || "Cupom inválido ou não aplicável."); return; }
    setPriceQuote(payload); setCouponMessage("Cupom aplicado com sucesso.");
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
        <DataView
          rows={safeOrders}
          loading={ordersLoading}
          error={ordersError}
          defaultSort={{ key: "created_at", dir: "desc" }}
          searchPlaceholder="Buscar por cliente, item, SKU, pagamento ou status"
          filters={[
            { key: "status", label: "Status", type: "select", options: statusOptions },
            { key: "order_type", label: "Tipo de pedido", type: "select", options: typeOptions },
            {
              key: "payment_method",
              label: "Forma de pagamento",
              type: "select",
              options: paymentOptions,
              match: (order, value) => (order.payment_method || "Pix") === value
            },
            {
              key: "from",
              label: "Data inicial",
              type: "date",
              match: (order, value) => String(order.created_at || "").slice(0, 10) >= value
            },
            {
              key: "to",
              label: "Data final",
              type: "date",
              match: (order, value) => String(order.created_at || "").slice(0, 10) <= value
            }
          ]}
          columns={[
            {
              key: "full_name",
              label: "Cliente",
              // Inclui itens e SKU no valor de busca, como fazia a busca própria da tela.
              value: (order) => `${order.full_name || ""} ${asArray(order.items).map((item) => `${item.item_name} ${item.sku || ""}`).join(" ")}`,
              render: (order) => (
                <div>
                  <strong>{order.full_name}</strong>
                  <br />
                  <small>{orderItemsLabel(order)}</small>
                </div>
              )
            },
            { key: "order_type", label: "Tipo", value: (order) => saleOrderTypeLabel(order.order_type), render: (order) => saleOrderTypeLabel(order.order_type) },
            { key: "total_value", label: "Valor", align: "right", value: (order) => Number(order.total_value || 0), render: (order) => currency.format(order.total_value || 0) },
            { key: "payment_method", label: "Pagamento", value: (order) => order.payment_method || "Pix", render: (order) => order.payment_method || "Pix" },
            {
              key: "status",
              label: "Status",
              value: (order) => order.status || "",
              render: (order) => (
                <StatusBadge status={order.status} tone={order.status === "cancelada" ? "danger" : order.status === "aberta" ? "warn" : "ok"} />
              )
            },
            {
              key: "created_at",
              label: "Data",
              value: (order) => String(order.created_at || "").slice(0, 10),
              render: (order) => formatDateWithYear(order.created_at)
            }
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
                <SmartCombobox label="Joia" value={line.product_id} options={safeJewelry} onChange={(value) => {
                  const selected = safeJewelry.find((item) => String(item.id) === String(value));
                  const firstVariant = asArray(selected?.variants).find((variant) => Number(variant.quantity || 0) > 0) || asArray(selected?.variants)[0];
                  setLine({
                    ...line,
                    product_id: value,
                    product_variant_id: firstVariant?.id ? String(firstVariant.id) : "",
                    item_name: selected?.name || "",
                    unit_price: firstVariant?.sale_value || selected?.sale_value || 0
                  });
                }} getMeta={(item) => [item.category, item.material, item.sku].filter(Boolean).join(" · ")} isDisabled={(item) => asArray(item.variants).length ? !asArray(item.variants).some((variant) => Number(variant.quantity || 0) > 0) : Number(item.inventory_quantity ?? item.quantity ?? 0) <= 0} />
              )}
              {line.item_type === "produto" && (
                <Select label="Variação" value={line.product_variant_id} onChange={(value) => {
                  const variant = selectedVariants.find((item) => String(item.id) === String(value));
                  setLine({
                    ...line,
                    product_variant_id: value,
                    unit_price: variant?.sale_value || selectedProduct?.sale_value || line.unit_price
                  });
                }}>
                  <option value="">Sem variação</option>
                  {selectedVariants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.variation_name || variant.sku} - {variant.quantity || 0} un
                    </option>
                  ))}
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
          <div className="soft-card sales-financial-summary">
            <strong>Resumo financeiro</strong>
            <span>Produtos <b>{currency.format(productSubtotal)}</b></span>
            <span>Serviços <b>{currency.format(serviceSubtotal)}</b></span>
            <span>Subtotal <b>{currency.format(saleSubtotal)}</b></span>
            {priceQuote?.promotion_discount > 0 && <span>Promoções <b>−{currency.format(priceQuote.promotion_discount)}</b></span>}
            {priceQuote?.coupon_discount > 0 && <span>Cupom <b>−{currency.format(priceQuote.coupon_discount)}</b></span>}
            <span className="total">Total final <b>{currency.format(saleTotal)}</b></span>
          </div>
          <div className="catalog-coupon-field">
            <Input label="Cupom" value={form.coupon_code || ""} onChange={(value) => { setForm({ ...form, coupon_code: value.toUpperCase() }); setPriceQuote(null); setCouponMessage(""); }} />
            <Button type="button" variant="secondary" onClick={applyCoupon} disabled={!form.coupon_code?.trim() || !items.length}>Aplicar cupom</Button>
            {priceQuote && <Button type="button" variant="secondary" onClick={() => { setForm({ ...form, coupon_code: "" }); setPriceQuote(null); setCouponMessage(""); }}>Remover</Button>}
          </div>
          {couponMessage && <span className="form-success">{couponMessage}</span>}

          <label>Observações da venda
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
    </section>
  );
}
