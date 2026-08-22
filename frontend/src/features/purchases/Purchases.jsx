import { useState } from "react";
import { Landmark, Tags } from "lucide-react";
import { Button, Input, Metric, PaymentSelect, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { InstallmentGrid } from "../../components/common/InstallmentGrid";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { installmentSummary, installmentsForPayload } from "../../lib/installments";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { financeLabel } from "../../lib/financeLabels";
import { currency } from "../shared/helpers";

const today = () => new Date().toISOString().slice(0, 10);

function emptyPurchase() {
  return {
    supplier_id: "",
    purchase_date: today(),
    first_due_date: today(),
    installment_count: 1,
    payment_method: "Pix",
    category: "",
    cost_center_id: "",
    notes: "",
    idempotency_key:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `purchase-${Date.now()}-${Math.random()}`,
  };
}

function emptyItem() {
  return { product_id: "", product_variant_id: "", quantity: 1, unit_cost: "" };
}

function formatDate(value) {
  const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

const purchaseStatusLabel = (status) =>
  ({ draft: "Rascunho", confirmed: "Confirmada", cancelled: "Cancelada" })[status] || status || "Confirmada";

export function Purchases({ onNavigate }) {
  const { data, loading, error: purchasesError } = useFetch("/purchases");
  const { data: suppliers } = useFetch("/finance/suppliers");
  const { data: products } = useFetch("/jewelry");
  const { data: categories } = useFetch("/finance/categories");
  const { data: centers } = useFetch("/finance/cost-centers");
  const invalidate = useApiInvalidate();
  const [form, setForm] = useState(emptyPurchase);
  const [line, setLine] = useState(emptyItem);
  const [items, setItems] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [automaticInstallments, setAutomaticInstallments] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");

  const purchasePayload = asObject(data);
  const purchases = Array.isArray(data) ? data : asArray(purchasePayload.items);
  const safeProducts = asArray(products);
  const selectedProduct = safeProducts.find((item) => String(item.id) === String(line.product_id));
  const variants = asArray(selectedProduct?.variants).filter((item) => Number(item.is_active ?? 1));
  const selectedVariant = variants.find((item) => String(item.id) === String(line.product_variant_id));
  const total = items.reduce((sum, item) => sum + asNumber(item.quantity) * asNumber(item.unit_cost), 0);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthPurchases = purchases.filter((item) =>
    String(item.purchase_date || item.created_at || "").startsWith(currentMonth),
  );
  const summary = {
    monthValue: monthPurchases.reduce((sum, item) => sum + asNumber(item.total_value), 0),
    monthCount: monthPurchases.length,
    totalValue: purchases.reduce((sum, item) => sum + asNumber(item.total_value), 0),
  };

  function openNew() {
    setForm(emptyPurchase());
    setLine(emptyItem());
    setItems([]);
    setInstallments([]);
    setAutomaticInstallments(true);
    setError("");
    setModalOpen(true);
  }

  function selectProduct(productId) {
    const product = safeProducts.find((item) => String(item.id) === String(productId));
    const variant = asArray(product?.variants).find((item) => Number(item.is_active ?? 1)) || null;
    setLine({
      ...emptyItem(),
      product_id: productId,
      product_variant_id: variant?.id ? String(variant.id) : "",
      unit_cost: variant?.cost_value ?? variant?.purchase_cost ?? product?.cost_value ?? "",
    });
  }

  function selectVariant(variantId) {
    const variant = variants.find((item) => String(item.id) === String(variantId));
    setLine({
      ...line,
      product_variant_id: variantId,
      unit_cost: variant?.cost_value ?? variant?.purchase_cost ?? line.unit_cost,
    });
  }

  function addItem() {
    if (!selectedProduct) return setError("Selecione um produto para adicionar.");
    if (asNumber(line.quantity) <= 0) return setError("A quantidade deve ser maior que zero.");
    if (asNumber(line.unit_cost) <= 0) return setError("O custo unitário deve ser maior que zero.");
    const label = selectedVariant
      ? `${selectedProduct.name} - ${selectedVariant.variation_name || selectedVariant.sku}`
      : selectedProduct.name;
    setItems((current) => [
      ...current,
      {
        row_key:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `purchase-item-${Date.now()}-${Math.random()}`,
        product_id: Number(selectedProduct.id),
        product_variant_id: selectedVariant?.id ? Number(selectedVariant.id) : null,
        product_name: label,
        quantity: Number(line.quantity),
        unit_cost: Number(line.unit_cost),
      },
    ]);
    setLine(emptyItem());
    setError("");
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    if (!items.length) return setError("Adicione pelo menos um item à compra.");
    const schedule = installmentSummary(total, installments, form.installment_count);
    if (!schedule.isValid) {
      return setError(
        "Revise as parcelas: a soma deve coincidir com o total da compra e todos os campos são obrigatórios.",
      );
    }
    const response = await apiFetch("/purchases", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        supplier_id: Number(form.supplier_id),
        installment_count: Number(form.installment_count || 1),
        cost_center_id: form.cost_center_id ? Number(form.cost_center_id) : null,
        installments: installmentsForPayload(installments),
        items: items.map(({ product_name: _productName, row_key: _rowKey, ...item }) => item),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível registrar a compra.");
    setModalOpen(false);
    invalidate("/purchases", "/jewelry", "/inventory", "/finance/ledger", "/finance", "/dashboard");
  }

  async function openDetails(item) {
    setDetails({ ...item, loading: true });
    const response = await apiFetch(`/purchases/${item.id}`);
    const payload = await response.json().catch(() => ({}));
    setDetails(response.ok ? payload : { ...item, error: payload.error || "Não foi possível abrir a compra." });
  }

  if (loading || data == null || suppliers == null || products == null || categories == null || centers == null)
    return <Loading />;
  if (purchasesError) return <ApiError message={purchasesError} />;

  return (
    <section className="stack purchases-page">
      <div className="metric-grid">
        <Metric label="Compras no mês" value={currency.format(summary.monthValue)} />
        <Metric label="Pedidos no mês" value={String(summary.monthCount)} />
        <Metric label="Total registrado" value={currency.format(summary.totalValue)} />
      </div>
      <section className="panel stack">
        <CrudHeader
          title="Compras"
          subtitle="Entrada de produtos e contas a pagar geradas no mesmo lançamento."
          actionLabel="Nova compra"
          onAction={openNew}
        />
        <div className="toolbar compact-actions">
          <Button variant="secondary" type="button" onClick={() => onNavigate?.("finance-categories")}>
            <Tags size={16} /> Categorias
          </Button>
          <Button variant="secondary" type="button" onClick={() => onNavigate?.("cost-centers")}>
            <Landmark size={16} /> Centros de custo
          </Button>
        </div>
        <DataView
          rows={purchases}
          loading={loading}
          error={purchasesError}
          defaultSort={{ key: "purchase_date", dir: "desc" }}
          searchPlaceholder="Buscar por fornecedor, status ou observação"
          filters={[
            {
              key: "status",
              label: "Status",
              type: "select",
              options: [...new Set(purchases.map((item) => item.status).filter(Boolean))],
            },
          ]}
          columns={[
            { key: "supplier_name", label: "Fornecedor", render: (item) => item.supplier_name || "—" },
            {
              key: "purchase_date",
              label: "Data",
              value: (item) => String(item.purchase_date || "").slice(0, 10),
              render: (item) => formatDate(item.purchase_date),
            },
            {
              key: "items_count",
              label: "Itens",
              value: (item) => asNumber(item.items_count || item.item_count),
              render: (item) => String(item.items_count || item.item_count || asArray(item.items).length || "—"),
            },
            {
              key: "installment_count",
              label: "Pagamento",
              render: (item) =>
                Number(item.installment_count || 1) > 1 ? `${item.installment_count} parcelas` : "À vista",
            },
            {
              key: "total_value",
              label: "Total",
              align: "right",
              value: (item) => asNumber(item.total_value),
              render: (item) => currency.format(asNumber(item.total_value)),
            },
            {
              key: "status",
              label: "Status",
              value: (item) => purchaseStatusLabel(item.status),
              render: (item) => <StatusBadge status={item.status}>{purchaseStatusLabel(item.status)}</StatusBadge>,
            },
          ]}
          actions={(item) => <RowActions actions={[{ label: "Ver detalhes", onClick: () => openDetails(item) }]} />}
          empty="Nenhuma compra registrada ainda."
        />
      </section>

      <Modal
        open={modalOpen}
        title="Nova compra"
        subtitle="Ao confirmar, os produtos entram no estoque e as parcelas vão para contas a pagar."
        size="lg"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="purchase-form">
              Confirmar compra
            </Button>
          </>
        }
      >
        <form id="purchase-form" className="stack" onSubmit={save}>
          <div className="form-grid">
            <Select
              label="Fornecedor"
              value={form.supplier_id}
              onChange={(supplier_id) => setForm({ ...form, supplier_id })}
              required
            >
              <option value="">Selecione</option>
              {asArray(suppliers).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              label="Data da compra"
              value={form.purchase_date}
              onChange={(purchase_date) => setForm({ ...form, purchase_date })}
              required
            />
            <Select
              label="Categoria financeira"
              value={form.category}
              onChange={(category) => setForm({ ...form, category })}
            >
              <option value="">Sem categoria</option>
              {asArray(categories).map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Select
              label="Centro de custo"
              value={form.cost_center_id}
              onChange={(cost_center_id) => setForm({ ...form, cost_center_id })}
            >
              <option value="">Sem centro</option>
              {asArray(centers).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <PaymentSelect
              label="Forma de pagamento"
              value={form.payment_method}
              onChange={(payment_method) => setForm({ ...form, payment_method })}
            />
            <Input
              type="number"
              min="1"
              max="120"
              label="Parcelas"
              value={form.installment_count}
              onChange={(installment_count) => setForm({ ...form, installment_count })}
              required
            />
            <Input
              type="date"
              label="Primeiro vencimento"
              value={form.first_due_date}
              onChange={(first_due_date) => setForm({ ...form, first_due_date })}
              required
            />
          </div>

          <section className="soft-card stack">
            <div className="section-inline-header">
              <strong>Itens da compra</strong>
              <span>Informe o custo unitário negociado.</span>
            </div>
            <div className="form-grid">
              <Select label="Produto" value={line.product_id} onChange={selectProduct}>
                <option value="">Selecione</option>
                {safeProducts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Select label="Variação" value={line.product_variant_id} onChange={selectVariant}>
                <option value="" disabled={variants.length > 0}>
                  Sem variação
                </option>
                {variants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.variation_name || item.sku}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min="1"
                label="Quantidade"
                value={line.quantity}
                onChange={(quantity) => setLine({ ...line, quantity })}
              />
              <Input
                type="number"
                min="0.01"
                step="0.01"
                label="Custo unitário"
                value={line.unit_cost}
                onChange={(unit_cost) => setLine({ ...line, unit_cost })}
              />
            </div>
            <Button type="button" variant="secondary" onClick={addItem}>
              Adicionar item
            </Button>
            <div className="sales-items-list">
              {items.length ? (
                items.map((item, index) => (
                  <article key={item.row_key}>
                    <div>
                      <strong>{item.product_name}</strong>
                      <span>
                        {item.quantity} un. × {currency.format(item.unit_cost)}
                      </span>
                      <small>Subtotal: {currency.format(item.quantity * item.unit_cost)}</small>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Remover
                    </Button>
                  </article>
                ))
              ) : (
                <p className="empty-state">Nenhum item adicionado.</p>
              )}
            </div>
            <div className="profit-box">
              <span>Total da compra</span>
              <strong>{currency.format(total)}</strong>
            </div>
          </section>
          <InstallmentGrid
            total={total}
            count={form.installment_count}
            firstDueDate={form.first_due_date}
            paymentMethod={form.payment_method}
            installments={installments}
            onChange={setInstallments}
            automatic={automaticInstallments}
            onAutomaticChange={setAutomaticInstallments}
            title="Parcelas da compra"
          />
          <Textarea label="Observações" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <Modal
        open={!!details}
        title="Detalhes da compra"
        subtitle={details?.supplier_name || "Fornecedor não informado"}
        onClose={() => setDetails(null)}
      >
        {details?.loading ? (
          <Loading />
        ) : (
          <div className="stack">
            {details?.error && <span className="form-error">{details.error}</span>}
            <div className="form-grid">
              <div>
                <small>Data</small>
                <strong>{formatDate(details?.purchase_date)}</strong>
              </div>
              <div>
                <small>Total</small>
                <strong>{currency.format(asNumber(details?.total_value))}</strong>
              </div>
              <div>
                <small>Parcelas</small>
                <strong>{details?.installment_count || 1}</strong>
              </div>
              <div>
                <small>Status</small>
                <strong>{purchaseStatusLabel(details?.status)}</strong>
              </div>
            </div>
            {asArray(details?.items).length > 0 && (
              <div className="clean-list">
                {asArray(details.items).map((item) => (
                  <div key={item.id}>
                    <span>
                      <strong>{item.product_name}</strong>
                      <small>{item.variation_name || item.variant_sku || "Sem variação"}</small>
                    </span>
                    <em>
                      {item.quantity} un. · {currency.format(asNumber(item.line_total))}
                    </em>
                  </div>
                ))}
              </div>
            )}
            {asArray(details?.payables).length > 0 && (
              <section className="stack">
                <div className="section-inline-header">
                  <strong>Parcelas em Contas a pagar</strong>
                  <span>{asArray(details.payables).length} lançamento(s)</span>
                </div>
                <div className="clean-list">
                  {asArray(details.payables).map((payable) => (
                    <div key={payable.id}>
                      <span>
                        <strong>
                          Parcela {payable.installment_number}/{payable.installment_count}
                        </strong>
                        <small>
                          {formatDate(payable.due_date)} · {payable.payment_method || "Não informado"}
                        </small>
                      </span>
                      <span>
                        <strong>{currency.format(asNumber(payable.amount))}</strong>
                        <StatusBadge status={payable.status}>{financeLabel(payable.status)}</StatusBadge>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {details?.notes && <p>{details.notes}</p>}
          </div>
        )}
      </Modal>
    </section>
  );
}
