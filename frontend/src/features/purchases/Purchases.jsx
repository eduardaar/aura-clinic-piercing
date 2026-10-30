import { useEffect, useMemo, useState } from "react";
import { FileUp, Landmark, Tags } from "lucide-react";
import {
  AdvancedFields,
  FormSection,
  FormWorkflow,
  ReviewSummary,
  StepNavigator,
  ValidationSummary,
} from "../../components/common/FormWorkflow";
import { Button, Input, Metric, PaymentSelect, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { InstallmentGrid } from "../../components/common/InstallmentGrid";
import { SelectWithCreate } from "../../components/common/SelectWithCreate";
import { ResponsiveEditableList, TransactionTotals } from "../../components/common/TransactionFields";
import { CollapsibleIndicators } from "../../components/common/CollapsibleIndicators";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { useFormDraft } from "../../lib/useFormDraft";
import { installmentSummary, installmentsForPayload } from "../../lib/installments";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { financeLabel } from "../../lib/financeLabels";
import { can } from "../../lib/permissions";
import { currency } from "../shared/helpers";

const today = () => new Date().toISOString().slice(0, 10);

function emptyPurchase() {
  return {
    supplier_id: "",
    description: "",
    purchase_date: today(),
    first_due_date: today(),
    installment_count: /** @type {string | number} */ (1),
    payment_method: "Pix",
    category: "",
    cost_center_id: "",
    freight_value: /** @type {string | number} */ (0),
    discount_value: /** @type {string | number} */ (0),
    notes: "",
    idempotency_key:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `purchase-${Date.now()}-${Math.random()}`,
  };
}

function emptyItem() {
  return { item_type: "product", product_id: "", consumable_id: "", product_variant_id: "", quantity: /** @type {string | number} */ (1), unit_cost: /** @type {string | number} */ (""),
    purchase_unit: "unidade",
    stock_conversion_factor: /** @type {string | number} */ (1),
    new_inventory_item: /** @type {Record<string, any> | null} */ (null),
  };
}

function formatDate(value) {
  const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

const purchaseStatusLabel = (status) =>
  ({ draft: "Rascunho", confirmed: "Confirmada", cancelled: "Cancelada" })[status] || status || "Confirmada";

const PURCHASE_STEPS = [
  { id: "details", label: "Dados", description: "Fornecedor e data" },
  { id: "items", label: "Itens", description: "Produtos e materiais" },
  { id: "payment", label: "Pagamento", description: "Total e parcelas" },
];

export function Purchases({ onNavigate, createSignal = 0 }) {
  const { data, loading, error: purchasesError } = useFetch("/purchases");
  const { data: suppliers } = useFetch("/finance/suppliers");
  const { data: products, loading: productsLoading, error: productsError } = useFetch("/jewelry");
  const { data: categories } = useFetch("/finance/categories");
  const { data: centers } = useFetch("/finance/cost-centers");
  const invalidate = useApiInvalidate();
  const [form, setForm] = useState(emptyPurchase);
  const [line, setLine] = useState(emptyItem);
  const [items, setItems] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [automaticInstallments, setAutomaticInstallments] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [purchaseChoice, setPurchaseChoice] = useState(false);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");
  const [nfeXml, setNfeXml] = useState("");
  const [nfePreview, setNfePreview] = useState(null);
  const [importingNfe, setImportingNfe] = useState(false);
  const [activeStep, setActiveStep] = useState("details");
  const [editingItemKey, setEditingItemKey] = useState("");
  const sessionUser = readStoredSession()?.user || {};
  const draftValue = useMemo(
    () => ({ form, line, items, installments, automaticInstallments }),
    [automaticInstallments, form, installments, items, line],
  );
  const draft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: sessionUser.id || "user",
    formId: "purchase-new",
    schemaKey: "purchase-v1",
    value: draftValue,
    enabled: modalOpen,
    onRestore: (value) => {
      const restored = asObject(value);
      setForm({ ...emptyPurchase(), ...asObject(restored.form) });
      setLine({ ...emptyItem(), ...asObject(restored.line) });
      setItems(asArray(restored.items));
      setInstallments(asArray(restored.installments));
      setAutomaticInstallments(restored.automaticInstallments !== false);
      setActiveStep("details");
    },
  });
  useEffect(() => { if (createSignal) setPurchaseChoice(true); }, [createSignal]);

  const purchasePayload = asObject(data);
  const purchases = Array.isArray(data) ? data : asArray(purchasePayload.items);
  const inventoryItems = asArray(products);
  const safeProducts = inventoryItems.filter((item) => Number(item.can_sell ?? 1) === 1 && item.status !== "arquivado");
  const safeConsumables = inventoryItems.filter((item) => Boolean(Number(item.can_use_in_service)) && item.status !== "arquivado");
  const selectedProduct = inventoryItems.find((item) => String(item.id) === String(line.product_id));
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

  async function createCategory(name) {
    const response = await apiFetch("/finance/categories", { method: "POST", body: JSON.stringify({ name, usage_scope: "purchase" }) });
    const created = await response.json();
    if (!response.ok) throw new Error(created.error || "Não foi possível criar a categoria.");
    invalidate("/finance/categories");
    return { id: created.name, name: created.name };
  }

  function openNew() {
    if (!draft.savedAt || draft.hasDraft) {
      setForm(emptyPurchase());
      setLine(emptyItem());
      setEditingItemKey("");
      setItems([]);
      setInstallments([]);
      setAutomaticInstallments(true);
      setNfeXml("");
      setNfePreview(null);
      setError("");
      setActiveStep("details");
    }
    setModalOpen(true);
  }

  function closePurchaseModal() {
    draft.flushDraft();
    setModalOpen(false);
  }

  function movePurchaseStep(offset) {
    const index = PURCHASE_STEPS.findIndex((step) => step.id === activeStep);
    const next = PURCHASE_STEPS[Math.max(0, Math.min(PURCHASE_STEPS.length - 1, index + offset))];
    if (next) setActiveStep(next.id);
  }

  function selectProduct(productId) {
    const product = safeProducts.find((item) => String(item.id) === String(productId));
    if (!product || String(line.product_id) === String(productId)) return;
    const variant = asArray(product?.variants).find((item) => Number(item.is_active ?? 1)) || null;
    setLine({
      ...emptyItem(),
      product_id: productId,
      stock_conversion_factor: product?.purchase_to_stock_factor || 1,
      purchase_unit: product?.purchase_unit || "unidade",
      product_variant_id: variant?.id ? String(variant.id) : "",
      unit_cost: Number(variant?.cost_value ?? variant?.purchase_cost ?? product?.cost_value ?? 0) * Number(product?.purchase_to_stock_factor || 1) || "",
    });
  }

  function selectConsumable(consumableId) {
    const consumable = safeConsumables.find((item) => String(item.id) === String(consumableId));
    // Eventos do select ao montar a edição não devem reiniciar a quantidade.
    if (!consumable || String(line.consumable_id) === String(consumableId)) return;
    const variant = asArray(consumable?.variants).find((item) => Number(item.is_active ?? 1)) || null;
    setLine({ ...emptyItem(), item_type: "consumable", product_id: consumableId, consumable_id: consumableId, product_variant_id: variant?.id ? String(variant.id) : "", unit_cost: Number(variant?.cost_value ?? consumable?.cost_value ?? 0) * Number(consumable?.purchase_to_stock_factor || 1) || "",
      stock_conversion_factor: consumable?.purchase_to_stock_factor || 1,
      purchase_unit: consumable?.purchase_unit || "unidade",
    });
  }

  function selectVariant(variantId) {
    const variant = variants.find((item) => String(item.id) === String(variantId));
    // O select nativo do Radix emite vazio quando troca a lista de opções.
    // Uma variação obrigatória já selecionada não pode ser apagada por esse evento.
    if (variants.length && !variant) return;
    setLine({
      ...line,
      product_variant_id: variantId,
      unit_cost: variant ? Number(variant.cost_value ?? variant.purchase_cost ?? 0) * Number(line.stock_conversion_factor || 1) : line.unit_cost,
    });
  }

  function addItem() {
    const isConsumable = line.item_type === "consumable";
    const newItem = line.new_inventory_item;
    if (newItem && !String(newItem.name || "").trim()) return setError("Informe o nome do novo produto ou material.");
    if (!newItem && isConsumable && !selectedConsumable) return setError("Selecione um material para adicionar.");
    if (!newItem && !isConsumable && !selectedProduct) return setError("Selecione um produto para adicionar.");
    if (variants.length && !selectedVariant) return setError("Selecione a variação do item para adicionar.");
    if (asNumber(line.quantity) <= 0) return setError("A quantidade deve ser maior que zero.");
    if (!Number.isInteger(Number(line.stock_conversion_factor)) || Number(line.stock_conversion_factor) <= 0)
      return setError("Informe um conteúdo por embalagem inteiro e positivo.");
    if (asNumber(line.unit_cost) <= 0) return setError("O custo unitário deve ser maior que zero.");
    const label = newItem ? String(newItem.name).trim() : isConsumable
      ? `${selectedConsumable.name}${selectedVariant ? ` - ${selectedVariant.variation_name || selectedVariant.sku}` : ""}`
      : selectedVariant
      ? `${selectedProduct.name} - ${selectedVariant.variation_name || selectedVariant.sku}`
      : selectedProduct.name;
    const nextItem = {
        row_key:
          editingItemKey || (typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `purchase-item-${Date.now()}-${Math.random()}`),
        item_type: isConsumable ? "consumable" : "product",
        purchase_purpose: isConsumable ? "consumption" : "resale",
        product_id: newItem ? null : isConsumable ? Number(selectedConsumable.id) : Number(selectedProduct.id),
        consumable_id: !newItem && isConsumable ? Number(selectedConsumable.id) : null,
        new_inventory_item: newItem ? { ...newItem, kind: isConsumable ? "consumable" : "product" } : undefined,
        product_variant_id: selectedVariant?.id ? Number(selectedVariant.id) : null,
        item_name: label,
        quantity: Number(line.quantity),
      stock_conversion_factor: Number(line.stock_conversion_factor || 1),
      purchase_unit: line.purchase_unit || "unidade",
      unit_cost: Number(line.unit_cost),
      };
    setItems((current) => editingItemKey
      ? current.map((item) => (item.row_key === editingItemKey ? nextItem : item))
        : [...current, nextItem]);
    setLine(emptyItem());
    setEditingItemKey("");
    setError("");
  }

  function editPurchaseItem(item) {
    setEditingItemKey(item.row_key);
    setLine({
      ...emptyItem(),
      item_type: item.item_type,
      product_id: String(item.product_id || ""),
      consumable_id: item.consumable_id ? String(item.consumable_id) : "",
      product_variant_id: item.product_variant_id ? String(item.product_variant_id) : "",
      quantity: Number(item.quantity || 1),
      unit_cost: item.unit_cost,
      stock_conversion_factor: Number(item.stock_conversion_factor || 1),
      purchase_unit: item.purchase_unit || "unidade",
      new_inventory_item: item.new_inventory_item || null,
    });
  }

  function fiscalTarget(match) {
    if (!match) return "";
    return match.item_type === "consumable"
      ? `consumable:${match.consumable_id}:${match.product_variant_id || 0}`
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
      const isNewItem = itemType === "new";
      const product = itemType === "product" ? safeProducts.find((item) => String(item.id) === rawId) : null;
      const consumable = itemType === "consumable" ? safeConsumables.find((item) => String(item.id) === rawId) : null;
      const variant = asArray((product || consumable)?.variants).find((item) => String(item.id) === rawVariantId && rawVariantId !== "0") || null;
      if (!product && !consumable && !isNewItem) return setError(`Revise a associação de ${imported.name}.`);
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
        item_type: isNewItem ? rawId : itemType,
        product_id: product ? Number(product.id) : consumable ? Number(consumable.id) : null,
        consumable_id: consumable ? Number(consumable.id) : null,
        product_variant_id: variant ? Number(variant.id) : null,
        item_name: isNewItem ? imported.name : consumable?.name || (variant ? `${product.name} - ${variant.variation_name || variant.sku}` : product.name),
        new_inventory_item: isNewItem ? {
          name: imported.name,
          kind: rawId,
          gtin: imported.gtin || "",
          supplier_item_code: imported.supplier_code || "",
          stock_unit: imported.unit || "unidade",
        } : undefined,
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
    draft.clearDraft();
    setModalOpen(false);
    invalidate("/purchases", "/jewelry", "/inventory", "/finance/ledger", "/finance", "/dashboard");
  }

  async function openDetails(item) {
    setDetails({ ...item, loading: true });
    const response = await apiFetch(`/purchases/${item.id}`);
    const payload = await response.json().catch(() => ({}));
    setDetails(response.ok ? payload : { ...item, error: payload.error || "Não foi possível abrir a compra." });
  }

  if (productsError) return <ApiError message={productsError} />;
  if (loading || data == null || suppliers == null || products == null || categories == null || centers == null)
    return <Loading />;
  if (purchasesError) return <ApiError message={purchasesError} />;

  return (
    <section className="stack purchases-page">
      <CollapsibleIndicators screenId="purchases"><div className="metric-grid">
        <Metric label="Compras no mês" value={currency.format(summary.monthValue)} />
        <Metric label="Pedidos no mês" value={String(summary.monthCount)} />
        <Metric label="Total registrado" value={currency.format(summary.totalValue)} />
      </div></CollapsibleIndicators>
      <section className="panel stack">
        <CrudHeader
          title="Compras"
          subtitle="Compras e reposições de joias e materiais, com entrada no estoque e contas a pagar."
          actions={[
            { label: "Despesas operacionais", onClick: () => onNavigate?.("payables") },
            { label: "Fornecedores", onClick: () => onNavigate?.("suppliers") },
            { label: "Categorias", icon: Tags, onClick: () => onNavigate?.("finance-categories") },
            { label: "Centros de custo", icon: Landmark, onClick: () => onNavigate?.("cost-centers") }
          ]}
          actionLabel="Nova compra"
          onAction={() => setPurchaseChoice(true)}
        />
        <Modal
          open={purchaseChoice}
          title="Novas compras"
          subtitle="Escolha o que deseja registrar."
          onClose={() => setPurchaseChoice(false)}
        >
          <div className="stack">
            <Button
              variant="secondary"
              onClick={() => {
                setPurchaseChoice(false);
                openNew();
                setLine({ ...emptyItem(), item_type: "product" });
              }}
            >
              Produtos para revenda
            </Button>
            <p>Joias, conectores e acessórios comercializados aos clientes.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setPurchaseChoice(false);
                openNew();
                setLine({ ...emptyItem(), item_type: "consumable" });
              }}
            >
              Materiais de consumo
            </Button>
            <p>Materiais do cadastro central, com entrada nas unidades reais de estoque.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setPurchaseChoice(false);
                onNavigate?.("payables");
              }}
            >
              Contas e despesas a pagar
            </Button>
            <p>Aluguel, água, energia e outras despesas sem movimentação de estoque.</p>
          </div>
        </Modal>
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
            { key: "description", label: "Descrição", render: (item) => item.description || `Compra #${item.id}` },
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
            { key: "paid_value", label: "Já pago", render: (item) => currency.format(asNumber(item.paid_value)) },
            { key: "pending_value", label: "A pagar", render: (item) => currency.format(asNumber(item.pending_value)) },
            {
              key: "status",
              label: "Entrada no estoque",
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
        subtitle="Produtos e materiais usam o estoque unificado; as parcelas vão para contas a pagar."
        size="lg"
        onClose={closePurchaseModal}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => (activeStep === "details" ? closePurchaseModal() : movePurchaseStep(-1))}
            >
              {activeStep === "details" ? "Cancelar" : "Voltar"}
            </Button>
            {activeStep === "payment" ? (
              <Button type="submit" form="purchase-form">Confirmar compra</Button>
            ) : (
              <Button type="button" onClick={() => movePurchaseStep(1)}>Continuar</Button>
            )}
          </>
        }
      >
        <form id="purchase-form" className="stack" onSubmit={save}>
          <FormWorkflow
            mobileFullscreen
            title="Cadastro da compra"
            description="Preencha o essencial primeiro. Importação fiscal e classificações continuam opcionais."
            eyebrow="Compras"
            draft={draft}
            actions={draft.hasDraft ? (
              <>
                <Button type="button" variant="secondary" onClick={draft.restoreDraft}>Restaurar</Button>
                <Button type="button" variant="ghost" onClick={draft.discardDraft}>Descartar</Button>
              </>
            ) : null}
          >
            <StepNavigator steps={PURCHASE_STEPS} currentStep={activeStep} onStepChange={setActiveStep} canNavigateTo={undefined} />
            <ValidationSummary errors={error ? [error] : []} />

            {activeStep === "details" && (
              <FormWorkflow.Page title="Dados principais" description="Identifique de quem e quando a clínica comprou.">
                <FormSection title="Fornecedor e data" badge="Obrigatório">
                  <div className="form-grid">
                    <Select label="Fornecedor" value={form.supplier_id} onChange={(supplier_id) => setForm({ ...form, supplier_id })} required>
                      <option value="">Selecione</option>
                      {asArray(suppliers).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>))}
                    </Select>
                    <Input type="date" label="Data da compra" value={form.purchase_date} onChange={(purchase_date) => setForm({ ...form, purchase_date })} required />
                    <Input label="Descrição da compra (opcional)" value={form.description} onChange={(description) => setForm({ ...form, description })} />
                  </div>
                </FormSection>
                <AdvancedFields
                  title="Importar XML da NF-e"
                  description="Opcional. Preenche fornecedor, itens e parcelas a partir da nota."
                  count={nfePreview ? asArray(nfePreview.items).length : undefined}
                  open={undefined}
                  onOpenChange={undefined}
                >
                  <section className="stack">
                    <div className="section-inline-header">
                      <span>Nada entra no estoque antes da confirmação final.</span>
                      <label className="button secondary">
                        <FileUp size={16} /> {importingNfe ? "Lendo…" : "Selecionar XML"}
                        <input type="file" accept=".xml,text/xml,application/xml" hidden disabled={importingNfe} onChange={importNfe} />
                      </label>
                    </div>
                    {nfePreview && (
                      <>
                      <small>NF-e {nfePreview.number} · série {nfePreview.series} · emitente {nfePreview.issuer?.name} · {" "}
                          {nfePreview.access_key}</small>
                      {!nfePreview.supplier && (
                          <span className="form-error">Fornecedor não localizado pelo documento. Selecione-o antes de confirmar.</span>
                        )}
                      <div className="clean-list">
                        {asArray(nfePreview.items).map((imported, index) => (
                            <div key={`${imported.line_number}-${imported.supplier_code}`}>
                          <span><strong>{imported.name}</strong><small>{imported.quantity} {imported.unit} × {currency.format(asNumber(imported.unit_cost))}{" "} · cód. {imported.supplier_code || "—"}</small></span>
                          <Select ariaLabel={`Associar ${imported.name}`} value={imported.selected_target} onChange={(selected_target) => setNfePreview((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, selected_target } : item) }))}>
                            <option value="">Selecione o item</option>
                            <option value="ignore">Ignorar esta linha</option>
                            <option value={`new:product:${imported.line_number}`}>Cadastrar novo produto/joia</option>
                            <option value={`new:consumable:${imported.line_number}`}>Cadastrar novo material de consumo</option>
                            {safeProducts.flatMap((product) => {
                              const productVariants = asArray(product.variants).filter((variant) => Number(variant.is_active ?? 1));
                              return productVariants.length
                                ? productVariants.map((variant) => (
                                        <option key={`p-${product.id}-${variant.id}`} value={`product:${product.id}:${variant.id}`}>{product.name} · {variant.variation_name || variant.sku}</option>))
                                : [<option key={`p-${product.id}`} value={`product:${product.id}:0`}>{product.name}</option>];
                            })}
                            {safeConsumables.flatMap((item) => {
                              const activeVariants = asArray(item.variants).filter((variant) => Number(variant.is_active ?? 1));
                              return activeVariants.length
                                ? activeVariants.map((variant) => (
                                        <option key={`c-${item.id}-${variant.id}`} value={`consumable:${item.id}:${variant.id}`}>{item.name} · {variant.variation_name || variant.sku} · material</option>))
                                : [<option key={`c-${item.id}`} value={`consumable:${item.id}:0`}>{item.name} · material</option>];
                            })}
                          </Select>
                        </div>))}
                      </div>
                      <Button type="button" variant="secondary" onClick={applyNfeItems}>Aplicar itens conferidos</Button>
                    </>
                    )}
                  </section>
                </AdvancedFields>
              </FormWorkflow.Page>
            )}

            {activeStep === "items" && (
              <FormWorkflow.Page title="Itens da compra" description="Monte a lista em uma única tela, sem abrir formulários sobrepostos.">
          <FormSection title="Adicionar item" description="Informe quantas embalagens chegaram, o conteúdo de cada uma e o preço por embalagem. O pagamento é registrado separadamente em Contas a pagar.">
            {line.item_type === "consumable" && (
              <div className="section-inline-header">
                <span>{productsLoading ? "Carregando materiais…" : safeConsumables.length ? "Materiais cadastrados no estoque, inclusive os que também podem ser vendidos." : "Nenhum material ativo cadastrado. Em Estoque → Materiais de procedimento, cadastre ou habilite um item para uso em procedimento."}</span>
                {onNavigate && can(sessionUser, "inventory.view") && (
                        <Button variant="secondary" onClick={() => { closePurchaseModal(); onNavigate("inventory", { target: "materiais" }); }}>{can(sessionUser, "inventory.create") ? "Cadastrar material no estoque" : "Ver materiais no estoque"}</Button>
                      )}
              </div>
            )}
            <div className="section-inline-header">
              <strong>Novo item</strong>
              <span>{items.length} item(ns) adicionado(s)</span>
            </div>
            <div className="form-grid">
              <Select label="Tipo de item" value={line.item_type} onChange={(item_type) => setLine({ ...emptyItem(), item_type })}>
                <option value="product">Produto para revenda</option>
                <option value="consumable">Material de consumo</option>
              </Select>
              {!line.new_inventory_item && (line.item_type === "consumable" ? (
                <Select label="Material" value={line.consumable_id} onChange={selectConsumable}>
                  <option value="">Selecione</option>
                  {safeConsumables.map((item) => (
                          <option key={item.id} value={item.id}>{item.name} · {item.quantity || 0} {item.stock_unit || "un."}</option>))}
                </Select>
              ) : (
                      <Select label="Produto" value={line.product_id} onChange={selectProduct}>
                <option value="">Selecione</option>
                {safeProducts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
                    ))}
              {line.new_inventory_item && <>
                <Input label="Nome do novo item" value={line.new_inventory_item.name || ""} onChange={(name) => setLine({ ...line, new_inventory_item: { ...line.new_inventory_item, name } })} />
                <Input label="Unidade individual no estoque" value={line.new_inventory_item.stock_unit || "unidade"} onChange={(stock_unit) => setLine({ ...line, new_inventory_item: { ...line.new_inventory_item, stock_unit } })} />
                <small>O cadastro será criado junto com a compra confirmada. O saldo entra somente uma vez.</small>
              </>}
              {(line.item_type === "product" || variants.length > 0) && (
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
                    )}
              <Input
                type="number"
                min="1"
                label="Quantidade de embalagens"
                value={line.quantity}
                onChange={(quantity) => setLine({ ...line, quantity })}
              />
              <Input
                      label="Unidade de compra"
                      value={line.purchase_unit || "unidade"}
                      onChange={(purchase_unit) => setLine({ ...line, purchase_unit })}
              />
              <Input
                type="number"
                min="1"
                      step="1"
                      label="Unidades em cada embalagem"
                      value={line.stock_conversion_factor ?? 1}
                      onChange={(stock_conversion_factor) => setLine({ ...line, stock_conversion_factor })}
                    />
                    <Input
                      type="number"
                      min="0.01"
                step="0.01"
                label="Preço por embalagem"
                value={line.unit_cost}
                onChange={(unit_cost) => setLine({ ...line, unit_cost })}
              />
            </div>
            <Button variant="secondary" type="button" onClick={() => setLine({ ...emptyItem(), item_type: line.item_type, new_inventory_item: line.new_inventory_item ? null : { name: "", stock_unit: "unidade" } })}>
              {line.new_inventory_item ? "Escolher item já cadastrado" : "Cadastrar novo item nesta compra"}
            </Button>
            <p>
                    Entrada prevista: {Number(line.quantity || 0) * Number(line.stock_conversion_factor || 1)}{" "}
                    {line.new_inventory_item?.stock_unit || selectedProduct?.stock_unit || "unidades"}. Custo por unidade de estoque:{" "}
                    {currency.format(Number(line.unit_cost || 0) / Number(line.stock_conversion_factor || 1))}.
                  </p>
            <Button type="button" variant="secondary" onClick={addItem}>
              {editingItemKey ? "Salvar alteração" : "Adicionar item"}
            </Button>
            <ResponsiveEditableList
              items={items}
              ariaLabel="Itens da compra"
              getKey={(item) => item.row_key}
              columns={[
                { key: "item", label: "Item", render: (item) => item.item_name },
                { key: "type", label: "Tipo", render: (item) => (item.item_type === "consumable" ? "Material" : "Revenda"),
                      },
                { key: "quantity", label: "Qtd.", value: (item) => item.quantity },
                { key: "unit_cost", label: "Custo", align: "right", render: (item) => currency.format(item.unit_cost) },
                { key: "subtotal", label: "Subtotal", align: "right", render: (item) => currency.format(item.quantity * item.unit_cost) },
              ]}
              onEdit={editPurchaseItem}
              onRemove={(_item, index) => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            />
            <TransactionTotals rows={[{ id: "total", label: "Total da compra", value: currency.format(total), emphasis: true }]} />
          </FormSection>
            </FormWorkflow.Page>
            )}

            {activeStep === "payment" && (
              <FormWorkflow.Page title="Pagamento e conferência" description="Defina as contas a pagar e confirme os totais.">
              <FormSection title="Condições de pagamento" badge="Obrigatório">
                <div className="form-grid">
                  <PaymentSelect label="Forma de pagamento" value={form.payment_method} onChange={(payment_method) => setForm({ ...form, payment_method })} />
                  <Input type="number" min="1" max="120" label="Parcelas" value={form.installment_count} onChange={(installment_count) => setForm({ ...form, installment_count })} required />
                  <Input type="date" label="Primeiro vencimento" value={form.first_due_date} onChange={(first_due_date) => setForm({ ...form, first_due_date })} required />
                </div>
                <InstallmentGrid total={total} count={form.installment_count} firstDueDate={form.first_due_date} paymentMethod={form.payment_method} installments={installments} onChange={setInstallments} automatic={automaticInstallments} onAutomaticChange={setAutomaticInstallments} title="Parcelas da compra" />
              </FormSection>
              <AdvancedFields title="Valores e classificação" description="Frete, desconto, categoria, centro de custo e observações." count={undefined} open={undefined} onOpenChange={undefined}>
                <div className="form-grid">
                  <Input type="number" min="0" step="0.01" label="Frete" value={form.freight_value} onChange={(freight_value) => setForm({ ...form, freight_value })} />
                  <Input type="number" min="0" step="0.01" label="Desconto" value={form.discount_value} onChange={(discount_value) => setForm({ ...form, discount_value })} />
                  <SelectWithCreate label="Categoria financeira" value={form.category} onChange={(category) => setForm({ ...form, category })}
                    options={asArray(categories).filter((item) => item.usage_scope !== "expense").map((item) => ({ id: item.name, name: item.name }))}
                    emptyLabel="Outros (opcional)" createTitle="Nova categoria de compra" createLabel="Nome da categoria" onCreate={createCategory} />
                  <Select label="Centro de custo" value={form.cost_center_id} onChange={(cost_center_id) => setForm({ ...form, cost_center_id })}>
                    <option value="">Sem centro</option>
                    {asArray(centers).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>))}
                  </Select>
                </div>
                <Textarea label="Observações" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
              </AdvancedFields>
              <ReviewSummary
                title="Resumo da compra"
                description={undefined}
                sections={undefined}
                onEdit={undefined}
                items={[
                  { label: "Fornecedor", value: asArray(suppliers).find((item) => String(item.id) === String(form.supplier_id))?.name },
                  { label: "Itens", value: items.length },
                  { label: "Total", value: currency.format(total) },
                  { label: "Pagamento", value: `${form.installment_count || 1} parcela(s) · ${form.payment_method}` },
                ]}
              />
            </FormWorkflow.Page>
            )}
          </FormWorkflow>
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
                      <small>{item.purchase_purpose === "consumption" ? "Material de consumo" : "Produto para revenda"} · {item.variation_name || item.variant_sku || "Sem variação"}</small>
                    </span>
                    <em>
                      {item.quantity} {item.purchase_unit || "embalagem(ns)"} × {item.stock_conversion_factor || 1} = {Number(item.quantity) * Number(item.stock_conversion_factor || 1)} {item.stock_unit || "unidades"} · {currency.format(asNumber(item.line_total))}
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
