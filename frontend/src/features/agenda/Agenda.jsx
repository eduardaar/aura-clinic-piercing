// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, ExternalLink, Filter, MoreHorizontal, Plus, Search, Settings2, X } from "lucide-react";
import { Accordion, Button, Checkbox, FinancialSummary, Input, Metric, PaymentSelect, Select, StatusBadge, Switch, Tabs, Textarea } from "../../components/common/Ui";
import { Modal, CrudHeader, ConfirmDeleteModal, DropdownMenu, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { FormSection, FormWorkflow, ReviewSummary, StepNavigator, ValidationSummary } from "../../components/common/FormWorkflow";
import { ResponsiveEditableList } from "../../components/common/TransactionFields";
import { CollapsibleIndicators } from "../../components/common/CollapsibleIndicators";
import { asArray, asNumber, asObject, formatDate, localDateValue } from "../../lib/utils";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { buildCalendar, buildTimeSlots, dateKey, movePeriod } from "../../lib/calendarUtils";
import { defaultAppointment, defaultProfessionalForm, defaultScheduleBlock } from "../../lib/defaultForms";
import { appointmentWhatsAppMessage, currency, personName, statusClass, weekdayLabel, whatsappUrl } from "../../features/shared/helpers";
import { SmartCombobox } from "../../components/common/SmartCombobox";
import { publicLinkForTenant } from "../../lib/publicRoutes";
import { PlanUpgradeNotice } from "../../components/common/PlanUpgradeNotice";
import { can, planAllowsAction } from "../../lib/permissions";
import { useFormDraft } from "../../lib/useFormDraft";
import { ServicesWorkspace } from "../services/Services";
import { calculateOperationTotals } from "../../lib/operationTotals";
import { AppointmentValueAdjustments } from "./AppointmentValueAdjustments";
import { ChemicalIndicatorHistory, ChemicalIndicatorPanel } from "./ChemicalIndicatorPanel";
import { ProfessionalCommissionRules } from "./ProfessionalCommissionRules";
import { AppointmentCommissionSummary } from "../finance/CommissionStatement";
import "../../styles/agenda-admin-responsive.css";
import "../../styles/appointment-workspace.css";

// formatDate() de lib/utils devolve dd/MM sem ano, e a agenda lista atendimentos
// de anos diferentes na mesma tabela — aqui a data precisa do ano para não virar
// ambígua. lib/utils é compartilhado com outras telas, então a correção fica aqui.
function formatDateWithYear(date) {
  if (!date) return "";
  const value = String(date).slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

function formatOperationalTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function operationalRequirements(value) {
  if (!value) return { checklist: [], biosafety: { enabled: false, required_fields: [] } };
  if (typeof value === "string") {
    try { return operationalRequirements(JSON.parse(value)); } catch { return { checklist: [], biosafety: { enabled: false, required_fields: [] } }; }
  }
  return {
    checklist: asArray(value.checklist),
    biosafety: { enabled: Boolean(value.biosafety?.enabled), required_fields: asArray(value.biosafety?.required_fields) }
  };
}

// Status canônicos de agendamento, com o rótulo que aparece na tela.
const APPOINTMENT_STATUS_OPTIONS = [
  { value: "pendente", label: "Pendente" },
  { value: "awaiting_deposit_proof", label: "Aguardando sinal" },
  { value: "confirmado", label: "Confirmado" },
  { value: "chegou", label: "Cliente chegou" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "atendido", label: "Atendido" },
  { value: "cancelado", label: "Cancelado" },
  { value: "nao_compareceu", label: "Não compareceu" },
  { value: "remarcado", label: "Remarcado" },
  { value: "recusado", label: "Recusado" }
];
// "Atendido" não é escolhido à mão: o fechamento passa só por "Revisar e
// finalizar" (POST /complete), que registra pagamentos, execução,
// biossegurança e comissão. Escolher o status num seletor criava um
// "atendido" sem nada disso.
const APPOINTMENT_EDITABLE_STATUSES = ["pendente", "confirmado", "chegou", "em_atendimento", "recusado", "remarcado"];

function appointmentStatusLabel(status) {
  return APPOINTMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label || status || "Sem status";
}

/**
 * Seletor de status com rótulos legíveis. O status atual entra na lista só
 * para continuar visível (ex.: "Atendido", "Cancelado"), nunca como escolha nova.
 * @param {{ value?: string, current?: string, onChange: (value: string) => void }} props
 */
function AppointmentStatusSelect({ value, current, onChange }) {
  const options = current && !APPOINTMENT_EDITABLE_STATUSES.includes(current)
    ? [...APPOINTMENT_EDITABLE_STATUSES, current]
    : APPOINTMENT_EDITABLE_STATUSES;
  return (
    <Select label="Status" value={value} onChange={onChange}>
      {options.map((status) => <option key={status} value={status}>{appointmentStatusLabel(status)}</option>)}
    </Select>
  );
}

// Dinheiro sempre em centavos inteiros: somar reais em ponto flutuante
// acumula resíduo (0,1 + 0,2 = 0,30000000000000004).
// Valor digitado em formato brasileiro ("50,5", "1.234,56") virava 0 em
// `Number()` e o sinal sumia da prévia e da gravação sem aviso.
const moneyNumber = (value) => (typeof value === "string" && value.includes(",")
  ? asNumber(value.replace(/\./g, "").replace(",", "."))
  : asNumber(value));
const toCents = (value) => Math.round(moneyNumber(value) * 100);
const fromCents = (cents) => cents / 100;
const depositReceived = (status) => ["pago", "confirmado"].includes(String(status || "").toLowerCase());

// Tudo que não é horário especial nem data indisponível é exibido como bloqueio
// de intervalo; o filtro por tipo segue exatamente esse agrupamento.
function blockTypeLabel(type) {
  if (type === "special_hours") return "Horário especial";
  if (type === "unavailable") return "Data indisponível";
  return "Bloqueio de intervalo";
}

// Opções de select montadas a partir dos próprios dados, sem repetir valores.
function distinctOptions(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
}

export function AgendaWorkspace({ initialScreen = "agenda", initialSettingsTab, navigationTarget, onSettingsClosed, features = [], onUpgrade, createSignal = 0 }) {
  const [screen, setScreen] = useState(initialScreen);
  const [settingsTab, setSettingsTab] = useState(initialSettingsTab);
  useEffect(() => setScreen(initialScreen), [initialScreen]);
  useEffect(() => setSettingsTab(initialSettingsTab), [initialSettingsTab]);
  return screen === "settings"
    ? <BookingAdmin initialTab={settingsTab} features={features} onUpgrade={onUpgrade} onBack={() => { setScreen("agenda"); onSettingsClosed?.(); }} />
    : <VisualCalendar navigationTarget={navigationTarget} features={features} onUpgrade={onUpgrade} onOpenSettings={(tab) => { setSettingsTab(tab); setScreen("settings"); }} createSignal={createSignal} />;
}

function PublicBookingLink() {
  const [copied, setCopied] = useState(false);
  const slug = tenantSlug();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = slug ? publicLinkForTenant("/agendar", slug, origin) : "";

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // O endereço continua visível para cópia manual quando a área de
      // transferência não estiver liberada pelo navegador.
    }
  }

  return (
    <div className="agenda-public-link">
      <span className="agenda-public-link-label">Agendamento público</span>
      {url ? <>
        <button type="button" className="agenda-link-copy" onClick={copy} title="Copiar link público"><Copy size={15} /> {copied ? "Copiado!" : "Copiar"}</button>
        <a className="agenda-link-open" href={url} target="_blank" rel="noreferrer" title="Abrir agendamento público" aria-label="Abrir agendamento público"><ExternalLink size={16} /></a>
      </> : <span className="form-error">Defina o código público da clínica.</span>}
    </div>
  );
}

function priceAppointmentDraft(draft, services = [], jewelryList = []) {
  const items = normalizeAppointmentFormItems(draft, services, jewelryList);
  const firstItem = /** @type {Record<string, any>} */ (items[0] || {});
  const values = appointmentValueParts(draft, services, jewelryList, items);
  const firstService = asArray(services).find((item) => String(item.id) === String(firstItem.service_id));
  return {
    ...draft,
    service_id: firstItem.service_id || draft.service_id,
    jewelry_id: firstItem.jewelry_id || "",
    jewelry_variant_id: firstItem.jewelry_variant_id || "",
    procedure: firstService?.name || draft.procedure,
    piercing_region: firstItem.region || draft.piercing_region,
    appointment_items: items,
    total_value: values.totalValue,
    deposit_value: values.depositValue,
    deposit_expected_value: draft.deposit_expected_value ?? values.depositExpectedValue,
    remaining_value: values.remainingValue
  };
}

function itemGrossCents(item) {
  return toCents(item.procedure_price) + Math.round(toCents(item.jewelry_unit_price) * Math.max(1, asNumber(item.quantity, 1)));
}

function appointmentValueParts(form, services = [], jewelryList = [], normalizedItems = null) {
  const items = normalizedItems || normalizeAppointmentFormItems(form, services, jewelryList);
  const procedureCents = items.reduce((sum, item) => sum + toCents(item.procedure_price), 0);
  const jewelryCents = items.reduce((sum, item) => sum + Math.round(toCents(item.jewelry_unit_price) * Math.max(1, asNumber(item.quantity, 1))), 0);
  const totalCents = procedureCents + jewelryCents;
  const firstService = asArray(services).find((item) => String(item.id) === String(items[0]?.service_id));
  // O sinal sugerido vem do serviço até a pessoa editar o campo; depois disso
  // (`deposit_manual`) vale o que ela digitou, inclusive zero.
  const depositCents = form.deposit_manual
    ? Math.max(0, toCents(form.deposit_value))
    : Math.max(0, toCents(form.deposit_value || firstService?.deposit_value || 0));
  return {
    procedureValue: fromCents(procedureCents),
    jewelryValue: fromCents(jewelryCents),
    totalValue: fromCents(totalCents),
    depositValue: fromCents(depositCents),
    depositExpectedValue: asNumber(form.deposit_expected_value ?? firstService?.deposit_value),
    remainingValue: fromCents(Math.max(totalCents - depositCents, 0))
  };
}

// Item com `id` já existe no banco: o id é reenviado no PATCH para o backend
// atualizar a mesma linha (o indicador químico e a comissão se ancoram nele).
function emptyAppointmentItem(seed = {}) {
  const hasId = seed.id !== undefined && seed.id !== null && seed.id !== "";
  return {
    ...(hasId ? { id: seed.id } : {}),
    service_id: seed.service_id || "",
    procedure_id: seed.procedure_id || "",
    region: seed.region || seed.piercing_region || "",
    jewelry_id: seed.jewelry_id || "",
    jewelry_variant_id: seed.jewelry_variant_id || "",
    quantity: seed.quantity || 1,
    procedure_price: seed.procedure_price || 0,
    jewelry_unit_price: seed.jewelry_unit_price || 0,
    duration_minutes: seed.duration_minutes || 40,
    notes: seed.notes || ""
  };
}

// Semeia o formulário com TODOS os itens gravados. A API devolve `items`;
// `appointment_items` fica como alternativa. Só sem itens (dados antigos) cai
// no item único montado a partir das colunas do agendamento.
function appointmentSeedItems(appointment) {
  const source = asArray(appointment?.items).length ? asArray(appointment.items) : asArray(appointment?.appointment_items);
  if (source.length) return source.map((item) => emptyAppointmentItem({ ...item, region: item.region ?? item.piercing_region }));
  return [emptyAppointmentItem({
    ...appointment,
    id: undefined,
    region: appointment?.piercing_region,
    procedure_price: appointment?.service_value,
    jewelry_unit_price: appointment?.jewelry_value
  })];
}

function rawAppointmentItems(form) {
  const items = asArray(form.appointment_items);
  if (items.length) return items;
  if (form.service_id || form.jewelry_id || form.piercing_region) return [emptyAppointmentItem(form)];
  return [emptyAppointmentItem()];
}

function normalizeAppointmentFormItems(form, services = [], jewelryList = []) {
  return rawAppointmentItems(form).map((raw) => {
    // Linha já gravada guarda o próprio serviço e preço: não herda o serviço
    // do 1º item (uma linha só de joia viraria serviço + joia) nem troca um
    // preço zero gravado pelo preço de tabela.
    const persisted = raw.id !== undefined && raw.id !== null && raw.id !== "";
    const serviceId = raw.service_id || (persisted ? "" : form.service_id) || "";
    const service = asArray(services).find((item) => String(item.id) === String(serviceId));
    const jewelry = asArray(jewelryList).find((item) => String(item.id) === String(raw.jewelry_id));
    const variant = asArray(jewelry?.variants).find((item) => String(item.id) === String(raw.jewelry_variant_id));
    const storedPrice = (value) => persisted && value !== undefined && value !== null && value !== "";
    return {
      ...emptyAppointmentItem(raw),
      service_id: serviceId,
      region: raw.region || (persisted ? "" : form.piercing_region) || "",
      quantity: Math.max(1, asNumber(raw.quantity, 1)),
      procedure_price: storedPrice(raw.procedure_price)
        ? asNumber(raw.procedure_price)
        : asNumber(raw.procedure_price || service?.base_price || service?.price || 0),
      jewelry_unit_price: raw.jewelry_id
        ? (storedPrice(raw.jewelry_unit_price) ? asNumber(raw.jewelry_unit_price) : asNumber(raw.jewelry_unit_price || variant?.sale_value || jewelry?.sale_value || 0))
        : 0,
      duration_minutes: asNumber(raw.duration_minutes || service?.duration_minutes || 40)
    };
  });
}

function withAppointmentItems(form, items, services = [], jewelry = []) {
  const normalized = normalizeAppointmentFormItems({ ...form, appointment_items: items }, services, jewelry);
  const first = normalized[0] || emptyAppointmentItem();
  const firstService = asArray(services).find((service) => String(service.id) === String(first.service_id));
  return {
    ...form,
    appointment_items: normalized,
    service_id: first.service_id || "",
    jewelry_id: first.jewelry_id || "",
    jewelry_variant_id: first.jewelry_variant_id || "",
    procedure: firstService?.name || form.procedure || "",
    piercing_region: first.region || form.piercing_region || ""
  };
}

