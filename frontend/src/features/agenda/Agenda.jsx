// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock, ShieldCheck, XCircle } from "lucide-react";
import { Button, Input, PaymentSelect, Select, StatusBadge, StatusSelect } from "../../components/common/Ui";
import { Modal, CrudHeader, DataTable, ConfirmDeleteModal } from "../../components/common/Crud";
import { Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject, formatDate } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { buildCalendar, buildTimeSlots, dateKey, movePeriod } from "../../lib/calendarUtils";
import { defaultAppointment, defaultProcedureForm, defaultProfessionalForm, defaultScheduleBlock, defaultServiceForm } from "../../lib/defaultForms";
import { appointmentWhatsAppMessage, calcRemaining, currency, personName, statusClass, statuses, weekdayLabel, whatsappUrl } from "../../features/shared/helpers";
import { Toggle } from "../../pages/CatalogCustomization";

export function AgendaWorkspace() {
  const [tab, setTab] = useState("visual");
  const tabs = [
    {
      id: "visual",
      title: "Agenda visual",
      description: "Calendário mensal, semanal e diário com status dos atendimentos.",
      icon: Calendar
    },
    {
      id: "agendamentos",
      title: "Agendamentos",
      description: "Cadastro manual, cliente, joia, pagamento e status do atendimento.",
      icon: Clock
    },
    {
      id: "disponibilidade",
      title: "Disponibilidade",
      description: "Serviços online, horários disponíveis, bloqueios e solicitações pendentes.",
      icon: ShieldCheck
    }
  ];

  return (
    <section className="agenda-workspace">
      <div className="agenda-hub">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={20} />
            <span><strong>{title}</strong><small>{description}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      <div className="agenda-tab-panel">
        {tab === "visual" && <VisualCalendar />}
        {tab === "agendamentos" && <Appointments />}
        {tab === "disponibilidade" && <BookingAdmin />}
      </div>
    </section>
  );
}

export function Appointments() {
  const { data: options } = useFetch("/options");
  const { data: clients, refresh: refreshClients } = useFetch("/clients");
  const { data: appointments, refresh } = useFetch("/appointments");
  const { data: services } = useFetch("/services");
  const { data: procedures } = useFetch("/procedures");
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
          actionLabel="Novo Agendamento"
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
            <button type="submit" form="appointment-form" className="primary-button" disabled={!form.appointment_time}>Salvar Agendamento</button>
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
          <div className="form-grid">
            <Select label="Tipo de Atendimento" value={form.service_id} onChange={(value) => {
              const service = safeServices.find((item) => String(item.id) === String(value));
              updatePricedForm({
                ...form,
                service_id: value,
                procedure: service?.name || "",
                appointment_time: ""
              });
            }} required>
              <option value="">Selecione</option>
              {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name} ({service.duration_minutes} min)</option>)}
            </Select>
            <Input label="Procedimento" value={form.procedure} onChange={(v) => setForm({ ...form, procedure: v })} required />
            <Input label="Região da perfuração" value={form.piercing_region} onChange={(v) => setForm({ ...form, piercing_region: v })} required />
            <Select label="Joalheria escolhida" value={form.jewelry_id} onChange={(v) => updatePricedForm({ ...form, jewelry_id: v, jewelry_variant_id: "" })}>
              <option value="">Sem joia vinculada</option>
              {safeJewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Select label="Variação da Joia" value={form.jewelry_variant_id} onChange={(v) => updatePricedForm({ ...form, jewelry_variant_id: v })}>
              <option value="">Selecione</option>
              {asArray(safeJewelry.find((item) => String(item.id) === String(form.jewelry_id))?.variants).filter((variant) => asNumber(variant?.quantity) > 0).map((variant) => (
                <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} · {variant.quantity} un</option>
              ))}
            </Select>
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
            <PaymentSelect label="Forma de pagamento do sinal" value={form.deposit_payment_method} onChange={(v) => setForm({ ...form, deposit_payment_method: v })} />
            <PaymentSelect label="Forma de pagamento restante" value={form.remaining_payment_method} onChange={(v) => setForm({ ...form, remaining_payment_method: v })} />
            <StatusSelect value={form.status} onChange={(v) => setForm({ ...form, status: v })} />
          </div>
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
  const service = asArray(services).find((item) => String(item.id) === String(draft.service_id));
  const jewelry = asArray(jewelryList).find((item) => String(item.id) === String(draft.jewelry_id));
  const variant = asArray(jewelry?.variants).find((item) => String(item.id) === String(draft.jewelry_variant_id));
  const procedureValue = asNumber(service?.base_price || service?.price || 0);
  const jewelryValue = draft.jewelry_id ? asNumber(variant?.sale_value || jewelry?.sale_value || 0) : 0;
  const totalValue = procedureValue + jewelryValue;
  const depositValue = asNumber(draft.deposit_value || service?.deposit_value || 0);
  return calcRemaining({
    ...draft,
    total_value: totalValue,
    deposit_value: depositValue
  });
}

