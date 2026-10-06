// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, FinancialSummary, Input, Metric, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { Modal, CrudHeader, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import {
  AdvancedFields,
  FormSection,
  FormWorkflow,
  ReviewSummary,
  StepNavigator,
  ValidationSummary,
} from "../../components/common/FormWorkflow";
import { InstallmentGrid } from "../../components/common/InstallmentGrid";
import { ResponsiveEditableList } from "../../components/common/TransactionFields";
import { CollapsibleIndicators } from "../../components/common/CollapsibleIndicators";
import { Loading } from "../../components/common/Feedback";
import { asArray } from "../../lib/utils";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { useFormDraft } from "../../lib/useFormDraft";
import { defaultSalesLine, defaultSalesOrderForm } from "../../lib/defaultForms";
import { installmentSummary, installmentsForPayload } from "../../lib/installments";
import { currency, saleItemLabel, saleOrderTypeLabel, saleSourceLabel } from "../../features/shared/helpers";
import { SmartCombobox } from "../../components/common/SmartCombobox";
import { PlanUpgradeNotice } from "../../components/common/PlanUpgradeNotice";
import { can, planAllowsAction } from "../../lib/permissions";
import "./sales.css";

// ---------------------------------------------------------------------------
// Dinheiro da venda em centavos inteiros. Somar `unit_price * quantity` em
// ponto flutuante é o que fazia a tela e o backend divergirem por centavos e
// derrubava a validação das parcelas (soma exata exigida pelo servidor).
// ---------------------------------------------------------------------------
export function toCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

const fromCents = (cents) => Number(cents || 0) / 100;
const wholeQuantity = (value) => Math.max(0, Math.trunc(Number(value) || 0));

// O primeiro campo numérico presente entre os nomes aceitos. A cotação oficial
// (`POST /sales-orders/quote`) pode responder no formato do pedido gravado
// (`subtotal_value`/`discount_value`/`total_value`) ou no de
// `calculateOperationTotals` (`grossTotal`/`discountTotal`/`netTotal`).
function firstMoney(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value))) return toCents(value);
  }
  return null;
}

/**
 * Normaliza a resposta da cotação oficial de venda para centavos.
 * A resposta é a fonte da verdade: só deriva um campo quando ele não vier.
 * Promoções NÃO entram (a venda interna nunca as aplicou no backend).
 * @param {Record<string, any>} payload
 */
export function normalizeSalesQuote(payload = {}) {
  const source = { ...(payload || {}), ...(payload?.totals || {}), ...(payload?.quote || {}) };
  const gross = firstMoney(source, ["subtotal_value", "grossTotal", "gross_total", "gross_value", "subtotal"]) ?? 0;
  const manual = firstMoney(source, ["manual_discount_value", "manualDiscount", "manual_discount"]) ?? 0;
  const explicitCoupon = firstMoney(source, ["coupon_discount_value", "coupon_discount", "couponDiscount"]);
  const explicitDiscount = firstMoney(source, ["discount_value", "discountTotal", "discount_total"]);
  const discount = explicitDiscount ?? Math.min(gross, (explicitCoupon ?? 0) + manual);
  const coupon = explicitCoupon ?? Math.max(0, discount - manual);
  const net = firstMoney(source, ["total_value", "netTotal", "net_total", "net_value"]) ?? Math.max(0, gross - discount);
  const couponCode = String(source.coupon?.code || source.coupon_code || "").trim();
  return { grossCents: gross, couponCents: coupon, manualCents: manual, discountCents: discount, netCents: net, couponCode };
}

/**
 * Desconto de cada item da venda, em centavos. Usa o rateio gravado em
 * `sales_order_items.discount_value`; venda antiga (desconto no pedido e nada
 * gravado por item) recebe o rateio proporcional ao bruto de cada item pelo
 * maior resto — o mesmo critério que o backend usa na devolução.
 * @param {Record<string, any>} order
 * @returns {number[]}
 */
export function saleItemDiscountCents(order = {}) {
  const items = asArray(order.items);
  const stored = items.map((item) => Math.max(0, toCents(item.discount_value)));
  const storedTotal = stored.reduce((sum, value) => sum + value, 0);
  const orderDiscount = Math.max(0, toCents(order.discount_value));
  if (storedTotal > 0 || orderDiscount === 0) return stored;
  const grossList = items.map((item) => toCents(item.unit_price) * wholeQuantity(item.quantity));
  const grossTotal = grossList.reduce((sum, value) => sum + value, 0);
  if (grossTotal <= 0) return items.map(() => 0);
  const target = Math.min(orderDiscount, grossTotal);
  const exact = grossList.map((gross) => (target * gross) / grossTotal);
  const allocated = exact.map((value) => Math.floor(value));
  let missing = target - allocated.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    allocated[index] += 1;
    missing -= 1;
  }
  return allocated;
}

/**
 * Valor de devolução de `returning` unidades de um item, com arredondamento
 * acumulado: devolver 1 + 1 + 1 de 3 unidades soma exatamente o líquido.
 */
export function saleReturnRefundCents(netCents, soldQuantity, alreadyReturned, returning) {
  const sold = wholeQuantity(soldQuantity);
  const before = Math.min(sold, wholeQuantity(alreadyReturned));
  const after = Math.min(sold, before + wholeQuantity(returning));
  if (!sold || after <= before) return 0;
  return Math.round((netCents * after) / sold) - Math.round((netCents * before) / sold);
}

// Bruto gravado; vendas antigas sem `subtotal_value` reconstroem o bruto a
// partir do líquido + desconto (mesma regra do relatório de vendas).
function orderMoney(order = {}) {
  const net = toCents(order.total_value);
  const discount = Math.max(0, toCents(order.discount_value));
  const gross = toCents(order.subtotal_value) > 0 ? toCents(order.subtotal_value) : net + discount;
  const manual = Math.min(discount, Math.max(0, toCents(order.manual_discount_value)));
  return { gross, discount, manual, coupon: Math.max(0, discount - manual), net };
}

const newSalesForm = () => ({ ...defaultSalesOrderForm(), manual_discount_value: 0, manual_discount_reason: "" });
const QUOTE_IDLE = { status: "idle", key: "", quote: null, error: "", basis: null };
const QUOTE_DEBOUNCE_MS = 350;

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