function AppointmentItemsEditor({ form, services, procedures = [], jewelry, onChange, compact = false }) {
  const items = rawAppointmentItems(form);
  function updateItem(index, patch) {
    const nextItems = items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    onChange(withAppointmentItems(form, nextItems, services, jewelry));
  }
  function removeItem(index) {
    const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
    onChange(withAppointmentItems(form, nextItems.length ? nextItems : [emptyAppointmentItem()], services, jewelry));
  }
  return (
    <div className="appointment-items-editor">
      <div className="section-inline-header">
        <strong>Procedimentos e joias</strong>
        <Button variant="secondary" onClick={() => onChange(withAppointmentItems(form, [...items, emptyAppointmentItem()], services, jewelry))}>Adicionar item</Button>
      </div>
      {items.map((item, index) => {
        const selectedJewelry = asArray(jewelry).find((product) => String(product.id) === String(item.jewelry_id));
        const selectedVariant = asArray(selectedJewelry?.variants).find((variant) => String(variant.id) === String(item.jewelry_variant_id));
        const selectedStock = selectedVariant ? asNumber(selectedVariant.quantity) : asNumber(selectedJewelry?.inventory_quantity ?? selectedJewelry?.quantity);
        const selectedService = asArray(services).find((service) => String(service.id) === String(item.service_id));
        const selectedProcedure = asArray(procedures).find((procedure) => String(procedure.id) === String(item.procedure_id));
        const ruleValue = (field) => selectedProcedure?.[field] ?? selectedService?.[field];
        const ruleSummary = [
          ruleValue("minimum_age_years") != null ? `idade mínima ${ruleValue("minimum_age_years")} anos` : "",
          ruleValue("requires_guardian") ? "responsável para menor" : "",
          ruleValue("requires_signed_term") ? "termo obrigatório" : "",
          asNumber(ruleValue("return_after_days")) > 0 ? `retorno em ${ruleValue("return_after_days")} dias` : "",
          asNumber(ruleValue("minimum_advance_minutes")) > 0 ? `${ruleValue("minimum_advance_minutes")} min de antecedência` : ""
        ].filter(Boolean);
        const priced = normalizeAppointmentFormItems({ ...form, appointment_items: [item] }, services, jewelry)[0] || item;
        return (
          <div className={`appointment-item-row ${compact ? "compact" : ""}`} key={item.id ? `item-${item.id}` : `${index}-${item.service_id}-${item.jewelry_id}`}>
            <Select label="Serviço" value={item.service_id} onChange={(value) => {
              const service = asArray(services).find((option) => String(option.id) === String(value));
              updateItem(index, {
                service_id: value,
                procedure_price: asNumber(service?.base_price || service?.price || 0),
                duration_minutes: asNumber(service?.duration_minutes || 40)
              });
            }} required={index === 0}>
              <option value="">Selecione</option>
              {asArray(services).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </Select>
            <Select label="Procedimento" value={item.procedure_id} onChange={(value) => {
              const procedure = asArray(procedures).find((option) => String(option.id) === String(value));
              updateItem(index, {
                procedure_id: value,
                service_id: procedure?.service_id || item.service_id,
                region: procedure?.body_area || item.region,
                procedure_price: asNumber(procedure?.price || selectedService?.base_price || selectedService?.price || item.procedure_price),
                duration_minutes: asNumber(procedure?.duration_minutes || selectedService?.duration_minutes || item.duration_minutes)
              });
            }}>
              <option value="">Sem procedimento específico</option>
              {asArray(procedures).filter((procedure) => !item.service_id || String(procedure.service_id) === String(item.service_id)).map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.name}</option>)}
            </Select>
            <Input label="Região" value={item.region} onChange={(value) => updateItem(index, { region: value })} required={index === 0} />
            <SmartCombobox label="Joia" value={item.jewelry_id} options={asArray(jewelry)} onChange={(value) => { if (!value) updateItem(index, { jewelry_id: "", jewelry_variant_id: "", jewelry_unit_price: 0 }); }} onSelect={(product) => {
              const variant = asArray(product.variants).find((option) => asNumber(option.quantity) > 0) || asArray(product.variants)[0];
              updateItem(index, { jewelry_id: String(product.id), jewelry_variant_id: variant?.id ? String(variant.id) : "", jewelry_unit_price: asNumber(variant?.sale_value || product.sale_value || 0) });
            }} getMeta={(product) => [product.category, product.material, product.sku].filter(Boolean).join(" · ")} isDisabled={(product) => asArray(product.variants).length ? !asArray(product.variants).some((variant) => asNumber(variant.quantity) > 0) : asNumber(product.inventory_quantity ?? product.quantity) <= 0} />
            <Select label="Variação" value={item.jewelry_variant_id} onChange={(value) => {
              const variant = asArray(selectedJewelry?.variants).find((option) => String(option.id) === String(value));
              updateItem(index, { jewelry_variant_id: value, jewelry_unit_price: asNumber(variant?.sale_value || selectedJewelry?.sale_value || 0) });
            }}>
              <option value="">Selecione</option>
              {asArray(selectedJewelry?.variants).filter((variant) => asNumber(variant?.quantity) > 0).map((variant) => (
                <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} · {variant.quantity} un</option>
              ))}
            </Select>
            <Input type="number" min="1" label="Qtd." value={item.quantity} onChange={(value) => updateItem(index, { quantity: value })} />
            <div className="appointment-item-total" aria-live="polite">
              <span>Valor do item</span>
              <strong>{currency.format(fromCents(itemGrossCents(priced)))}</strong>
            </div>
            <Button variant="secondary" className="danger" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label={`Remover item ${index + 1}`}>Remover</Button>
            {ruleSummary.length > 0 && <span className="field-hint">Regras: {ruleSummary.join(" · ")}</span>}
            {selectedJewelry && <div className="appointment-jewelry-selected" data-product-id={selectedJewelry.id}>
              <strong>{selectedJewelry.name}</strong><span>ID {selectedJewelry.id}</span>
              <span>{selectedVariant ? `Variação: ${selectedVariant.variation_name || selectedVariant.sku}` : "Sem variação"}</span>
              <span>Qtd. {Math.max(1, asNumber(item.quantity, 1))}</span><span>Preço {currency.format(asNumber(item.jewelry_unit_price))}</span>
              <span>Estoque {selectedStock} un.</span><span>Subtotal {currency.format(fromCents(Math.round(toCents(item.jewelry_unit_price) * Math.max(1, asNumber(item.quantity, 1)))))}</span>
            </div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Prévia OFICIAL do valor (mesmo cálculo da gravação, sem gravar), com
 * debounce. Devolve `null` enquanto a resposta da combinação atual não chega,
 * para a tela mostrar o cálculo local no meio tempo.
 * @param {Record<string, any> | null} body
 * @param {number} [refreshKey] Muda para refazer a prévia (ex.: após um ajuste de valor).
 */
function useFinancialPreview(body, refreshKey = 0) {
  const bodyJson = body ? JSON.stringify(body) : "";
  const key = bodyJson ? `${bodyJson}#${refreshKey}` : "";
  const [result, setResult] = useState({ key: "", data: null, error: "" });
  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch("/appointments/financial-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyJson });
        const payload = asObject(await response.json().catch(() => ({})));
        if (!active) return;
        if (!response.ok) {
          // Regra de negócio (desconto acima do bruto, cupom inválido) aparece
          // na tela; falha de rede/permissão mantém o cálculo local em silêncio.
          const businessError = [400, 409, 422].includes(response.status) ? String(payload.error || "") : "";
          setResult({ key, data: null, error: businessError });
          return;
        }
        setResult({ key, data: asObject(payload.financial ?? payload.preview ?? payload.summary ?? payload), error: "" });
      } catch {
        if (active) setResult({ key, data: null, error: "" });
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, bodyJson]);
  const current = result.key === key ? result : { key, data: null, error: "" };
  return { preview: current.data, error: current.error, loading: Boolean(key) && result.key !== key };
}

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

/**
 * Resumo financeiro do agendamento (bruto − descontos ± ajustes = líquido;
 * − pago = restante). A fonte oficial é `POST /appointments/financial-preview`;
 * enquanto ela carrega (ou se falhar), vale o cálculo local de
 * lib/operationTotals.js, com a mesma matemática em centavos.
 * @param {{
 *   form: Record<string, any>,
 *   services?: any[],
 *   jewelry?: any[],
 *   appointment?: Record<string, any> | null,
 *   canEditDiscount?: boolean,
 *   discountLockedReason?: string,
 *   onDiscountChange?: (value: number) => void,
 *   onDiscountReasonChange?: (text: string) => void,
 *   depositFromForm?: boolean,
 *   financialOverride?: Record<string, any> | null,
 *   refreshKey?: number,
 *   onSummary?: (summary: Record<string, any>) => void
 * }} props
 */
function AppointmentValueSummary({ form, services, jewelry, appointment = null, canEditDiscount = false, discountLockedReason = "", onDiscountChange, onDiscountReasonChange, depositFromForm = true, financialOverride = null, refreshKey = 0, onSummary }) {
  const items = normalizeAppointmentFormItems(form, services, jewelry);
  const parts = appointmentValueParts(form, services, jewelry, items);
  const hasItems = Boolean(form.service_id || form.jewelry_id);
  const manualDiscount = fromCents(Math.max(0, toCents(form.manual_discount_value)));
  const previewBody = hasItems ? {
    appointment_id: appointment?.id || undefined,
    appointment_items: items,
    coupon_code: String(form.coupon_code || "").trim(),
    manual_discount_value: manualDiscount
  } : null;
  const { preview, error, loading } = useFinancialPreview(previewBody, refreshKey);
  const stored = asObject(appointment);
  const override = asObject(financialOverride);
  const official = preview ? asObject(preview) : null;

  // Valores de preço: prévia oficial > último retorno dos ajustes > gravado.
  const storedCouponCents = appointment ? Math.max(0, toCents(stored.discount_value) - toCents(stored.manual_discount_value)) : 0;
  const couponDiscount = asNumber(firstDefined(
    official?.couponDiscount,
    official ? fromCents(Math.max(0, toCents(official.discountTotal) - toCents(firstDefined(official.manualDiscount, manualDiscount)))) : undefined,
    override.couponDiscount,
    fromCents(storedCouponCents)
  ));
  const adjustmentTotal = asNumber(firstDefined(official?.adjustmentTotal, override.adjustmentTotal, stored.adjustment_total, 0));
  const serviceSubtotal = asNumber(firstDefined(official?.serviceSubtotal, parts.procedureValue));
  const productSubtotal = asNumber(firstDefined(official?.productSubtotal, parts.jewelryValue));

  // Pagamentos: o sinal editado no formulário (ainda não salvo) substitui o
  // gravado; os demais pagamentos confirmados vêm da prévia ou do registro.
  const storedDepositCents = appointment && depositReceived(stored.deposit_status) ? toCents(stored.deposit_value) : 0;
  const formDepositCents = depositReceived(form.deposit_status) ? toCents(parts.depositValue) : 0;
  const depositPaidCents = depositFromForm
    ? formDepositCents
    : toCents(firstDefined(official?.depositPaid, override.depositPaid, fromCents(storedDepositCents)));
  const storedOtherCents = appointment ? Math.max(0, toCents(stored.total_value) - toCents(stored.remaining_value) - storedDepositCents) : 0;
  const otherPaidCents = toCents(firstDefined(official?.otherPayments, override.otherPayments, fromCents(storedOtherCents)));

  const totals = calculateOperationTotals({
    serviceSubtotal,
    productSubtotal,
    couponDiscount,
    manualDiscount,
    discountTotal: fromCents(toCents(couponDiscount) + toCents(manualDiscount)),
    adjustmentTotal,
    payments: [
      depositPaidCents > 0 && { payment_type: "sinal", status: "pago", amount: fromCents(depositPaidCents) },
      otherPaidCents > 0 && { payment_type: "outro", status: "pago", amount: fromCents(otherPaidCents) }
    ].filter(Boolean)
  });
  // A prévia responde 200 mesmo com cupom inválido ou desconto acima do bruto:
  // o motivo vem em `validation`/`coupon.error` e precisa aparecer na tela.
  const officialValidation = asObject(official?.validation);
  const officialCoupon = asObject(official?.coupon);
  const couponError = official ? String(officialValidation.coupon || officialCoupon.error || "") : "";
  const officialWarning = official ? String(officialValidation.discount || officialValidation.net || "") : "";
  const summary = {
    // "Cupom aplicado" só quando o cupom de fato abateu algo; código digitado
    // e recusado não pode aparecer como aplicado.
    couponCode: totals.couponDiscount > 0 ? (String(form.coupon_code || "").trim() || null) : null,
    couponDiscount,
    manualDiscount,
    adjustmentTotal,
    ...totals
  };
  const discountMaxCents = Math.max(0, toCents(serviceSubtotal) + toCents(productSubtotal) - toCents(couponDiscount));
  const localError = toCents(manualDiscount) > discountMaxCents ? "O desconto não pode ser maior que o valor bruto." : "";
  const shownError = error || couponError || officialWarning || localError;
  const outstanding = summary.outstandingBalance;
  // Avisa o pai quando o restante assenta: o oficial, ou o local se a prévia
  // falhou (sem isso a linha padrão de pagamento ficaria com o restante antigo
  // e a finalização estouraria o teto do backend).
  const notify = hasItems && !loading ? outstanding : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: só o restante assentado importa; `onSummary` é recriado a cada render do pai.
  useEffect(() => {
    if (notify !== undefined) onSummary?.(summary);
  }, [notify]);
  if (!hasItems) return null;
  return (
    <div className="soft-card appointment-value-summary" aria-busy={loading}>
      <FinancialSummary
        summary={summary}
        discountEditable={canEditDiscount}
        onDiscountChange={(value) => onDiscountChange?.(value)}
        discountReason={form.manual_discount_reason || ""}
        onDiscountReasonChange={(text) => onDiscountReasonChange?.(text)}
        discountMax={fromCents(discountMaxCents)}
      />
      {!canEditDiscount && discountLockedReason && <small className="field-hint">{discountLockedReason}</small>}
      {loading && <small className="field-hint" role="status">Atualizando a prévia oficial do valor…</small>}
      {shownError && <small className="form-error" role="alert">{shownError}</small>}
    </div>
  );
}

/**
 * Sinal do agendamento: valor, forma e "Sinal recebido". Ao marcar como
 * recebido, a data de hoje vira a data do recebimento.
 * @param {{ form: Record<string, any>, onChange: (patch: Record<string, any>) => void, lockedReason?: string }} props
 */
function AppointmentDepositFields({ form, onChange, lockedReason = "" }) {
  const received = depositReceived(form.deposit_status);
  if (lockedReason) {
    return (
      <section className="appointment-deposit-fields" aria-label="Sinal do agendamento">
        <div className="section-inline-header"><strong>Sinal</strong><StatusBadge status={received ? "Recebido" : "Pendente"} /></div>
        <p className="appointment-locked-note">{currency.format(asNumber(form.deposit_value))} · {form.deposit_payment_method || "Pix"}{received && form.deposit_paid_at ? ` · recebido em ${formatDateWithYear(form.deposit_paid_at)}` : ""}</p>
        <small className="field-hint">{lockedReason}</small>
      </section>
    );
  }
  return (
    <section className="appointment-deposit-fields" aria-label="Sinal do agendamento">
      <div className="section-inline-header"><strong>Sinal</strong>{received && form.deposit_paid_at ? <small>Recebido em {formatDateWithYear(form.deposit_paid_at)}</small> : null}</div>
      {form.deposit_expected_value != null && <small className="field-hint">Sinal esperado: {currency.format(asNumber(form.deposit_expected_value))}</small>}
      <div className="form-grid">
        <Input type="number" min="0" step="0.01" inputMode="decimal" label="Valor do sinal (R$)" value={form.deposit_value} onChange={(deposit_value) => onChange({ deposit_value })} />
        <PaymentSelect label="Forma do sinal" value={form.deposit_payment_method || "Pix"} onChange={(deposit_payment_method) => onChange({ deposit_payment_method })} />
      </div>
      <small className="field-hint">Informe o valor efetivamente recebido, mesmo que seja diferente do sinal esperado. O saldo só é abatido quando “Sinal recebido” estiver marcado.</small>
      <Switch
        label="Sinal recebido"
        description="Marque quando o valor do sinal já estiver com a clínica."
        checked={received}
        onChange={(checked) => onChange({ deposit_status: checked ? "pago" : "pendente", deposit_paid_at: checked ? (form.deposit_paid_at || localDateValue(new Date())) : "" })}
      />
    </section>
  );
}

const DEPOSIT_FIELDS = ["deposit_value", "deposit_status", "deposit_payment_method", "deposit_paid_at"];

/**
 * Corpo do PATCH do "Detalhes do Agendamento". Itens vão com `id` (identidade
 * preservada no backend); `deposit_*` só quando a pessoa editou o sinal — sem
 * isso o backend recriava o pagamento do sinal a cada salvamento.
 */
function appointmentPatchPayload(form, services, jewelry, { depositDirty = false, includeStatus = true } = {}) {
  const priced = priceAppointmentDraft(form, services, jewelry);
  const payload = { ...priced };
  delete payload.deposit_expected_value;
  for (const field of [...DEPOSIT_FIELDS, "deposit_manual", "remaining_value"]) delete payload[field];
  if (!includeStatus) delete payload.status;
  payload.appointment_items = normalizeAppointmentFormItems(priced, services, jewelry);
  payload.manual_discount_value = fromCents(Math.max(0, toCents(form.manual_discount_value)));
  payload.manual_discount_reason = String(form.manual_discount_reason || "").trim();
  if (depositDirty) {
    payload.deposit_value = priced.deposit_value;
    payload.deposit_status = form.deposit_status || "pendente";
    payload.deposit_payment_method = form.deposit_payment_method || "Pix";
    payload.deposit_paid_at = depositReceived(form.deposit_status) ? (form.deposit_paid_at || localDateValue(new Date())) : "";
  }
  return payload;
}

/**
 * Impressão digital do que mexe em dinheiro no "Detalhes do Agendamento"
 * (itens com preço, desconto manual). Serve para saber se um atendimento já
 * finalizado teve alteração financeira: só nesse caso o PATCH leva esses
 * campos — o backend exige `finance.edit` + motivo sempre que eles vêm.
 */
function appointmentFinancialFingerprint(form, services, jewelry) {
  const items = normalizeAppointmentFormItems(form, services, jewelry).map((item) => [
    item.id ?? null,
    String(item.service_id || ""),
    String(item.procedure_id || ""),
    String(item.region || ""),
    String(item.jewelry_id || ""),
    String(item.jewelry_variant_id || ""),
    Math.max(1, asNumber(item.quantity, 1)),
    toCents(item.procedure_price),
    toCents(item.jewelry_unit_price)
  ]);
  return JSON.stringify({
    items,
    manual: Math.max(0, toCents(form.manual_discount_value)),
    reason: String(form.manual_discount_reason || "").trim()
  });
}

// Campos que um atendimento finalizado pode gravar sem tocar no financeiro.
const NON_FINANCIAL_PATCH_FIELDS = ["appointment_date", "appointment_time", "status", "notes", "reschedule_reason"];

export function VisualCalendar({ navigationTarget, onOpenSettings, features = [], onUpgrade, createSignal = 0 }) {
  const { data: options } = useFetch("/options");
  const { data: clients } = useFetch("/clients");
  const { data: services } = useFetch("/services");
  const { data: procedures } = useFetch("/procedures");
  const [filters, setFilters] = useState({ mode: "diario", search: "", professional_id: "", status: "", from: "", to: "" });
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState({ professional_id: "", status: "" });
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState({ from: "", to: "" });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [linkedId] = useState(() => Number(new URLSearchParams(window.location.search).get("appointment")) || 0);
  const { data: linkedAppointments, loading: linkedLoading, error: linkedError } = useFetch(linkedId > 0 ? `/appointments?id=${linkedId}` : null);
  useEffect(() => {
    const linked = asArray(linkedAppointments)[0];
    if (linked) { setSelectedAppointment(linked); setCurrentDate(new Date(`${linked.appointment_date}T12:00:00`)); }
  }, [linkedAppointments]);
  // Passo pedido no card do calendário (remarcar, cancelar, finalizar).
  const [selectedIntent, setSelectedIntent] = useState(/** @type {"" | "reschedule" | "cancel" | "finalize"} */ (""));
  /** @param {any} item @param {"" | "reschedule" | "cancel" | "finalize"} [intent] */
  const selectAppointment = (item, intent = "") => {
    setSelectedIntent(intent || "");
    setSelectedAppointment(item);
  };
  const [createSeed, setCreateSeed] = useState(null);
  useEffect(() => { if (createSignal) setCreateSeed({}); }, [createSignal]);
  useEffect(() => {
    if (navigationTarget === "historico") setFilters((current) => ({ ...current, mode: "realizados" }));
    if (navigationTarget === "calendario") setFilters((current) => ({ ...current, mode: "mensal" }));
    if (navigationTarget === "diario") setFilters((current) => ({ ...current, mode: "diario" }));
    if (navigationTarget === "espera") setFilters((current) => ({ ...current, mode: "espera" }));
  }, [navigationTarget]);
  const appointmentQuery = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([key, value]) => key !== "mode" && value)));
  const { data } = useFetch(`/appointments?${appointmentQuery}`);
  // Invalidar "/appointments" alcança o calendário sob qualquer combinação de
  // filtros, não só a consulta que está montada agora.
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/appointments", "/service-executions", "/clients", "/dashboard", "/finance", "/reports", "/payments", "/inventory", "/commissions");
  const refreshClients = refresh;
  const safeOptions = asObject(options);
  const calendar = useMemo(() => ["lista", "realizados", "espera"].includes(filters.mode) ? null : buildCalendar(asArray(data), filters.mode, currentDate), [data, filters.mode, currentDate]);
  const operationalRows = asArray(data);
  const today = dateKey(new Date());
  const todayRows = operationalRows.filter((item) => String(item.appointment_date).slice(0, 10) === today);
  const completedWithTiming = operationalRows.filter((item) => item.arrived_at && item.started_at);
  const averageDelay = completedWithTiming.length
    ? Math.round(completedWithTiming.reduce((sum, item) => sum + Math.max(0, (new Date(item.started_at).getTime() - new Date(item.arrived_at).getTime()) / 60000), 0) / completedWithTiming.length)
    : 0;
  const cancellationRate = operationalRows.length
    ? Math.round(operationalRows.filter((item) => ["cancelado", "nao_compareceu"].includes(item.status)).length / operationalRows.length * 100)
    : 0;
  const activeFilterCount = ["professional_id", "status"].filter((key) => filters[key]).length;
  const hasPeriod = Boolean(filters.from || filters.to);
  const periodLabel = filters.from && filters.to
    ? `${formatDateWithYear(filters.from)} até ${formatDateWithYear(filters.to)}`
    : formatDateWithYear(filters.from || filters.to);

  function openFilters() {
    setDraftFilters({ professional_id: filters.professional_id, status: filters.status });
    setFilterModalOpen(true);
  }

  function applyFilters() {
    setFilters({ ...filters, ...draftFilters });
    setFilterModalOpen(false);
  }

  function clearFilters() {
    const empty = { professional_id: "", status: "" };
    setDraftFilters(empty);
    setFilters({ ...filters, ...empty });
    setFilterModalOpen(false);
  }

  function openPeriod() {
    setDraftPeriod({ from: filters.from, to: filters.to });
    setPeriodModalOpen(true);
  }

  function applyPeriod() {
    const referenceDate = draftPeriod.from || draftPeriod.to;
    if (referenceDate) setCurrentDate(new Date(`${referenceDate}T12:00:00`));
    setFilters({ ...filters, ...draftPeriod });
    setPeriodModalOpen(false);
  }

  function clearPeriod() {
    setDraftPeriod({ from: "", to: "" });
    setFilters({ ...filters, from: "", to: "" });
    setCurrentDate(new Date());
    setPeriodModalOpen(false);
  }

  return (
    <section className="stack agenda-visual-page">
      {linkedId > 0 && linkedLoading && <Loading />}
      {linkedId > 0 && linkedError && <ApiError message={linkedError} />}
      {linkedId > 0 && !linkedLoading && !linkedError && linkedAppointments && !asArray(linkedAppointments).length && <ApiError message="O atendimento de origem não foi encontrado ou não está disponível para este usuário." />}
      <CollapsibleIndicators screenId="agenda">
        <div className="metric-grid">
          <Metric label="Agenda de hoje" value={todayRows.length} />
          <Metric label="Aguardando início" value={todayRows.filter((item) => ["pendente", "confirmado", "chegou"].includes(item.status)).length} />
          <Metric label="Atraso médio" value={`${averageDelay} min`} />
          <Metric label="Cancelamentos/ausências" value={`${cancellationRate}%`} />
        </div>
      </CollapsibleIndicators>
      <div className="agenda-sticky-controls">
        <div className="panel agenda-page-heading">
        <div>
          <span className="eyebrow">Gestão de agenda</span>
          <h2>Agenda</h2>
        </div>
        <div className="agenda-page-actions">
          <PublicBookingLink />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><Button variant="secondary"><MoreHorizontal size={16} /> Mais opções</Button></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="crud-options-popover" align="end" sideOffset={6}>
                <DropdownMenu.Item onSelect={() => onOpenSettings()}><Settings2 size={16} /> Configurações da Agenda</DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => onOpenSettings("solicitacoes")}>Solicitações online</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => setFilters({ ...filters, mode: "espera" })}>Lista de espera</DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => setFilters({ ...filters, mode: "realizados" })}>Histórico de atendimentos</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Button onClick={() => setCreateSeed({})}><Plus size={16} /> Novo agendamento</Button>
        </div>
        </div>
        <div className="toolbar">
        <div className="segmented">
          {[["mensal", "Mensal"], ["semanal", "Semanal"], ["diario", "Diário"], ["lista", "Agendamentos"]].map(([mode, label]) => <button key={mode} className={filters.mode === mode ? "active" : ""} onClick={() => setFilters({ ...filters, mode })}>{label}</button>)}
        </div>
        {["mensal", "semanal", "diario", "lista"].includes(filters.mode) && <div className="calendar-nav">
          {calendar && !hasPeriod && <button aria-label="Período anterior" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, -1))}><ChevronLeft size={18} /></button>}
          <strong>{hasPeriod ? periodLabel : calendar?.title || "Todos os períodos"}</strong>
          {calendar && !hasPeriod && <button aria-label="Próximo período" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, 1))}><ChevronRight size={18} /></button>}
          {!hasPeriod && calendar && <button onClick={() => setCurrentDate(new Date())}>Hoje</button>}
          <button onClick={openPeriod}>Período</button>
          {hasPeriod && <button onClick={clearPeriod}>Limpar</button>}
        </div>}
        </div>
        {["mensal", "semanal", "diario", "lista"].includes(filters.mode) && <div className="dataview-toolbar agenda-shared-filters">
        <label className="dataview-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={filters.search} placeholder="Buscar cliente, telefone ou procedimento" onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          {filters.search && <button type="button" onClick={() => setFilters({ ...filters, search: "" })} aria-label="Limpar busca"><X size={14} /></button>}
        </label>
        <button type="button" className={`dataview-filter-toggle ${activeFilterCount ? "has-filters" : ""}`} onClick={openFilters} aria-haspopup="dialog">
          <Filter size={15} /> Filtros
          {activeFilterCount > 0 && <span className="dataview-filter-count">{activeFilterCount}</span>}
        </button>
        </div>}
      </div>
      <Modal open={filterModalOpen} title="Filtros da Agenda" subtitle="Aplicados às quatro visualizações" onClose={() => setFilterModalOpen(false)} footer={<><Button variant="secondary" onClick={clearFilters}>Limpar</Button><Button onClick={applyFilters}>Aplicar filtros</Button></>}>
        <div className="dataview-filter-modal-grid">
          <Select label="Profissional" value={draftFilters.professional_id} onChange={(professional_id) => setDraftFilters({ ...draftFilters, professional_id })}>
            <option value="">Todos</option>
            {asArray(safeOptions.professionals).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select label="Status" value={draftFilters.status} onChange={(status) => setDraftFilters({ ...draftFilters, status })}>
            <option value="">Todos</option>
            {APPOINTMENT_STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </Select>
        </div>
      </Modal>
      <Modal open={periodModalOpen} title="Período da Agenda" subtitle="O período será aplicado às quatro visualizações" onClose={() => setPeriodModalOpen(false)} footer={<><Button variant="secondary" onClick={clearPeriod}>Limpar</Button><Button onClick={applyPeriod}>Aplicar período</Button></>}>
        <div className="dataview-filter-modal-grid">
          <Input type="date" label="Data inicial" value={draftPeriod.from} onChange={(from) => setDraftPeriod({ ...draftPeriod, from })} />
          <Input type="date" label="Data final" value={draftPeriod.to} onChange={(to) => setDraftPeriod({ ...draftPeriod, to })} />
        </div>
      </Modal>
      {filters.mode === "espera" ? (
        <Waitlist onSchedule={(item) => setCreateSeed({
          waitlist_id: item.id,
          client_id: item.client_id,
          full_name: item.client_name,
          whatsapp: item.contact,
          service_id: item.service_id,
          professional_id: item.professional_id,
          appointment_date: item.preferred_date_from || today,
          appointment_time: ""
        })} />
      ) : filters.mode === "realizados" ? (
        <ServiceExecutionHistory />
      ) : filters.mode === "lista" ? (
        <div className="panel"><AppointmentList appointments={asArray(data)} onChanged={refresh} /></div>
      ) : filters.mode === "diario" ? (
        <DailyAgenda day={calendar.days[0]} refresh={refresh} onSelect={selectAppointment} onEmptySlot={setCreateSeed} />
      ) : (
        <GoogleLikeCalendar days={calendar.days} mode={filters.mode} refresh={refresh} onSelect={selectAppointment} onEmptySlot={setCreateSeed} />
      )}
      <AppointmentCreateModal
        seed={createSeed}
        options={safeOptions}
        clients={clients}
        services={services}
        procedures={procedures}
        onClose={() => setCreateSeed(null)}
        onSaved={() => {
          if (createSeed?.waitlist_id) void apiFetch(`/agenda/waitlist/${createSeed.waitlist_id}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled", reason: "Agendamento criado pela lista de espera" }) });
          setCreateSeed(null);
          refresh();
          refreshClients();
        }}
      />
      <AppointmentQuickModal
        appointment={selectedAppointment}
        initialAction={selectedIntent}
        options={safeOptions}
        services={services}
        procedures={procedures}
        features={features}
        onUpgrade={onUpgrade}
        onClose={() => setSelectedAppointment(null)}
        onSaved={() => {
          setSelectedAppointment(null);
          refresh();
        }}
      />
    </section>
  );
}

function Waitlist({ onSchedule }) {
  const { data } = useFetch("/agenda/waitlist");
  const { data: clients } = useFetch("/clients");
  const { data: services } = useFetch("/services");
  const { data: professionals } = useFetch("/professionals");
  const invalidate = useApiInvalidate();
  const [open, setOpen] = useState(false);
  /** @returns {Record<string, any>} */
  const emptyForm = () => ({ client_id: "", client_name: "", contact: "", service_id: "", professional_id: "", preferred_date_from: "", preferred_date_to: "", preferred_period: "qualquer", priority: 0, notes: "" });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const rows = asArray(data);

  async function save(event) {
    event.preventDefault();
    const response = await apiFetch("/agenda/waitlist", { method: "POST", body: JSON.stringify(form) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível adicionar à lista de espera.");
    setOpen(false); setForm(emptyForm()); invalidate("/agenda/waitlist", "/dashboard");
  }

  async function changeStatus(item, status) {
    await apiFetch(`/agenda/waitlist/${item.id}`, { method: "PATCH", body: JSON.stringify({ status, reason: "Fila operacional atualizada" }) });
    invalidate("/agenda/waitlist", "/dashboard");
  }

  return (
    <section className="panel stack">
      <CrudHeader title="Lista de espera" subtitle="Priorize clientes e transforme uma vaga em agendamento sem perder o histórico." actionLabel="Adicionar à espera" onAction={() => { setForm(emptyForm()); setError(""); setOpen(true); }} />
      <DataView
        rows={rows}
        defaultSort={{ key: "priority", dir: "desc" }}
        searchPlaceholder="Buscar cliente, contato, serviço ou observação"
        filters={[{ key: "status", label: "Status", type: "select", options: [{ value: "waiting", label: "Aguardando" }, { value: "contacted", label: "Contatado" }, { value: "scheduled", label: "Agendado" }, { value: "closed", label: "Encerrado" }] }]}
        columns={[
          { key: "client_name", label: "Cliente" },
          { key: "service_name", label: "Procedimento", render: (item) => item.service_name || "Qualquer" },
          { key: "preferred_date_from", label: "Preferência", render: (item) => [formatDateWithYear(item.preferred_date_from), item.preferred_period].filter(Boolean).join(" · ") || "Flexível" },
          { key: "priority", label: "Prioridade", render: (item) => `${Number(item.priority || 0)}/5` },
          { key: "status", label: "Status", render: (item) => <StatusBadge status={item.status} /> }
        ]}
        actions={(item) => <RowActions actions={[
          item.status === "waiting" && { label: "Marcar contato", onClick: () => changeStatus(item, "contacted") },
          !["scheduled", "closed"].includes(item.status) && { label: "Criar encaixe", primary: true, onClick: () => onSchedule?.(item) },
          item.status !== "closed" && { label: "Encerrar", onClick: () => changeStatus(item, "closed") }
        ].filter(Boolean)} />}
        empty="Nenhum cliente aguardando uma vaga."
      />
      <Modal open={open} title="Adicionar à lista de espera" subtitle="Preferências são opcionais e ajudam a encontrar o melhor encaixe." onClose={() => setOpen(false)} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" form="waitlist-form">Salvar</Button></>}>
        <form id="waitlist-form" className="stack" onSubmit={save}>
          <Select label="Cliente cadastrado" value={form.client_id} onChange={(client_id) => { const client = asArray(clients).find((item) => String(item.id) === String(client_id)); setForm({ ...form, client_id, client_name: personName(client), contact: client?.whatsapp || "" }); }}><option value="">Contato avulso</option>{asArray(clients).map((item) => <option key={item.id} value={item.id}>{personName(item)}</option>)}</Select>
          <div className="form-grid"><Input label="Nome" value={form.client_name} onChange={(client_name) => setForm({ ...form, client_name })} required /><Input label="Contato" value={form.contact} onChange={(contact) => setForm({ ...form, contact })} /></div>
          <div className="form-grid"><Select label="Procedimento" value={form.service_id} onChange={(service_id) => setForm({ ...form, service_id })}><option value="">Qualquer</option>{asArray(services).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Profissional" value={form.professional_id} onChange={(professional_id) => setForm({ ...form, professional_id })}><option value="">Qualquer</option>{asArray(professionals).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>
          <div className="form-grid"><Input type="date" label="A partir de" value={form.preferred_date_from} onChange={(preferred_date_from) => setForm({ ...form, preferred_date_from })} /><Input type="date" label="Até" value={form.preferred_date_to} onChange={(preferred_date_to) => setForm({ ...form, preferred_date_to })} /><Select label="Período" value={form.preferred_period} onChange={(preferred_period) => setForm({ ...form, preferred_period })}><option value="qualquer">Qualquer</option><option value="manha">Manhã</option><option value="tarde">Tarde</option><option value="noite">Noite</option></Select><Input type="number" min="0" max="5" label="Prioridade" value={form.priority} onChange={(priority) => setForm({ ...form, priority })} /></div>
          <Textarea label="Observações" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
    </section>
  );
}

function AgendaResources() {
  const { data } = useFetch("/agenda/resources");
  const invalidate = useApiInvalidate();
  /** @returns {Record<string, any>} */
  const emptyForm = () => ({ name: "", resource_type: "station", capacity: 1, notes: "", active: true });
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    const response = await apiFetch("/agenda/resources", { method: "POST", body: JSON.stringify(form) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível salvar o recurso.");
    setOpen(false); setForm(emptyForm()); invalidate("/agenda/resources");
  }

  async function toggle(item) {
    await apiFetch(`/agenda/resources/${item.id}`, { method: "PATCH", body: JSON.stringify({ active: !item.active }) });
    invalidate("/agenda/resources");
  }

  const typeLabel = { room: "Sala", chair: "Cadeira", station: "Estação", equipment: "Equipamento" };
  return (
    <div className="panel stack">
      <CrudHeader title="Salas e recursos" subtitle="Cadastro opcional para preparar a alocação operacional sem bloquear a agenda básica." actionLabel="Novo recurso" onAction={() => { setForm(emptyForm()); setError(""); setOpen(true); }} />
      <DataView
        rows={asArray(data)}
        defaultSort={{ key: "name", dir: "asc" }}
        searchPlaceholder="Buscar sala, cadeira, estação ou equipamento"
        columns={[
          { key: "name", label: "Recurso" },
          { key: "resource_type", label: "Tipo", render: (item) => typeLabel[item.resource_type] || item.resource_type },
          { key: "capacity", label: "Capacidade" },
          { key: "active", label: "Status", render: (item) => <StatusBadge status={item.active ? "Ativo" : "Inativo"} /> }
        ]}
        actions={(item) => <RowActions actions={[{ label: item.active ? "Desativar" : "Ativar", onClick: () => toggle(item) }]} />}
        empty="Nenhuma sala ou recurso cadastrado. A agenda continua funcionando normalmente."
      />
      <Modal open={open} title="Novo recurso da agenda" subtitle="Use para salas, cadeiras, estações ou equipamentos compartilhados." onClose={() => setOpen(false)} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" form="agenda-resource-form">Salvar</Button></>}>
        <form id="agenda-resource-form" className="stack" onSubmit={save}>
          <div className="form-grid"><Input label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} required /><Select label="Tipo" value={form.resource_type} onChange={(resource_type) => setForm({ ...form, resource_type })}><option value="room">Sala</option><option value="chair">Cadeira</option><option value="station">Estação</option><option value="equipment">Equipamento</option></Select><Input type="number" min="1" max="100" label="Capacidade" value={form.capacity} onChange={(capacity) => setForm({ ...form, capacity })} /></div>
          <Textarea label="Observações" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
    </div>
  );
}

function serviceExecutionRows(payload) {
  return asArray(payload).length ? asArray(payload) : asArray(asObject(payload).items);
}

function ServiceExecutionHistory() {
  const { data } = useFetch("/service-executions?limit=200");
  const [selectedId, setSelectedId] = useState(null);
  if (data == null) return <Loading />;
  const rows = serviceExecutionRows(data);
  return (
    <div className="panel">
      <CrudHeader title="Atendimentos realizados" subtitle="Histórico gerado automaticamente quando um agendamento é finalizado." />
      <DataView
        rows={rows}
        defaultSort={{ key: "completed_at", dir: "desc" }}
        searchPlaceholder="Buscar por cliente, serviço ou profissional"
        filters={[
          { key: "professional_name", label: "Profissional", type: "select", options: distinctOptions(rows.map((item) => item.professional_name)).map((value) => ({ value, label: value })) },
          { key: "status", label: "Status", type: "select", options: [{ value: "completed", label: "Concluído" }, { value: "cancelled", label: "Cancelado" }] }
        ]}
        columns={[
          { key: "completed_at", label: "Conclusão", render: (item) => formatDateWithYear(item.completed_at) },
          { key: "client_name", label: "Cliente" },
          { key: "service_name", label: "Serviço", render: (item) => item.service_name || "Atendimento" },
          { key: "professional_name", label: "Profissional" },
          { key: "total_value", label: "Valor", value: (item) => asNumber(item.total_value), render: (item) => currency.format(item.total_value || 0) },
          { key: "status", label: "Status", render: (item) => <StatusBadge status={item.status === "completed" ? "Concluído" : "Cancelado"} /> }
        ]}
        actions={(item) => <RowActions actions={[{ label: "Ver atendimento", primary: true, onClick: () => setSelectedId(item.id) }]} />}
        empty="Nenhum atendimento foi finalizado pela Agenda."
        emptyFiltered="Nenhum atendimento corresponde aos filtros aplicados."
      />
      <ServiceExecutionDetail executionId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/**
 * Composição do valor da execução: bruto − descontos ± ajustes = líquido.
 * O bruto vem das colunas da execução; sem elas (registros antigos), é
 * reconstruído a partir do líquido, do desconto e dos ajustes.
 */
function executionValueComposition(execution) {
  const subtotalCents = toCents(execution.service_subtotal) + toCents(execution.product_subtotal);
  const discountCents = toCents(execution.discount_total);
  const adjustmentCents = toCents(execution.adjustment_total);
  const netCents = toCents(execution.total_value);
  const grossCents = toCents(execution.gross_value) || subtotalCents || Math.max(0, netCents + discountCents - adjustmentCents);
  return {
    gross: fromCents(grossCents),
    discount: fromCents(discountCents),
    adjustment: fromCents(adjustmentCents),
    net: fromCents(netCents),
    paid: fromCents(toCents(execution.paid_value)),
    receivable: fromCents(toCents(execution.receivable_value))
  };
}

function ServiceExecutionDetail({ executionId, onClose }) {
  const { data } = useFetch(executionId ? `/service-executions/${executionId}` : null);
  const execution = asObject(data);
  const snapshot = asObject(execution.snapshot);
  const checklist = asArray(execution.checklist_snapshot);
  const biosafety = asObject(execution.biosafety_snapshot);
  const composition = executionValueComposition(execution);
  const appointmentId = execution.appointment_id || null;
  const signedMoney = (value) => `${value < 0 ? "− " : "+ "}${currency.format(Math.abs(value))}`;
  return (
    <Modal open={Boolean(executionId)} title="Atendimento realizado" subtitle={executionId ? `Registro #${executionId}` : ""} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      {!data ? <Loading /> : <div className="stack">
        <div className="summary-grid">
          <span>Cliente <strong>{snapshot.client_name || "—"}</strong></span>
          <span>Serviço <strong>{snapshot.procedure || "Atendimento"}</strong></span>
          <span>Data <strong>{formatDateWithYear(snapshot.appointment_date || execution.completed_at)}</strong></span>
          <span>Total <strong>{currency.format(composition.net)}</strong></span>
        </div>
        <section className="soft-card stack" aria-label="Composição do valor">
          <strong>Composição do valor</strong>
          <div className="service-execution-composition">
            <div><span>Valor bruto</span><strong>{currency.format(composition.gross)}</strong></div>
            <div><span>Descontos</span><strong>− {currency.format(composition.discount)}</strong></div>
            <div><span>Ajustes</span><strong>{signedMoney(composition.adjustment)}</strong></div>
            <div><span>Valor líquido</span><strong>{currency.format(composition.net)}</strong></div>
            <div><span>Pago</span><strong>{currency.format(composition.paid)}</strong></div>
            <div><span>A receber</span><strong>{currency.format(composition.receivable)}</strong></div>
          </div>
        </section>
        {(execution.clinical_notes || execution.occurrences || execution.aftercare_notes) ? <div className="soft-card stack">
          {execution.clinical_notes && <div><strong>Observações clínicas</strong><p>{execution.clinical_notes}</p></div>}
          {execution.occurrences && <div><strong>Intercorrências</strong><p>{execution.occurrences}</p></div>}
          {execution.aftercare_notes && <div><strong>Orientações pós-atendimento</strong><p>{execution.aftercare_notes}</p></div>}
        </div> : <p className="empty-state">Nenhuma informação clínica opcional foi registrada.</p>}
        {(checklist.length > 0 || biosafety.enabled) && <div className="soft-card stack">
          <strong>Checklist e rastreabilidade</strong>
          {checklist.length > 0 && <div>{checklist.map((item) => <p key={item.key}>{item.completed ? "✓" : "○"} {item.label}{item.required ? " (obrigatório)" : ""}</p>)}</div>}
          {biosafety.enabled && <div>
            {biosafety.sterilization_cycle && <p>Ciclo: <strong>{biosafety.sterilization_cycle}</strong></p>}
            {biosafety.sterilization_record && <p>Registro: <strong>{biosafety.sterilization_record}</strong></p>}
            {asArray(biosafety.material_lots).map((item, index) => <p key={`${item.batch_code}-${index}`}>Material/lote: <strong>{item.batch_code || item.inventory_item_lot_id}</strong> · qtd. {item.quantity}</p>)}
            {biosafety.notes && <p>Observações: {biosafety.notes}</p>}
          </div>}
          {asArray(execution.operationalHistory).length > 1 && <small>{asArray(execution.operationalHistory).length} revisões preservadas no histórico.</small>}
        </div>}
        <DataView
          rows={asArray(execution.items)}
          columns={[
            { key: "item_name", label: "Item" },
            { key: "item_type", label: "Tipo", render: (item) => item.item_type === "service" ? "Serviço" : "Produto aplicado" },
            { key: "quantity", label: "Quantidade" },
            { key: "total_value", label: "Valor", render: (item) => currency.format(item.total_value || 0) }
          ]}
          empty="Nenhum item registrado."
        />
        {appointmentId && <section className="soft-card stack" aria-label="Indicadores químicos">
          <strong>Indicadores químicos</strong>
          <ChemicalIndicatorHistory appointmentId={appointmentId} compact />
        </section>}
        {/* O resumo tem cabeçalho próprio e some sozinho para quem não pode ver comissão. */}
        {appointmentId && <AppointmentCommissionSummary appointmentId={appointmentId} />}
      </div>}
    </Modal>
  );
}

export function GoogleLikeCalendar({ days, mode, refresh, onSelect, onEmptySlot }) {
  return (
    <div className={`google-calendar ${mode === "semanal" ? "week-view" : ""}`}>
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
      {days.map((day) => (
        <article className={`calendar-cell ${day.isOutside ? "outside" : ""} ${day.isToday ? "today" : ""}`} key={day.key} onClick={() => onEmptySlot?.({ appointment_date: day.key })}>
          <header>
            <span>{day.date.getDate()}</span>
            {day.isToday && <strong>Hoje</strong>}
          </header>
          <div className="calendar-events">
            {asArray(day.items).map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} onSelect={onSelect} />)}
          </div>
        </article>
      ))}
    </div>
  );
}

