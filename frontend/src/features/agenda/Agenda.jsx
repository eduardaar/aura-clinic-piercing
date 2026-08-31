// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, ExternalLink, Filter, MoreHorizontal, Plus, Search, Settings2, X } from "lucide-react";
import { Accordion, Button, Checkbox, FinancialSummary, Input, Metric, PaymentSelect, Select, StatusBadge, StatusSelect, Switch, Tabs, Textarea } from "../../components/common/Ui";
import { Modal, CrudHeader, ConfirmDeleteModal, DropdownMenu, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { FormSection, FormWorkflow, ReviewSummary, StepNavigator, ValidationSummary } from "../../components/common/FormWorkflow";
import { ResponsiveEditableList } from "../../components/common/TransactionFields";
import { asArray, asNumber, asObject, formatDate } from "../../lib/utils";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { buildCalendar, buildTimeSlots, dateKey, movePeriod } from "../../lib/calendarUtils";
import { defaultAppointment, defaultProfessionalForm, defaultScheduleBlock } from "../../lib/defaultForms";
import { appointmentWhatsAppMessage, calcRemaining, currency, personName, statusClass, weekdayLabel, whatsappUrl } from "../../features/shared/helpers";
import { SmartCombobox } from "../../components/common/SmartCombobox";
import { publicLinkForTenant } from "../../lib/publicRoutes";
import { PlanUpgradeNotice } from "../../components/common/PlanUpgradeNotice";
import { can, planAllowsAction } from "../../lib/permissions";
import { useFormDraft } from "../../lib/useFormDraft";
import { ServicesWorkspace } from "../services/Services";
import "../../styles/agenda-admin-responsive.css";

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
const APPOINTMENT_EDITABLE_STATUSES = ["pendente", "confirmado", "chegou", "em_atendimento", "recusado", "atendido", "remarcado"];

function appointmentStatusLabel(status) {
  return APPOINTMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label || status || "Sem status";
}

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
    ? <BookingAdmin initialTab={settingsTab} onBack={() => { setScreen("agenda"); onSettingsClosed?.(); }} />
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
  const firstItem = items[0] || {};
  const procedureValue = items.reduce((sum, item) => sum + asNumber(item.procedure_price), 0);
  const jewelryValue = items.reduce((sum, item) => sum + asNumber(item.jewelry_unit_price) * Math.max(1, asNumber(item.quantity, 1)), 0);
  const totalValue = procedureValue + jewelryValue;
  const firstService = asArray(services).find((item) => String(item.id) === String(firstItem.service_id));
  const depositValue = asNumber(draft.deposit_value || firstService?.deposit_value || 0);
  return calcRemaining({
    ...draft,
    service_id: firstItem.service_id || draft.service_id,
    jewelry_id: firstItem.jewelry_id || "",
    jewelry_variant_id: firstItem.jewelry_variant_id || "",
    procedure: firstService?.name || draft.procedure,
    piercing_region: firstItem.region || draft.piercing_region,
    appointment_items: items,
    total_value: totalValue,
    deposit_value: depositValue
  });
}

function appointmentValueParts(form, services = [], jewelryList = []) {
  const items = normalizeAppointmentFormItems(form, services, jewelryList);
  const procedureValue = items.reduce((sum, item) => sum + asNumber(item.procedure_price), 0);
  const jewelryValue = items.reduce((sum, item) => sum + asNumber(item.jewelry_unit_price) * Math.max(1, asNumber(item.quantity, 1)), 0);
  const totalValue = procedureValue + jewelryValue;
  const firstService = asArray(services).find((item) => String(item.id) === String(items[0]?.service_id));
  const depositValue = asNumber(form.deposit_value || firstService?.deposit_value || 0);
  return {
    procedureValue,
    jewelryValue,
    totalValue,
    depositValue,
    remainingValue: Math.max(totalValue - depositValue, 0)
  };
}