function appointmentValueParts(form, services = [], jewelryList = []) {
  const service = asArray(services).find((item) => String(item.id) === String(form.service_id));
  const jewelry = asArray(jewelryList).find((item) => String(item.id) === String(form.jewelry_id));
  const variant = asArray(jewelry?.variants).find((item) => String(item.id) === String(form.jewelry_variant_id));
  const procedureValue = asNumber(service?.base_price || service?.price || 0);
  const jewelryValue = form.jewelry_id ? asNumber(variant?.sale_value || jewelry?.sale_value || 0) : 0;
  const totalValue = procedureValue + jewelryValue;
  const depositValue = asNumber(form.deposit_value || service?.deposit_value || 0);
  return {
    procedureValue,
    jewelryValue,
    totalValue,
    depositValue,
    remainingValue: Math.max(totalValue - depositValue, 0)
  };
}

function AppointmentValueSummary({ form, services, jewelry }) {
  const values = appointmentValueParts(form, services, jewelry);
  if (!form.service_id && !form.jewelry_id) return null;
  return (
    <div className="soft-card appointment-value-summary">
      <span>Procedimento: <strong>{currency.format(values.procedureValue)}</strong></span>
      <span>Joalheria: <strong>{currency.format(values.jewelryValue)}</strong></span>
      <span>Sinal: <strong>{currency.format(values.depositValue)}</strong></span>
      <span>Restante: <strong>{currency.format(values.remainingValue)}</strong></span>
      <span>Total: <strong>{currency.format(values.totalValue)}</strong></span>
    </div>
  );
}

export function VisualCalendar() {
  const { data: options } = useFetch("/options");
  const { data: clients, refresh: refreshClients } = useFetch("/clients");
  const { data: services } = useFetch("/services");
  const [filters, setFilters] = useState({ mode: "mensal", professional_id: "", status: "" });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [createSeed, setCreateSeed] = useState(null);
  const { data, refresh } = useFetch(`/appointments?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v && !["mensal", "semanal", "diario"].includes(v))))}`);
  const safeOptions = asObject(options);
  const calendar = useMemo(() => buildCalendar(asArray(data), filters.mode, currentDate), [data, filters.mode, currentDate]);

  return (
    <section className="stack">
      <div className="toolbar">
        <div className="segmented">
          {["mensal", "semanal", "diario"].map((mode) => <button key={mode} className={filters.mode === mode ? "active" : ""} onClick={() => setFilters({ ...filters, mode })}>{mode}</button>)}
        </div>
        <Select label="Profissional" value={filters.professional_id} onChange={(v) => setFilters({ ...filters, professional_id: v })}>
          <option value="">Todos</option>
          {asArray(safeOptions.professionals).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
          <option value="">Todos</option>
          {statuses().map((status) => <option key={status}>{status}</option>)}
        </Select>
        <div className="calendar-nav">
          <button aria-label="Período anterior" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, -1))}><ChevronLeft size={18} /></button>
          <strong>{calendar.title}</strong>
          <button aria-label="Próximo período" onClick={() => setCurrentDate(movePeriod(currentDate, filters.mode, 1))}><ChevronRight size={18} /></button>
          <button onClick={() => setCurrentDate(new Date())}>Hoje</button>
        </div>
      </div>
      {filters.mode === "diario" ? (
        <DailyAgenda day={calendar.days[0]} refresh={refresh} onSelect={setSelectedAppointment} onEmptySlot={setCreateSeed} />
      ) : (
        <GoogleLikeCalendar days={calendar.days} mode={filters.mode} refresh={refresh} onSelect={setSelectedAppointment} onEmptySlot={setCreateSeed} />
      )}
      <AppointmentCreateModal
        seed={createSeed}
        options={safeOptions}
        clients={clients}
        services={services}
        onClose={() => setCreateSeed(null)}
        onSaved={() => {
          setCreateSeed(null);
          refresh();
          refreshClients();
        }}
      />
      <AppointmentQuickModal
        appointment={selectedAppointment}
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
        <button onClick={() => updateAppointment(item.id, { status: "atendido" }, refresh)}>Atendido</button>
      </div>
    </div>
  );
}

