// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, ExternalLink, List, Plus, Settings2 } from "lucide-react";
import { Button, FinancialSummary, Input, PaymentSelect, Select, StatusBadge, StatusSelect } from "../../components/common/Ui";
import { Modal, CrudHeader, ConfirmDeleteModal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject, formatDate } from "../../lib/utils";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { buildCalendar, buildTimeSlots, dateKey, movePeriod } from "../../lib/calendarUtils";
import { defaultAppointment, defaultProcedureForm, defaultProfessionalForm, defaultScheduleBlock, defaultServiceForm } from "../../lib/defaultForms";
import { appointmentWhatsAppMessage, calcRemaining, currency, personName, statusClass, statuses, weekdayLabel, whatsappUrl } from "../../features/shared/helpers";
import { Toggle } from "../../pages/CatalogCustomization";
import { SmartCombobox } from "../../components/common/SmartCombobox";
import { publicLinkForTenant } from "../../lib/publicRoutes";

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

// Status canônicos de agendamento, com o rótulo que aparece na tela.
const APPOINTMENT_STATUS_OPTIONS = [
  { value: "pendente", label: "Pendente" },
  { value: "awaiting_deposit_proof", label: "Aguardando sinal" },
  { value: "confirmado", label: "Confirmado" },
  { value: "atendido", label: "Atendido" },
  { value: "cancelado", label: "Cancelado" },
  { value: "recusado", label: "Recusado" }
];

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

