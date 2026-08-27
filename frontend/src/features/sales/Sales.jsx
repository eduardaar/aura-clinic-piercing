// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useState } from "react";
import { Button, FinancialSummary, Input, Metric, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { Modal, CrudHeader, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { InstallmentGrid } from "../../components/common/InstallmentGrid";
import { Loading } from "../../components/common/Feedback";
import { asArray, formatDate } from "../../lib/utils";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { defaultSalesLine, defaultSalesOrderForm } from "../../lib/defaultForms";
import { installmentSummary, installmentsForPayload } from "../../lib/installments";
import { currency, personName, saleItemLabel, saleOrderTypeLabel, saleSourceLabel } from "../../features/shared/helpers";
import { SmartCombobox } from "../../components/common/SmartCombobox";
import { PlanUpgradeNotice } from "../../components/common/PlanUpgradeNotice";
import { planAllowsAction } from "../../lib/permissions";

// `formatDate` de lib/utils devolve dd/MM sem ano: numa lista com histórico de
// vários anos duas vendas distantes ficariam idênticas na coluna.
function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

const ORDER_STATUS_LABELS = {
  concluida: "concluída",
  aberta: "aberta",
  cancelado: "cancelada",
  // Compatibilidade visual com vendas antigas gravadas antes da padronização.
  cancelada: "cancelada"
};

// Opções vindas dos próprios pedidos: nenhum filtro oferecido devolve lista vazia.
const distinctOptions = (rows, pick, label = (value) => value) =>
  [...new Set(rows.map(pick).filter(Boolean))].sort().map((value) => ({ value, label: label(value) }));

const orderItemsLabel = (order) =>
  asArray(order.items).map((item) => `${item.quantity}x ${item.item_name}`).join(" · ");

export function SalesWorkspace({ features = [], onUpgrade }) {
  const { data: orders, loading: ordersLoading, error: ordersError } = useFetch("/sales-orders");
  const { data: jewelry } = useFetch("/jewelry");
  // Uma venda dá baixa no estoque e lança no financeiro: invalidar só a lista
  // de pedidos deixaria as outras telas mostrando o saldo anterior.
  const invalidate = useApiInvalidate();
  const refreshOrders = () => invalidate("/sales-orders", "/jewelry", "/finance", "/dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(defaultSalesOrderForm());
  const [line, setLine] = useState(defaultSalesLine());
  const [items, setItems] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [automaticInstallments, setAutomaticInstallments] = useState(true);
  const [error, setError] = useState("");
  const [priceQuote, setPriceQuote] = useState(null);
  const [couponMessage, setCouponMessage] = useState("");
  const [details, setDetails] = useState(null);
  const canGenerateReceivables = planAllowsAction(features, "sales.generate_receivables");
  const safeOrders = asArray(orders);
  const safeJewelry = asArray(jewelry);
  const statusOptions = distinctOptions(safeOrders, (order) => order.status, (value) => ORDER_STATUS_LABELS[value] || value);
  const typeOptions = distinctOptions(safeOrders, (order) => order.order_type, saleOrderTypeLabel);
  const sourceOptions = distinctOptions(safeOrders, (order) => order.source, saleSourceLabel);
  const paymentOptions = [...new Set(safeOrders.map((order) => order.payment_method || "Pix"))].sort();
  const selectedProduct = safeJewelry.find((item) => String(item.id) === String(line.product_id));
  const selectedVariants = asArray(selectedProduct?.variants).filter((variant) => Number(variant.is_active ?? 1));
  // Espelha a regra de baixa do backend (`resolveStockTarget` em services/sales.js):
  // sem variação escolhida a venda debita a primeira variação ativa com saldo e,
  // se o produto não tem variação nenhuma, debita o saldo do próprio produto.
  const stockVariant = line.product_variant_id
    ? selectedVariants.find((variant) => String(variant.id) === String(line.product_variant_id)) || null
    : selectedVariants.find((variant) => Number(variant.quantity || 0) > 0) || null;
  const stockKey = stockVariant ? `variant:${stockVariant.id}` : `product:${line.product_id}`;
  // O que já está no carrinho conta contra o mesmo saldo: duas linhas de 2 un.
  // sobre um estoque de 3 são recusadas pelo backend, então a tela também soma.
  const reservedInCart = items
    .filter((item) => item.item_type === "produto" && item.stock_key === stockKey)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const productStock = stockVariant
    ? Number(stockVariant.quantity || 0)
    : Number(selectedProduct?.inventory_quantity ?? selectedProduct?.quantity ?? 0);
  // Saldo que a PRÓXIMA linha ainda pode consumir. `null` quando a pergunta não
  // faz sentido (serviço, ou nenhuma joia escolhida ainda).
  const availableQuantity = line.item_type === "produto" && selectedProduct
    ? Math.max(0, productStock - reservedInCart)
    : null;
  const requestedQuantity = Math.max(1, Number(line.quantity || 1));
  const exceedsStock = availableQuantity !== null && requestedQuantity > availableQuantity;
  function addSelectedJewelry(product) {
    const variant = asArray(product?.variants).find((option) => Number(option.quantity || 0) > 0) || asArray(product?.variants)[0];
    const unitPrice = Number(variant?.sale_value || product?.sale_value || 0);
    const availableStock = variant ? Number(variant.quantity || 0) : Number(product?.inventory_quantity ?? product?.quantity ?? 0);
    setLine({ ...defaultSalesLine(), item_type: "produto", product_id: String(product.id), product_variant_id: variant?.id ? String(variant.id) : "", item_name: product.name, unit_price: unitPrice });
    setItems((current) => [...current, {
      item_type: "produto", product_id: Number(product.id), service_id: null,
      item_name: variant ? `${product.name} - ${variant.variation_name || variant.sku}` : product.name,
      quantity: 1, product_variant_id: variant ? Number(variant.id) : null,
      variation_name: variant?.variation_name || variant?.sku || "",
      stock_key: variant ? `variant:${variant.id}` : `product:${product.id}`,
      available_stock: availableStock, unit_price: unitPrice, notes: ""
    }]);
    setPriceQuote(null);
    setError("");
  }

  // A lista carrega sozinha: só a tabela espera pelos pedidos, o resto da tela
  // (métricas e modal de cadastro) não fica bloqueado pelos outros fetches.
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthOrders = safeOrders.filter(
    (order) =>
      String(order?.created_at || "").startsWith(currentMonth) &&
      !["cancelado", "cancelada"].includes(order?.status)
  );
  const summary = {
    total: monthOrders.reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    products: monthOrders.filter((order) => order.order_type === "produto").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    // "mista" é a venda de balcão com produto e serviço no mesmo pedido — não
    // confundir com "ordem_servico" (agenda), que aparece no total mas tem
    // card próprio abaixo.
    legacyMixed: monthOrders.filter((order) => order.order_type === "mista").reduce((sum, order) => sum + Number(order.total_value || 0), 0),
    legacyAgenda: monthOrders.filter((order) => order.order_type === "ordem_servico").reduce((sum, order) => sum + Number(order.total_value || 0), 0)
  };

  function openNew() {
    setForm(defaultSalesOrderForm());
    setItems([]);
    setInstallments([]);
    setAutomaticInstallments(true);
    setLine(defaultSalesLine());
    setError("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function addLineItem() {
    const quantity = Math.max(1, Number(line.quantity || 1));
    const entry = safeJewelry.find((item) => String(item.id) === String(line.product_id));
    if (!entry) return;
    // A variação usada é a MESMA que o backend vai debitar (inclusive quando o
    // caixa deixou "Sem variação"): é o que faz o aviso da tela e a recusa do
    // servidor falarem do mesmo saldo.
    const variant = stockVariant;
    // Produto sem variação nenhuma nunca passava por checagem: era exatamente
    // por aí que 50 unidades de um estoque de 3 entravam na venda.
    if (availableQuantity !== null && quantity > availableQuantity) {
      setError(`Estoque insuficiente para ${entry.name}: ${availableQuantity} un. disponível(is)${reservedInCart ? ` (${reservedInCart} un. já nesta venda)` : ""}.`);
      return;
    }
    setError("");
    setItems((current) => [...current, {
      item_type: "produto",
      product_id: Number(entry.id),
      service_id: null,
      item_name: variant ? `${entry.name} - ${variant.variation_name || variant.sku}` : entry.name,
      quantity,
      product_variant_id: variant ? Number(variant.id) : null,
      // Só para a tela somar o que já foi adicionado contra o mesmo saldo; o
      // backend ignora campos que não conhece.
      stock_key: stockKey,
      unit_price: Number(line.unit_price || variant?.sale_value || entry.sale_value || 0),
      notes: line.notes || ""
    }]);
    setLine((current) => ({ ...current, quantity: 1, notes: "" }));
  }

  function removeLine(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setPriceQuote(null);
  }

  const productSubtotal = items.filter((item) => item.item_type === "produto").reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
  const serviceSubtotal = 0;
  const saleSubtotal = productSubtotal;
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
    if (form.receivable_mode === "pending" && !canGenerateReceivables) {
      setError("Gerar contas a receber exige o plano Profissional. Registre a venda como recebida agora ou faça o upgrade.");
      return;
    }
    if (form.receivable_mode === "pending") {
      const schedule = installmentSummary(saleTotal, installments, form.installment_count);
      if (!schedule.isValid) {
        setError("Revise as parcelas: a soma deve coincidir com o total da venda e todos os campos são obrigatórios.");
        return;
      }
    }
    const response = await apiFetch("/sales-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        order_type: "produto",
        source: "interno",
        installments: form.receivable_mode === "pending" ? installmentsForPayload(installments) : [],
        items
      })
    });
    if (!response.ok) {
      setError((await response.json()).error || "Não foi possível salvar a venda.");
      return;
    }
    setForm(defaultSalesOrderForm());
    setItems([]);
    setInstallments([]);
    setAutomaticInstallments(true);
    setLine(defaultSalesLine());
    setModalOpen(false);
    refreshOrders();
  }

  async function updateStatus(order, status) {
    setError("");
    const orderInstallments = asArray(order.installments);
    const response = await apiFetch(`/sales-orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        payment_method: order.payment_method || "Pix",
        receivable_mode: order.receivable_mode || "paid",
        installment_count: Number(order.installment_count || 1),
        first_due_date: order.first_due_date || String(order.created_at || new Date().toISOString()).slice(0, 10),
        ...(orderInstallments.length ? { installments: installmentsForPayload(orderInstallments) } : {})
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || "Não foi possível atualizar a venda.");
      return;
    }
    refreshOrders();
  }

  async function openDetails(order) {
    setDetails({ ...order, loading: true });
    const response = await apiFetch(`/sales-orders/${order.id}`);
    const payload = await response.json().catch(() => ({}));
    setDetails(response.ok ? payload : { ...order, error: payload.error || "Não foi possível abrir a venda." });
  }

  return (
    <section className="sales-page stack">
      <div className="metric-grid">
        <Metric label="Vendas no mês" value={currency.format(summary.total)} />
        <Metric label="Produtos" value={currency.format(summary.products)} />
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
              key: "source",
              label: "Origem",
              type: "select",
              options: sourceOptions,
              match: (order, value) => saleSourceLabel(order.source) === value
            },
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
            {
              key: "source",
              label: "Origem",
              value: (order) => saleSourceLabel(order.source),
              render: (order) => (
                <StatusBadge
                  status={saleSourceLabel(order.source)}
                  tone={order.source === "agenda" ? "info" : order.source === "site" ? "ok" : "neutral"}
                />
              )
            },
            { key: "total_value", label: "Valor", align: "right", value: (order) => Number(order.total_value || 0), render: (order) => currency.format(order.total_value || 0) },
            { key: "payment_method", label: "Pagamento", value: (order) => order.payment_method || "Pix", render: (order) => order.payment_method || "Pix" },
            {
              key: "installment_count",
              label: "Recebimento",
              value: (order) => Number(order.installment_count || asArray(order.receivables).length || 1),
              render: (order) =>
                order.receivable_mode === "pending"
                  ? `${Number(order.installment_count || asArray(order.receivables).length || 1)} parcela(s)`
                  : "Recebido agora"
            },
            {
              key: "status",
              label: "Status",
              value: (order) => order.status || "",
              render: (order) => (
                <StatusBadge status={order.status} tone={["cancelado", "cancelada"].includes(order.status) ? "danger" : order.status === "aberta" ? "warn" : "ok"} />
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
            <RowActions actions={[
              { label: "Detalhes", onClick: () => openDetails(order) },
              ["pendente", "aberta"].includes(order.status) && order.source !== "agenda" && {
                label: "Concluir", onClick: () => updateStatus(order, "concluida")
              },
              !["cancelado", "cancelada"].includes(order.status) && order.source !== "agenda" &&
                !Number(order.stock_deducted || 0) && !Number(order.paid_value || 0) && {
                label: "Cancelar", onClick: () => updateStatus(order, "cancelado"), danger: true
              }
            ].filter(Boolean)} />
          )}
          empty="Nenhuma venda registrada ainda."
        />
      </div>

      <Modal
        open={modalOpen}
        title="Venda de produto"
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
        <form id="sales-order-form" onSubmit={saveOrder}>
          <div className="form-grid">
            <Input label="Cliente" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
            <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
            <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
              <option>Pix</option>
              <option>Dinheiro</option>
              <option>Cartão de crédito</option>
              <option>Cartão de débito</option>
            </Select>
            <Select label="Recebimento" value={form.receivable_mode} onChange={(value) => setForm({ ...form, receivable_mode: value })}>
              <option value="paid">Recebido agora</option>
              <option value="pending" disabled={!canGenerateReceivables}>Gerar contas a receber{canGenerateReceivables ? "" : " — Profissional"}</option>
            </Select>
            {form.receivable_mode === "pending" && <>
              <Input type="number" min="1" max="120" label="Parcelas" value={form.installment_count} onChange={(value) => setForm({ ...form, installment_count: value })} required />
              <Input type="date" label="Primeiro vencimento" value={form.first_due_date} onChange={(value) => setForm({ ...form, first_due_date: value })} required />
            </>}
            <Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
              <option value="concluida">concluída</option>
              <option value="aberta">aberta</option>
              <option value="cancelado">cancelada</option>
            </Select>
          </div>

          {!canGenerateReceivables && (
            <PlanUpgradeNotice title="Contas a receber no plano Profissional" onUpgrade={onUpgrade}>
              A venda e o pagamento imediato continuam disponíveis no Start. O upgrade libera vencimentos e parcelamento em contas a receber.
            </PlanUpgradeNotice>
          )}

          <div className="sales-line-builder">
            <div className="sales-line-header">
              <strong>Selecionar joia</strong>
              <span>Adicione os itens da venda.</span>
            </div>
            <div className="form-grid">
              <SmartCombobox label="Joia" value={line.product_id} options={safeJewelry} onChange={(value) => { if (!value) setLine({ ...defaultSalesLine(), item_type: "produto" }); }} onSelect={addSelectedJewelry} getMeta={(item) => [item.category, item.material, item.sku].filter(Boolean).join(" · ")} isDisabled={(item) => asArray(item.variants).length ? !asArray(item.variants).some((variant) => Number(variant.quantity || 0) > 0) : Number(item.inventory_quantity ?? item.quantity ?? 0) <= 0} />
              {(
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
              <div>
                <Input type="number" label="Quantidade" value={line.quantity} onChange={(value) => setLine({ ...line, quantity: value })} />
                {availableQuantity !== null && (
                  <span className={exceedsStock ? "field-hint is-error" : "field-hint"}>
                    {availableQuantity > 0
                      ? `${availableQuantity} un. disponível(is) em estoque${reservedInCart ? ` (${reservedInCart} un. já nesta venda)` : ""}.`
                      : "Sem saldo em estoque para este item."}
                  </span>
                )}
              </div>
              <Input type="number" label="Valor unitário" value={line.unit_price} onChange={(value) => setLine({ ...line, unit_price: value })} />
            </div>
            <Textarea label="Observações do item" value={line.notes} onChange={(value) => setLine({ ...line, notes: value })} />
            <Button variant="secondary" type="button" onClick={addLineItem} disabled={exceedsStock}>Adicionar item</Button>
          </div>

          <div className="sales-items-list">
            {items.length ? items.map((item, index) => (
              <article key={`${item.item_name}-${index}`}>
                <div>
                  <strong>{item.item_name}</strong>
                  <span>{saleItemLabel(item.item_type)} · {item.quantity}x · {currency.format(item.unit_price)}</span>
                  {item.product_id && <small>ID {item.product_id} · {item.variation_name ? `Variação: ${item.variation_name} · ` : ""}Estoque: {item.available_stock ?? "—"} un.</small>}
                  <small>Subtotal: {currency.format(Number(item.unit_price) * Number(item.quantity))}</small>
                  {item.notes && <small>{item.notes}</small>}
                </div>
                <Button variant="secondary" onClick={() => removeLine(index)}>Remover</Button>
              </article>
            )) : <p className="empty-state">Nenhum item adicionado ainda.</p>}
          </div>
          <FinancialSummary summary={{ grossTotal: saleSubtotal, serviceSubtotal, productSubtotal, discountTotal: Number(priceQuote?.promotion_discount || 0) + Number(priceQuote?.coupon_discount || 0), netTotal: saleTotal, depositPaid: 0, otherPayments: form.receivable_mode === "paid" ? saleTotal : 0, totalPaid: form.receivable_mode === "paid" ? saleTotal : 0, outstandingBalance: form.receivable_mode === "paid" ? 0 : saleTotal, paymentStatus: form.receivable_mode === "paid" ? "pago" : "pendente", couponCode: priceQuote?.coupon?.code || form.coupon_code || "" }} />
          <div className="catalog-coupon-field">
            <Input label="Cupom" value={form.coupon_code || ""} onChange={(value) => { setForm({ ...form, coupon_code: value.toUpperCase() }); setPriceQuote(null); setCouponMessage(""); }} />
            <Button type="button" variant="secondary" onClick={applyCoupon} disabled={!form.coupon_code?.trim() || !items.length}>Aplicar cupom</Button>
            {priceQuote && <Button type="button" variant="secondary" onClick={() => { setForm({ ...form, coupon_code: "" }); setPriceQuote(null); setCouponMessage(""); }}>Remover</Button>}
          </div>
          {couponMessage && <span className="form-success">{couponMessage}</span>}

          {form.receivable_mode === "pending" && canGenerateReceivables && (
            <InstallmentGrid
              total={saleTotal}
              count={form.installment_count}
              firstDueDate={form.first_due_date}
              paymentMethod={form.payment_method}
              installments={installments}
              onChange={setInstallments}
              automatic={automaticInstallments}
              onAutomaticChange={setAutomaticInstallments}
              title="Parcelas da venda"
            />
          )}

          <Textarea label="Observações da venda" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <Modal
        open={!!details}
        title={`Venda #${details?.id || ""}`}
        subtitle={details?.full_name || "Cliente não informado"}
        size="lg"
        onClose={() => setDetails(null)}
      >
        {details?.loading ? (
          <Loading />
        ) : (
          <div className="stack">
            {details?.error && <span className="form-error">{details.error}</span>}
            <div className="form-grid">
              <div>
                <small>Total</small>
                <strong>{currency.format(Number(details?.total_value || 0))}</strong>
              </div>
              <div>
                <small>Forma padrão</small>
                <strong>{details?.payment_method || "Pix"}</strong>
              </div>
              <div>
                <small>Recebimento</small>
                <strong>{details?.receivable_mode === "pending" ? "Contas a receber" : "Recebido agora"}</strong>
              </div>
              <div>
                <small>Status</small>
                <StatusBadge status={details?.status} />
              </div>
            </div>
            <section className="soft-card stack">
              <div className="section-inline-header">
                <strong>Cronograma de recebimento</strong>
                <span>{asArray(details?.receivables).length} parcela(s)</span>
              </div>
              {asArray(details?.receivables).length ? (
                <div className="clean-list">
                  {asArray(details.receivables).map((receivable, index) => (
                    <div key={receivable.id || receivable.source_key || receivable.installment_number || receivable.due_date}>
                      <span>
                        <strong>
                          Parcela {receivable.installment_number || index + 1}/
                          {receivable.installment_count || details.installment_count || asArray(details.receivables).length}
                        </strong>
                        <small>
                          {formatDateWithYear(receivable.due_date)} · {receivable.payment_method || details.payment_method || "Pix"}
                        </small>
                      </span>
                      <span>
                        <strong>{currency.format(Number(receivable.amount || 0))}</strong>
                        <StatusBadge status={receivable.status} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  {details?.receivable_mode === "pending"
                    ? "Nenhuma parcela retornada pelo financeiro."
                    : "Esta venda foi registrada como recebida no ato."}
                </p>
              )}
            </section>
          </div>
        )}
      </Modal>
    </section>
  );
}