export function AppointmentCreateModal({ seed, options, clients, services, onClose, onSaved }) {
  const safeOptions = asObject(options);
  const safeClients = asArray(clients);
  const safeServices = asArray(services);
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
      body: JSON.stringify(form)
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
          <button type="submit" form="visual-appointment-form" className="primary-button">Salvar Agendamento</button>
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
          <Select label="Serviço" value={form.service_id} onChange={(value) => {
            const service = safeServices.find((item) => String(item.id) === String(value));
            updatePricedForm({ ...form, service_id: value, procedure: service?.name || "", piercing_region: service?.name || form.piercing_region });
          }} required>
            <option value="">Selecione</option>
            {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </Select>
          <Input label="Procedimento" value={form.procedure} onChange={(value) => setForm({ ...form, procedure: value })} required />
          <Input label="Região" value={form.piercing_region} onChange={(value) => setForm({ ...form, piercing_region: value })} required />
          <Select label="Profissional" value={form.professional_id} onChange={(value) => setForm({ ...form, professional_id: value })} required>
            <option value="">Selecione</option>
            {safeProfessionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
          </Select>
          <Input type="date" label="Data" value={form.appointment_date} onChange={(value) => setForm({ ...form, appointment_date: value })} required />
          <Input type="time" label="Horário" value={form.appointment_time} onChange={(value) => setForm({ ...form, appointment_time: value })} required />
          <StatusSelect value={form.status} onChange={(value) => setForm({ ...form, status: value })} />
          <Select label="Joalheria" value={form.jewelry_id} onChange={(value) => updatePricedForm({ ...form, jewelry_id: value, jewelry_variant_id: "" })}>
            <option value="">Sem joia</option>
            {safeJewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select label="Variação" value={form.jewelry_variant_id} onChange={(value) => updatePricedForm({ ...form, jewelry_variant_id: value })}>
            <option value="">Selecione</option>
            {asArray(safeJewelry.find((item) => String(item.id) === String(form.jewelry_id))?.variants).filter((variant) => asNumber(variant?.quantity) > 0).map((variant) => (
              <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} · {currency.format(asNumber(variant.sale_value || 0))}</option>
            ))}
          </Select>
        </div>
        <AppointmentValueSummary form={form} services={safeServices} jewelry={safeJewelry} />
        <label>Observações
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        {error && <span className="form-error">{error}</span>}
      </form>
    </Modal>
  );
}

export function AppointmentQuickModal({ appointment, onClose, onSaved }) {
  const [form, setForm] = useState({ appointment_date: "", appointment_time: "", status: "pendente", notes: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!appointment) return;
    setForm({
      appointment_date: appointment.appointment_date || "",
      appointment_time: appointment.appointment_time || "",
      status: appointment.status || "pendente",
      notes: appointment.notes || ""
    });
    setError("");
  }, [appointment]);

  async function saveAppointment(patch = {}) {
    if (!appointment?.id) return;
    setError("");
    const payload = { ...form, ...patch };
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
          <button type="button" className="primary-button" onClick={() => saveAppointment()}>Salvar Alterações</button>
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
          <label>Observação
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="toolbar compact-actions">
            <button type="button" className="secondary-button" onClick={() => saveAppointment({ status: "confirmado" })}>Confirmar</button>
            <button type="button" className="secondary-button" onClick={() => saveAppointment({ status: "remarcado" })}>Reagendar</button>
            <button type="button" className="secondary-button danger" onClick={() => saveAppointment({ status: "cancelado" })}>Cancelar</button>
            <button type="button" className="primary-button" onClick={() => saveAppointment({ status: "atendido" })}>Finalizar</button>
          </div>
          {error && <span className="form-error">{error}</span>}
        </div>
      )}
    </Modal>
  );
}