export function AgendaWorkspace({ initialScreen = "agenda", initialSettingsTab, onSettingsClosed }) {
  const [screen, setScreen] = useState(initialScreen);
  return screen === "settings"
    ? <BookingAdmin initialTab={initialSettingsTab} onBack={() => { setScreen("agenda"); onSettingsClosed?.(); }} />
    : <VisualCalendar onOpenSettings={() => setScreen("settings")} />;
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

export function Appointments() {
  const { data: options } = useFetch("/options");
  const { data: clients } = useFetch("/clients");
  const { data: appointments } = useFetch("/appointments");
  const { data: services } = useFetch("/services");
  const { data: procedures } = useFetch("/procedures");
  // Um agendamento pode criar cliente novo, ocupar horário e mexer nos números
  // do painel — as três rotas caem juntas.
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/appointments", "/clients", "/dashboard");
  const refreshClients = refresh;
  const [form, setForm] = useState(defaultAppointment());
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const safeOptions = asObject(options);
  const safeClients = asArray(clients);
  const safeAppointments = asArray(appointments);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(safeOptions.jewelry);
  const safeProfessionals = asArray(safeOptions.professionals);

  function updatePricedForm(nextForm) {
    setForm(priceAppointmentDraft(nextForm, safeServices, safeJewelry));
  }

  useEffect(() => {
    async function loadSlots() {
      if (!form.service_id || !form.professional_id || !form.appointment_date) return setSlots([]);
      setLoadingSlots(true);
      const response = await apiFetch(`/booking/slots?service_id=${form.service_id}&professional_id=${form.professional_id}&date=${form.appointment_date}`);
      const json = await response.json().catch(() => ({}));
      setLoadingSlots(false);
      setSlots(response.ok ? asArray(json.slots) : []);
      if (!response.ok) setError(json.error || "Não foi possível carregar os horários.");
    }
    loadSlots();
  }, [form.service_id, form.professional_id, form.appointment_date]);

  function selectClient(clientId) {
    if (!clientId) {
      setForm({ ...form, client_id: "", full_name: "", whatsapp: "", instagram: "", birth_date: "" });
      return;
    }
    const client = safeClients.find((item) => String(item.id) === String(clientId));
    if (!client) return;
    setForm({
      ...form,
      client_id: client.id,
      full_name: personName(client),
      whatsapp: client.whatsapp || "",
      instagram: client.instagram || "",
      birth_date: client.birth_date || ""
    });
  }

  function openNew() {
    setForm(defaultAppointment());
    setSlots([]);
    setError("");
    setModalOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === "appointment_items") {
        body.append(key, JSON.stringify(normalizeAppointmentFormItems(form, safeServices, safeJewelry)));
        return;
      }
      if (value !== "" && value !== null && value !== undefined) body.append(key, value);
    });
    const response = await apiFetch(`/appointments`, {
      method: "POST",
      body
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || "Não foi possível salvar o agendamento.");
      return;
    }
    setForm(defaultAppointment());
    setModalOpen(false);
    refresh();
    refreshClients();
  }

  return (
    <section className="stack appointments-admin">
      <div className="panel appointments-toolbar">
        <CrudHeader
          title="Agendamentos"
          subtitle="Cadastre e acompanhe os próximos atendimentos."
          actionLabel="Novo agendamento"
          onAction={openNew}
        />
      </div>
      <Modal
        open={modalOpen}
        title="Novo Agendamento"
        subtitle="Profissional, serviço, cliente, data e horário."
        size="lg"
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" form="appointment-form" className="primary-button" disabled={!form.appointment_time}>Salvar agendamento</button>
          </>
        )}
      >
      <form id="appointment-form" onSubmit={submit}>
        <div className="form-section">
          <h3>Cliente</h3>
          <div className="form-grid">
            <Select label="Cliente cadastrado" value={form.client_id} onChange={selectClient}>
              <option value="">Novo cliente</option>
              {safeClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {personName(client)} - {client.whatsapp}
                </option>
              ))}
            </Select>
            <Input label="Nome completo" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} required />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} required />
            <Input label="Instagram" value={form.instagram} onChange={(v) => setForm({ ...form, instagram: v })} />
            <Input type="date" label="Aniversário" value={form.birth_date} onChange={(v) => setForm({ ...form, birth_date: v })} />
          </div>
        </div>
        <div className="form-section">
          <h3>Procedimento</h3>
          <AppointmentItemsEditor
            form={form}
            services={safeServices}
            procedures={safeProcedures}
            jewelry={safeJewelry}
            onChange={updatePricedForm}
          />
          <div className="form-grid">
            <Select label="Profissional" value={form.professional_id} onChange={(v) => setForm({ ...form, professional_id: v })} required>
              <option value="">Selecione</option>
              {safeProfessionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Input type="date" label="Data" value={form.appointment_date} onChange={(v) => setForm({ ...form, appointment_date: v, appointment_time: "" })} required />
          </div>
          <AppointmentValueSummary form={form} services={safeServices} jewelry={safeJewelry} />
          <div className="manual-slot-field">
            <span>Horários Disponíveis</span>
            <div className="manual-slot-grid">
              {loadingSlots && <small>Carregando horários...</small>}
              {asArray(slots).map((slot) => <button key={slot.time} type="button" className={form.appointment_time === slot.time ? "active" : ""} onClick={() => setForm({ ...form, appointment_time: slot.time })}>{slot.time}</button>)}
              {!loadingSlots && form.appointment_date && form.service_id && form.professional_id && !asArray(slots).length && <small>Nenhum horário livre neste dia.</small>}
            </div>
          </div>
          <label>Descrição do atendimento
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
        </div>
        <div className="form-section">
          <h3>Financeiro</h3>
          <div className="form-grid">
            <Input type="number" label="Valor total" value={form.total_value} onChange={(v) => setForm(calcRemaining({ ...form, total_value: v }))} />
            <Input type="number" label="Valor do sinal" value={form.deposit_value} onChange={(v) => setForm(calcRemaining({ ...form, deposit_value: v }))} />
            <Input type="number" label="Valor restante" value={form.remaining_value} onChange={(v) => setForm({ ...form, remaining_value: v })} />
            <Input label="Cupom" value={form.coupon_code || ""} onChange={(v) => setForm({ ...form, coupon_code: v.toUpperCase() })} />
            <PaymentSelect label="Forma de pagamento do sinal" value={form.deposit_payment_method} onChange={(v) => setForm({ ...form, deposit_payment_method: v })} />
            <Select label="Status do sinal" value={form.deposit_status || "pendente"} onChange={(v) => setForm({ ...form, deposit_status: v })}><option value="pendente">Pendente</option><option value="pago">Pago</option><option value="nao_aplicavel">Não aplicável</option></Select>
            <Input type="date" label="Data do sinal" value={form.deposit_paid_at || ""} onChange={(v) => setForm({ ...form, deposit_paid_at: v })} />
            <PaymentSelect label="Forma de pagamento restante" value={form.remaining_payment_method} onChange={(v) => setForm({ ...form, remaining_payment_method: v })} />
            <StatusSelect value={form.status} onChange={(v) => setForm({ ...form, status: v })} />
          </div>
          <label>Observações financeiras<textarea value={form.financial_notes || ""} onChange={(e) => setForm({ ...form, financial_notes: e.target.value })} /></label>
          <label>Observações importantes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <label>Foto de referência
            <input type="file" accept="image/*" onChange={(event) => setForm({ ...form, reference_photo: event.target.files?.[0] || null })} />
            <small>Opcional. Use uma foto nítida da referência enviada pela cliente.</small>
          </label>
        </div>
        {error && <span className="form-error">{error}</span>}
      </form>
      </Modal>
      <div className="panel">
        <div className="panel-heading">
          <h2>Próximos Atendimentos</h2>
          <span>Com Ações Rápidas</span>
        </div>
        <AppointmentList appointments={safeAppointments} onChanged={refresh} />
      </div>
    </section>
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
        <button type="button" className="secondary-button" onClick={() => onChange(withAppointmentItems(form, [...items, emptyAppointmentItem()], services, jewelry))}>Adicionar item</button>
      </div>
      {items.map((item, index) => {
        const selectedJewelry = asArray(jewelry).find((product) => String(product.id) === String(item.jewelry_id));
        const selectedVariant = asArray(selectedJewelry?.variants).find((variant) => String(variant.id) === String(item.jewelry_variant_id));
        const selectedStock = selectedVariant ? asNumber(selectedVariant.quantity) : asNumber(selectedJewelry?.inventory_quantity ?? selectedJewelry?.quantity);
        const selectedService = asArray(services).find((service) => String(service.id) === String(item.service_id));
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
            <button type="button" className="secondary-button danger" onClick={() => removeItem(index)} disabled={items.length === 1}>Remover</button>
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

export function VisualCalendar({ onOpenSettings }) {
  const { data: options } = useFetch("/options");
  const { data: clients } = useFetch("/clients");
  const { data: services } = useFetch("/services");
  const { data: procedures } = useFetch("/procedures");
  const [filters, setFilters] = useState({ mode: "mensal", professional_id: "", status: "" });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [createSeed, setCreateSeed] = useState(null);
  const { data } = useFetch(`/appointments?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v && !["mensal", "semanal", "diario", "lista"].includes(v))))}`);
  // Invalidar "/appointments" alcança o calendário sob qualquer combinação de
  // filtros, não só a consulta que está montada agora.
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/appointments", "/clients", "/dashboard");
  const refreshClients = refresh;
  const safeOptions = asObject(options);
  const calendar = useMemo(() => filters.mode === "lista" ? null : buildCalendar(asArray(data), filters.mode, currentDate), [data, filters.mode, currentDate]);

  return (
    <section className="stack">
      <div className="panel agenda-page-heading">
        <div>
          <span className="eyebrow">Gestão de agenda</span>
          <h2>Agenda</h2>
        </div>
        <div className="agenda-page-actions">
          <PublicBookingLink />
          <Button variant="secondary" onClick={onOpenSettings}><Settings2 size={16} /> Configurações</Button>
          <Button onClick={() => setCreateSeed({})}><Plus size={16} /> Novo agendamento</Button>
        </div>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {[["mensal", "Mensal"], ["semanal", "Semanal"], ["diario", "Diário"], ["lista", "Lista"]].map(([mode, label]) => <button key={mode} className={filters.mode === mode ? "active" : ""} onClick={() => setFilters({ ...filters, mode })}>{mode === "lista" && <List size={15} />}{label}</button>)}
        </div>
        <Select label="Profissional" value={filters.professional_id} onChange={(v) => setFilters({ ...filters, professional_id: v })}>
          <option value="">Todos</option>
          {asArray(safeOptions.professionals).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
          <option value="">Todos</option>
          {statuses().map((status) => <option key={status}>{status}</option>)}
        </Select>
        {calendar && <div className="calendar-nav">
          <button aria-label="Período anterior" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, -1))}><ChevronLeft size={18} /></button>
          <strong>{calendar.title}</strong>
          <button aria-label="Próximo período" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, 1))}><ChevronRight size={18} /></button>
          <button onClick={() => setCurrentDate(new Date())}>Hoje</button>
        </div>}
      </div>
      {filters.mode === "lista" ? (
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
        onClose={() => setSelectedAppointment(null)}
        onSaved={() => {
          setSelectedAppointment(null);
          refresh();
        }}
      />
    </section>
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
        <button onClick={() => updateAppointment(item.id, { status: "remarcado" }, refresh)}>Remarcar</button>
        <button onClick={() => updateAppointment(item.id, { status: "cancelado" }, refresh)}>Cancelar</button>
        <button onClick={() => onSelect?.(item)}>Revisar e finalizar</button>
      </div>
    </div>
  );
}

export function AppointmentCreateModal({ seed, options, clients, services, procedures, onClose, onSaved }) {
  const safeOptions = asObject(options);
  const safeClients = asArray(clients);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(safeOptions.jewelry);
  const safeProfessionals = asArray(safeOptions.professionals);
  const [form, setForm] = useState(defaultAppointment());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!seed) return;
    setForm({
      ...defaultAppointment(),
      appointment_date: seed.appointment_date || defaultAppointment().appointment_date,
      appointment_time: seed.appointment_time || "",
      status: "pendente"
    });
    setError("");
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
      setError(data.error || "Não foi possível criar o agendamento.");
      return;
    }
    onSaved?.();
  }

  return (
    <Modal
      open={!!seed}
      title="Novo Agendamento"
      subtitle="Criação rápida pela agenda visual"
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="visual-appointment-form" className="primary-button">Salvar agendamento</button>
        </>
      )}
    >
      <form id="visual-appointment-form" className="stack" onSubmit={submit}>
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
          <StatusSelect value={form.status} onChange={(value) => setForm({ ...form, status: value })} />
        </div>
        <AppointmentItemsEditor
          form={form}
          services={safeServices}
          procedures={safeProcedures}
          jewelry={safeJewelry}
          onChange={updatePricedForm}
          compact
        />
        <AppointmentValueSummary form={form} services={safeServices} jewelry={safeJewelry} />
        <label>Observações
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        {error && <span className="form-error">{error}</span>}
      </form>
    </Modal>
  );
}