function emptyAppointmentItem(seed = {}) {
  return {
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

function rawAppointmentItems(form) {
  const items = asArray(form.appointment_items);
  if (items.length) return items;
  if (form.service_id || form.jewelry_id || form.piercing_region) return [emptyAppointmentItem(form)];
  return [emptyAppointmentItem()];
}

function normalizeAppointmentFormItems(form, services = [], jewelryList = []) {
  return rawAppointmentItems(form).map((raw) => {
    const service = asArray(services).find((item) => String(item.id) === String(raw.service_id || form.service_id));
    const jewelry = asArray(jewelryList).find((item) => String(item.id) === String(raw.jewelry_id));
    const variant = asArray(jewelry?.variants).find((item) => String(item.id) === String(raw.jewelry_variant_id));
    return {
      ...emptyAppointmentItem(raw),
      service_id: raw.service_id || form.service_id || "",
      region: raw.region || form.piercing_region || "",
      quantity: Math.max(1, asNumber(raw.quantity, 1)),
      procedure_price: asNumber(raw.procedure_price || service?.base_price || service?.price || 0),
      jewelry_unit_price: raw.jewelry_id ? asNumber(raw.jewelry_unit_price || variant?.sale_value || jewelry?.sale_value || 0) : 0,
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
        <strong>Procedimentos E Joias</strong>
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
        return (
          <div className={`appointment-item-row ${compact ? "compact" : ""}`} key={`${index}-${item.service_id}-${item.jewelry_id}`}>
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
            <Input type="number" label="Qtd." value={item.quantity} onChange={(value) => updateItem(index, { quantity: value })} />
            <Button variant="secondary" className="danger" onClick={() => removeItem(index)} disabled={items.length === 1}>Remover</Button>
            {ruleSummary.length > 0 && <span className="field-hint">Regras: {ruleSummary.join(" · ")}</span>}
            {selectedJewelry && <div className="appointment-jewelry-selected" data-product-id={selectedJewelry.id}>
              <strong>{selectedJewelry.name}</strong><span>ID {selectedJewelry.id}</span>
              <span>{selectedVariant ? `Variação: ${selectedVariant.variation_name || selectedVariant.sku}` : "Sem variação"}</span>
              <span>Qtd. {Math.max(1, asNumber(item.quantity, 1))}</span><span>Preço {currency.format(asNumber(item.jewelry_unit_price))}</span>
              <span>Estoque {selectedStock} un.</span><span>Subtotal {currency.format(asNumber(item.jewelry_unit_price) * Math.max(1, asNumber(item.quantity, 1)))}</span>
            </div>}
          </div>
        );
      })}
    </div>
  );
}

function AppointmentValueSummary({ form, services, jewelry }) {
  const values = appointmentValueParts(form, services, jewelry);
  const [quote, setQuote] = useState(null);
  const [couponError, setCouponError] = useState("");
  useEffect(() => {
    const code = String(form.coupon_code || "").trim();
    if (!code) { setQuote(null); setCouponError(""); return; }
    const timer = setTimeout(async () => {
      const items = normalizeAppointmentFormItems(form, services, jewelry).map((item) => ({
        product_id: item.jewelry_id || null,
        service_id: item.service_id || null,
        unit_price: asNumber(item.procedure_price) + asNumber(item.jewelry_unit_price),
        quantity: Math.max(1, asNumber(item.quantity, 1))
      }));
      const response = await apiFetch("/catalog/price-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coupon_code: code, items }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setQuote(null); setCouponError(payload.error || "Cupom inválido ou não aplicável."); return; }
      setQuote(payload); setCouponError("");
    }, 350);
    return () => clearTimeout(timer);
  }, [form.coupon_code, values.totalValue]);
  if (!form.service_id && !form.jewelry_id) return null;
  const finalTotal = quote?.valid ? asNumber(quote.final_amount) : values.totalValue;
  const discountAmount = asNumber(quote?.discount_amount || 0);
  const depositPaid = ["pago", "confirmado"].includes(String(form.deposit_status || "pendente").toLowerCase())
    ? values.depositValue
    : 0;
  const summary = {
    serviceSubtotal: values.procedureValue,
    productSubtotal: values.jewelryValue,
    grossTotal: values.totalValue,
    couponCode: String(form.coupon_code || "").trim() || null,
    discountTotal: discountAmount,
    netTotal: finalTotal,
    depositPaid,
    otherPayments: 0,
    totalPaid: depositPaid,
    outstandingBalance: Math.max(finalTotal - depositPaid, 0)
  };
  return (
    <div className="soft-card appointment-value-summary">
      <FinancialSummary summary={summary} />
      {quote?.discount_amount > 0 && <small className="form-success">Cupom aplicado com sucesso.</small>}
      {couponError && <small className="form-error">{couponError}</small>}
    </div>
  );
}

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
  const refresh = () => invalidate("/appointments", "/service-executions", "/clients", "/dashboard");
  const refreshClients = refresh;
  const safeOptions = asObject(options);
  const calendar = useMemo(() => ["lista", "realizados", "espera"].includes(filters.mode) ? null : buildCalendar(asArray(data), filters.mode, currentDate), [data, filters.mode, currentDate]);
  const operationalRows = asArray(data);
  const today = dateKey(new Date());
  const todayRows = operationalRows.filter((item) => String(item.appointment_date).slice(0, 10) === today);
  const completedWithTiming = operationalRows.filter((item) => item.arrived_at && item.started_at);
  const averageDelay = completedWithTiming.length
    ? Math.round(completedWithTiming.reduce((sum, item) => sum + Math.max(0, (new Date(item.started_at) - new Date(item.arrived_at)) / 60000), 0) / completedWithTiming.length)
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
    <section className="stack">
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
      <div className="metric-grid">
        <Metric label="Agenda de hoje" value={todayRows.length} />
        <Metric label="Aguardando início" value={todayRows.filter((item) => ["pendente", "confirmado", "chegou"].includes(item.status)).length} />
        <Metric label="Atraso médio" value={`${averageDelay} min`} />
        <Metric label="Cancelamentos/ausências" value={`${cancellationRate}%`} />
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
        <DailyAgenda day={calendar.days[0]} refresh={refresh} onSelect={setSelectedAppointment} onEmptySlot={setCreateSeed} />
      ) : (
        <GoogleLikeCalendar days={calendar.days} mode={filters.mode} refresh={refresh} onSelect={setSelectedAppointment} onEmptySlot={setCreateSeed} />
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

function ServiceExecutionDetail({ executionId, onClose }) {
  const { data } = useFetch(executionId ? `/service-executions/${executionId}` : null);
  const execution = asObject(data);
  const snapshot = asObject(execution.snapshot);
  const checklist = asArray(execution.checklist_snapshot);
  const biosafety = asObject(execution.biosafety_snapshot);
  return (
    <Modal open={Boolean(executionId)} title="Atendimento realizado" subtitle={executionId ? `Registro #${executionId}` : ""} size="lg" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      {!data ? <Loading /> : <div className="stack">
        <div className="summary-grid">
          <span>Cliente <strong>{snapshot.client_name || "—"}</strong></span>
          <span>Serviço <strong>{snapshot.procedure || "Atendimento"}</strong></span>
          <span>Data <strong>{formatDateWithYear(snapshot.appointment_date || execution.completed_at)}</strong></span>
          <span>Total <strong>{currency.format(execution.total_value || 0)}</strong></span>
        </div>
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

export function CalendarEvent({ item, refresh, onSelect }) {
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
          menuOnly
          actions={[
            { label: "Remarcar", onClick: () => updateAppointment(item.id, { status: "remarcado" }, refresh) },
            { label: "Cancelar com resolução", danger: true, onClick: () => onSelect?.(item) },
            { label: "Revisar e finalizar", onClick: () => onSelect?.(item) }
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
  const [activeStep, setActiveStep] = useState("schedule");
  const currentUser = readStoredSession()?.user || {};
  const draft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: currentUser.id || "user",
    formId: "appointment-new",
    schemaKey: "appointment-v1",
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

  async function submit(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch("/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...priceAppointmentDraft(form, safeServices, safeJewelry), appointment_items: normalizeAppointmentFormItems(form, safeServices, safeJewelry) })
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

  return (
    <Modal
      open={!!seed}
      title="Novo Agendamento"
      subtitle="Criação rápida pela agenda visual"
      size="lg"
      onClose={closeCreate}
      footer={(
        <>
          <Button variant="secondary" onClick={() => activeStep === "schedule" ? closeCreate() : setActiveStep("schedule")}>{activeStep === "schedule" ? "Cancelar" : "Voltar"}</Button>
          {activeStep === "operation" ? <Button type="submit" form="visual-appointment-form">Salvar agendamento</Button> : <Button onClick={() => setActiveStep("operation")}>Continuar</Button>}
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
          onStepChange={setActiveStep}
          canNavigateTo={undefined}
        />
        <ValidationSummary errors={error ? [error] : []} />
        {activeStep === "schedule" && <FormWorkflow.Page title="Cliente e horário">
        <FormSection title="Informações principais" badge="Obrigatório">
        <div className="form-grid">
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
          <StatusSelect value={form.status} options={APPOINTMENT_EDITABLE_STATUSES} onChange={(value) => setForm({ ...form, status: value })} />
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
        <AppointmentValueSummary form={form} services={safeServices} jewelry={safeJewelry} />
        <Textarea label="Observações" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
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
          ]}
        />
        </FormWorkflow.Page>}
      </FormWorkflow>
    </Modal>
  );
}

export function AppointmentQuickModal({ appointment, options, services, procedures, onClose, onSaved, features = [], onUpgrade }) {
  const [form, setForm] = useState({ appointment_date: "", appointment_time: "", status: "pendente", notes: "", reschedule_reason: "" });
  const [payments, setPayments] = useState([{ method: "Pix", amount: 0, status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" }]);
  const [financialNotes, setFinancialNotes] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [occurrences, setOccurrences] = useState("");
  const [aftercareNotes, setAftercareNotes] = useState("");
  const [operationalChecklist, setOperationalChecklist] = useState([]);
  const [biosafety, setBiosafety] = useState({ material_lots: [], sterilization_cycle: "", sterilization_record: "", applied_jewelry_id: "", applied_jewelry_variant_id: "", notes: "" });
  const [error, setError] = useState("");
  const [deletion, setDeletion] = useState(null);
  const [cancellation, setCancellation] = useState(null);
  const canGenerateReceivables = planAllowsAction(features, "appointments.generate_receivables");
  const currentUser = readStoredSession()?.user || {};
  const canCancel = can(currentUser, "appointments.cancel");
  const canResolveFinance = can(currentUser, "finance.edit");
  const hasPaidDeposit = Number(appointment?.deposit_value || 0) > 0 && ["pago", "confirmado"].includes(String(appointment?.deposit_status || "").toLowerCase());
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(asObject(options).serviceItems);
  const operationalRules = operationalRequirements(appointment?.operational_requirements_snapshot);
  const quickDraftValue = useMemo(() => ({ form, payments, financialNotes, clinicalNotes, occurrences, aftercareNotes, operationalChecklist, biosafety }), [aftercareNotes, biosafety, clinicalNotes, financialNotes, form, occurrences, operationalChecklist, payments]);
  const quickDraft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: currentUser.id || "user",
    formId: appointment?.id ? `appointment-${appointment.id}` : "appointment",
    schemaKey: "appointment-attendance-v1",
    value: quickDraftValue,
    enabled: Boolean(appointment),
    onRestore: (value) => {
      const restored = asObject(value);
      if (restored.form) setForm(restored.form);
      if (restored.payments) setPayments(asArray(restored.payments));
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
    const seededItems = asArray(appointment.appointment_items).length
      ? appointment.appointment_items
      : [emptyAppointmentItem({
          ...appointment,
          region: appointment.piercing_region,
          procedure_price: appointment.service_value,
          jewelry_unit_price: appointment.jewelry_value
        })];
    setForm(priceAppointmentDraft({
      appointment_date: appointment.appointment_date || "",
      appointment_time: appointment.appointment_time || "",
      status: appointment.status || "pendente",
      notes: appointment.notes || "",
      reschedule_reason: "",
      deposit_value: appointment.deposit_value || 0,
      deposit_status: appointment.deposit_status || "pendente",
      coupon_code: appointment.coupon_code || "",
      appointment_items: seededItems
    }, safeServices, safeJewelry));
    setPayments([{ method: appointment.remaining_payment_method || "Pix", amount: Math.max(0, Number(appointment.remaining_value || 0)), status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" }]);
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

  function updatePricedForm(nextForm) {
    setForm(priceAppointmentDraft(nextForm, safeServices, safeJewelry));
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
    const pricedForm = priceAppointmentDraft(form, safeServices, safeJewelry);
    const scheduleChanged = pricedForm.appointment_date !== appointment.appointment_date
      || pricedForm.appointment_time !== appointment.appointment_time;
    if (scheduleChanged && !String(pricedForm.reschedule_reason || "").trim()) {
      setError("Informe o motivo do reagendamento.");
      return;
    }
    const payload = {
      ...pricedForm,
      ...patch,
      reason: scheduleChanged ? pricedForm.reschedule_reason : patch.reason,
      appointment_items: normalizeAppointmentFormItems(pricedForm, safeServices, safeJewelry)
    };
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
    if (!canGenerateReceivables && payments.some((payment) => payment.status === "pendente")) {
      setError("Deixar saldo pendente e gerar contas a receber exige o plano Profissional.");
      return;
    }
    const pricedForm = priceAppointmentDraft(form, safeServices, safeJewelry);
    const updateResponse = await apiFetch(`/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...pricedForm,
        appointment_items: normalizeAppointmentFormItems(pricedForm, safeServices, safeJewelry)
      })
    });
    if (!updateResponse.ok) {
      const updateData = await updateResponse.json().catch(() => ({}));
      return setError(updateData.error || "Não foi possível salvar os itens do atendimento.");
    }
    const response = await apiFetch(`/appointments/${appointment.id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payments, financial_notes: financialNotes, clinical_notes: clinicalNotes, occurrences, aftercare_notes: aftercareNotes, checklist: operationalChecklist, biosafety }) });
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
    setPayments([{ method: "Crédito do cliente", amount: 0, status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" }]);
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

  return (
    <Modal
      open={!!appointment}
      title="Detalhes do Agendamento"
      subtitle={appointment ? `${personName(appointment)} · ${appointment.procedure || "Atendimento"}` : ""}
      size="lg"
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
          <div className="soft-card">
            <strong>{personName(appointment)}</strong>
            <p>{appointment.whatsapp || "WhatsApp não informado"}</p>
            <p>{appointment.service_name || appointment.procedure || "Procedimento não informado"} · {appointment.professional_name || "Sem profissional"}</p>
            {appointment.arrived_at && <p>Chegada registrada: {formatOperationalTime(appointment.arrived_at)}</p>}
            {appointment.started_at && <p>Atendimento iniciado: {formatOperationalTime(appointment.started_at)}</p>}
            {appointment.no_show_at && <p>Ausência registrada: {formatOperationalTime(appointment.no_show_at)}</p>}
          </div>
          <div className="form-grid">
            <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value })} />
            <Input type="time" label="Horário" value={form.appointment_time} onChange={(value) => setForm({ ...form, appointment_time: value })} />
            <StatusSelect value={form.status} options={["cancelado", "nao_compareceu"].includes(appointment.status) ? [...APPOINTMENT_EDITABLE_STATUSES, appointment.status] : APPOINTMENT_EDITABLE_STATUSES} onChange={(value) => setForm({ ...form, status: value })} />
          </div>
          {(form.appointment_date !== appointment.appointment_date || form.appointment_time !== appointment.appointment_time) && (
            <Textarea label="Motivo do reagendamento" value={form.reschedule_reason || ""} onChange={(reschedule_reason) => setForm({ ...form, reschedule_reason })} required />
          )}
          <AppointmentItemsEditor
            form={form}
            services={safeServices}
            procedures={safeProcedures}
            jewelry={safeJewelry}
            onChange={updatePricedForm}
            compact
          />
          <AppointmentValueSummary form={form} services={safeServices} jewelry={safeJewelry} />
          <Textarea label="Observação" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
          {form.status !== "atendido" && <section className="soft-card stack">
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
            <div className="section-inline-header"><strong>Conferência financeira</strong><Button variant="secondary" onClick={() => setPayments([...payments, { method: "Pix", amount: 0, status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" }])}>Dividir pagamento</Button></div>
            <ResponsiveEditableList
              items={payments}
              ariaLabel="Pagamentos do atendimento"
              getKey={(payment, index) => payment.row_key || `${payment.method}-${index}`}
              columns={[
                { key: "method", label: "Forma", render: (payment, index) => <PaymentSelect ariaLabel={`Forma ${index + 1}`} value={payment.method} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, method: value } : item))} /> },
                { key: "amount", label: "Valor", render: (payment, index) => <Input type="number" aria-label={`Valor ${index + 1}`} value={payment.amount} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, amount: Number(value || 0) } : item))} /> },
                { key: "status", label: "Status", render: (payment, index) => <Select ariaLabel={payments.length === 1 ? "Status" : `Status ${index + 1}`} value={payment.status} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, status: value } : item))}><option value="pago">Pago</option><option value="pendente" disabled={!canGenerateReceivables}>Pendente{canGenerateReceivables ? "" : " — Profissional"}</option></Select> },
                { key: "installments", label: "Parcelas", render: (payment, index) => String(payment.method).toLowerCase().includes("crédito") ? <Input type="number" aria-label={`Parcelas ${index + 1}`} value={payment.installments} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, installments: Number(value || 1) } : item))} /> : "—" },
                { key: "fee", label: "Taxa", render: (payment, index) => String(payment.method).toLowerCase().includes("crédito") ? <Input type="number" aria-label={`Taxa ${index + 1}`} value={payment.fee_amount} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, fee_amount: Number(value || 0) } : item))} /> : "—" },
                { key: "receipt", label: "Previsão", render: (payment, index) => String(payment.method).toLowerCase().includes("crédito") ? <Input type="date" aria-label={`Previsão ${index + 1}`} value={payment.expected_receipt_date} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, expected_receipt_date: value } : item))} /> : "—" },
              ]}
              onRemove={payments.length > 1 ? (_payment, index) => setPayments(payments.filter((_, itemIndex) => itemIndex !== index)) : null}
            />
            {!canGenerateReceivables && (
              <PlanUpgradeNotice title="Saldo pendente no plano Profissional" onUpgrade={onUpgrade}>
                No Start, o atendimento pode ser finalizado com pagamentos recebidos. Gerar saldo a receber exige o Financeiro básico.
              </PlanUpgradeNotice>
            )}
            <Textarea label="Observações financeiras" value={financialNotes} onChange={setFinancialNotes} />
            <small>Sinal preservado: {currency.format(Number(appointment.deposit_value || 0))} · saldo atual: {currency.format(Number(appointment.remaining_value || 0))}</small>
          </section>}
          <div className="toolbar compact-actions">
            <Button variant="secondary" onClick={() => saveAppointment({ status: "confirmado" })}>Confirmar</Button>
            {form.status === "confirmado" && <Button variant="secondary" onClick={() => saveAppointment({ status: "chegou" })}>Registrar chegada</Button>}
            {form.status === "chegou" && <Button variant="secondary" onClick={() => saveAppointment({ status: "em_atendimento" })}>Iniciar atendimento</Button>}
            <Button variant="secondary" onClick={() => saveAppointment({ status: "remarcado" })}>Reagendar</Button>
            {canCancel && <Button variant="secondary" className="danger" onClick={() => setCancellation({ resolution: hasPaidDeposit ? "retain_deposit" : "no_payment", refund_method: "Pix", reason: "" })}>Cancelar</Button>}
            {canCancel && !["atendido", "cancelado", "nao_compareceu"].includes(form.status) && <Button variant="secondary" onClick={() => setCancellation({ outcome: "no_show", resolution: hasPaidDeposit ? "retain_deposit" : "no_payment", refund_method: "Pix", reason: "" })}>Não compareceu</Button>}
            <Button onClick={completeAppointment}>Revisar e finalizar</Button>
          </div>
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

export function BookingAdmin({ onBack, initialTab }) {
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
  const [professionalError, setProfessionalError] = useState("");
  const [weeklyProfessionalId, setWeeklyProfessionalId] = useState("");
  const [weeklyDays, setWeeklyDays] = useState([]);
  const [readinessMessage, setReadinessMessage] = useState("");
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
    setProfessionalModalOpen(true);
  }

  function editProfessional(professional) {
    setEditingProfessionalId(professional.id);
    setProfessionalError("");
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
    await updateAppointment(id, { status }, refreshAppointments);
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
            </form>
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

export async function updateAppointment(id, body, refresh) {
  await apiFetch(`/appointments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  refresh?.();
}