export function DailyAgenda({ day, refresh, onSelect, onEmptySlot }) {
  const slots = buildTimeSlots(day.items);
  return (
    <div className="daily-calendar">
      <div className="daily-heading">
        <strong>{day.date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</strong>
        <span>{day.items.length} atendimento(s)</span>
      </div>
      {slots.map((slot) => (
        <div className="time-slot" key={slot.hour} onClick={() => onEmptySlot?.({ appointment_date: dateKey(day.date), appointment_time: slot.hour })}>
          <span>{slot.hour}</span>
          <div>{asArray(slot.items).map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} onSelect={onSelect} />)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Card do calendário. As ações do menu abrem o atendimento JÁ no passo que
 * prometem (`onSelect(item, intent)`): "Remarcar" mudava só o status, sem data,
 * motivo nem histórico, e "Cancelar com resolução"/"Revisar e finalizar" só
 * abriam o modal como um clique comum.
 * @param {{ item: Record<string, any>, refresh?: () => void, onSelect?: (item: Record<string, any>, intent?: "reschedule" | "cancel" | "finalize") => void }} props
 */
export function CalendarEvent({ item, onSelect }) {
  const currentUser = readStoredSession()?.user || {};
  const closed = ["atendido", "cancelado", "nao_compareceu"].includes(item.status);
  return (
    <div
      className={`calendar-event ${statusClass[item.status]}`}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(item);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
          onSelect?.(item);
        }
      }}
    >
      <strong>{item.appointment_time} - {personName(item)}</strong>
      <span>{item.procedure}</span>
      <small>{item.professional_name}</small>
      <div className="event-actions" onClick={(event) => event.stopPropagation()}>
        <RowActions
          actions={[
            !closed && can(currentUser, "appointments.reschedule") && { label: "Remarcar", onClick: () => onSelect?.(item, "reschedule") },
            !closed && can(currentUser, "appointments.cancel") && { label: "Cancelar com resolução", danger: true, onClick: () => onSelect?.(item, "cancel") },
            !closed && can(currentUser, "appointments.finalize") && { label: "Revisar e finalizar", onClick: () => onSelect?.(item, "finalize") }
          ]}
        />
      </div>
    </div>
  );
}

export function AppointmentCreateModal({ seed, options, clients, services, procedures, onClose, onSaved }) {
  const safeOptions = asObject(options);
  const safeClients = asArray(clients);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(safeOptions.serviceItems);
  const safeProfessionals = asArray(safeOptions.professionals);
  const [form, setForm] = useState(defaultAppointment());
  const [error, setError] = useState("");
  const [stepErrors, setStepErrors] = useState(/** @type {string[]} */ ([]));
  const [activeStep, setActiveStep] = useState("schedule");
  const currentUser = readStoredSession()?.user || {};
  const canDiscount = can(currentUser, "appointments.apply_discount");
  const draft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: currentUser.id || "user",
    formId: "appointment-new",
    // v2: sinal editável e desconto manual entraram no formulário.
    schemaKey: "appointment-v2",
    value: form,
    enabled: Boolean(seed),
    onRestore: setForm,
  });

  useEffect(() => {
    if (!seed) return;
    const seededClient = safeClients.find((item) => String(item.id) === String(seed.client_id));
    setForm({
      ...defaultAppointment(),
      client_id: seed.client_id || "",
      full_name: seed.full_name || personName(seededClient),
      whatsapp: seed.whatsapp || seededClient?.whatsapp || "",
      service_id: seed.service_id || "",
      professional_id: seed.professional_id || "",
      appointment_date: seed.appointment_date || defaultAppointment().appointment_date,
      appointment_time: seed.appointment_time || "",
      status: "pendente"
    });
    setError("");
    setStepErrors([]);
    setActiveStep("schedule");
  }, [seed]);

  function setClient(clientId) {
    const client = safeClients.find((item) => String(item.id) === String(clientId));
    if (!client) {
      setForm({ ...form, client_id: "", full_name: "", whatsapp: "", instagram: "", birth_date: "" });
      return;
    }
    setForm({
      ...form,
      client_id: client.id,
      full_name: personName(client),
      whatsapp: client.whatsapp || "",
      instagram: client.instagram || "",
      birth_date: client.birth_date || ""
    });
  }

  function updatePricedForm(nextForm) {
    setForm(priceAppointmentDraft(nextForm, safeServices, safeJewelry));
  }

  // Os campos obrigatórios da 1ª etapa saem do DOM na 2ª: a validação nativa
  // não os alcança no envio, então a etapa é conferida antes de avançar.
  function scheduleStepErrors() {
    return [
      !String(form.full_name || "").trim() && "Informe o nome completo.",
      !String(form.whatsapp || "").trim() && "Informe o WhatsApp.",
      !form.professional_id && "Escolha o profissional.",
      !form.appointment_date && "Informe a data.",
      !form.appointment_time && "Informe o horário."
    ].filter(Boolean);
  }

  function goToOperation() {
    const errors = scheduleStepErrors();
    setStepErrors(errors);
    if (!errors.length) setActiveStep("operation");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const errors = scheduleStepErrors();
    if (errors.length) {
      setStepErrors(errors);
      setActiveStep("schedule");
      return;
    }
    const priced = priceAppointmentDraft(form, safeServices, safeJewelry);
    const body = { ...priced, appointment_items: normalizeAppointmentFormItems(form, safeServices, safeJewelry) };
    delete body.deposit_manual;
    body.deposit_status = form.deposit_status || "pendente";
    body.deposit_payment_method = form.deposit_payment_method || "Pix";
    body.deposit_paid_at = depositReceived(form.deposit_status) ? (form.deposit_paid_at || localDateValue(new Date())) : "";
    if (canDiscount) {
      const gross = toCents(appointmentValueParts(form, safeServices, safeJewelry).totalValue);
      const manual = Math.max(0, toCents(form.manual_discount_value));
      if (manual > gross) return setError("O desconto não pode ser maior que o valor bruto.");
      body.manual_discount_value = fromCents(manual);
      body.manual_discount_reason = String(form.manual_discount_reason || "").trim();
    } else {
      // Sem a permissão, o desconto manual nem é enviado (o backend recusaria).
      delete body.manual_discount_value;
      delete body.manual_discount_reason;
    }
    const response = await apiFetch("/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(response.status === 409 ? `Alerta de conflito: ${data.error || "revise o horário antes de criar o encaixe."}` : data.error || "Não foi possível criar o agendamento.");
      return;
    }
    draft.clearDraft();
    onSaved?.();
  }

  function closeCreate() {
    draft.flushDraft();
    onClose?.();
  }

  const values = appointmentValueParts(form, safeServices, safeJewelry);
  const manualDiscount = Math.max(0, toCents(form.manual_discount_value));

  return (
    <Modal
      open={!!seed}
      title="Novo Agendamento"
      subtitle="Criação rápida pela agenda visual"
      size="workspace"
      formId="visual-appointment-form"
      onClose={closeCreate}
      footer={(
        <>
          <Button variant="secondary" onClick={() => activeStep === "schedule" ? closeCreate() : setActiveStep("schedule")}>{activeStep === "schedule" ? "Cancelar" : "Voltar"}</Button>
          {activeStep === "operation" ? <Button type="submit" form="visual-appointment-form">Salvar agendamento</Button> : <Button onClick={goToOperation}>Continuar</Button>}
        </>
      )}
    >
      <FormWorkflow
        as="form"
        id="visual-appointment-form"
        className="stack"
        mobileFullscreen
        title="Novo agendamento"
        description="Identificação e horário primeiro; procedimento e valores na sequência."
        draft={draft}
        actions={draft.hasDraft ? <><Button type="button" variant="secondary" onClick={draft.restoreDraft}>Restaurar</Button><Button type="button" variant="ghost" onClick={draft.discardDraft}>Descartar</Button></> : null}
        onSubmit={submit}
      >
        <StepNavigator
          steps={[{ id: "schedule", label: "Agenda", description: "Cliente e horário" }, { id: "operation", label: "Atendimento", description: "Itens e valores" }]}
          currentStep={activeStep}
          onStepChange={(step) => step === "operation" ? goToOperation() : setActiveStep(step)}
          canNavigateTo={undefined}
        />
        <ValidationSummary errors={[...(activeStep === "schedule" ? stepErrors : []), ...(error ? [error] : [])]} />
        {activeStep === "schedule" && <FormWorkflow.Page title="Cliente e horário">
        <FormSection title="Informações principais" badge="Obrigatório">
        <div className="form-grid appointment-schedule-grid">
          <Select label="Cliente cadastrado" value={form.client_id} onChange={setClient}>
            <option value="">Novo cliente</option>
            {safeClients.map((client) => <option key={client.id} value={client.id}>{personName(client)} - {client.whatsapp}</option>)}
          </Select>
          <Input label="Nome completo" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
          <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
          <Select label="Profissional" value={form.professional_id} onChange={(value) => setForm({ ...form, professional_id: value })} required>
            <option value="">Selecione</option>
            {safeProfessionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
          </Select>
          <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value })} required />
          <Input type="time" label="Horário" value={form.appointment_time} onChange={(value) => setForm({ ...form, appointment_time: value })} required />
          <AppointmentStatusSelect value={form.status} onChange={(value) => setForm({ ...form, status: value })} />
        </div>
        </FormSection>
        </FormWorkflow.Page>}
        {activeStep === "operation" && <FormWorkflow.Page title="Itens, valores e confirmação">
        <AppointmentItemsEditor
          form={form}
          services={safeServices}
          procedures={safeProcedures}
          jewelry={safeJewelry}
          onChange={updatePricedForm}
          compact
        />
        <div className="appointment-workspace-columns">
          <AppointmentValueSummary
            form={form}
            services={safeServices}
            jewelry={safeJewelry}
            canEditDiscount={canDiscount}
            discountLockedReason="Desconto manual exige a permissão “Aplicar desconto”."
            onDiscountChange={(value) => setForm((current) => ({ ...current, manual_discount_value: value }))}
            onDiscountReasonChange={(text) => setForm((current) => ({ ...current, manual_discount_reason: text }))}
          />
          <div className="appointment-workspace-side">
            <AppointmentDepositFields
              form={{ ...form, deposit_value: form.deposit_manual ? form.deposit_value : values.depositValue, deposit_expected_value: values.depositExpectedValue }}
              onChange={(patch) => setForm((current) => ({
                ...current,
                deposit_value: current.deposit_manual ? current.deposit_value : values.depositValue,
                ...patch,
                deposit_manual: true
              }))}
            />
            <Textarea label="Observações" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
          </div>
        </div>
        <ReviewSummary
          title="Resumo do agendamento"
          description={undefined}
          sections={undefined}
          onEdit={undefined}
          items={[
            { label: "Cliente", value: form.full_name },
            { label: "Data", value: formatDateWithYear(form.appointment_date) },
            { label: "Horário", value: form.appointment_time },
            { label: "Itens", value: rawAppointmentItems(form).length },
            { label: "Sinal", value: `${currency.format(values.depositValue)} · ${depositReceived(form.deposit_status) ? "recebido" : "pendente"}` },
            ...(manualDiscount > 0 ? [{ label: "Desconto manual", value: currency.format(fromCents(manualDiscount)) }] : []),
          ]}
        />
        </FormWorkflow.Page>}
      </FormWorkflow>
    </Modal>
  );
}