export function AppointmentQuickModal({ appointment, options, services, procedures, onClose, onSaved }) {
  const [form, setForm] = useState({ appointment_date: "", appointment_time: "", status: "pendente", notes: "" });
  const [payments, setPayments] = useState([{ method: "Pix", amount: 0, status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" }]);
  const [financialNotes, setFinancialNotes] = useState("");
  const [error, setError] = useState("");
  const [deletion, setDeletion] = useState(null);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeJewelry = asArray(asObject(options).jewelry);

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
      deposit_value: appointment.deposit_value || 0,
      deposit_status: appointment.deposit_status || "pendente",
      coupon_code: appointment.coupon_code || "",
      appointment_items: seededItems
    }, safeServices, safeJewelry));
    setPayments([{ method: appointment.remaining_payment_method || "Pix", amount: Math.max(0, Number(appointment.remaining_value || 0)), status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" }]);
    setFinancialNotes(appointment.financial_notes || "");
    setError("");
    setDeletion(null);
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
    const payload = {
      ...pricedForm,
      ...patch,
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
    onSaved?.();
  }

  async function completeAppointment() {
    setError("");
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
    const response = await apiFetch(`/appointments/${appointment.id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payments, financial_notes: financialNotes }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setError(data.error || "Não foi possível concluir o atendimento.");
    onSaved?.();
  }

  return (
    <Modal
      open={!!appointment}
      title="Detalhes do Agendamento"
      subtitle={appointment ? `${personName(appointment)} · ${appointment.procedure || "Atendimento"}` : ""}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
          <button type="button" className="primary-button" onClick={() => saveAppointment()}>Salvar alterações</button>
        </>
      )}
    >
      {appointment && (
        <div className="stack">
          <div className="soft-card">
            <strong>{personName(appointment)}</strong>
            <p>{appointment.whatsapp || "WhatsApp não informado"}</p>
            <p>{appointment.service_name || appointment.procedure || "Procedimento não informado"} · {appointment.professional_name || "Sem profissional"}</p>
          </div>
          <div className="form-grid">
            <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value })} />
            <Input type="time" label="Horário" value={form.appointment_time} onChange={(value) => setForm({ ...form, appointment_time: value })} />
            <StatusSelect value={form.status} onChange={(value) => setForm({ ...form, status: value })} />
          </div>
          <AppointmentItemsEditor
            form={form}
            services={safeServices}
            procedures={safeProcedures}
            jewelry={safeJewelry}
            onChange={updatePricedForm}
            compact
          />
          <AppointmentValueSummary form={form} services={safeServices} jewelry={safeJewelry} />
          <label>Observação
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          {form.status !== "atendido" && <section className="soft-card stack">
            <div className="section-inline-header"><strong>Conferência financeira</strong><button type="button" className="secondary-button" onClick={() => setPayments([...payments, { method: "Pix", amount: 0, status: "pago", installments: 1, fee_amount: 0, expected_receipt_date: "" }])}>Dividir pagamento</button></div>
            {payments.map((payment, index) => <div className="form-grid" key={`${index}-${payment.method}`}>
              <PaymentSelect label={`Forma ${index + 1}`} value={payment.method} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, method: value } : item))} />
              <Input type="number" label="Valor" value={payment.amount} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, amount: value } : item))} />
              <Select label="Status" value={payment.status} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, status: value } : item))}><option value="pago">Pago</option><option value="pendente">Pendente</option></Select>
              {String(payment.method).toLowerCase().includes("crédito") && <><Input type="number" label="Parcelas" value={payment.installments} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, installments: value } : item))} /><Input type="number" label="Taxa" value={payment.fee_amount} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, fee_amount: value } : item))} /><Input type="date" label="Previsão de recebimento" value={payment.expected_receipt_date} onChange={(value) => setPayments(payments.map((item, itemIndex) => itemIndex === index ? { ...item, expected_receipt_date: value } : item))} /></>}
              {payments.length > 1 && <button type="button" className="secondary-button danger" onClick={() => setPayments(payments.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>}
            </div>)}
            <label>Observações financeiras<textarea value={financialNotes} onChange={(event) => setFinancialNotes(event.target.value)} /></label>
            <small>Sinal preservado: {currency.format(Number(appointment.deposit_value || 0))} · saldo atual: {currency.format(Number(appointment.remaining_value || 0))}</small>
          </section>}
          <div className="toolbar compact-actions">
            <button type="button" className="secondary-button" onClick={() => saveAppointment({ status: "confirmado" })}>Confirmar</button>
            <button type="button" className="secondary-button" onClick={() => saveAppointment({ status: "remarcado" })}>Reagendar</button>
            <button type="button" className="secondary-button danger" onClick={() => saveAppointment({ status: "cancelado" })}>Cancelar</button>
            <button type="button" className="primary-button" onClick={completeAppointment}>Revisar e finalizar</button>
          </div>
          {readStoredSession()?.user?.role === "admin" && <button type="button" className="secondary-button danger" onClick={openDeletion}>Excluir definitivamente</button>}
          {error && <span className="form-error">{error}</span>}
          <Modal open={!!deletion} title="Excluir definitivamente" subtitle="Esta ação exige análise e confirmação" onClose={() => !deletion?.busy && setDeletion(null)} footer={<><button type="button" className="secondary-button" onClick={() => setDeletion(null)}>Voltar</button><button type="button" className="primary-button danger" disabled={!deletion?.canDelete || deletion?.busy || deletion?.confirmation !== "EXCLUIR AGENDAMENTO" || !deletion?.reason?.trim()} onClick={deleteAppointment}>{deletion?.busy ? "Excluindo…" : "Excluir agendamento"}</button></>}>
            {deletion && <div className="stack"><div className="soft-card"><strong>{deletion.canDelete ? "Agendamento de teste sem vínculos" : "Exclusão bloqueada"}</strong><p>{deletion.canDelete ? "A exclusão é irreversível e ficará registrada na auditoria." : "Existem vínculos financeiros, clínicos ou de estoque. Cancele o agendamento para preservar o histórico."}</p></div><div className="summary-grid">{Object.entries(deletion.impact).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")}: <strong>{value}</strong></span>)}</div><Input label="Motivo obrigatório" value={deletion.reason} onChange={(reason) => setDeletion({ ...deletion, reason })} /><Input label="Digite EXCLUIR AGENDAMENTO" value={deletion.confirmation} onChange={(confirmation) => setDeletion({ ...deletion, confirmation })} /></div>}
          </Modal>
        </div>
      )}
    </Modal>
  );
}

export function BookingAdmin({ onBack, initialTab }) {
  const { data: services } = useFetch("/services");
  const { data: procedures } = useFetch("/procedures");
  const { data: professionalsData } = useFetch("/professionals");
  const { data: options } = useFetch("/options");
  const { data: availability } = useFetch("/availability");
  const { data: blocks } = useFetch("/schedule-blocks");
  const { data: appointments } = useFetch("/appointments?status=pendente");
  // Serviço, procedimento e profissional alimentam também "/options" (usado nos
  // formulários da agenda: salvar num lugar atualiza as dependências do outro.
  const invalidate = useApiInvalidate();
  const refreshServices = () => invalidate("/services", "/options");
  const refreshProcedures = () => invalidate("/procedures", "/options");
  const refreshProfessionals = () => invalidate("/professionals", "/options");
  const refreshAvailability = () => invalidate("/availability");
  const refreshBlocks = () => invalidate("/schedule-blocks", "/availability");
  const refreshAppointments = () => invalidate("/appointments", "/dashboard");
  const [tab, setTab] = useState(initialTab || "servicos");
  const [serviceForm, setServiceForm] = useState(defaultServiceForm());
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [procedureForm, setProcedureForm] = useState(defaultProcedureForm());
  const [editingProcedureId, setEditingProcedureId] = useState(null);
  const [procedureModalOpen, setProcedureModalOpen] = useState(false);
  const [professionalForm, setProfessionalForm] = useState(defaultProfessionalForm());
  const [editingProfessionalId, setEditingProfessionalId] = useState(null);
  const [professionalModalOpen, setProfessionalModalOpen] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [procedureError, setProcedureError] = useState("");
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
  const safeProcedures = asArray(procedures);
  const safeAvailability = asArray(availability);
  const safeBlocks = asArray(blocks);
  const safeAppointments = asArray(appointments);

  const activeServices = safeServices.filter((service) => Boolean(Number(service.is_active ?? service.active_online_booking)));
  const activeProcedures = safeProcedures.filter((procedure) => Boolean(Number(procedure.is_active)));
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

  if (services == null || procedures == null || professionalsData == null || availability == null || blocks == null || appointments == null) return <Loading />;

  function validateServiceForm() {
    if (!serviceForm.name.trim()) return "Informe o nome do serviço.";
    if (Number(serviceForm.base_price || 0) < 0) return "Preço não pode ser negativo.";
    if (Number(serviceForm.duration_minutes || 0) <= 0) return "Duração deve ser um número positivo.";
    return "";
  }

  function validateProcedureForm() {
    if (!procedureForm.name.trim()) return "Informe o nome do procedimento.";
    if (!procedureForm.service_id) return "Procedimento precisa ter um serviço vinculado.";
    if (Number(procedureForm.price || 0) < 0) return "Preço não pode ser negativo.";
    if (Number(procedureForm.duration_minutes || 0) <= 0) return "Duração deve ser um número positivo.";
    return "";
  }

  function openNewService() {
    setEditingServiceId(null);
    setServiceForm(defaultServiceForm());
    setServiceError("");
    setServiceModalOpen(true);
  }

  async function saveService(event) {
    event.preventDefault();
    setServiceError("");
    const error = validateServiceForm();
    if (error) return setServiceError(error);
    const response = await apiFetch(editingServiceId ? `/services/${editingServiceId}` : "/services", {
      method: editingServiceId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serviceForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setServiceError(payload.error || "Não foi possível salvar o serviço.");
    }
    setServiceForm(defaultServiceForm());
    setEditingServiceId(null);
    setServiceModalOpen(false);
    refreshServices();
  }

  function editService(service) {
    setEditingServiceId(service.id);
    setServiceError("");
    setServiceForm({
      name: service.name || "",
      description: service.description || "",
      base_price: service.base_price || 0,
      deposit_value: Number(service.deposit_value || 25),
      duration_minutes: service.duration_minutes || 40,
      is_active: Boolean(service.is_active)
    });
    setServiceModalOpen(true);
  }

  function removeService(service) {
    setDeleting({
      message: `Excluir ${service.name}?`,
      run: async () => {
        const response = await apiFetch(`/services/${service.id}`, { method: "DELETE" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          return setServiceError(payload.error || "Não foi possível excluir o serviço.");
        }
        if (editingServiceId === service.id) {
          setEditingServiceId(null);
          setServiceForm(defaultServiceForm());
        }
        refreshServices();
        refreshProcedures();
      }
    });
  }

  function openNewProcedure() {
    setEditingProcedureId(null);
    setProcedureForm(defaultProcedureForm());
    setProcedureError("");
    setProcedureModalOpen(true);
  }

  async function saveProcedure(event) {
    event.preventDefault();
    setProcedureError("");
    const error = validateProcedureForm();
    if (error) return setProcedureError(error);
    const response = await apiFetch(editingProcedureId ? `/procedures/${editingProcedureId}` : "/procedures", {
      method: editingProcedureId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(procedureForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setProcedureError(payload.error || "Não foi possível salvar o procedimento.");
    }
    setProcedureForm(defaultProcedureForm());
    setEditingProcedureId(null);
    setProcedureModalOpen(false);
    refreshProcedures();
  }

  function editProcedure(procedure) {
    setEditingProcedureId(procedure.id);
    setProcedureError("");
    setProcedureForm({
      service_id: procedure.service_id || "",
      name: procedure.name || "",
      body_area: procedure.body_area || "",
      description: procedure.description || "",
      price: procedure.price || 0,
      duration_minutes: procedure.duration_minutes || 40,
      aftercare_instructions: procedure.aftercare_instructions || "",
      is_active: Boolean(procedure.is_active)
    });
    setProcedureModalOpen(true);
  }

  function removeProcedure(procedure) {
    setDeleting({
      message: `Excluir ${procedure.name}?`,
      run: async () => {
        const response = await apiFetch(`/procedures/${procedure.id}`, { method: "DELETE" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          return setProcedureError(payload.error || "Não foi possível excluir o procedimento.");
        }
        if (editingProcedureId === procedure.id) {
          setEditingProcedureId(null);
          setProcedureForm(defaultProcedureForm());
        }
        refreshProcedures();
      }
    });
  }

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

  async function updateAvailability(item, patch) {
    await apiFetch(`/availability/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, ...patch })
    });
    refreshAvailability();
  }

  async function createDefaultAvailability(professionalId) {
    if (!professionalId) return;
    await apiFetch("/availability/generate-weekly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        professional_id: professionalId,
        is_active: true,
        start_time: "09:00",
        end_time: "18:00",
        lunch_start: "12:00",
        lunch_end: "13:00",
        duration_minutes: 40,
        buffer_minutes: 10,
        weekdays: [1, 2, 3, 4, 5, 6]
      })
    });
    setWeeklyProfessionalId(String(professionalId));
    refreshAvailability();
  }

  async function saveWeeklyAvailability(event) {
    event.preventDefault();
    setReadinessMessage("");
    if (!activeProfessionals.length) return setReadinessMessage("Cadastre e ative pelo menos um profissional antes de configurar a agenda semanal.");
    if (!activeServices.length) return setReadinessMessage("Cadastre e ative pelo menos um serviço antes de configurar a agenda semanal.");
    if (!activeProcedures.length) return setReadinessMessage("Cadastre e ative pelo menos um procedimento vinculado ao serviço.");
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
      <nav className="customization-tabs">
        {[
          ["profissionais", "Profissionais"],
          ["servicos", "Serviços"],
          ["horarios", "Agenda semanal"],
          ["bloqueios", "Disponibilidade avançada"],
          ["solicitacoes", "Solicitações pendentes"]
        ].map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

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
                <button type="button" className="secondary-button" onClick={() => setProfessionalModalOpen(false)}>Cancelar</button>
                <button type="submit" form="professional-form" className="primary-button">Salvar profissional</button>
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
              <Toggle label="Profissional ativo" checked={professionalForm.active} onChange={(value) => setProfessionalForm({ ...professionalForm, active: value })} />
              <Toggle label="Receber notificações automáticas" checked={professionalForm.notification_opt_in} onChange={(value) => setProfessionalForm({ ...professionalForm, notification_opt_in: value })} />
              <div className="form-section">
                <h3>Serviços que realiza</h3>
                <div className="toggle-grid">
                  {safeServices.map((service) => (
                    <Toggle
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

      {tab === "servicos" && (
        <div className="stack">
          <div className="panel">
            <CrudHeader
              title="Serviços cadastrados"
              subtitle="Cadastro real no PostgreSQL"
              actionLabel="Novo serviço"
              onAction={openNewService}
            />
            <DataView
              rows={safeServices}
              defaultSort={{ key: "name", dir: "asc" }}
              searchPlaceholder="Buscar por nome do serviço"
              filters={[
                {
                  key: "status",
                  label: "Agendamento online",
                  type: "select",
                  options: [{ value: "ativo", label: "Ativo" }, { value: "inativo", label: "Inativo" }],
                  match: (service, value) => (service.is_active ? "ativo" : "inativo") === value
                }
              ]}
              columns={[
                { key: "name", label: "Nome" },
                { key: "duration_minutes", label: "Duração", value: (service) => asNumber(service.duration_minutes), render: (service) => `${service.duration_minutes} min` },
                { key: "base_price", label: "Preço base", value: (service) => asNumber(service.base_price), render: (service) => currency.format(service.base_price || 0) },
                { key: "is_active", label: "Status", value: (service) => service.is_active ? "Ativo" : "Inativo", render: (service) => <StatusBadge status={service.is_active ? "Ativo" : "Inativo"} /> },
              ]}
              actions={(service) => <RowActions actions={[
                { label: "Editar", onClick: () => editService(service), primary: true },
                { label: "Excluir", onClick: () => removeService(service), danger: true },
              ]} />}
              empty="Você ainda não possui serviços cadastrados."
              emptyFiltered="Nenhum serviço corresponde aos filtros aplicados."
            />
          </div>

          <div className="panel">
            <CrudHeader
              title="Procedimentos cadastrados"
              subtitle="Vincule a um serviço"
              actionLabel="Novo procedimento"
              onAction={openNewProcedure}
            />
            <DataView
              rows={safeProcedures}
              defaultSort={{ key: "name", dir: "asc" }}
              searchPlaceholder="Buscar por nome, serviço ou área do corpo"
              filters={[
                {
                  key: "service_id",
                  label: "Serviço vinculado",
                  type: "select",
                  options: safeServices.map((service) => ({ value: String(service.id), label: service.name })),
                  match: (procedure, value) => String(procedure.service_id) === value
                },
                {
                  key: "body_area",
                  label: "Área do corpo",
                  type: "select",
                  options: distinctOptions(safeProcedures.map((procedure) => procedure.body_area)),
                  match: (procedure, value) => procedure.body_area === value
                },
                {
                  key: "status",
                  label: "Status",
                  type: "select",
                  options: [{ value: "ativo", label: "Ativo" }, { value: "inativo", label: "Inativo" }],
                  match: (procedure, value) => (procedure.is_active ? "ativo" : "inativo") === value
                }
              ]}
              columns={[
                { key: "name", label: "Nome" },
                { key: "service_name", label: "Serviço", value: (procedure) => procedure.service_name || "Sem serviço", render: (procedure) => procedure.service_name || "Sem serviço" },
                { key: "body_area", label: "Área do corpo", value: (procedure) => procedure.body_area || "Sem área", render: (procedure) => procedure.body_area || "Sem área" },
                { key: "duration_minutes", label: "Duração", value: (procedure) => asNumber(procedure.duration_minutes), render: (procedure) => `${procedure.duration_minutes} min` },
                { key: "price", label: "Preço", value: (procedure) => asNumber(procedure.price), render: (procedure) => currency.format(procedure.price || 0) },
                { key: "is_active", label: "Status", value: (procedure) => procedure.is_active ? "Ativo" : "Inativo", render: (procedure) => <StatusBadge status={procedure.is_active ? "Ativo" : "Inativo"} /> },
              ]}
              actions={(procedure) => <RowActions actions={[
                { label: "Editar", onClick: () => editProcedure(procedure), primary: true },
                { label: "Excluir", onClick: () => removeProcedure(procedure), danger: true },
              ]} />}
              empty="Você ainda não possui procedimentos cadastrados."
              emptyFiltered="Nenhum procedimento corresponde aos filtros aplicados."
            />
          </div>

          <Modal
            open={serviceModalOpen}
            title={editingServiceId ? "Editar serviço" : "Novo serviço"}
            subtitle="Cadastro real no PostgreSQL"
            onClose={() => setServiceModalOpen(false)}
            footer={(
              <>
                <button type="button" className="secondary-button" onClick={() => setServiceModalOpen(false)}>Cancelar</button>
                <button type="submit" form="service-form" className="primary-button">{editingServiceId ? "Salvar alterações" : "Salvar serviço"}</button>
              </>
            )}
          >
            <form id="service-form" onSubmit={saveService}>
              <div className="form-grid">
                <Input label="Nome" value={serviceForm.name} onChange={(value) => setServiceForm({ ...serviceForm, name: value })} required />
                <Input type="number" label="Duração em minutos" value={serviceForm.duration_minutes} onChange={(value) => setServiceForm({ ...serviceForm, duration_minutes: value })} />
                <Input type="number" label="Preço base" value={serviceForm.base_price} onChange={(value) => setServiceForm({ ...serviceForm, base_price: value })} />
                <Input type="number" label="Sinal obrigatório" value={serviceForm.deposit_value} onChange={(value) => setServiceForm({ ...serviceForm, deposit_value: value })} />
              </div>
              <label>Descrição<textarea value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} /></label>
              <Toggle label="Serviço ativo" checked={serviceForm.is_active} onChange={(value) => setServiceForm({ ...serviceForm, is_active: value })} />
              {serviceError && <span className="form-error">{serviceError}</span>}
            </form>
          </Modal>

          <Modal
            open={procedureModalOpen}
            title={editingProcedureId ? "Editar procedimento" : "Novo procedimento"}
            subtitle="Vincule a um serviço"
            onClose={() => setProcedureModalOpen(false)}
            footer={(
              <>
                <button type="button" className="secondary-button" onClick={() => setProcedureModalOpen(false)}>Cancelar</button>
                <button type="submit" form="procedure-form" className="primary-button">{editingProcedureId ? "Salvar alterações" : "Salvar procedimento"}</button>
              </>
            )}
          >
            <form id="procedure-form" onSubmit={saveProcedure}>
              <div className="form-grid">
                <Select label="Serviço" value={procedureForm.service_id} onChange={(value) => setProcedureForm({ ...procedureForm, service_id: value })} required>
                  <option value="">Selecione</option>
                  {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </Select>
                <Input label="Nome" value={procedureForm.name} onChange={(value) => setProcedureForm({ ...procedureForm, name: value })} required />
                <Input label="Área do corpo" value={procedureForm.body_area} onChange={(value) => setProcedureForm({ ...procedureForm, body_area: value })} />
                <Input type="number" label="Preço" value={procedureForm.price} onChange={(value) => setProcedureForm({ ...procedureForm, price: value })} />
                <Input type="number" label="Duração em minutos" value={procedureForm.duration_minutes} onChange={(value) => setProcedureForm({ ...procedureForm, duration_minutes: value })} />
              </div>
              <label>Descrição<textarea value={procedureForm.description} onChange={(event) => setProcedureForm({ ...procedureForm, description: event.target.value })} /></label>
              <label>Orientações pós-atendimento<textarea value={procedureForm.aftercare_instructions} onChange={(event) => setProcedureForm({ ...procedureForm, aftercare_instructions: event.target.value })} /></label>
              <Toggle label="Procedimento ativo" checked={procedureForm.is_active} onChange={(value) => setProcedureForm({ ...procedureForm, is_active: value })} />
              {procedureError && <span className="form-error">{procedureError}</span>}
            </form>
          </Modal>
        </div>
      )}
      {tab === "horarios" && (
        <div className="stack">
          <article className="panel">
            <div className="panel-heading">
              <h2>Agenda semanal</h2>
              <span>Defina os horários fixos de cada profissional.</span>
            </div>
            {readinessMessage && <p className={readinessMessage.includes("sucesso") ? "form-success" : "form-error"}>{readinessMessage}</p>}
            <form onSubmit={saveWeeklyAvailability}>
              <div className="form-grid">
                <Select label="Profissional" value={weeklyProfessionalId} onChange={(value) => setWeeklyProfessionalId(value)}>
                  <option value="">Escolha um profissional</option>
                  {activeProfessionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
                </Select>
              </div>
              <div className="availability-grid">
                {weeklyWeekdays.map((weekday) => (
                  <article className="panel availability-card" key={weekday}>
                    <div className="panel-heading"><h2>{weekdayLabel(weekday)}</h2><span>{weekday === 0 ? "Indisponível por padrão" : "Horário semanal"}</span></div>
                    <Toggle label="Atende neste dia" checked={Boolean(weeklyDays.find((day) => day.weekday === weekday)?.is_active)} onChange={(value) => updateWeeklyDay(weekday, { is_active: value })} />
                    <div className="form-grid">
                      <Input label="Início" value={weeklyDays.find((day) => day.weekday === weekday)?.start_time || "09:00"} onChange={(value) => updateWeeklyDay(weekday, { start_time: value })} />
                      <Input label="Final" value={weeklyDays.find((day) => day.weekday === weekday)?.end_time || "18:00"} onChange={(value) => updateWeeklyDay(weekday, { end_time: value })} />
                      <Input label="Almoço início" value={weeklyDays.find((day) => day.weekday === weekday)?.lunch_start || ""} onChange={(value) => updateWeeklyDay(weekday, { lunch_start: value })} />
                      <Input label="Almoço final" value={weeklyDays.find((day) => day.weekday === weekday)?.lunch_end || ""} onChange={(value) => updateWeeklyDay(weekday, { lunch_end: value })} />
                      <Input type="number" label="Duração padrão" value={weeklyDays.find((day) => day.weekday === weekday)?.duration_minutes || 40} onChange={(value) => updateWeeklyDay(weekday, { duration_minutes: value })} />
                      <Input type="number" label="Intervalo" value={weeklyDays.find((day) => day.weekday === weekday)?.buffer_minutes || 10} onChange={(value) => updateWeeklyDay(weekday, { buffer_minutes: value })} />
                    </div>
                  </article>
                ))}
              </div>
              <p className="empty-state">Domingo fica desligado por padrão. Para liberar apenas uma data específica, crie um horário especial em Disponibilidade avançada.</p>
              <Button variant="primary" type="submit">Salvar disponibilidade individual</Button>
            </form>
          </article>
          <div className="availability-grid">
            {!safeAvailability.length && (
              <article className="panel availability-card">
                <div className="panel-heading"><h2>Sem horários cadastrados</h2><span>Seu agendamento online ainda não está pronto.</span></div>
                <p className="empty-state">Cadastre primeiro os profissionais, serviços e procedimentos. Depois gere a agenda semanal.</p>
                <Select label="Gerar semana padrão para" value="" onChange={createDefaultAvailability}>
                  <option value="">Escolha um profissional</option>
                  {activeProfessionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
                </Select>
              </article>
            )}
            {safeAvailability.map((item) => (
              <article className="panel availability-card" key={item.id}>
                <div className="panel-heading"><h2>{weekdayLabel(item.weekday)}</h2><span>{item.professional_name}</span></div>
                <Toggle label="Atende neste dia" checked={item.is_active} onChange={(value) => updateAvailability(item, { is_active: value })} />
                <div className="form-grid">
                  <Input label="Início" value={item.start_time} onChange={(value) => updateAvailability(item, { start_time: value })} />
                  <Input label="Final" value={item.end_time} onChange={(value) => updateAvailability(item, { end_time: value })} />
                  <Input label="Almoço início" value={item.lunch_start || ""} onChange={(value) => updateAvailability(item, { lunch_start: value })} />
                  <Input label="Almoço final" value={item.lunch_end || ""} onChange={(value) => updateAvailability(item, { lunch_end: value })} />
                  <Input type="number" label="Duração padrão" value={item.duration_minutes} onChange={(value) => updateAvailability(item, { duration_minutes: value })} />
                  <Input type="number" label="Intervalo" value={item.buffer_minutes} onChange={(value) => updateAvailability(item, { buffer_minutes: value })} />
                </div>
              </article>
            ))}
          </div>
        </div>
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
                <button type="button" className="secondary-button" onClick={() => { setBlockModalOpen(false); setEditingBlockId(null); }}>Cancelar</button>
                <button type="submit" form="block-form" className="primary-button">Salvar regra</button>
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
              <Toggle label="Dia inteiro" checked={blockForm.is_full_day} onChange={(value) => setBlockForm({ ...blockForm, is_full_day: value })} />
              <Toggle label="Recorrente" checked={blockForm.is_recurring} onChange={(value) => setBlockForm({ ...blockForm, is_recurring: value })} />
              <label>Observação<textarea value={blockForm.notes} onChange={(event) => setBlockForm({ ...blockForm, notes: event.target.value })} /></label>
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
                  <button onClick={() => updateRequest(item.id, "confirmado")}>Confirmar</button>
                  <button onClick={() => updateRequest(item.id, "recusado")}>Recusar</button>
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
  // As opções de profissional saem da própria lista: o componente recebe só os
  // agendamentos, sem acesso ao cadastro de profissionais.
  const professionalOptions = useMemo(
    () => distinctOptions(safeAppointments.map((item) => item.professional_name)),
    [appointments]
  );

  return (
    <DataView
      rows={safeAppointments}
      defaultSort={{ key: "appointment_date", dir: "asc" }}
      searchPlaceholder="Buscar por cliente, procedimento, região, profissional ou data"
      filters={[
        {
          key: "status",
          label: "Status",
          type: "select",
          options: APPOINTMENT_STATUS_OPTIONS,
          match: (item, value) => item.status === value
        },
        {
          key: "professional_name",
          label: "Profissional",
          type: "select",
          options: professionalOptions,
          match: (item, value) => item.professional_name === value
        },
        {
          key: "date_from",
          label: "Data inicial",
          type: "date",
          match: (item, value) => String(item.appointment_date || "").slice(0, 10) >= value
        },
        {
          key: "date_to",
          label: "Data final",
          type: "date",
          match: (item, value) => String(item.appointment_date || "").slice(0, 10) <= value
        }
      ]}
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
            { label: "Cancelar atendimento", onClick: () => updateAppointment(item.id, { status: "cancelado" }, onChanged), danger: true },
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