export function BookingAdmin() {
  const { data: services, refresh: refreshServices } = useFetch("/services");
  const { data: procedures, refresh: refreshProcedures } = useFetch("/procedures");
  const { data: professionalsData, refresh: refreshProfessionals } = useFetch("/professionals");
  const { data: readiness, refresh: refreshReadiness } = useFetch("/booking/readiness");
  const { data: options } = useFetch("/options");
  const { data: availability, refresh: refreshAvailability } = useFetch("/availability");
  const { data: blocks, refresh: refreshBlocks } = useFetch("/schedule-blocks");
  const { data: appointments, refresh: refreshAppointments } = useFetch("/appointments?status=pendente");
  const [tab, setTab] = useState("servicos");
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

  const readinessData = asObject(readiness);
  const checklist = asArray(readinessData.checklist);
  const activeServices = safeServices.filter((service) => Boolean(Number(service.is_active ?? service.active_online_booking)));
  const activeProcedures = safeProcedures.filter((procedure) => Boolean(Number(procedure.is_active)));
  const activeProfessionals = allProfessionals.filter((professional) => Boolean(Number(professional.active)));
  const isBookingReady = Boolean(readinessData.ready);
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

  if (services == null || procedures == null || professionalsData == null || readiness == null || availability == null || blocks == null || appointments == null) return <Loading />;

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
      return setProfessionalError(payload.error || "NÃ£o foi possÃ­vel salvar o profissional.");
    }
    setProfessionalForm(defaultProfessionalForm());
    setEditingProfessionalId(null);
    setProfessionalModalOpen(false);
    refreshProfessionals();
    refreshReadiness();
  }

  function removeProfessional(professional) {
    setDeleting({
      message: `Excluir ${professional.name}?`,
      run: async () => {
        const response = await apiFetch(`/professionals/${professional.id}`, { method: "DELETE" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          return setProfessionalError(payload.error || "NÃ£o foi possÃ­vel excluir o profissional.");
        }
        refreshProfessionals();
        refreshAvailability();
        refreshReadiness();
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
    refreshReadiness();
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
    refreshReadiness();
  }

  async function saveWeeklyAvailability(event) {
    event.preventDefault();
    setReadinessMessage("");
    if (!activeProfessionals.length) return setReadinessMessage("Cadastre e ative pelo menos um profissional antes de configurar a agenda semanal.");
    if (!activeServices.length) return setReadinessMessage("Cadastre e ative pelo menos um serviÃ§o antes de configurar a agenda semanal.");
    if (!activeProcedures.length) return setReadinessMessage("Cadastre e ative pelo menos um procedimento vinculado ao serviÃ§o.");
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
    refreshReadiness();
  }

  function validatePublicLink(event) {
    if (isBookingReady) return;
    event.preventDefault();
    const missing = asArray(readinessData.missing);
    setReadinessMessage(`Agendamento online ainda nÃ£o estÃ¡ pronto. Falta: ${missing.join(", ")}.`);
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
      message: `Apagar o bloqueio "${block.reason}"?`,
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
      <header className="availability-header">
        <div>
          <span className="eyebrow">Agendamento online</span>
          <h2>Disponibilidade</h2>
          <p>Configure serviços, horários, bloqueios e solicitações vindas do link público.</p>
        </div>
        <a className="primary-button" href="/agendar" target="_blank" rel="noreferrer" onClick={validatePublicLink}>Abrir link público</a>
      </header>
      <div className="panel">
        <div className="panel-heading">
          <h2>Configuração do Agendamento Online</h2>
          <span>{isBookingReady ? "Link público pronto para uso." : "Seu agendamento online ainda não está pronto."}</span>
        </div>
        <div className="metric-grid">
          {checklist.map((item) => (
            <article className="metric-card" key={item.key}>
              {item.done ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
              <span>{item.label}</span>
              <strong>{item.done ? "Concluído" : "Pendente"}</strong>
            </article>
          ))}
        </div>
        {!isBookingReady && (
          <div className="empty-state">
            Seu agendamento online ainda não está pronto. Cadastre primeiro os profissionais, serviços, procedimentos e horários semanais.
            <div className="row-actions">
              <button type="button" onClick={() => setTab("profissionais")}>Cadastrar profissional</button>
              <button type="button" onClick={() => setTab("servicos")}>Cadastrar serviço</button>
              <button type="button" onClick={() => setTab("servicos")}>Cadastrar procedimento</button>
              <button type="button" onClick={() => setTab("horarios")}>Configurar agenda semanal</button>
            </div>
          </div>
        )}
        {readinessMessage && <span className="form-error">{readinessMessage}</span>}
      </div>
      <nav className="customization-tabs">`r`n        {[
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
          <DataTable
            rows={allProfessionals}
            columns={[
              { key: "name", label: "Nome" },
              { key: "specialty", label: "Especialidade", render: (professional) => professional.specialty || "Body Piercer" },
              { key: "phone", label: "Contato", render: (professional) => [professional.phone, professional.email].filter(Boolean).join(" · ") || "Sem contato" },
              { key: "service_ids", label: "Serviços", render: (professional) => asArray(professional.service_ids).length ? `${asArray(professional.service_ids).length} serviço(s)` : "Sem vínculo" },
              { key: "active", label: "Status", render: (professional) => <StatusBadge status={professional.active ? "Ativo" : "Inativo"} /> },
            ]}
            actions={(professional) => (
              <>
                <button type="button" onClick={() => editProfessional(professional)}>Editar</button>
                <button type="button" onClick={() => removeProfessional(professional)}>Excluir</button>
              </>
            )}
            empty="Cadastre pelo menos um profissional para liberar o agendamento online."
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
            <DataTable
              rows={safeServices}
              columns={[
                { key: "name", label: "Nome" },
                { key: "duration_minutes", label: "Duração", render: (service) => `${service.duration_minutes} min` },
                { key: "base_price", label: "Preço base", render: (service) => currency.format(service.base_price || 0) },
                { key: "is_active", label: "Status", render: (service) => <StatusBadge status={service.is_active ? "Ativo" : "Inativo"} /> },
              ]}
              actions={(service) => (
                <>
                  <button type="button" onClick={() => editService(service)}>Editar</button>
                  <button type="button" onClick={() => removeService(service)}>Excluir</button>
                </>
              )}
              empty="Você ainda não possui serviços cadastrados."
            />
          </div>

          <div className="panel">
            <CrudHeader
              title="Procedimentos cadastrados"
              subtitle="Vincule a um serviço"
              actionLabel="Novo procedimento"
              onAction={openNewProcedure}
            />
            <DataTable
              rows={safeProcedures}
              columns={[
                { key: "name", label: "Nome" },
                { key: "service_name", label: "Serviço", render: (procedure) => procedure.service_name || "Sem serviço" },
                { key: "body_area", label: "Área do corpo", render: (procedure) => procedure.body_area || "Sem área" },
                { key: "duration_minutes", label: "Duração", render: (procedure) => `${procedure.duration_minutes} min` },
                { key: "price", label: "Preço", render: (procedure) => currency.format(procedure.price || 0) },
                { key: "is_active", label: "Status", render: (procedure) => <StatusBadge status={procedure.is_active ? "Ativo" : "Inativo"} /> },
              ]}
              actions={(procedure) => (
                <>
                  <button type="button" onClick={() => editProcedure(procedure)}>Editar</button>
                  <button type="button" onClick={() => removeProcedure(procedure)}>Excluir</button>
                </>
              )}
              empty="Você ainda não possui procedimentos cadastrados."
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
              <span>Salve os horários fixos antes de liberar o link público.</span>
            </div>
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
            <DataTable
              rows={safeBlocks}
              columns={[
                { key: "block_type", label: "Tipo", render: (block) => block.block_type === "special_hours" ? "Horário especial" : block.block_type === "unavailable" ? "Data indisponível" : "Bloqueio de intervalo" },
                { key: "reason", label: "Motivo" },
                { key: "professional_name", label: "Profissional", render: (block) => block.professional_name || "Todos" },
                { key: "start_datetime", label: "Início", render: (block) => new Date(block.start_datetime).toLocaleString("pt-BR") },
                { key: "end_datetime", label: "Final", render: (block) => new Date(block.end_datetime).toLocaleString("pt-BR") },
              ]}
              actions={(block) => (
                <>
                  <button type="button" onClick={() => editBlock(block)}>Editar</button>
                  <button type="button" onClick={() => removeBlock(block)}>Apagar</button>
                </>
              )}
              empty="Nenhuma regra avançada cadastrada ainda."
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
  if (!safeAppointments.length) return <p className="empty-state">Nenhum atendimento encontrado.</p>;
  return (
    <div className="appointment-list">
      {safeAppointments.map((item) => (
        <article className="appointment-row" key={item.id}>
          <div className="time-box"><strong>{item.appointment_time}</strong><span>{formatDate(item.appointment_date)}</span></div>
          <div>
            <h3>{personName(item)}</h3>
            <p>{item.procedure} · {item.piercing_region}</p>
            <small>{item.professional_name} · {item.jewelry_name || "sem joia vinculada"}</small>
          </div>
          <StatusBadge status={item.status} />
          {!compact && <div className="row-actions">
            <a title="WhatsApp" href={whatsappUrl(item.whatsapp, appointmentWhatsAppMessage(item))} target="_blank" rel="noreferrer">WhatsApp</a>
            <button title="Cancelar" onClick={() => updateAppointment(item.id, { status: "cancelado" }, onChanged)}><XCircle size={16} /></button>
            <button title="Atendido" onClick={() => updateAppointment(item.id, { status: "atendido" }, onChanged)}><CheckCircle2 size={16} /></button>
          </div>}
        </article>
      ))}
    </div>
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