const DEFAULT_PAYMENT_ROW = { method: "Pix", amount: 0, status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" };

export function AppointmentQuickModal({ appointment, options, services, procedures, onClose, onSaved, features = [], onUpgrade, initialAction = "" }) {
  const [form, setForm] = useState(/** @type {Record<string, any>} */ ({ appointment_date: "", appointment_time: "", status: "pendente", notes: "", reschedule_reason: "" }));
  const [payments, setPayments] = useState([{ ...DEFAULT_PAYMENT_ROW }]);
  // A grade nasce com uma linha padrão (o restante). Enquanto a pessoa não
  // mexer nela, acompanha o restante recalculado (desconto, itens, ajustes).
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  // `deposit_*` só vai no PATCH quando o sinal foi editado aqui.
  const [depositDirty, setDepositDirty] = useState(false);
  const [financialOverride, setFinancialOverride] = useState(/** @type {Record<string, any> | null} */ (null));
  const [financialRevision, setFinancialRevision] = useState(0);
  const [changeReason, setChangeReason] = useState("");
  // Retrato financeiro do agendamento como foi carregado (ver appointmentFinancialFingerprint).
  const [financialBaseline, setFinancialBaseline] = useState("");
  const [financialNotes, setFinancialNotes] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [occurrences, setOccurrences] = useState("");
  const [aftercareNotes, setAftercareNotes] = useState("");
  const [operationalChecklist, setOperationalChecklist] = useState([]);
  const [biosafety, setBiosafety] = useState(/** @type {Record<string, any>} */ ({ material_lots: [], sterilization_cycle: "", sterilization_record: "", applied_jewelry_id: "", applied_jewelry_variant_id: "", notes: "" }));
  const [error, setError] = useState("");
  const [deletion, setDeletion] = useState(null);
  const [cancellation, setCancellation] = useState(null);
  const canGenerateReceivables = planAllowsAction(features, "appointments.generate_receivables");
  const currentUser = readStoredSession()?.user || {};
  const canCancel = can(currentUser, "appointments.cancel");
  const canResolveFinance = can(currentUser, "finance.edit");
  const canFinalize = can(currentUser, "appointments.finalize");
  const attended = appointment?.status === "atendido";
  const closedStatus = ["cancelado", "nao_compareceu"].includes(appointment?.status);
  // Depois do fechamento, mexer em valor exige também a permissão financeira
  // (mesma regra do backend para alterações financeiras após "atendido").
  const canEditDiscount = can(currentUser, "appointments.apply_discount") && (!attended || canResolveFinance);
  const discountLockedReason = !can(currentUser, "appointments.apply_discount")
    ? "Desconto manual exige a permissão “Aplicar desconto”."
    : attended && !canResolveFinance ? "Atendimento finalizado: alterar o desconto exige permissão financeira." : "";
  // Depois de "atendido" o backend exige também o Financeiro básico do plano;
  // sem ele, o botão levaria a um erro só depois do clique.
  const closedValuePlanBlocked = attended && !planAllowsAction(features, "appointments.adjust_closed_value");
  const canAdjustValue = can(currentUser, "appointments.edit_final_value")
    && (!attended || (canResolveFinance && !closedValuePlanBlocked))
    && !closedStatus;
  const adjustmentLockedReason = closedValuePlanBlocked && can(currentUser, "appointments.edit_final_value") && canResolveFinance
    ? "Atendimento finalizado: ajustar o valor exige o Financeiro básico do plano Profissional."
    : "";
  const hasPaidDeposit = Number(appointment?.deposit_value || 0) > 0 && depositReceived(appointment?.deposit_status);
  const depositLockedReason = attended
    ? "Atendimento finalizado: correções do sinal são feitas pelo Financeiro."
    : closedStatus
      ? "Agendamento encerrado: o destino do sinal foi definido no cancelamento."
      : hasPaidDeposit && !canResolveFinance ? "Sinal já recebido. Para corrigir, é preciso a permissão financeira." : "";
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(asObject(options).serviceItems);
  const operationalRules = operationalRequirements(appointment?.operational_requirements_snapshot);
  const quickDraftValue = useMemo(() => ({ form, payments, paymentsTouched, depositDirty, changeReason, financialNotes, clinicalNotes, occurrences, aftercareNotes, operationalChecklist, biosafety }), [aftercareNotes, biosafety, changeReason, clinicalNotes, depositDirty, financialNotes, form, occurrences, operationalChecklist, payments, paymentsTouched]);
  const quickDraft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: currentUser.id || "user",
    formId: appointment?.id ? `appointment-${appointment.id}` : "appointment",
    // v2: itens com id, sinal editável e desconto manual no formulário.
    schemaKey: "appointment-attendance-v2",
    value: quickDraftValue,
    enabled: Boolean(appointment),
    onRestore: (value) => {
      const restored = asObject(value);
      if (restored.form) setForm(restored.form);
      if (restored.payments) {
        setPayments(asArray(restored.payments));
        setPaymentsTouched(true);
      }
      setDepositDirty(Boolean(restored.depositDirty));
      setChangeReason(restored.changeReason || "");
      setFinancialNotes(restored.financialNotes || "");
      setClinicalNotes(restored.clinicalNotes || "");
      setOccurrences(restored.occurrences || "");
      setAftercareNotes(restored.aftercareNotes || "");
      if (restored.operationalChecklist) setOperationalChecklist(asArray(restored.operationalChecklist));
      if (restored.biosafety) setBiosafety(restored.biosafety);
    },
  });

  useEffect(() => {
    if (!appointment) return;
    const seededForm = priceAppointmentDraft({
      appointment_date: appointment.appointment_date || "",
      appointment_time: appointment.appointment_time || "",
      status: appointment.status || "pendente",
      notes: appointment.notes || "",
      reschedule_reason: "",
      deposit_value: asNumber(appointment.deposit_value),
      deposit_expected_value: appointment.deposit_expected_value,
      deposit_status: appointment.deposit_status || "pendente",
      deposit_payment_method: appointment.deposit_payment_method || "Pix",
      deposit_paid_at: String(appointment.deposit_paid_at || "").slice(0, 10),
      // O sinal gravado é o valor de partida, mesmo zero: não volta para o
      // sinal sugerido do serviço.
      deposit_manual: true,
      coupon_code: appointment.coupon_code || "",
      manual_discount_value: asNumber(appointment.manual_discount_value),
      manual_discount_reason: appointment.manual_discount_reason || "",
      appointment_items: appointmentSeedItems(appointment)
    }, safeServices, safeJewelry);
    setForm(seededForm);
    setFinancialBaseline(appointmentFinancialFingerprint(seededForm, safeServices, safeJewelry));
    setPayments([{ ...DEFAULT_PAYMENT_ROW, method: appointment.remaining_payment_method || "Pix", amount: Math.max(0, Number(appointment.remaining_value || 0)) }]);
    setPaymentsTouched(false);
    setDepositDirty(false);
    setFinancialOverride(null);
    setFinancialRevision(0);
    setChangeReason("");
    setFinancialNotes(appointment.financial_notes || "");
    setClinicalNotes("");
    setOccurrences("");
    setAftercareNotes("");
    const requirements = operationalRequirements(appointment.operational_requirements_snapshot);
    setOperationalChecklist(requirements.checklist.map((item) => ({ ...item, completed: false })));
    setBiosafety({
      enabled: requirements.biosafety.enabled,
      material_lots: [],
      sterilization_cycle: "",
      sterilization_record: "",
      applied_jewelry_id: appointment.jewelry_id || "",
      applied_jewelry_variant_id: appointment.jewelry_variant_id || "",
      notes: ""
    });
    setError("");
    setDeletion(null);
    setCancellation(null);
  }, [appointment, services, options]);

  // Ação pedida no card do calendário: abre direto o passo certo. Roda uma vez
  // por agendamento aberto — recarregar serviços não reabre o cancelamento.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só a abertura (agendamento + ação) dispara; permissões e sinal são lidos no momento.
  useEffect(() => {
    if (!appointment || !initialAction) return undefined;
    if (initialAction === "cancel") {
      if (canCancel && !closedStatus && !attended) setCancellation({ resolution: hasPaidDeposit ? "retain_deposit" : "no_payment", refund_method: "Pix", reason: "" });
      return undefined;
    }
    // Remarcar: foco na data (mudar data/hora pede o motivo, que vai para o
    // histórico). Finalizar: leva à conferência financeira antes do botão.
    const timer = setTimeout(() => {
      const target = initialAction === "reschedule"
        ? document.querySelector(".appointment-schedule-grid input[type='date']")
        : document.querySelector("[aria-label='Conferência financeira']");
      if (!(target instanceof HTMLElement)) return;
      target.scrollIntoView?.({ block: "center" });
      if (initialAction === "reschedule") target.focus();
    }, 80);
    return () => clearTimeout(timer);
  }, [appointment, initialAction]);

  function updatePricedForm(nextForm) {
    setForm(priceAppointmentDraft(nextForm, safeServices, safeJewelry));
  }

  function editPayments(nextPayments) {
    setPaymentsTouched(true);
    setPayments(nextPayments);
  }

  // Só a linha única padrão, nunca editada, acompanha o novo restante.
  function syncDefaultPayment(summary) {
    if (paymentsTouched || attended) return;
    const outstanding = summary?.outstandingBalance;
    if (outstanding === undefined || outstanding === null) return;
    setPayments((current) => current.length === 1 ? [{ ...current[0], amount: fromCents(Math.max(0, toCents(outstanding))) }] : current);
  }

  function handleAdjustmentsChanged(payload) {
    const financial = asObject(payload?.financial);
    setFinancialOverride(financial);
    setFinancialRevision((revision) => revision + 1);
    syncDefaultPayment(financial);
  }

  // Atendimento finalizado: só alteração de itens/desconto/sinal é financeira.
  // Observação, data e status seguem sem motivo nem permissão financeira.
  const financialChanged = depositDirty || (Boolean(financialBaseline) && appointmentFinancialFingerprint(form, safeServices, safeJewelry) !== financialBaseline);
  // Tirar do "atendido" pelo seletor reabre o atendimento (estorna comissão):
  // também é alteração financeira para o backend.
  const reopening = attended && form.status !== "atendido";
  const needsChangeReason = attended && (financialChanged || reopening);

  function discountError() {
    const parts = appointmentValueParts(form, safeServices, safeJewelry);
    const couponCents = Math.max(0, toCents(appointment?.discount_value) - toCents(appointment?.manual_discount_value));
    const maxCents = Math.max(0, toCents(parts.totalValue) - couponCents);
    return Math.max(0, toCents(form.manual_discount_value)) > maxCents ? "O desconto não pode ser maior que o valor bruto." : "";
  }

  async function openDeletion() {
    setError("");
    const response = await apiFetch(`/appointments/${appointment.id}/deletion-impact`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível analisar o agendamento.");
    setDeletion({ impact: payload.impact || {}, canDelete: payload.can_delete, confirmation: "", reason: "", busy: false });
  }

  async function deleteAppointment() {
    setDeletion({ ...deletion, busy: true });
    const response = await apiFetch(`/appointments/${appointment.id}`, { method: "DELETE", body: JSON.stringify({ confirmation: deletion.confirmation, reason: deletion.reason }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setDeletion({ ...deletion, busy: false });
      return setError(payload.error || "Não foi possível excluir o agendamento.");
    }
    onSaved?.();
  }

  async function saveAppointment(patch = {}) {
    if (!appointment?.id) return;
    setError("");
    const scheduleChanged = form.appointment_date !== appointment.appointment_date
      || form.appointment_time !== appointment.appointment_time;
    if (scheduleChanged && !String(form.reschedule_reason || "").trim()) {
      setError("Informe o motivo do reagendamento.");
      return;
    }
    const invalidDiscount = discountError();
    if (invalidDiscount) return setError(invalidDiscount);
    if (needsChangeReason && !canResolveFinance) return setError("Atendimento finalizado: alterar itens, desconto ou status exige a permissão financeira.");
    if (needsChangeReason && !changeReason.trim()) return setError("Atendimento finalizado: informe o motivo da alteração.");
    // Finalizado sem mudança de dinheiro: o PATCH leva só os campos não
    // financeiros (o backend trataria itens/desconto como alteração financeira).
    const base = attended && !financialChanged
      ? Object.fromEntries(NON_FINANCIAL_PATCH_FIELDS.filter((field) => form[field] !== undefined).map((field) => [field, form[field]]))
      : appointmentPatchPayload(form, safeServices, safeJewelry, { depositDirty });
    const payload = { ...base, ...patch };
    payload.reason = scheduleChanged ? form.reschedule_reason : (patch.reason ?? (needsChangeReason ? changeReason.trim() : undefined));
    const response = await apiFetch(`/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Não foi possível atualizar o agendamento.");
      return;
    }
    quickDraft.clearDraft();
    onSaved?.();
  }

  async function completeAppointment() {
    setError("");
    if (!canFinalize) return setError("Você não tem permissão para finalizar atendimentos.");
    // Refazer o fechamento por aqui SUBSTITUIRIA os pagamentos finais pela grade
    // (que nem aparece depois de "atendido") e cancelaria os já recebidos.
    if (attended) return setError("Atendimento já finalizado: use os ajustes de valor ou corrija os pagamentos pelo Financeiro.");
    if (!canGenerateReceivables && payments.some((payment) => payment.status === "pendente")) {
      setError("Deixar saldo pendente e gerar contas a receber exige o plano Profissional.");
      return;
    }
    const invalidDiscount = discountError();
    if (invalidDiscount) return setError(invalidDiscount);
    // O PATCH prévio grava itens, desconto e sinal editado — SEM status: quem
    // conclui é o POST /complete, com pagamentos e dados clínicos.
    const updatePayload = appointmentPatchPayload(form, safeServices, safeJewelry, { depositDirty, includeStatus: false });
    const updateResponse = await apiFetch(`/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatePayload)
    });
    const updateData = await updateResponse.json().catch(() => ({}));
    if (!updateResponse.ok) {
      return setError(updateData.error || "Não foi possível salvar os itens do atendimento.");
    }
    // Um clique imediatamente após editar o sinal pode anteceder a prévia
    // debounced. A linha padrão usa o saldo recém-gravado pelo backend.
    const finalPayments = !paymentsTouched && payments.length === 1 && updateData.remaining_value != null
      ? [{ ...payments[0], amount: asNumber(updateData.remaining_value) }]
      : payments;
    const response = await apiFetch(`/appointments/${appointment.id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payments: finalPayments, financial_notes: financialNotes, clinical_notes: clinicalNotes, occurrences, aftercare_notes: aftercareNotes, checklist: operationalChecklist, biosafety }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setError(data.error || "Não foi possível concluir o atendimento.");
    quickDraft.clearDraft();
    onSaved?.();
  }

  function closeQuickModal() {
    quickDraft.flushDraft();
    onClose?.();
  }

  async function applyClientCredit() {
    const response = await apiFetch(`/appointments/${appointment.id}/apply-client-credit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível aplicar o crédito disponível.");
    setPayments([{ ...DEFAULT_PAYMENT_ROW, method: "Crédito do cliente" }]);
    onSaved?.();
  }

  async function cancelWithResolution() {
    if (!cancellation?.reason?.trim()) return setError("Informe o motivo do cancelamento.");
    if (cancellation.resolution === "manual_refund" && !cancellation.refund_method) return setError("Informe a forma do reembolso.");
    const response = await apiFetch(`/appointments/${appointment.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cancellation) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível cancelar o agendamento.");
    setCancellation(null);
    onSaved?.();
  }

  const updatePayment = (index, patch) => editPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  return (
    <Modal
      open={!!appointment}
      title="Detalhes do Agendamento"
      subtitle={appointment ? `${personName(appointment)} · ${appointment.procedure || "Atendimento"}` : ""}
      size="workspace"
      onClose={closeQuickModal}
      footer={(
        <>
          <Button variant="secondary" onClick={closeQuickModal}>Fechar</Button>
          <Button onClick={() => saveAppointment()}>Salvar alterações</Button>
        </>
      )}
    >
      {appointment && (
        <FormWorkflow
          className="stack appointment-details-content"
          mobileFullscreen
          title="Atendimento"
          description="Dados operacionais, clínicos e financeiros no mesmo fluxo."
          draft={quickDraft}
          actions={quickDraft.hasDraft ? <><Button variant="secondary" onClick={quickDraft.restoreDraft}>Restaurar</Button><Button variant="ghost" onClick={quickDraft.discardDraft}>Descartar</Button></> : null}
        >
          <ValidationSummary errors={error ? [error] : []} />
          <div className="appointment-workspace-pair">
            <div className="soft-card">
              <strong>{personName(appointment)}</strong>
              <p>{appointment.whatsapp || "WhatsApp não informado"}</p>
              <p>{appointment.service_name || appointment.procedure || "Procedimento não informado"} · {appointment.professional_name || "Sem profissional"}</p>
              {appointment.arrived_at && <p>Chegada registrada: {formatOperationalTime(appointment.arrived_at)}</p>}
              {appointment.started_at && <p>Atendimento iniciado: {formatOperationalTime(appointment.started_at)}</p>}
              {appointment.no_show_at && <p>Ausência registrada: {formatOperationalTime(appointment.no_show_at)}</p>}
            </div>
            <div className="form-grid appointment-schedule-grid">
              <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value })} />
              <Input type="time" label="Horário" value={form.appointment_time} onChange={(value) => setForm({ ...form, appointment_time: value })} />
              <AppointmentStatusSelect value={form.status} current={appointment.status} onChange={(value) => setForm({ ...form, status: value })} />
            </div>
          </div>
          {(form.appointment_date !== appointment.appointment_date || form.appointment_time !== appointment.appointment_time) && (
            <Textarea label="Motivo do reagendamento" value={form.reschedule_reason || ""} onChange={(reschedule_reason) => setForm({ ...form, reschedule_reason })} required />
          )}
          {needsChangeReason && (
            <Textarea label="Motivo da alteração (atendimento finalizado)" value={changeReason} onChange={setChangeReason} placeholder="Ex.: correção do valor cobrado" required />
          )}
          <AppointmentItemsEditor
            form={form}
            services={safeServices}
            procedures={safeProcedures}
            jewelry={safeJewelry}
            onChange={updatePricedForm}
            compact
          />
          <div className="appointment-workspace-columns">
            <AppointmentValueSummary
              form={form}
              services={safeServices}
              jewelry={safeJewelry}
              appointment={appointment}
              canEditDiscount={canEditDiscount}
              discountLockedReason={discountLockedReason}
              onDiscountChange={(value) => setForm((current) => ({ ...current, manual_discount_value: value }))}
              onDiscountReasonChange={(text) => setForm((current) => ({ ...current, manual_discount_reason: text }))}
              depositFromForm={depositDirty}
              financialOverride={financialOverride}
              refreshKey={financialRevision}
              onSummary={syncDefaultPayment}
            />
            <div className="appointment-workspace-side">
              <AppointmentDepositFields
                form={form}
                lockedReason={depositLockedReason}
                onChange={(patch) => {
                  setDepositDirty(true);
                  setForm((current) => ({ ...current, ...patch, deposit_manual: true }));
                }}
              />
              <Textarea label="Observação" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
            </div>
          </div>
          <div className="appointment-workspace-pair">
            {!attended ? <section className="soft-card stack" aria-label="Registro clínico">
              <div className="section-inline-header"><strong>Registro clínico</strong><small>Campos opcionais</small></div>
              <Textarea label="Observações clínicas (opcional)" value={clinicalNotes} onChange={setClinicalNotes} />
              <Textarea label="Intercorrências (opcional)" value={occurrences} onChange={setOccurrences} />
              <Textarea label="Orientações pós-atendimento (opcional)" value={aftercareNotes} onChange={setAftercareNotes} />
              {operationalChecklist.length > 0 && <div className="soft-card stack">
                <div className="section-inline-header"><strong>Checklist do atendimento</strong><small>Opcionais podem ficar em branco</small></div>
                {operationalChecklist.map((item) => <Checkbox key={item.key} label={`${item.label}${item.required ? " *" : ""}`} checked={Boolean(item.completed)} onChange={(completed) => setOperationalChecklist(operationalChecklist.map((row) => row.key === item.key ? { ...row, completed } : row))} />)}
              </div>}
              {operationalRules.biosafety.enabled && <div className="soft-card stack">
                <div className="section-inline-header"><strong>Rastreabilidade de biossegurança</strong><small>Dados preservados no histórico</small></div>
                <div className="form-grid">
                  <Input label={`Ciclo de esterilização${operationalRules.biosafety.required_fields.includes("sterilization_cycle") ? " *" : ""}`} value={biosafety.sterilization_cycle} onChange={(sterilization_cycle) => setBiosafety({ ...biosafety, sterilization_cycle })} />
                  <Input label={`Registro/comprovante${operationalRules.biosafety.required_fields.includes("sterilization_record") ? " *" : ""}`} value={biosafety.sterilization_record} onChange={(sterilization_record) => setBiosafety({ ...biosafety, sterilization_record })} />
                  <Select label={`Joia aplicada${operationalRules.biosafety.required_fields.includes("applied_jewelry") ? " *" : ""}`} value={biosafety.applied_jewelry_id} onChange={(applied_jewelry_id) => setBiosafety({ ...biosafety, applied_jewelry_id })}><option value="">Não informar</option>{safeJewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
                </div>
                {asArray(biosafety.material_lots).map((material, index) => <div className="form-grid" key={index}>
                  <Input label={`Material/lote${operationalRules.biosafety.required_fields.includes("material_lots") ? " *" : ""}`} value={material.batch_code} onChange={(batch_code) => setBiosafety({ ...biosafety, material_lots: biosafety.material_lots.map((row, rowIndex) => rowIndex === index ? { ...row, batch_code } : row) })} placeholder="Ex.: Agulha lote ABC123" />
                  <Input type="number" min="1" label="Quantidade" value={material.quantity} onChange={(quantity) => setBiosafety({ ...biosafety, material_lots: biosafety.material_lots.map((row, rowIndex) => rowIndex === index ? { ...row, quantity } : row) })} />
                  <Button variant="secondary" onClick={() => setBiosafety({ ...biosafety, material_lots: biosafety.material_lots.filter((_, rowIndex) => rowIndex !== index) })}>Remover</Button>
                </div>)}
                <Button variant="secondary" onClick={() => setBiosafety({ ...biosafety, material_lots: [...biosafety.material_lots, { batch_code: "", quantity: 1 }] })}>Adicionar material/lote</Button>
                <Textarea label="Observações de biossegurança (opcional)" value={biosafety.notes} onChange={(notes) => setBiosafety({ ...biosafety, notes })} />
              </div>}
            </section> : <section className="soft-card stack" aria-label="Registro clínico">
              <strong>Registro clínico</strong>
              <p className="appointment-locked-note">Registrado na finalização. Consulte em Agenda → Histórico de atendimentos.</p>
            </section>}
            {/* Fora da condição acima: o indicador químico continua visível e
                registrável depois que o atendimento é finalizado. */}
            <ChemicalIndicatorPanel appointment={appointment} canEdit={can(currentUser, "clinical_files.edit")} />
          </div>
          <section className="soft-card stack" aria-label="Conferência financeira">
            <div className="section-inline-header">
              <strong>Conferência financeira</strong>
              {!attended && <Button variant="secondary" onClick={() => editPayments([...payments, { ...DEFAULT_PAYMENT_ROW }])}>Dividir pagamento</Button>}
            </div>
            <AppointmentValueAdjustments
              appointment={appointment}
              canEdit={canAdjustValue}
              lockedReason={adjustmentLockedReason}
              requireReason
              onChanged={handleAdjustmentsChanged}
            />
            {!attended && <>
              <ResponsiveEditableList
                items={payments}
                ariaLabel="Pagamentos do atendimento"
                getKey={(payment, index) => payment.row_key || `${payment.method}-${index}`}
                columns={[
                  { key: "method", label: "Forma", render: (payment, index) => <PaymentSelect ariaLabel={`Forma ${index + 1}`} value={payment.method} onChange={(value) => updatePayment(index, { method: value })} /> },
                  { key: "amount", label: "Valor", render: (payment, index) => <Input type="number" aria-label={`Valor ${index + 1}`} value={payment.amount} onChange={(value) => updatePayment(index, { amount: Number(value || 0) })} /> },
                  { key: "status", label: "Status", render: (payment, index) => <Select ariaLabel={payments.length === 1 ? "Status" : `Status ${index + 1}`} value={payment.status} onChange={(value) => updatePayment(index, { status: value })}><option value="pago">Pago</option><option value="pendente" disabled={!canGenerateReceivables}>Pendente{canGenerateReceivables ? "" : " — Profissional"}</option></Select> },
                  { key: "installments", label: "Parcelas", render: (payment, index) => String(payment.method).toLowerCase().includes("crédito") ? <Input type="number" aria-label={`Parcelas ${index + 1}`} value={payment.installments} onChange={(value) => updatePayment(index, { installments: Number(value || 1) })} /> : "—" },
                  { key: "fee", label: "Taxa", render: (payment, index) => String(payment.method).toLowerCase().includes("crédito") ? <Input type="number" aria-label={`Taxa ${index + 1}`} value={payment.fee_amount} onChange={(value) => updatePayment(index, { fee_amount: Number(value || 0) })} /> : "—" },
                  { key: "receipt", label: "Previsão", render: (payment, index) => String(payment.method).toLowerCase().includes("crédito") ? <Input type="date" aria-label={`Previsão ${index + 1}`} value={payment.expected_receipt_date} onChange={(value) => updatePayment(index, { expected_receipt_date: value })} /> : "—" },
                ]}
                onRemove={payments.length > 1 ? (_payment, index) => editPayments(payments.filter((_, itemIndex) => itemIndex !== index)) : null}
              />
              {!canGenerateReceivables && (
                <PlanUpgradeNotice title="Saldo pendente no plano Profissional" onUpgrade={onUpgrade}>
                  No Start, o atendimento pode ser finalizado com pagamentos recebidos. Gerar saldo a receber exige o Financeiro básico.
                </PlanUpgradeNotice>
              )}
              <Textarea label="Observações financeiras" value={financialNotes} onChange={setFinancialNotes} />
              <small>Sinal conferido: {currency.format(asNumber(form.deposit_value))} ({depositReceived(form.deposit_status) ? "recebido" : "pendente"}). Confira o saldo atualizado no resumo financeiro acima.</small>
            </>}
          </section>
          <div className="toolbar compact-actions">
            {/* Finalizado: atalhos de status reabririam o atendimento (estornando
                comissão) num clique; a reabertura fica só no seletor de status. */}
            {!attended && <Button variant="secondary" onClick={() => saveAppointment({ status: "confirmado" })}>Confirmar</Button>}
            {!attended && form.status === "confirmado" && <Button variant="secondary" onClick={() => saveAppointment({ status: "chegou" })}>Registrar chegada</Button>}
            {!attended && form.status === "chegou" && <Button variant="secondary" onClick={() => saveAppointment({ status: "em_atendimento" })}>Iniciar atendimento</Button>}
            {!attended && <Button variant="secondary" onClick={() => saveAppointment({ status: "remarcado" })}>Reagendar</Button>}
            {canCancel && <Button variant="secondary" className="danger" onClick={() => setCancellation({ resolution: hasPaidDeposit ? "retain_deposit" : "no_payment", refund_method: "Pix", reason: "" })}>Cancelar</Button>}
            {canCancel && !["atendido", "cancelado", "nao_compareceu"].includes(form.status) && <Button variant="secondary" onClick={() => setCancellation({ outcome: "no_show", resolution: hasPaidDeposit ? "retain_deposit" : "no_payment", refund_method: "Pix", reason: "" })}>Não compareceu</Button>}
            {!attended && <Button onClick={completeAppointment} disabled={!canFinalize} title={canFinalize ? undefined : "Finalizar exige a permissão de finalizar atendimentos."}>Revisar e finalizar</Button>}
          </div>
          {attended
            ? <small className="field-hint">Atendimento finalizado: diferenças de valor entram como ajuste na Conferência financeira; pagamentos são corrigidos pelo Financeiro.</small>
            : !canFinalize && <small className="field-hint">Finalizar o atendimento exige a permissão “Finalizar atendimento”.</small>}
          {canResolveFinance && form.status !== "atendido" && form.status !== "cancelado" && <Button variant="secondary" onClick={applyClientCredit}>Aplicar crédito disponível</Button>}
          {readStoredSession()?.user?.role === "admin" && <Button variant="secondary" className="danger" onClick={openDeletion}>Excluir definitivamente</Button>}
          <Modal open={!!deletion} title="Excluir definitivamente" subtitle="Esta ação exige análise e confirmação" onClose={() => !deletion?.busy && setDeletion(null)} footer={<><Button variant="secondary" onClick={() => setDeletion(null)}>Voltar</Button><Button variant="danger" disabled={!deletion?.canDelete || deletion?.busy || deletion?.confirmation !== "EXCLUIR AGENDAMENTO" || !deletion?.reason?.trim()} onClick={deleteAppointment}>{deletion?.busy ? "Excluindo…" : "Excluir agendamento"}</Button></>}>
            {deletion && <div className="stack"><div className="soft-card"><strong>{deletion.canDelete ? "Agendamento de teste sem vínculos" : "Exclusão bloqueada"}</strong><p>{deletion.canDelete ? "A exclusão é irreversível e ficará registrada na auditoria." : "Existem vínculos financeiros, clínicos ou de estoque. Cancele o agendamento para preservar o histórico."}</p></div><div className="summary-grid">{Object.entries(deletion.impact).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")}: <strong>{value}</strong></span>)}</div><Input label="Motivo obrigatório" value={deletion.reason} onChange={(reason) => setDeletion({ ...deletion, reason })} /><Input label="Digite EXCLUIR AGENDAMENTO" value={deletion.confirmation} onChange={(confirmation) => setDeletion({ ...deletion, confirmation })} /></div>}
          </Modal>
          <Modal open={!!cancellation} title={cancellation?.outcome === "no_show" ? "Registrar ausência" : "Cancelar agendamento"} subtitle="Defina o destino do sinal; a decisão ficará auditada." onClose={() => setCancellation(null)} footer={<><Button variant="secondary" onClick={() => setCancellation(null)}>Voltar</Button><Button variant="danger" disabled={!cancellation?.reason?.trim()} onClick={cancelWithResolution}>Confirmar</Button></>}>
            {cancellation && <div className="stack"><Select label="Resolução financeira" value={cancellation.resolution} onChange={(resolution) => setCancellation({ ...cancellation, resolution })}>{hasPaidDeposit ? <><option value="retain_deposit">Reter sinal</option>{canResolveFinance && <option value="client_credit">Converter sinal em crédito</option>}{canResolveFinance && <option value="manual_refund">Reembolso manual</option>}</> : <option value="no_payment">Sem pagamento recebido</option>}</Select>{cancellation.resolution === "manual_refund" && <PaymentSelect label="Forma do reembolso" value={cancellation.refund_method} onChange={(refund_method) => setCancellation({ ...cancellation, refund_method })} />}<Textarea label="Motivo obrigatório" value={cancellation.reason} onChange={(reason) => setCancellation({ ...cancellation, reason })} /></div>}
          </Modal>
        </FormWorkflow>
      )}
    </Modal>
  );
}

/**
 * Leitura da coluna "Comissão" da lista de profissionais. O backend só manda
 * `commission_summary` para quem pode ver comissão e tem o recurso do plano:
 * `{ service_default: {rate_type, rate_value} | null, product_default,
 * service_rules, active_rules }`. O percentual legado só vale para dados sem
 * resumo (nenhum cálculo novo lê `commission_percentage`).
 */
export function professionalCommissionLabel(professional) {
  const rateLabel = (rule, unit) => {
    const value = asNumber(rule.rate_value);
    return rule.rate_type === "valor_fixo"
      ? `${currency.format(value)} por ${unit}`
      : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  };
  const hasSummary = professional.commission_summary !== undefined && professional.commission_summary !== null;
  if (hasSummary) {
    const summary = asObject(professional.commission_summary);
    const serviceDefault = asObject(summary.service_default ?? summary.servico_padrao ?? summary.default_rule);
    const productDefault = asObject(summary.product_default ?? summary.produto_padrao);
    const serviceRules = asNumber(firstDefined(summary.service_rules, summary.service_rules_count, summary.rules_count, 0));
    const hasServiceDefault = firstDefined(serviceDefault.rate_value) !== undefined;
    const hasProductDefault = firstDefined(productDefault.rate_value) !== undefined;
    const extra = [
      hasProductDefault ? `Produtos: ${rateLabel(productDefault, "item")}` : "",
      serviceRules > 0 ? `${serviceRules} regra(s) por serviço` : ""
    ].filter(Boolean).join(" · ");
    if (hasServiceDefault) return { label: `Serviços: ${rateLabel(serviceDefault, "serviço")}`, extra, sort: asNumber(serviceDefault.rate_value) };
    if (extra) return { label: serviceRules > 0 ? "Regras por serviço" : "Só produtos", extra, sort: 0 };
    return { label: "Sem comissão", extra: "", sort: -1 };
  }
  const legacy = asNumber(professional.commission_percentage);
  if (legacy > 0) return { label: `Serviços: ${legacy.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`, extra: "", sort: legacy };
  return { label: "Sem comissão", extra: "", sort: -1 };
}

export function BookingAdmin({ onBack, initialTab, features = [], onUpgrade }) {
  const { data: services } = useFetch("/services");
  const { data: professionalsData } = useFetch("/professionals");
  const { data: options } = useFetch("/options");
  const { data: availability } = useFetch("/availability");
  const { data: blocks } = useFetch("/schedule-blocks");
  const { data: appointments } = useFetch("/appointments?status=pendente");
  // Serviço e profissional alimentam também "/options" e o checklist do onboarding.
  const invalidate = useApiInvalidate();
  const refreshProfessionals = () => invalidate("/professionals", "/options", "/booking/readiness");
  const refreshAvailability = () => invalidate("/availability", "/booking/readiness");
  const refreshBlocks = () => invalidate("/schedule-blocks", "/availability");
  const refreshAppointments = () => invalidate("/appointments", "/dashboard");
  const normalizeSettingsTab = (value) => ["procedimentos", "profissionais", "horarios", "recursos", "bloqueios", "solicitacoes"].includes(value) ? value : "procedimentos";
  const [tab, setTab] = useState(normalizeSettingsTab(initialTab));
  useEffect(() => setTab(normalizeSettingsTab(initialTab)), [initialTab]);
  const [professionalForm, setProfessionalForm] = useState(defaultProfessionalForm());
  const [editingProfessionalId, setEditingProfessionalId] = useState(null);
  const [professionalModalOpen, setProfessionalModalOpen] = useState(false);
  // Regras de comissão editadas e ainda não salvas (salvamento próprio, fora do <form>).
  const [commissionDirty, setCommissionDirty] = useState(false);
  const [professionalError, setProfessionalError] = useState("");
  // Aviso quando o cadastro foi salvo mas a comissão editada ainda não.
  const [professionalNotice, setProfessionalNotice] = useState("");
  const [weeklyProfessionalId, setWeeklyProfessionalId] = useState("");
  const [weeklyDays, setWeeklyDays] = useState([]);
  const [readinessMessage, setReadinessMessage] = useState("");
  const [requestError, setRequestError] = useState("");
  const [blockForm, setBlockForm] = useState(defaultScheduleBlock());
  const [editingBlockId, setEditingBlockId] = useState(null);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockError, setBlockError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const professionals = asArray(asObject(options).professionals);
  const allProfessionals = asArray(professionalsData);
  const safeServices = asArray(services);
  const safeAvailability = asArray(availability);
  const safeBlocks = asArray(blocks);
  const safeAppointments = asArray(appointments);
  const sessionUser = readStoredSession()?.user || {};
  // Coluna "Comissão": permissão de ver comissão E recurso do plano (sem o
  // recurso o backend nem manda o resumo, e o percentual legado enganaria).
  const canSeeCommission = (can(sessionUser, "commission.view_all") || can(sessionUser, "commission.edit"))
    && asArray(features).includes("commissions");

  const activeServices = safeServices.filter((service) => Boolean(Number(service.is_active ?? service.active_online_booking)));
  const activeProfessionals = allProfessionals.filter((professional) => Boolean(Number(professional.active)));
  const weeklyWeekdays = [0, 1, 2, 3, 4, 5, 6];

  function defaultWeeklyDay(weekday, professionalId = weeklyProfessionalId) {
    return {
      professional_id: professionalId,
      weekday,
      is_active: weekday >= 1 && weekday <= 6,
      start_time: "09:00",
      end_time: "18:00",
      lunch_start: "12:00",
      lunch_end: "13:00",
      duration_minutes: 40,
      buffer_minutes: 10
    };
  }

  function weeklyDaysForProfessional(professionalId) {
    const savedDays = safeAvailability.filter((item) => String(item.professional_id) === String(professionalId));
    return weeklyWeekdays.map((weekday) => {
      const saved = savedDays.find((item) => Number(item.weekday) === weekday);
      return saved
        ? {
          professional_id: professionalId,
          weekday,
          is_active: Boolean(Number(saved.is_active)),
          start_time: saved.start_time || "09:00",
          end_time: saved.end_time || "18:00",
          lunch_start: saved.lunch_start || "",
          lunch_end: saved.lunch_end || "",
          duration_minutes: Number(saved.duration_minutes || 40),
          buffer_minutes: Number(saved.buffer_minutes || 10)
        }
        : defaultWeeklyDay(weekday, professionalId);
    });
  }

  function updateWeeklyDay(weekday, patch) {
    setWeeklyDays((current) => {
      const base = current.length ? current : weeklyDaysForProfessional(weeklyProfessionalId);
      return base.map((day) => Number(day.weekday) === Number(weekday) ? { ...day, ...patch } : day);
    });
  }

  useEffect(() => {
    if (!weeklyProfessionalId && activeProfessionals[0]?.id) {
      setWeeklyProfessionalId(String(activeProfessionals[0].id));
      return;
    }
    if (!weeklyProfessionalId) return;
    setWeeklyDays(weeklyDaysForProfessional(weeklyProfessionalId));
  }, [availability, weeklyProfessionalId, activeProfessionals.length]);

  if (services == null || professionalsData == null || availability == null || blocks == null || appointments == null) return <Loading />;

  function openNewProfessional() {
    setEditingProfessionalId(null);
    setProfessionalForm(defaultProfessionalForm());
    setProfessionalError("");
    setProfessionalNotice("");
    setProfessionalModalOpen(true);
  }

  function editProfessional(professional) {
    setEditingProfessionalId(professional.id);
    setProfessionalError("");
    setProfessionalNotice("");
    setProfessionalForm({
      ...defaultProfessionalForm(),
      name: professional.name || "",
      specialty: professional.specialty || "",
      phone: professional.phone || "",
      whatsapp: professional.whatsapp || professional.phone || "",
      email: professional.email || "",
      notification_opt_in: Boolean(Number(professional.notification_opt_in ?? 1)),
      calendar_color: professional.calendar_color || "#C8A96A",
      active: Boolean(Number(professional.active)),
      service_ids: asArray(professional.service_ids).map(String)
    });
    setProfessionalModalOpen(true);
  }

  function toggleProfessionalService(serviceId) {
    const id = String(serviceId);
    const current = asArray(professionalForm.service_ids).map(String);
    setProfessionalForm({
      ...professionalForm,
      service_ids: current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    });
  }

  async function saveProfessional(event) {
    event.preventDefault();
    setProfessionalError("");
    if (!professionalForm.name.trim()) return setProfessionalError("Informe o nome do profissional.");
    const response = await apiFetch(editingProfessionalId ? `/professionals/${editingProfessionalId}` : "/professionals", {
      method: editingProfessionalId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(professionalForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setProfessionalError(payload.error || "Não foi possível salvar o profissional.");
    }
    // O "Salvar profissional" (e o "Salvar" da guarda de saída) envia só o
    // cadastro; as regras de comissão têm salvamento próprio. Fechar aqui
    // descartaria em silêncio a comissão editada, então o modal fica aberto.
    if (commissionDirty && editingProfessionalId) {
      setProfessionalNotice("Cadastro salvo. A comissão editada ainda não foi gravada: use “Salvar comissão” abaixo.");
      refreshProfessionals();
      return;
    }
    setProfessionalNotice("");
    setProfessionalForm(defaultProfessionalForm());
    setEditingProfessionalId(null);
    setProfessionalModalOpen(false);
    refreshProfessionals();
  }

  function removeProfessional(professional) {
    setDeleting({
      message: `Excluir ${professional.name}?`,
      run: async () => {
        const response = await apiFetch(`/professionals/${professional.id}`, { method: "DELETE" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          return setProfessionalError(payload.error || "Não foi possível excluir o profissional.");
        }
        refreshProfessionals();
        refreshAvailability();
      }
    });
  }

  async function saveWeeklyAvailability(event) {
    event.preventDefault();
    setReadinessMessage("");
    if (!activeProfessionals.length) return setReadinessMessage("Cadastre e ative pelo menos um profissional antes de configurar a agenda semanal.");
    if (!activeServices.length) return setReadinessMessage("Cadastre e ative pelo menos um serviço antes de configurar a agenda semanal.");
    if (!weeklyProfessionalId) return setReadinessMessage("Escolha o profissional da agenda semanal.");
    const response = await apiFetch("/availability/generate-weekly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        professional_id: weeklyProfessionalId,
        days: weeklyDays.map((day) => ({
          ...day,
          professional_id: weeklyProfessionalId,
          is_active: Boolean(day.is_active)
        }))
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setReadinessMessage(payload.error || "Não foi possível salvar a disponibilidade semanal.");
    }
    setReadinessMessage("Disponibilidade semanal salva com sucesso.");
    refreshAvailability();
  }

  function openNewBlock() {
    setBlockForm(defaultScheduleBlock());
    setEditingBlockId(null);
    setBlockError("");
    setBlockModalOpen(true);
  }

  function editBlock(block) {
    setEditingBlockId(block.id);
    setBlockError("");
    setBlockForm({
      ...defaultScheduleBlock(),
      ...block,
      is_full_day: Boolean(Number(block.is_full_day)),
      is_recurring: Boolean(Number(block.is_recurring)),
      duration_minutes: block.duration_minutes || "",
      buffer_minutes: block.buffer_minutes || ""
    });
    setBlockModalOpen(true);
  }

  async function saveBlock(event) {
    event.preventDefault();
    setBlockError("");
    const response = await apiFetch(editingBlockId ? `/schedule-blocks/${editingBlockId}` : "/schedule-blocks", {
      method: editingBlockId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blockForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setBlockError(payload.error || "Não foi possível salvar o bloqueio.");
    }
    setBlockForm(defaultScheduleBlock());
    setEditingBlockId(null);
    setBlockModalOpen(false);
    refreshBlocks();
  }

  function removeBlock(block) {
    setDeleting({
      message: `Excluir o bloqueio "${block.reason}"?`,
      run: async () => {
        await apiFetch(`/schedule-blocks/${block.id}`, { method: "DELETE" });
        refreshBlocks();
      }
    });
  }

  async function updateRequest(id, status) {
    setRequestError(await updateAppointment(id, { status }, refreshAppointments));
  }

  return (
    <section className="booking-admin-page">
      <header className="availability-header agenda-settings-header">
        <div>
          <h2>Configurações da agenda</h2>
        </div>
        <div className="availability-header-actions">
          <Button variant="secondary" onClick={onBack}><ArrowLeft size={16} /> Voltar para agenda</Button>
        </div>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.List className="customization-tabs" aria-label="Configurações da agenda">
          {[
            ["procedimentos", "Procedimentos"],
            ["profissionais", "Profissionais"],
            ["horarios", "Agenda semanal"],
            ["recursos", "Salas e recursos"],
            ["bloqueios", "Disponibilidade avançada"],
            ["solicitacoes", "Solicitações pendentes"]
          ].map(([id, label]) => <Tabs.Trigger key={id} value={id}>{label}</Tabs.Trigger>)}
        </Tabs.List>
      </Tabs>

      {tab === "procedimentos" && <ServicesWorkspace />}

      {tab === "recursos" && <AgendaResources />}

      {tab === "profissionais" && (
        <div className="panel">
          <CrudHeader
            title="Profissionais"
            subtitle="Cadastre quem atende, especialidades, status e serviços realizados."
            actionLabel="Novo profissional"
            onAction={openNewProfessional}
          />
          <DataView
            rows={allProfessionals}
            defaultSort={{ key: "name", dir: "asc" }}
            searchPlaceholder="Buscar por nome, especialidade, telefone ou e-mail"
            filters={[
              {
                key: "status",
                label: "Status",
                type: "select",
                options: [{ value: "ativo", label: "Ativo" }, { value: "inativo", label: "Inativo" }],
                match: (professional, value) => (Boolean(Number(professional.active)) ? "ativo" : "inativo") === value
              },
              {
                key: "service_id",
                label: "Serviço atendido",
                type: "select",
                options: safeServices.map((service) => ({ value: String(service.id), label: service.name })),
                match: (professional, value) => asArray(professional.service_ids).map(String).includes(value)
              }
            ]}
            columns={[
              { key: "name", label: "Nome" },
              { key: "specialty", label: "Especialidade", value: (professional) => professional.specialty || "Body Piercer", render: (professional) => professional.specialty || "Body Piercer" },
              { key: "phone", label: "Contato", value: (professional) => [professional.phone, professional.email].filter(Boolean).join(" · ") || "Sem contato", render: (professional) => [professional.phone, professional.email].filter(Boolean).join(" · ") || "Sem contato" },
              { key: "service_ids", label: "Serviços", value: (professional) => asArray(professional.service_ids).length, render: (professional) => asArray(professional.service_ids).length ? `${asArray(professional.service_ids).length} serviço(s)` : "Sem vínculo" },
              ...(canSeeCommission ? [{
                key: "commission",
                label: "Comissão",
                value: (professional) => professionalCommissionLabel(professional).sort,
                render: (professional) => {
                  const commission = professionalCommissionLabel(professional);
                  return <span className="appointment-commission-cell">{commission.label}{commission.extra && <small>{commission.extra}</small>}</span>;
                }
              }] : []),
              { key: "active", label: "Status", value: (professional) => professional.active ? "Ativo" : "Inativo", render: (professional) => <StatusBadge status={professional.active ? "Ativo" : "Inativo"} /> },
            ]}
            actions={(professional) => <RowActions actions={[
              { label: "Editar", onClick: () => editProfessional(professional), primary: true },
              { label: "Excluir", onClick: () => removeProfessional(professional), danger: true },
            ]} />}
            empty="Cadastre pelo menos um profissional para liberar o agendamento online."
            emptyFiltered="Nenhum profissional corresponde aos filtros aplicados."
          />
          <Modal
            open={professionalModalOpen}
            title={editingProfessionalId ? "Editar profissional" : "Novo profissional"}
            subtitle="Defina status, contato, cor da agenda e serviços realizados."
            onClose={() => setProfessionalModalOpen(false)}
            // Com regra de comissão pendente, a guarda de saída liga; sem ela, o
            // modal segue detectando sozinho as edições do cadastro.
            dirty={commissionDirty || undefined}
            footer={(
              <>
                <Button variant="secondary" onClick={() => setProfessionalModalOpen(false)}>Cancelar</Button>
                <Button type="submit" form="professional-form">Salvar profissional</Button>
              </>
            )}
          >
            <form id="professional-form" onSubmit={saveProfessional}>
              <div className="form-grid">
                <Input label="Nome" value={professionalForm.name} onChange={(value) => setProfessionalForm({ ...professionalForm, name: value })} required />
                <Input label="Especialidade" value={professionalForm.specialty} onChange={(value) => setProfessionalForm({ ...professionalForm, specialty: value })} />
                <Input label="Telefone" value={professionalForm.phone} onChange={(value) => setProfessionalForm({ ...professionalForm, phone: value })} />
                <Input label="WhatsApp profissional" value={professionalForm.whatsapp} onChange={(value) => setProfessionalForm({ ...professionalForm, whatsapp: value })} />
                <Input type="email" label="E-mail" value={professionalForm.email} onChange={(value) => setProfessionalForm({ ...professionalForm, email: value })} />
                <Input type="color" label="Cor na agenda" value={professionalForm.calendar_color} onChange={(value) => setProfessionalForm({ ...professionalForm, calendar_color: value })} />
              </div>
              <Switch label="Profissional ativo" checked={professionalForm.active} onChange={(value) => setProfessionalForm({ ...professionalForm, active: value })} />
              <Switch label="Receber notificações automáticas" checked={professionalForm.notification_opt_in} onChange={(value) => setProfessionalForm({ ...professionalForm, notification_opt_in: value })} />
              <div className="form-section">
                <h3>Serviços que realiza</h3>
                <div className="toggle-grid">
                  {safeServices.map((service) => (
                    <Switch
                      key={service.id}
                      label={service.name}
                      checked={asArray(professionalForm.service_ids).map(String).includes(String(service.id))}
                      onChange={() => toggleProfessionalService(service.id)}
                    />
                  ))}
                </div>
              </div>
              {professionalError && <span className="form-error">{professionalError}</span>}
              {professionalNotice && <p className="field-hint" role="status">{professionalNotice}</p>}
            </form>
            {/* Fora do <form> do profissional: as regras têm salvamento próprio
                (PUT /professionals/:id/commission-rules) e histórico. */}
            {/* Permissão e plano são tratados pelo próprio componente (aviso no lugar). */}
            <div className="form-section">
              <ProfessionalCommissionRules professionalId={editingProfessionalId} services={safeServices} features={features} onUpgrade={onUpgrade} onDirtyChange={setCommissionDirty} />
            </div>
          </Modal>
        </div>
      )}

      {tab === "horarios" && (
        <article className="panel weekly-schedule-panel">
          <div className="panel-heading">
            <div><h2>Agenda semanal</h2><span>Escolha o profissional e defina os dias e horários de atendimento.</span></div>
          </div>
          {readinessMessage && <p className={readinessMessage.includes("sucesso") ? "form-success" : "form-error"}>{readinessMessage}</p>}
          <form onSubmit={saveWeeklyAvailability}>
            <div className="weekly-schedule-toolbar">
              <Select label="Profissional" value={weeklyProfessionalId} onChange={(value) => setWeeklyProfessionalId(value)}>
                <option value="">Escolha um profissional</option>
                {activeProfessionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
              </Select>
              <Button variant="primary" type="submit" disabled={!weeklyProfessionalId}>Salvar agenda semanal</Button>
            </div>
            <div className="weekly-schedule-list">
              {weeklyWeekdays.map((weekday) => {
                const day = weeklyDays.find((item) => Number(item.weekday) === weekday) || defaultWeeklyDay(weekday);
                const active = Boolean(day.is_active);
                return <article className={`weekly-schedule-row ${active ? "" : "is-inactive"}`} key={weekday}>
                  <Checkbox className="weekly-day-toggle" checked={active} onChange={(is_active) => updateWeeklyDay(weekday, { is_active })} label={<span><strong>{weekdayLabel(weekday)}</strong><small>{active ? "Atende" : "Fechado"}</small></span>} />
                  <label><span>Início</span><input type="time" value={day.start_time || "09:00"} disabled={!active} onChange={(event) => updateWeeklyDay(weekday, { start_time: event.target.value })} /></label>
                  <label><span>Fim</span><input type="time" value={day.end_time || "18:00"} disabled={!active} onChange={(event) => updateWeeklyDay(weekday, { end_time: event.target.value })} /></label>
                  <label><span>Pausa</span><input type="time" value={day.lunch_start || ""} disabled={!active} onChange={(event) => updateWeeklyDay(weekday, { lunch_start: event.target.value })} /></label>
                  <label><span>Retorno</span><input type="time" value={day.lunch_end || ""} disabled={!active} onChange={(event) => updateWeeklyDay(weekday, { lunch_end: event.target.value })} /></label>
                  <Accordion className="weekly-schedule-advanced">
                    <Accordion.Item value="ajustes">
                      <Accordion.Header><Accordion.Trigger>Ajustes</Accordion.Trigger></Accordion.Header>
                      <Accordion.Content>
                        <div className="weekly-schedule-advanced-fields">
                          <label><span>Duração (min.)</span><input type="number" min="1" value={day.duration_minutes || 40} disabled={!active} onChange={(event) => updateWeeklyDay(weekday, { duration_minutes: event.target.value })} /></label>
                          <label><span>Intervalo (min.)</span><input type="number" min="0" value={day.buffer_minutes || 10} disabled={!active} onChange={(event) => updateWeeklyDay(weekday, { buffer_minutes: event.target.value })} /></label>
                        </div>
                      </Accordion.Content>
                    </Accordion.Item>
                  </Accordion>
                </article>;
              })}
            </div>
            <p className="field-optional">Domingo começa fechado. Para exceções pontuais, use Disponibilidade avançada.</p>
          </form>
        </article>
      )}

      {tab === "bloqueios" && (
        <div className="stack">
          <div className="panel">
            <CrudHeader
              title="Disponibilidade avançada"
              subtitle="Bloqueie datas, crie horários especiais e libere domingos específicos."
              actionLabel="Nova regra"
              onAction={openNewBlock}
            />
            <DataView
              rows={safeBlocks}
              defaultSort={{ key: "start_datetime", dir: "asc" }}
              searchPlaceholder="Buscar por motivo, tipo ou profissional"
              filters={[
                {
                  key: "professional_name",
                  label: "Profissional",
                  type: "select",
                  options: distinctOptions(safeBlocks.map((block) => block.professional_name || "Todos")),
                  match: (block, value) => (block.professional_name || "Todos") === value
                },
                {
                  key: "block_type",
                  label: "Tipo de bloqueio",
                  type: "select",
                  options: [
                    { value: "block", label: "Bloqueio de intervalo" },
                    { value: "unavailable", label: "Data indisponível" },
                    { value: "special_hours", label: "Horário especial" }
                  ],
                  match: (block, value) => blockTypeLabel(block.block_type) === blockTypeLabel(value)
                }
              ]}
              columns={[
                { key: "block_type", label: "Tipo", value: (block) => blockTypeLabel(block.block_type), render: (block) => blockTypeLabel(block.block_type) },
                { key: "reason", label: "Motivo" },
                { key: "professional_name", label: "Profissional", value: (block) => block.professional_name || "Todos", render: (block) => block.professional_name || "Todos" },
                // Ordena pelo valor cru (ISO) porque dd/MM/aaaa ordenaria errado.
                { key: "start_datetime", label: "Início", render: (block) => new Date(block.start_datetime).toLocaleString("pt-BR") },
                { key: "end_datetime", label: "Final", render: (block) => new Date(block.end_datetime).toLocaleString("pt-BR") },
              ]}
              actions={(block) => <RowActions actions={[
                { label: "Editar", onClick: () => editBlock(block), primary: true },
                { label: "Excluir", onClick: () => removeBlock(block), danger: true },
              ]} />}
              empty="Nenhuma regra avançada cadastrada ainda."
              emptyFiltered="Nenhuma regra corresponde aos filtros aplicados."
            />
          </div>

          <Modal
            open={blockModalOpen}
            title={editingBlockId ? "Editar regra" : "Nova regra"}
            subtitle="Bloqueios removem horários. Horários especiais liberam uma data específica, inclusive domingo."
            onClose={() => { setBlockModalOpen(false); setEditingBlockId(null); }}
            footer={(
              <>
                <Button variant="secondary" onClick={() => { setBlockModalOpen(false); setEditingBlockId(null); }}>Cancelar</Button>
                <Button type="submit" form="block-form">Salvar regra</Button>
              </>
            )}
          >
            <form id="block-form" onSubmit={saveBlock}>
              <div className="form-grid">
                <Select label="Profissional" value={blockForm.professional_id} onChange={(value) => setBlockForm({ ...blockForm, professional_id: value })}>
                  <option value="">Selecione</option>
                  {professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
                </Select>
                <Select label="Tipo de regra" value={blockForm.block_type} onChange={(value) => setBlockForm({
                  ...blockForm,
                  block_type: value,
                  reason: value === "special_hours" ? "Horário especial" : value === "unavailable" ? "Data indisponível" : "Bloqueio",
                  is_full_day: value === "unavailable"
                })}>
                  <option value="block">Bloquear intervalo específico</option>
                  <option value="unavailable">Adicionar data indisponível</option>
                  <option value="special_hours">Adicionar horário especial</option>
                </Select>
                <Input label="Motivo" value={blockForm.reason} onChange={(value) => setBlockForm({ ...blockForm, reason: value })} />
                <Input type="datetime-local" label="Início" value={blockForm.start_datetime} onChange={(value) => setBlockForm({ ...blockForm, start_datetime: value })} />
                <Input type="datetime-local" label="Final" value={blockForm.end_datetime} onChange={(value) => setBlockForm({ ...blockForm, end_datetime: value })} />
              </div>
              {blockForm.block_type === "special_hours" && (
                <div className="form-grid">
                  <Input label="Almoço início" value={blockForm.lunch_start} onChange={(value) => setBlockForm({ ...blockForm, lunch_start: value })} />
                  <Input label="Almoço final" value={blockForm.lunch_end} onChange={(value) => setBlockForm({ ...blockForm, lunch_end: value })} />
                  <Input type="number" label="Duração padrão" value={blockForm.duration_minutes} onChange={(value) => setBlockForm({ ...blockForm, duration_minutes: value })} />
                  <Input type="number" label="Intervalo" value={blockForm.buffer_minutes} onChange={(value) => setBlockForm({ ...blockForm, buffer_minutes: value })} />
                </div>
              )}
              <Switch label="Dia inteiro" checked={blockForm.is_full_day} onChange={(value) => setBlockForm({ ...blockForm, is_full_day: value })} />
              <Switch label="Recorrente" checked={blockForm.is_recurring} onChange={(value) => setBlockForm({ ...blockForm, is_recurring: value })} />
              <Textarea label="Observação" value={blockForm.notes} onChange={(value) => setBlockForm({ ...blockForm, notes: value })} />
              {blockError && <span className="form-error">{blockError}</span>}
            </form>
          </Modal>
        </div>
      )}

      {tab === "solicitacoes" && (
        <div className="panel">
          <div className="panel-heading"><h2>Solicitações pendentes</h2><span>Confirme ou recuse manualmente</span></div>
          {requestError && <p className="form-error" role="alert">{requestError}</p>}
          <div className="appointment-list">
            {safeAppointments.map((item) => (
              <article className="appointment-row" key={item.id}>
                <div className="time-box"><strong>{item.appointment_time}</strong><span>{formatDate(item.appointment_date)}</span></div>
                <div><h3>{personName(item)}</h3><p>{item.procedure} · {currency.format(item.deposit_value || 0)} de sinal</p><small>{item.professional_name} · {item.whatsapp}</small></div>
                <div className="row-actions">
                  <Button onClick={() => updateRequest(item.id, "confirmado")}>Confirmar</Button>
                  <Button variant="secondary" className="danger" onClick={() => updateRequest(item.id, "recusado")}>Recusar</Button>
                </div>
              </article>
            ))}
            {!safeAppointments.length && <p className="empty-state">Nenhuma solicitação pendente.</p>}
          </div>
        </div>
      )}
      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        confirmWord={deleting?.confirmWord}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
    </section>
  );
}

/** @param {{ appointments?: any[], onChanged?: () => any, compact?: boolean }} props */
export function AppointmentList({ appointments = [], onChanged, compact }) {
  const safeAppointments = asArray(appointments);

  return (
    <DataView
      rows={safeAppointments}
      defaultSort={{ key: "appointment_date", dir: "asc" }}
      searchable={false}
      columns={[
        {
          key: "appointment_date",
          label: "Data/Hora",
          // Ordena pela data ISO (dd/MM/aaaa ordenaria errado) e ainda deixa a
          // busca achar a data no formato que aparece na tela.
          value: (item) => `${item.appointment_date || ""} ${item.appointment_time || ""} ${formatDateWithYear(item.appointment_date)}`,
          render: (item) => (
            <span><strong>{formatDateWithYear(item.appointment_date)}</strong>{item.appointment_time ? ` · ${item.appointment_time}` : ""}</span>
          )
        },
        {
          key: "client",
          label: "Cliente",
          value: (item) => `${personName(item)} ${item.whatsapp || ""}`,
          render: (item) => personName(item)
        },
        {
          key: "procedure",
          label: "Procedimento · Região",
          value: (item) => `${item.procedure || ""} ${item.piercing_region || ""} ${item.jewelry_name || ""}`,
          render: (item) => (
            <>
              <span>{item.procedure || "Sem procedimento"} · {item.piercing_region || "sem região"}</span>
              <br />
              <small>{item.jewelry_name || "sem joia vinculada"}</small>
            </>
          )
        },
        {
          key: "professional_name",
          label: "Profissional",
          value: (item) => item.professional_name || "Sem profissional",
          render: (item) => item.professional_name || "Sem profissional"
        },
        {
          key: "status",
          label: "Status",
          value: (item) => appointmentStatusLabel(item.status),
          render: (item) => <StatusBadge status={item.status} />
        }
      ]}
      actions={compact ? undefined : (item) => (
        <RowActions
          actions={[
            { label: "WhatsApp", href: whatsappUrl(item.whatsapp, appointmentWhatsAppMessage(item)), target: "_blank", rel: "noreferrer", primary: true },
          ]}
        />
      )}
      empty="Nenhum atendimento encontrado."
      emptyFiltered="Nenhum atendimento corresponde aos filtros aplicados."
    />
  );
}

/**
 * PATCH simples de agendamento. Devolve o erro em vez de engolir: antes a tela
 * recarregava como se tivesse dado certo mesmo com 400/403/409.
 * @returns {Promise<string>} Mensagem de erro, ou "" quando gravou.
 */
export async function updateAppointment(id, body, refresh) {
  try {
    const response = await apiFetch(`/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = asObject(await response.json().catch(() => ({})));
      return String(payload.error || "Não foi possível atualizar o agendamento.");
    }
  } catch {
    return "Não foi possível conectar com a API.";
  }
  refresh?.();
  return "";
}