const SALES_STEPS = [
  { id: "customer", label: "Cliente", description: "Contato e status" },
  { id: "items", label: "Itens", description: "Joias e valores" },
  { id: "payment", label: "Pagamento", description: "Recebimento e conferência" },
];

export function SalesWorkspace({ features = [], onUpgrade, initialView = "historico", createSignal = 0 }) {
  const { data: orders, loading: ordersLoading, error: ordersError } = useFetch("/sales-orders");
  const { data: jewelry } = useFetch("/jewelry");
  // Uma venda dá baixa no estoque e lança no financeiro: invalidar só a lista
  // de pedidos deixaria as outras telas mostrando o saldo anterior.
  const invalidate = useApiInvalidate();
  const refreshOrders = () => invalidate("/sales-orders", "/jewelry", "/finance", "/dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(newSalesForm);
  const [line, setLine] = useState(defaultSalesLine());
  const [items, setItems] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [automaticInstallments, setAutomaticInstallments] = useState(true);
  const [error, setError] = useState("");
  // Cotação oficial do backend (`POST /sales-orders/quote`). Só vale para a
  // combinação exata de itens + cupom + desconto em `key`: qualquer edição
  // torna a cotação velha e ela deixa de ser usada imediatamente.
  const [quoteState, setQuoteState] = useState(QUOTE_IDLE);
  const quoteSequence = useRef(0);
  // Força nova cotação da MESMA combinação (após descartar uma em andamento,
  // ou em "Tentar novamente"), já que o efeito só reage a mudanças.
  const [quoteNonce, setQuoteNonce] = useState(0);
  const preloadedQuoteKey = useRef("");
  // Cupom só conta depois de "Aplicar cupom" ser aceito pela cotação: texto
  // apenas digitado não vai no POST nem aparece como "Cupom aplicado".
  const [appliedCouponCode, setAppliedCouponCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(null);
  const [linkedId] = useState(() => Number(new URLSearchParams(window.location.search).get("sale")) || 0);
  const { data: linkedSale } = useFetch(linkedId > 0 ? `/sales-orders/${linkedId}` : null);
  useEffect(() => {
    if (linkedId > 0 && linkedSale) setDetails({ id: linkedId, ...linkedSale });
  }, [linkedId, linkedSale]);
  const [returnOrder, setReturnOrder] = useState(null);
  const [returnForm, setReturnForm] = useState(null);
  const [returnedQuantities, setReturnedQuantities] = useState({});
  // Trava o "Confirmar devolução" durante o envio: um segundo clique gravaria
  // outra devolução (com outro reembolso) das unidades ainda devolvíveis.
  const [returnSaving, setReturnSaving] = useState(false);
  // Venda cuja devolução está aberta: o histórico de devoluções que chegar
  // depois de fechar/trocar de venda não pode sobrescrever o formulário atual.
  const returnRequest = useRef(0);
  const [activeStep, setActiveStep] = useState("customer");
  const [view, setView] = useState(initialView === "aberto" ? "aberto" : "historico");
  const [editingItemKey, setEditingItemKey] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: createSignal representa uma borda de evento externa.
  useEffect(() => { if (createSignal) openNew(); }, [createSignal]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialView é a navegação externa; openNew lê o estado atual a cada chamada.
  useEffect(() => {
    if (initialView === "nova") openNew();
    else setView(initialView === "aberto" ? "aberto" : "historico");
  }, [initialView]);
  const canGenerateReceivables = planAllowsAction(features, "sales.generate_receivables");
  const currentUser = readStoredSession()?.user || {};
  const draftValue = useMemo(
    () => ({ form, line, items, installments, automaticInstallments, appliedCouponCode }),
    [appliedCouponCode, automaticInstallments, form, installments, items, line],
  );
  const draft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: currentUser.id || "user",
    formId: "sale-new",
    schemaKey: "sale-v1",
    value: draftValue,
    enabled: modalOpen,
    onRestore: (value) => {
      const restored = value && typeof value === "object" ? value : {};
      const restoredForm = { ...newSalesForm(), ...(restored.form || {}) };
      setForm(can(currentUser, "coupons.apply") ? restoredForm : { ...restoredForm, coupon_code: "" });
      setLine({ ...defaultSalesLine(), ...(restored.line || {}) });
      setItems(asArray(restored.items));
      setInstallments(asArray(restored.installments));
      setAutomaticInstallments(restored.automaticInstallments !== false);
      // O cupom restaurado volta a ser conferido pela cotação automática —
      // desde que o perfil atual possa aplicar cupom (senão a cotação daria
      // 403 em loop e a venda ficaria travada).
      setAppliedCouponCode(can(currentUser, "coupons.apply") ? String(restored.appliedCouponCode || "") : "");
      resetQuote();
      setCouponError("");
      setActiveStep("customer");
    },
  });
  const canCancelSales = can(currentUser, "sales.cancel");
  const canReturnSales = can(currentUser, "sales.edit_closed");
  const canRefundSales = can(currentUser, "finance.refund");
  const canApplyCredit = can(currentUser, "finance.edit");
  const canApplyDiscount = can(currentUser, "sales.apply_discount");
  const canApplyCoupon = can(currentUser, "coupons.apply");
  const safeOrders = asArray(orders);
  const safeJewelry = asArray(jewelry).filter((item) => Boolean(Number(item.can_sell ?? 1)));
  const statusOptions = distinctOptions(safeOrders, (order) => order.status, (value) => ORDER_STATUS_LABELS[value] || value);
  const typeOptions = distinctOptions(safeOrders, (order) => order.order_type, saleOrderTypeLabel);
  const sourceOptions = distinctOptions(safeOrders, (order) => order.source, saleSourceLabel);
  const paymentOptions = [...new Set(safeOrders.map((order) => order.payment_method || "Pix"))].sort();
  const visibleOrders = view === "aberto"
    ? safeOrders.filter((order) => ["pendente", "aberta", "aberto"].includes(order.status))
    : safeOrders.filter((order) => !["pendente", "aberta", "aberto"].includes(order.status));
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
    .filter((item) => item.item_type === "produto" && item.stock_key === stockKey && item.row_key !== editingItemKey)
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
    const rowKey = crypto.randomUUID?.() || `sale-${Date.now()}-${Math.random()}`;
    setLine({ ...defaultSalesLine(), item_type: "produto", product_id: String(product.id), product_variant_id: variant?.id ? String(variant.id) : "", unit_price: unitPrice });
    // Escolher a joia já coloca 1 un. no carrinho. A linha passa a EDITAR esse
    // item ("Salvar alteração"): antes, clicar em "Adicionar item" logo depois
    // inseria a mesma joia de novo e o estoque e o total saíam em dobro.
    setEditingItemKey(rowKey);
    setItems((current) => [...current, {
      row_key: rowKey,
      item_type: "produto", product_id: Number(product.id), service_id: null,
      item_name: variant ? `${product.name} - ${variant.variation_name || variant.sku}` : product.name,
      quantity: 1, product_variant_id: variant ? Number(variant.id) : null,
      variation_name: variant?.variation_name || variant?.sku || "",
      stock_key: variant ? `variant:${variant.id}` : `product:${product.id}`,
      available_stock: availableStock, unit_price: unitPrice, notes: ""
    }]);
    resetQuote();
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
    total: fromCents(monthOrders.reduce((sum, order) => sum + toCents(order.total_value), 0)),
    products: fromCents(monthOrders.filter((order) => order.order_type === "produto").reduce((sum, order) => sum + toCents(order.total_value), 0))
  };

  function resetQuote() {
    quoteSequence.current += 1;
    preloadedQuoteKey.current = "";
    setQuoteState(QUOTE_IDLE);
    setQuoteNonce((current) => current + 1);
  }

  function resetCoupon() {
    setAppliedCouponCode("");
    setCouponError("");
  }

  function openNew() {
    if (!draft.savedAt || draft.hasDraft) {
      setForm(newSalesForm());
      setItems([]);
      setInstallments([]);
      setAutomaticInstallments(true);
      setLine(defaultSalesLine());
      setEditingItemKey("");
      setError("");
      resetCoupon();
      resetQuote();
      setActiveStep("customer");
    }
    setModalOpen(true);
  }

  function moveSalesStep(offset) {
    const index = SALES_STEPS.findIndex((step) => step.id === activeStep);
    const next = SALES_STEPS[Math.max(0, Math.min(SALES_STEPS.length - 1, index + offset))];
    if (next) setActiveStep(next.id);
  }

  function closeModal() {
    draft.flushDraft();
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
    const nextItem = {
      row_key: editingItemKey || crypto.randomUUID?.() || `sale-${Date.now()}-${Math.random()}`,
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
    };
    setItems((current) => editingItemKey
      ? current.map((item) => item.row_key === editingItemKey ? nextItem : item)
      : [...current, nextItem]);
    // Itens mudaram: a cotação anterior não vale mais para esta venda.
    resetQuote();
    setEditingItemKey("");
    setLine((current) => ({ ...current, quantity: 1, notes: "" }));
  }

  function editSalesItem(item) {
    setEditingItemKey(item.row_key);
    setLine({
      ...defaultSalesLine(),
      item_type: item.item_type,
      product_id: String(item.product_id || ""),
      product_variant_id: item.product_variant_id ? String(item.product_variant_id) : "",
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unit_price || 0),
      notes: item.notes || "",
    });
  }

  function removeLine(index) {
    // Remover o item que a linha está editando: "Salvar alteração" não teria
    // mais o que atualizar e a edição sumiria calada.
    if (items[index]?.row_key === editingItemKey) setEditingItemKey("");
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    resetQuote();
  }

  // Prévia local só para a tela não ficar vazia enquanto a cotação oficial
  // responde; ela nunca decide o valor gravado nem a validação das parcelas
  // quando há cupom, desconto ou contas a receber.
  const localGrossCents = items
    .filter((item) => item.item_type === "produto")
    .reduce((sum, item) => sum + toCents(item.unit_price) * wholeQuantity(item.quantity), 0);
  // Sem a permissão, o desconto manual nunca é enviado (nem um restaurado do rascunho).
  const manualDiscountCents = canApplyDiscount ? Math.max(0, toCents(form.manual_discount_value)) : 0;
  const manualDiscountReason = canApplyDiscount ? String(form.manual_discount_reason || "").trim() : "";
  const itemsKey = items.map((item) => [item.item_type, item.product_id, item.product_variant_id, wholeQuantity(item.quantity), toCents(item.unit_price)]);
  // O cupom pode ter limite por cliente: o backend resolve o cliente pelo
  // WhatsApp, então trocar o WhatsApp com cupom aplicado exige nova cotação.
  const couponClient = (couponCode) => (couponCode ? String(form.whatsapp || "").trim() : "");
  // O cupom é calculado sobre o bruto e não depende do desconto manual: enquanto
  // só o desconto manual muda, o valor do cupom da última cotação dos MESMOS
  // itens + cupom continua valendo. Sem isso o cupom "sumia" a cada tecla e o
  // atalho % do resumo calculava sobre o bruto inteiro em vez de bruto − cupom.
  const couponKeyFor = (couponCode) => JSON.stringify({ items: itemsKey, coupon: couponCode, client: couponClient(couponCode) });
  const quoteKeyFor = (couponCode) => JSON.stringify({ items: itemsKey, coupon: couponCode, client: couponClient(couponCode), manual: manualDiscountCents });
  const quoteKey = quoteKeyFor(appliedCouponCode);
  const couponKey = couponKeyFor(appliedCouponCode);
  const couponBasis = appliedCouponCode && quoteState.basis?.key === couponKey ? quoteState.basis : null;
  const freshQuote = quoteState.status === "ready" && quoteState.key === quoteKey ? quoteState.quote : null;
  const quoteError = quoteState.status === "error" && quoteState.key === quoteKey ? quoteState.error : "";
  const grossCents = freshQuote ? freshQuote.grossCents : localGrossCents;
  const couponDiscountCents = freshQuote ? freshQuote.couponCents : couponBasis ? couponBasis.couponCents : 0;
  const discountCents = freshQuote ? freshQuote.discountCents : Math.min(grossCents, couponDiscountCents + manualDiscountCents);
  const netCents = freshQuote ? freshQuote.netCents : Math.max(0, grossCents - discountCents);
  // Teto do desconto manual: o bruto menos o que o cupom já descontou.
  const manualDiscountMaxCents = Math.max(0, grossCents - couponDiscountCents);
  const manualDiscountTooHigh = manualDiscountCents > manualDiscountMaxCents;
  // Só a venda concluída com "Recebido agora" grava pagamento ao salvar.
  const paidOnSave = form.receivable_mode === "paid" && form.status === "concluida";
  // Desconto acima do teto já é recusado na tela: não há o que cotar (o
  // servidor só responderia 400 com a mesma mensagem).
  const quoteLoading = items.length > 0 && !freshQuote && !quoteError && !manualDiscountTooHigh;
  const saleTotal = fromCents(netCents);
  const typedCoupon = String(form.coupon_code || "").trim().toUpperCase();
  // Sem a permissão o campo fica travado: um texto restaurado do rascunho não
  // pode bloquear o salvamento (ele nunca é enviado no POST).
  const couponPendingApply = canApplyCoupon && Boolean(typedCoupon) && typedCoupon !== appliedCouponCode;
  // Mensagem do cupom sempre a partir da cotação ATUAL: depois de editar os
  // itens o valor anterior do cupom não vale mais.
  const couponConfirmed = Boolean(appliedCouponCode) && Boolean(freshQuote || couponBasis);
  const appliedCouponMessage = !appliedCouponCode
    ? ""
    : !couponConfirmed
      ? quoteError ? "" : `Conferindo o cupom ${appliedCouponCode}…`
      : couponDiscountCents > 0
        ? `Cupom ${appliedCouponCode} aplicado: − ${currency.format(fromCents(couponDiscountCents))}.`
        : `Cupom ${appliedCouponCode} aceito, sem desconto sobre os itens atuais.`;

  function quoteRequestBody(couponCode) {
    return JSON.stringify({
      full_name: form.full_name,
      whatsapp: form.whatsapp,
      order_type: "produto",
      source: "interno",
      coupon_code: couponCode || "",
      manual_discount_value: fromCents(manualDiscountCents),
      manual_discount_reason: manualDiscountReason,
      items,
    });
  }

  async function requestSalesQuote(couponCode) {
    try {
      const response = await apiFetch("/sales-orders/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: quoteRequestBody(couponCode),
      });
      const payload = await response?.json?.().catch(() => ({}));
      if (!response?.ok) return { ok: false, error: payload?.error || "Não foi possível conferir o total da venda." };
      return { ok: true, quote: normalizeSalesQuote(payload) };
    } catch {
      return { ok: false, error: "Sem conexão para conferir o total da venda. Tente novamente." };
    }
  }

  // Cotação oficial com espera curta enquanto o caixa digita. A sequência
  // descarta respostas atrasadas de uma combinação que já foi editada.
  // biome-ignore lint/correctness/useExhaustiveDependencies: quoteKey resume itens, cupom e desconto que entram na cotação.
  useEffect(() => {
    if (!modalOpen || !items.length) {
      quoteSequence.current += 1;
      setQuoteState(QUOTE_IDLE);
      return undefined;
    }
    if (preloadedQuoteKey.current === quoteKey) {
      // "Aplicar cupom" já trouxe a cotação desta mesma combinação.
      preloadedQuoteKey.current = "";
      return undefined;
    }
    const sequence = ++quoteSequence.current;
    const key = quoteKey;
    const basisKey = couponKey;
    if (manualDiscountTooHigh) {
      setQuoteState((current) => ({ status: "blocked", key, quote: null, error: "", basis: current.basis }));
      return undefined;
    }
    setQuoteState((current) => ({ status: "loading", key, quote: null, error: "", basis: current.basis }));
    const timer = setTimeout(async () => {
      const result = await requestSalesQuote(appliedCouponCode);
      if (sequence !== quoteSequence.current) return;
      setQuoteState((current) => (result.ok
        ? { status: "ready", key, quote: result.quote, error: "", basis: { key: basisKey, couponCents: result.quote.couponCents } }
        : { status: "error", key, quote: null, error: result.error, basis: current.basis }));
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [modalOpen, quoteKey, quoteNonce, manualDiscountTooHigh]);

  async function applyCoupon() {
    if (!canApplyCoupon || !typedCoupon || !items.length) return;
    setError(""); setCouponError("");
    setApplyingCoupon(true);
    quoteSequence.current += 1;
    const sequence = quoteSequence.current;
    const result = await requestSalesQuote(typedCoupon);
    setApplyingCoupon(false);
    if (sequence !== quoteSequence.current) return;
    if (!result.ok) {
      setAppliedCouponCode("");
      setCouponError(result.error || "Cupom inválido ou não aplicável.");
      // A cotação automática em andamento foi descartada acima: cota de novo
      // a venda sem o cupom recusado.
      resetQuote();
      return;
    }
    const nextKey = quoteKeyFor(typedCoupon);
    preloadedQuoteKey.current = nextKey;
    setQuoteState({
      status: "ready",
      key: nextKey,
      quote: result.quote,
      error: "",
      basis: { key: couponKeyFor(typedCoupon), couponCents: result.quote.couponCents },
    });
    setAppliedCouponCode(typedCoupon);
  }

  function removeCoupon() {
    setForm((current) => ({ ...current, coupon_code: "" }));
    resetCoupon();
  }

  function changeManualDiscount(value) {
    if (!canApplyDiscount) return;
    const parsed = Number(value);
    const cents = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
    setForm((current) => ({ ...current, manual_discount_value: fromCents(cents) }));
  }

  async function saveOrder(event) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (!items.length) {
      setError("Adicione ao menos um item à venda.");
      return;
    }
    if (couponPendingApply) {
      setError("Clique em “Aplicar cupom” ou remova o cupom digitado antes de salvar.");
      return;
    }
    if (manualDiscountTooHigh) {
      setError("O desconto não pode ser maior que o valor bruto.");
      return;
    }
    if (form.receivable_mode === "pending" && !canGenerateReceivables) {
      setError("Gerar contas a receber exige o plano Profissional. Registre a venda como recebida agora ou faça o upgrade.");
      return;
    }
    // Com cupom, desconto ou parcelas, o valor que vale é o da cotação oficial:
    // sem ela a tela poderia gravar/parcelar um total diferente do servidor.
    const needsOfficialQuote = Boolean(appliedCouponCode) || manualDiscountCents > 0 || form.receivable_mode === "pending";
    if (!freshQuote && quoteLoading) {
      setError("Aguarde a conferência do total da venda e tente salvar de novo.");
      return;
    }
    if (!freshQuote && needsOfficialQuote) {
      setError(quoteError || "Não foi possível conferir o total da venda. Tente novamente.");
      return;
    }
    if (form.receivable_mode === "pending") {
      const schedule = installmentSummary(saleTotal, installments, form.installment_count);
      if (!schedule.isValid) {
        setError("Revise as parcelas: a soma deve coincidir com o total da venda e todos os campos são obrigatórios.");
        return;
      }
    }
    setSaving(true);
    try {
      const response = await apiFetch("/sales-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          coupon_code: appliedCouponCode,
          manual_discount_value: fromCents(manualDiscountCents),
          manual_discount_reason: manualDiscountCents > 0 ? manualDiscountReason : "",
          order_type: "produto",
          source: "interno",
          installments: form.receivable_mode === "pending" ? installmentsForPayload(installments) : [],
          items
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error || "Não foi possível salvar a venda.");
        return;
      }
    } catch {
      setError("Sem conexão para salvar a venda. Tente novamente.");
      return;
    } finally {
      setSaving(false);
    }
    setForm(newSalesForm());
    setItems([]);
    setInstallments([]);
    setAutomaticInstallments(true);
    setLine(defaultSalesLine());
    resetCoupon();
    resetQuote();
    draft.clearDraft();
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
    try {
      const response = await apiFetch(`/sales-orders/${order.id}`);
      const payload = await response.json().catch(() => ({}));
      // Detalhe fechado (ou outra venda aberta) enquanto a resposta vinha.
      setDetails((current) => (current && String(current.id) === String(order.id)
        ? (response.ok ? payload : { ...order, error: payload.error || "Não foi possível abrir a venda." })
        : current));
    } catch {
      setDetails((current) => (current && String(current.id) === String(order.id)
        ? { ...order, error: "Sem conexão para abrir a venda. Tente novamente." }
        : current));
    }
  }

  function returnFormFor(order, returned) {
    return {
      financial_action: Number(order.paid_value || 0) > 0 && canRefundSales ? "manual_refund" : "none",
      refund_method: "Pix",
      reason: "",
      // Sugere devolver só o que ainda é devolvível: unidades já devolvidas
      // seriam recusadas pelo servidor.
      items: asArray(order.items).map((item) => ({
        sales_order_item_id: item.id,
        quantity: Math.max(0, wholeQuantity(item.quantity || 1) - wholeQuantity(returned[item.id])),
        return_to_stock: true,
        condition: "sellable",
        notes: ""
      }))
    };
  }

  async function openReturn(order) {
    setError("");
    const request = ++returnRequest.current;
    setReturnOrder(order);
    setReturnedQuantities({});
    setReturnForm(returnFormFor(order, {}));
    // Devoluções anteriores definem o saldo devolvível e o arredondamento
    // acumulado do valor; sem elas a tela segue com a venda inteira.
    try {
      const response = await apiFetch(`/sales-orders/${order.id}/returns`);
      if (!response?.ok || request !== returnRequest.current) return;
      const payload = await response.json().catch(() => []);
      if (request !== returnRequest.current) return;
      const returned = {};
      for (const saleReturn of asArray(payload?.items ?? payload)) {
        for (const item of asArray(saleReturn?.items)) {
          returned[item.sales_order_item_id] = (returned[item.sales_order_item_id] || 0) + wholeQuantity(item.quantity);
        }
      }
      setReturnedQuantities(returned);
      setReturnForm((current) => (current ? { ...returnFormFor(order, returned), financial_action: current.financial_action, refund_method: current.refund_method, reason: current.reason } : current));
    } catch {
      // Sem histórico: o servidor continua validando o saldo devolvível.
    }
  }

  function closeReturn() {
    returnRequest.current += 1;
    setReturnOrder(null);
    setReturnForm(null);
    setReturnedQuantities({});
  }

  async function saveReturn() {
    if (returnSaving) return;
    setError("");
    if (!returnForm?.reason?.trim()) return setError("Informe o motivo da devolução.");
    const invalidQuantity = returnForm.items.find((item) => {
      const value = Number(item.quantity || 0);
      return !Number.isInteger(value) || value < 0;
    });
    if (invalidQuantity) return setError("A quantidade devolvida deve ser um número inteiro (0 ou mais).");
    const exceeded = returnForm.items.findIndex((item, index) => returnPreview[index] && Number(item.quantity || 0) > returnPreview[index].available);
    if (exceeded >= 0) {
      const name = asArray(returnOrder.items)[exceeded]?.item_name || "o item";
      return setError(`A devolução de ${name} supera a quantidade ainda devolvível (${returnPreview[exceeded].available}).`);
    }
    const itemsToReturn = returnForm.items
      .filter((item) => Number(item.quantity || 0) > 0)
      .map((item) => ({ ...item, quantity: Number(item.quantity) }));
    if (!itemsToReturn.length) return setError("Informe ao menos um item para devolver.");
    setReturnSaving(true);
    try {
      const response = await apiFetch(`/sales-orders/${returnOrder.id}/returns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...returnForm, items: itemsToReturn }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível registrar a devolução.");
    } catch {
      return setError("Sem conexão para registrar a devolução. Tente novamente.");
    } finally {
      setReturnSaving(false);
    }
    closeReturn(); refreshOrders();
  }

  // Prévia do valor da devolução pelo líquido rateado (bruto do item menos a
  // parte do desconto que coube a ele). O servidor recalcula ao confirmar.
  const returnDiscounts = returnOrder ? saleItemDiscountCents(returnOrder) : [];
  const returnPreview = returnForm && returnOrder
    ? returnForm.items.map((row, index) => {
      const original = asArray(returnOrder.items)[index] || {};
      const sold = wholeQuantity(original.quantity);
      const grossItem = toCents(original.unit_price) * sold;
      const discountItem = Math.min(grossItem, returnDiscounts[index] || 0);
      const netItem = Math.max(0, grossItem - discountItem);
      const alreadyReturned = wholeQuantity(returnedQuantities[original.id]);
      return {
        sold,
        alreadyReturned,
        available: Math.max(0, sold - alreadyReturned),
        discountItem,
        unitNet: sold ? Math.round(netItem / sold) : 0,
        refund: saleReturnRefundCents(netItem, sold, alreadyReturned, Math.min(wholeQuantity(row.quantity), Math.max(0, sold - alreadyReturned))),
      };
    })
    : [];
  const returnPreviewTotal = returnPreview.reduce((sum, row) => sum + row.refund, 0);
  const detailMoney = details && !details.loading && !details.error ? orderMoney(details) : null;
  const detailItemDiscounts = detailMoney ? saleItemDiscountCents(details) : [];

  async function applyCredit(order) {
    const response = await apiFetch(`/sales-orders/${order.id}/apply-client-credit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível aplicar o crédito disponível.");
    await openDetails(order);
    refreshOrders();
  }

  return (
    <section className="sales-page stack">
      <CollapsibleIndicators screenId="sales"><div className="metric-grid">
        <Metric label="Vendas no mês" value={currency.format(summary.total)} />
        <Metric label="Produtos" value={currency.format(summary.products)} />
      </div></CollapsibleIndicators>

      <div className="panel">
        <CrudHeader
          title={view === "aberto" ? "Vendas em aberto" : "Histórico de vendas"}
          subtitle={view === "aberto" ? "Pedidos que ainda exigem conclusão operacional" : "Pedidos internos com baixa financeira"}
          actionLabel="Nova venda"
          onAction={openNew}
        />
        <div className="toolbar compact-actions">
          <Button variant={view === "aberto" ? "primary" : "secondary"} type="button" onClick={() => setView("aberto")}>Em aberto</Button>
          <Button variant={view === "historico" ? "primary" : "secondary"} type="button" onClick={() => setView("historico")}>Histórico</Button>
        </div>
        <DataView
          rows={visibleOrders}
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
              canCancelSales && !["cancelado", "cancelada"].includes(order.status) && order.source !== "agenda" &&
                !Number(order.stock_deducted || 0) && !Number(order.paid_value || 0) && {
                label: "Cancelar", onClick: () => updateStatus(order, "cancelado"), danger: true
              },
              canReturnSales && Number(order.stock_deducted || 0) && order.source !== "agenda" && order.status !== "devolvida" && {
                label: "Devolução / troca", onClick: () => openReturn(order), danger: true
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
            <Button type="button" variant="secondary" onClick={() => activeStep === "customer" ? closeModal() : moveSalesStep(-1)}>
              {activeStep === "customer" ? "Cancelar" : "Voltar"}
            </Button>
            {activeStep === "payment" ? (
              <Button type="submit" form="sales-order-form" variant="primary" disabled={saving}>{saving ? "Salvando…" : "Salvar venda"}</Button>
            ) : (
              <Button type="button" variant="primary" onClick={() => moveSalesStep(1)}>Continuar</Button>
            )}
          </>
        )}
      >
        <form id="sales-order-form" className="stack" onSubmit={saveOrder}>
          <FormWorkflow
            mobileFullscreen
            title="Cadastro da venda"
            description="Cliente, itens e pagamento em uma sequência curta e objetiva."
            eyebrow="Vendas"
            draft={draft}
            actions={draft.hasDraft ? (
              <>
                <Button type="button" variant="secondary" onClick={draft.restoreDraft}>Restaurar</Button>
                <Button type="button" variant="ghost" onClick={draft.discardDraft}>Descartar</Button>
              </>
            ) : null}
          >
            <StepNavigator steps={SALES_STEPS} currentStep={activeStep} onStepChange={setActiveStep} canNavigateTo={undefined} />
            <ValidationSummary errors={error ? [error] : []} />

            {activeStep === "customer" && <FormWorkflow.Page title="Cliente" description="Dados necessários para identificar e contatar o comprador.">
              <FormSection title="Dados principais" badge="Obrigatório">
                <div className="form-grid">
                  <Input label="Cliente" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
                  <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
                </div>
              </FormSection>
              <AdvancedFields title="Contato e status" description="Instagram e situação inicial da venda." count={undefined} open={undefined} onOpenChange={undefined}>
                <div className="form-grid">
                  <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
                  <Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
                    <option value="concluida">concluída</option>
                    <option value="aberta">aberta</option>
                  </Select>
                </div>
              </AdvancedFields>
            </FormWorkflow.Page>}

            {activeStep === "items" && <FormWorkflow.Page title="Itens da venda" description="Adicione e revise as joias sem abrir outro formulário.">
              <FormSection title="Selecionar joia" description={`${items.length} item(ns) adicionado(s)`}>
          <div className="sales-line-builder">
            <div className="sales-line-header">
              <strong>Nova linha</strong>
              <span>Escolha o item, a quantidade e o valor.</span>
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
                <Input type="number" label="Quantidade" value={line.quantity} onChange={(value) => setLine({ ...line, quantity: Number(value || 0) })} />
                {availableQuantity !== null && (
                  <span className={exceedsStock ? "field-hint is-error" : "field-hint"}>
                    {availableQuantity > 0
                      ? `${availableQuantity} un. disponível(is) em estoque${reservedInCart ? ` (${reservedInCart} un. já nesta venda)` : ""}.`
                      : "Sem saldo em estoque para este item."}
                  </span>
                )}
              </div>
              <Input type="number" label="Valor unitário" value={line.unit_price} onChange={(value) => setLine({ ...line, unit_price: Number(value || 0) })} />
            </div>
            <Textarea label="Observações do item" value={line.notes} onChange={(value) => setLine({ ...line, notes: value })} />
            <Button variant="secondary" type="button" onClick={addLineItem} disabled={exceedsStock}>{editingItemKey ? "Salvar alteração" : "Adicionar item"}</Button>
          </div>

          <ResponsiveEditableList
            items={items}
            ariaLabel="Itens da venda"
            getKey={(item) => item.row_key || `${item.stock_key}-${item.item_name}`}
            columns={[
              { key: "item", label: "Item", render: (item) => item.item_name },
              { key: "type", label: "Tipo", render: (item) => saleItemLabel(item.item_type) },
              { key: "quantity", label: "Qtd.", value: (item) => item.quantity },
              { key: "unit_price", label: "Unitário", align: "right", render: (item) => currency.format(item.unit_price) },
              { key: "subtotal", label: "Subtotal", align: "right", render: (item) => currency.format(fromCents(toCents(item.unit_price) * wholeQuantity(item.quantity))) },
            ]}
            onEdit={editSalesItem}
            onRemove={(_item, index) => removeLine(index)}
          />
              </FormSection>
            </FormWorkflow.Page>}

            {activeStep === "payment" && <FormWorkflow.Page title="Pagamento e conferência" description="Registre o recebimento sem alterar a origem da venda.">
              <FormSection title="Recebimento" badge="Obrigatório">
                <div className="form-grid">
                  <Select label="Forma de pagamento" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}>
                    <option>Pix</option><option>Dinheiro</option><option>Cartão de crédito</option><option>Cartão de débito</option>
                  </Select>
                  <Select label="Recebimento" value={form.receivable_mode} onChange={(value) => setForm({ ...form, receivable_mode: value })}>
                    <option value="paid">Recebido agora</option>
                    <option value="pending" disabled={!canGenerateReceivables}>Gerar contas a receber{canGenerateReceivables ? "" : " — Profissional"}</option>
                  </Select>
                  {form.receivable_mode === "pending" && <>
                    <Input type="number" min="1" max="120" label="Parcelas" value={form.installment_count} onChange={(value) => setForm({ ...form, installment_count: Number(value || 1) })} required />
                    <Input type="date" label="Primeiro vencimento" value={form.first_due_date} onChange={(value) => setForm({ ...form, first_due_date: value })} required />
                  </>}
                </div>
                {!canGenerateReceivables && <PlanUpgradeNotice title="Contas a receber no plano Profissional" onUpgrade={onUpgrade}>A venda e o pagamento imediato continuam disponíveis no Start. O upgrade libera vencimentos e parcelamento em contas a receber.</PlanUpgradeNotice>}
                {form.receivable_mode === "pending" && canGenerateReceivables && <InstallmentGrid total={saleTotal} count={form.installment_count} firstDueDate={form.first_due_date} paymentMethod={form.payment_method} installments={installments} onChange={setInstallments} automatic={automaticInstallments} onAutomaticChange={setAutomaticInstallments} title="Parcelas da venda" />}
              </FormSection>
              <FormSection title="Descontos" description="Cupom e desconto manual entram no total conferido pelo sistema.">
                <div className="catalog-coupon-field sale-coupon-field">
                  <Input
                    label="Cupom"
                    value={form.coupon_code || ""}
                    disabled={!canApplyCoupon || !!appliedCouponCode}
                    onChange={(value) => { setForm({ ...form, coupon_code: value.toUpperCase() }); setCouponError(""); }}
                  />
                  {appliedCouponCode ? (
                    <Button type="button" variant="secondary" onClick={removeCoupon}>Remover cupom</Button>
                  ) : (
                    <Button type="button" variant="secondary" onClick={applyCoupon} disabled={!canApplyCoupon || !typedCoupon || !items.length || applyingCoupon}>
                      {applyingCoupon ? "Aplicando…" : "Aplicar cupom"}
                    </Button>
                  )}
                </div>
                {!canApplyCoupon && <span className="field-hint">Seu perfil não pode aplicar cupom. Peça a um responsável com a permissão “Aplicar cupom”.</span>}
                {couponPendingApply && canApplyCoupon && !couponError && <span className="field-hint">O cupom só vale depois de “Aplicar cupom”.</span>}
                {appliedCouponMessage && <span className="form-success" role="status">{appliedCouponMessage}</span>}
                {couponError && <span className="form-error" role="alert">{couponError}</span>}
                {!canApplyDiscount && <span className="field-hint sale-discount-locked">Desconto manual indisponível para o seu perfil (permissão “Aplicar desconto”).</span>}
              </FormSection>
              {/* O backend só registra o pagamento quando a venda é concluída
                  (services/sales.js): venda "aberta" com "Recebido agora" ainda
                  não recebeu nada e não pode aparecer como "Pago". */}
              <FinancialSummary
                summary={{
                  grossTotal: fromCents(grossCents),
                  serviceSubtotal: 0,
                  productSubtotal: fromCents(grossCents),
                  discountTotal: fromCents(discountCents),
                  couponDiscount: fromCents(couponDiscountCents),
                  manualDiscount: fromCents(manualDiscountCents),
                  netTotal: saleTotal,
                  depositPaid: 0,
                  otherPayments: paidOnSave ? saleTotal : 0,
                  totalPaid: paidOnSave ? saleTotal : 0,
                  outstandingBalance: paidOnSave ? 0 : saleTotal,
                  paymentStatus: paidOnSave ? "pago" : "pendente",
                  // Só anuncia cupom que a cotação oficial confirmou.
                  couponCode: appliedCouponCode && (freshQuote || couponBasis) ? (freshQuote?.couponCode || appliedCouponCode) : "",
                }}
                discountEditable={canApplyDiscount && items.length > 0}
                onDiscountChange={canApplyDiscount ? changeManualDiscount : undefined}
                discountReason={canApplyDiscount ? form.manual_discount_reason || "" : ""}
                onDiscountReasonChange={canApplyDiscount ? (text) => setForm((current) => ({ ...current, manual_discount_reason: text })) : undefined}
                discountMax={fromCents(manualDiscountMaxCents)}
              />
              <div className={`sale-quote-status${quoteError ? " is-error" : ""}`} aria-live="polite">
                {!items.length || manualDiscountTooHigh ? null : quoteError ? (
                  <>
                    <span role="alert">{quoteError}</span>
                    <Button type="button" variant="ghost" onClick={resetQuote}>Tentar novamente</Button>
                  </>
                ) : quoteLoading ? (
                  <span>Conferindo o total da venda…</span>
                ) : (
                  <span>Total conferido pelo sistema.</span>
                )}
              </div>
              <AdvancedFields title="Observações" description="Anotação interna da venda, quando necessária." count={undefined} open={undefined} onOpenChange={undefined}>
                <Textarea label="Observações da venda" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
              </AdvancedFields>
              <ReviewSummary title="Resumo da venda" description={undefined} sections={undefined} onEdit={undefined} items={[
                { label: "Cliente", value: form.full_name },
                { label: "Itens", value: items.length },
                { label: "Valor bruto", value: currency.format(fromCents(grossCents)) },
                ...(couponDiscountCents > 0 ? [{ label: `Cupom ${appliedCouponCode}`, value: `− ${currency.format(fromCents(couponDiscountCents))}` }] : []),
                ...(manualDiscountCents > 0 ? [{ label: "Desconto manual", value: `− ${currency.format(fromCents(manualDiscountCents))}${manualDiscountReason ? ` · ${manualDiscountReason}` : ""}` }] : []),
                { label: "Total líquido", value: currency.format(saleTotal) },
                { label: "Recebimento", value: form.receivable_mode === "pending" ? `${form.installment_count || 1} parcela(s)` : paidOnSave ? "Recebido agora" : "Recebido ao concluir a venda" },
              ]} />
            </FormWorkflow.Page>}
          </FormWorkflow>
        </form>
      </Modal>

      <Modal
        open={!!returnOrder}
        title={`Devolução da venda #${returnOrder?.id || ""}`}
        subtitle="Selecione itens, condição e destino financeiro"
        size="lg"
        onClose={closeReturn}
        footer={<><Button variant="secondary" onClick={closeReturn}>Voltar</Button><Button variant="danger" disabled={!returnForm?.reason?.trim() || returnSaving} onClick={saveReturn}>{returnSaving ? "Registrando…" : "Confirmar devolução"}</Button></>}
      >
        {returnForm && (
          <div className="stack">
            <Select label="Destino do valor já recebido" value={returnForm.financial_action} onChange={(financial_action) => setReturnForm({ ...returnForm, financial_action })}>
              <option value="none">Abater somente contas pendentes</option>
              {canRefundSales && <option value="client_credit">Gerar crédito para o cliente</option>}
              {canRefundSales && <option value="manual_refund">Reembolso manual</option>}
            </Select>
            {returnForm.financial_action === "manual_refund" && (
              <Select label="Forma do reembolso" value={returnForm.refund_method} onChange={(refund_method) => setReturnForm({ ...returnForm, refund_method })}>
                <option>Pix</option><option>Dinheiro</option><option>Cartão</option>
              </Select>
            )}
            <div className="clean-list">
              {returnForm.items.map((item, index) => {
                const original = asArray(returnOrder.items)[index];
                const preview = returnPreview[index];
                return (
                  <div key={item.sales_order_item_id} className="stack sale-return-item">
                    <div className="sale-return-item-header">
                      <strong>{original?.item_name || `Item #${item.sales_order_item_id}`}</strong>
                      {preview && (
                        <small>
                          {preview.sold} un. vendida(s) · {currency.format(fromCents(preview.unitNet))} líquido por unidade
                          {preview.discountItem > 0 ? ` (desconto de ${currency.format(fromCents(preview.discountItem))} no item)` : ""}
                          {preview.alreadyReturned > 0 ? ` · ${preview.alreadyReturned} já devolvida(s)` : ""}
                        </small>
                      )}
                    </div>
                    <div className="form-grid">
                      <Input type="number" min="0" max={preview ? preview.available : original?.quantity || 1} label="Quantidade" value={item.quantity} onChange={(quantity) => setReturnForm({ ...returnForm, items: returnForm.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity } : row) })} />
                      <Select label="Condição" value={item.condition} onChange={(condition) => setReturnForm({ ...returnForm, items: returnForm.items.map((row, rowIndex) => rowIndex === index ? { ...row, condition, return_to_stock: condition === "sellable" } : row) })}>
                        <option value="sellable">Vendável — retornar ao estoque</option>
                        <option value="damaged">Danificado — não retornar</option>
                        <option value="discarded">Descartado — não retornar</option>
                      </Select>
                    </div>
                    {preview && Number(item.quantity || 0) > preview.available ? (
                      <span className="field-hint is-error">Máximo de {preview.available} un. ainda devolvível(is) neste item.</span>
                    ) : preview && wholeQuantity(item.quantity) > 0 && (
                      <span className="sale-return-item-value">A devolver neste item: <strong>{currency.format(fromCents(preview.refund))}</strong></span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="sale-return-total" aria-live="polite">
              <span>Valor da devolução</span>
              <strong>{currency.format(fromCents(returnPreviewTotal))}</strong>
              <small>Calculado pelo valor pago em cada item, já descontado o rateio do cupom e do desconto manual. Contas pendentes são abatidas primeiro; o sistema confirma o valor final ao registrar.</small>
            </div>
            <Textarea label="Motivo obrigatório" value={returnForm.reason} onChange={(reason) => setReturnForm({ ...returnForm, reason })} />
            {error && <span className="form-error" role="alert">{error}</span>}
          </div>
        )}
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
            {detailMoney && (
              <dl className="sale-detail-totals" aria-label="Valores da venda">
                <div>
                  <dt>Valor bruto</dt>
                  <dd>{currency.format(fromCents(detailMoney.gross))}</dd>
                </div>
                <div>
                  <dt>Desconto de cupom{details?.coupon_code ? ` (${details.coupon_code})` : ""}</dt>
                  <dd>{detailMoney.coupon > 0 ? `− ${currency.format(fromCents(detailMoney.coupon))}` : currency.format(0)}</dd>
                </div>
                <div>
                  <dt>Desconto manual</dt>
                  <dd>{detailMoney.manual > 0 ? `− ${currency.format(fromCents(detailMoney.manual))}` : currency.format(0)}</dd>
                  {detailMoney.manual > 0 && details?.manual_discount_reason && <small>Motivo: {details.manual_discount_reason}</small>}
                </div>
                <div className="is-featured">
                  <dt>Valor líquido</dt>
                  <dd>{currency.format(fromCents(detailMoney.net))}</dd>
                </div>
              </dl>
            )}
            <div className="form-grid">
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
            {detailMoney && asArray(details?.items).length > 0 && (
              <section className="soft-card stack">
                <div className="section-inline-header">
                  <strong>Itens da venda</strong>
                  <span>{asArray(details.items).length} item(ns)</span>
                </div>
                <div className="clean-list sale-detail-items">
                  {asArray(details.items).map((item, index) => {
                    const grossItem = toCents(item.unit_price) * wholeQuantity(item.quantity);
                    const discountItem = Math.min(grossItem, detailItemDiscounts[index] || 0);
                    return (
                      <div key={item.id || `${item.item_name}-${index}`}>
                        <span>
                          <strong>{item.item_name}</strong>
                          <small>{wholeQuantity(item.quantity)} × {currency.format(Number(item.unit_price || 0))}{discountItem > 0 ? ` · desconto − ${currency.format(fromCents(discountItem))}` : ""}</small>
                        </span>
                        <strong>{currency.format(fromCents(grossItem - discountItem))}</strong>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
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
            {canApplyCredit && details?.receivable_mode === "pending" && <Button variant="secondary" onClick={() => applyCredit(details)}>Aplicar crédito disponível</Button>}
          </div>
        )}
      </Modal>
    </section>
  );
}
