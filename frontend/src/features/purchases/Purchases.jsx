import { useEffect, useState } from "react";
import { FileUp, Landmark, Tags } from "lucide-react";
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
    freight_value: 0,
    discount_value: 0,
    notes: "",
    idempotency_key:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `purchase-${Date.now()}-${Math.random()}`,
  };
}

function emptyItem() {
  return { item_type: "product", product_id: "", consumable_id: "", product_variant_id: "", quantity: 1, unit_cost: "" };
}

function formatDate(value) {
  const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

const purchaseStatusLabel = (status) =>
  ({ draft: "Rascunho", confirmed: "Confirmada", cancelled: "Cancelada" })[status] || status || "Confirmada";

export function Purchases({ onNavigate, createSignal = 0 }) {
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
  const [nfeXml, setNfeXml] = useState("");
  const [nfePreview, setNfePreview] = useState(null);
  const [importingNfe, setImportingNfe] = useState(false);
  useEffect(() => { if (createSignal) openNew(); }, [createSignal]);

  const purchasePayload = asObject(data);
  const purchases = Array.isArray(data) ? data : asArray(purchasePayload.items);
  const safeProducts = asArray(products);
  const safeConsumables = safeProducts.filter((item) => Boolean(Number(item.can_use_in_service)) && !Boolean(Number(item.can_sell)) && item.status !== "arquivado");
  const selectedProduct = safeProducts.find((item) => String(item.id) === String(line.product_id));
  const selectedConsumable = safeConsumables.find((item) => String(item.id) === String(line.consumable_id));
  const variants = asArray(selectedProduct?.variants).filter((item) => Number(item.is_active ?? 1));
  const selectedVariant = variants.find((item) => String(item.id) === String(line.product_variant_id));
  const productsTotal = items.reduce((sum, item) => sum + asNumber(item.quantity) * asNumber(item.unit_cost), 0);
  const total = Math.max(0, productsTotal + asNumber(form.freight_value) - asNumber(form.discount_value));
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
    setNfeXml("");
    setNfePreview(null);
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

  function selectConsumable(consumableId) {
    const consumable = safeConsumables.find((item) => String(item.id) === String(consumableId));
    setLine({ ...emptyItem(), item_type: "consumable", product_id: consumableId, consumable_id: consumableId, unit_cost: consumable?.cost_value ?? "" });
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
    const isConsumable = line.item_type === "consumable";
    if (isConsumable && !selectedConsumable) return setError("Selecione um material para adicionar.");
    if (!isConsumable && !selectedProduct) return setError("Selecione um produto para adicionar.");
    if (asNumber(line.quantity) <= 0) return setError("A quantidade deve ser maior que zero.");
    if (asNumber(line.unit_cost) <= 0) return setError("O custo unitário deve ser maior que zero.");
    const label = isConsumable
      ? selectedConsumable.name
      : selectedVariant
      ? `${selectedProduct.name} - ${selectedVariant.variation_name || selectedVariant.sku}`
      : selectedProduct.name;
    setItems((current) => [
      ...current,
      {
        row_key:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `purchase-item-${Date.now()}-${Math.random()}`,
        item_type: isConsumable ? "consumable" : "product",
        product_id: isConsumable ? Number(selectedConsumable.id) : Number(selectedProduct.id),
        consumable_id: isConsumable ? Number(selectedConsumable.id) : null,
        product_variant_id: isConsumable ? null : (selectedVariant?.id ? Number(selectedVariant.id) : null),
        item_name: label,
        quantity: Number(line.quantity),
        unit_cost: Number(line.unit_cost),
      },
    ]);
    setLine(emptyItem());
    setError("");
  }

  function fiscalTarget(match) {
    if (!match) return "";
    return match.item_type === "consumable"
      ? `consumable:${match.consumable_id}`
      : `product:${match.product_id}:${match.product_variant_id || 0}`;
  }

  async function importNfe(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > 900 * 1024) return setError("O XML da NF-e deve ter no máximo 900 KB.");
    setImportingNfe(true);
    try {
      const xml = await file.text();
      const response = await apiFetch("/purchases/nfe/preview", { method: "POST", body: JSON.stringify({ xml }) });
      const preview = await response.json().catch(() => ({}));
      if (!response.ok) return setError(preview.error || "Não foi possível importar a NF-e.");
      const importedInstallments = asArray(preview.installments).map((installment, index) => ({
        installment_number: index + 1,
        due_date: installment.due_date,
        amount: installment.amount,
        payment_method: preview.payment_method || "Outros",
      }));
      const firstDueDate = importedInstallments[0]?.due_date || preview.purchase_date || today();
      setNfeXml(xml);
      setNfePreview({
        ...preview,
        items: asArray(preview.items).map((item) => ({ ...item, selected_target: fiscalTarget(item.match) })),
      });
      setForm((current) => ({
        ...current,
        supplier_id: preview.supplier?.id ? String(preview.supplier.id) : current.supplier_id,
        purchase_date: preview.purchase_date || current.purchase_date,
        first_due_date: firstDueDate,
        installment_count: importedInstallments.length || 1,
        payment_method: preview.payment_method || current.payment_method,
        freight_value: preview.totals?.freight || 0,
        discount_value: preview.totals?.discount || 0,
        notes: `NF-e ${preview.number || ""} série ${preview.series || ""} · chave ${preview.access_key}`,
      }));
      setInstallments(importedInstallments);
      setAutomaticInstallments(importedInstallments.length === 0);
    } finally {
      setImportingNfe(false);
    }
  }

  function applyNfeItems() {
    const selected = asArray(nfePreview?.items).filter((item) => item.selected_target !== "ignore");
    if (selected.some((item) => !item.selected_target)) return setError("Associe ou ignore todos os itens importados.");
    if (selected.some((item) => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      return setError("Há item da NF-e com quantidade fracionada; ajuste a unidade de estoque antes de importar.");
    }
    const grouped = new Map();
    for (const imported of selected) {
      const [itemType, rawId, rawVariantId] = imported.selected_target.split(":");
      const product = itemType === "product" ? safeProducts.find((item) => String(item.id) === rawId) : null;
      const variant = product ? asArray(product.variants).find((item) => String(item.id) === rawVariantId && rawVariantId !== "0") : null;
      const consumable = itemType === "consumable" ? safeConsumables.find((item) => String(item.id) === rawId) : null;
      if (!product && !consumable) return setError(`Revise a associação de ${imported.name}.`);
      const quantity = Number(imported.quantity);
      const lineValue = quantity * asNumber(imported.unit_cost);
      const current = grouped.get(imported.selected_target);
      if (current) {
        current.quantity += quantity;
        current._costTotal += lineValue;
        current.unit_cost = current._costTotal / current.quantity;
        continue;
      }
      grouped.set(imported.selected_target, {
        row_key: crypto.randomUUID?.() || `nfe-${Date.now()}-${imported.line_number}`,
        item_type: itemType,
        product_id: product ? Number(product.id) : Number(consumable.id),
        consumable_id: consumable ? Number(consumable.id) : null,
        product_variant_id: variant ? Number(variant.id) : null,
        item_name: consumable?.name || (variant ? `${product.name} - ${variant.variation_name || variant.sku}` : product.name),
        quantity,
        unit_cost: asNumber(imported.unit_cost),
        batch_code: imported.batch_code || "",
        expiry_date: imported.expiry_date || null,
        _costTotal: lineValue,
      });
    }
    setItems([...grouped.values()].map(({ _costTotal, ...item }) => item));
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
        nfe_xml: nfeXml || undefined,
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
        subtitle="Produtos para revenda e materiais de consumo entram em estoques separados; as parcelas vão para contas a pagar."
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
          <section className="soft-card stack">
            <div className="section-inline-header">
              <div><strong>Importar XML da NF-e</strong><span>O sistema apenas prepara uma prévia; nada entra no estoque antes da confirmação.</span></div>
              <label className="button secondary">
                <FileUp size={16} /> {importingNfe ? "Lendo…" : "Selecionar XML"}
                <input type="file" accept=".xml,text/xml,application/xml" hidden disabled={importingNfe} onChange={importNfe} />
              </label>
            </div>
            {nfePreview && <>
              <small>NF-e {nfePreview.number} · série {nfePreview.series} · emitente {nfePreview.issuer?.name} · {nfePreview.access_key}</small>
              {!nfePreview.supplier && <span className="form-error">Fornecedor não localizado pelo documento. Selecione-o abaixo ou cadastre-o antes de confirmar.</span>}
              <div className="clean-list">
                {asArray(nfePreview.items).map((imported, index) => <div key={`${imported.line_number}-${imported.supplier_code}`}>
                  <span><strong>{imported.name}</strong><small>{imported.quantity} {imported.unit} × {currency.format(asNumber(imported.unit_cost))} · cód. {imported.supplier_code || "—"}</small></span>
                  <Select ariaLabel={`Associar ${imported.name}`} value={imported.selected_target} onChange={(selected_target) => setNfePreview((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, selected_target } : item) }))}>
                    <option value="">Selecione o item</option>
                    <option value="ignore">Ignorar esta linha</option>
                    {safeProducts.flatMap((product) => {
                      const productVariants = asArray(product.variants).filter((variant) => Number(variant.is_active ?? 1));
                      return productVariants.length
                        ? productVariants.map((variant) => <option key={`p-${product.id}-${variant.id}`} value={`product:${product.id}:${variant.id}`}>{product.name} · {variant.variation_name || variant.sku}</option>)
                        : [<option key={`p-${product.id}`} value={`product:${product.id}:0`}>{product.name}</option>];
                    })}
                    {safeConsumables.map((item) => <option key={`c-${item.id}`} value={`consumable:${item.id}`}>{item.name} · material</option>)}
                  </Select>
                </div>)}
              </div>
              <Button type="button" variant="secondary" onClick={applyNfeItems}>Aplicar itens conferidos</Button>
            </>}
          </section>
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
            <Input type="number" min="0" step="0.01" label="Frete" value={form.freight_value} onChange={(freight_value) => setForm({ ...form, freight_value })} />
            <Input type="number" min="0" step="0.01" label="Desconto" value={form.discount_value} onChange={(discount_value) => setForm({ ...form, discount_value })} />
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
              <Select label="Tipo de item" value={line.item_type} onChange={(item_type) => setLine({ ...emptyItem(), item_type })}>
                <option value="product">Produto para revenda</option>
                <option value="consumable">Material de consumo</option>
              </Select>
              {line.item_type === "consumable" ? (
                <Select label="Material" value={line.consumable_id} onChange={selectConsumable}>
                  <option value="">Selecione</option>
                  {safeConsumables.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.quantity || 0} {item.unit || "un."}</option>)}
                </Select>
              ) : <Select label="Produto" value={line.product_id} onChange={selectProduct}>
                <option value="">Selecione</option>
                {safeProducts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>}
              {line.item_type === "product" && <Select label="Variação" value={line.product_variant_id} onChange={selectVariant}>
                <option value="" disabled={variants.length > 0}>
                  Sem variação
                </option>
                {variants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.variation_name || item.sku}
                  </option>
                ))}
              </Select>}
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
                      <strong>{item.item_name}</strong>
                      <span>
                        {item.item_type === "consumable" ? "Material de consumo" : "Produto para revenda"} · {item.quantity} un. × {currency.format(item.unit_cost)}
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
                      <strong>{item.item_name || item.product_name || item.consumable_name}</strong>
                      <small>{item.item_type === "consumable" ? "Material de consumo" : (item.variation_name || item.variant_sku || "Sem variação")}</small>
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
