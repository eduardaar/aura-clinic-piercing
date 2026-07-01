// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock, ShieldCheck, XCircle } from "lucide-react";
import { Input, PaymentSelect, Select, StatusSelect } from "../../components/common/Ui";
import { Modal, CrudHeader, DataTable } from "../../components/common/Crud";
import { Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject, formatDate } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { buildCalendar, buildTimeSlots, movePeriod } from "../../lib/calendarUtils";
import { defaultAppointment, defaultProcedureForm, defaultScheduleBlock, defaultServiceForm } from "../../lib/defaultForms";
import { calcRemaining, currency, statusClass, statuses, weekdayLabel, whatsappUrl } from "../../features/shared/helpers";
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
      full_name: client.full_name || "",
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
                  {client.full_name} - {client.whatsapp}
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
              setForm(calcRemaining({
                ...form,
                service_id: value,
                procedure: service?.name || "",
                total_value: Number(service?.base_price || service?.price || 0),
                deposit_value: Number(service?.deposit_value || 0),
                appointment_time: ""
              }));
            }} required>
              <option value="">Selecione</option>
              {safeServices.map((service) => <option key={service.id} value={service.id}>{service.name} ({service.duration_minutes} min)</option>)}
            </Select>
            <Input label="Procedimento" value={form.procedure} onChange={(v) => setForm({ ...form, procedure: v })} required />
            <Input label="Região da perfuração" value={form.piercing_region} onChange={(v) => setForm({ ...form, piercing_region: v })} required />
            <Select label="Joalheria escolhida" value={form.jewelry_id} onChange={(v) => setForm({ ...form, jewelry_id: v })}>
              <option value="">Sem joia vinculada</option>
              {safeJewelry.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Select label="Variação da Joia" value={form.jewelry_variant_id} onChange={(v) => setForm({ ...form, jewelry_variant_id: v })}>
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

export function VisualCalendar() {
  const { data: options } = useFetch("/options");
  const [filters, setFilters] = useState({ mode: "mensal", professional_id: "", status: "" });
  const [currentDate, setCurrentDate] = useState(new Date());
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
        <DailyAgenda day={calendar.days[0]} refresh={refresh} />
      ) : (
        <GoogleLikeCalendar days={calendar.days} mode={filters.mode} refresh={refresh} />
      )}
    </section>
  );
}

export function GoogleLikeCalendar({ days, mode, refresh }) {
  return (
    <div className={`google-calendar ${mode === "semanal" ? "week-view" : ""}`}>
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
      {days.map((day) => (
        <article className={`calendar-cell ${day.isOutside ? "outside" : ""} ${day.isToday ? "today" : ""}`} key={day.key}>
          <header>
            <span>{day.date.getDate()}</span>
            {day.isToday && <strong>Hoje</strong>}
          </header>
          <div className="calendar-events">
            {asArray(day.items).map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} />)}
          </div>
        </article>
      ))}
    </div>
  );
}

export function DailyAgenda({ day, refresh }) {
  const slots = buildTimeSlots(day.items);
  return (
    <div className="daily-calendar">
      <div className="daily-heading">
        <strong>{day.date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</strong>
        <span>{day.items.length} atendimento(s)</span>
      </div>
      {slots.map((slot) => (
        <div className="time-slot" key={slot.hour}>
          <span>{slot.hour}</span>
          <div>{asArray(slot.items).map((item) => <CalendarEvent item={item} key={item.id} refresh={refresh} />)}</div>
        </div>
      ))}
    </div>
  );
}

export function CalendarEvent({ item, refresh }) {
  return (
    <div className={`calendar-event ${statusClass[item.status]}`}>
      <strong>{item.appointment_time} - {item.full_name}</strong>
      <span>{item.procedure}</span>
      <small>{item.professional_name}</small>
      <div className="event-actions">
        <button onClick={() => updateAppointment(item.id, { status: "remarcado" }, refresh)}>Remarcar</button>
        <button onClick={() => updateAppointment(item.id, { status: "cancelado" }, refresh)}>Cancelar</button>
        <button onClick={() => updateAppointment(item.id, { status: "atendido" }, refresh)}>Atendido</button>
      </div>
    </div>
  );
}

export function BookingAdmin() {
  const { data: services, refresh: refreshServices } = useFetch("/services");
  const { data: procedures, refresh: refreshProcedures } = useFetch("/procedures");
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
  const [serviceError, setServiceError] = useState("");
  const [procedureError, setProcedureError] = useState("");
  const [blockForm, setBlockForm] = useState(defaultScheduleBlock());
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockError, setBlockError] = useState("");
  const professionals = asArray(asObject(options).professionals);
  const safeServices = asArray(services);
  const safeProcedures = asArray(procedures);
  const safeAvailability = asArray(availability);
  const safeBlocks = asArray(blocks);
  const safeAppointments = asArray(appointments);

  if (services == null || procedures == null || availability == null || blocks == null || appointments == null) return <Loading />;

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
      duration_minutes: service.duration_minutes || 40,
      is_active: Boolean(service.is_active)
    });
    setServiceModalOpen(true);
  }

  async function removeService(service) {
    if (!window.confirm(`Excluir ${service.name}?`)) return;
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

  async function removeProcedure(procedure) {
    if (!window.confirm(`Excluir ${procedure.name}?`)) return;
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
  async function updateAvailability(item, patch) {
    await apiFetch(`/availability/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, ...patch })
    });
    refreshAvailability();
  }

  function openNewBlock() {
    setBlockForm(defaultScheduleBlock());
    setBlockError("");
    setBlockModalOpen(true);
  }

  async function saveBlock(event) {
    event.preventDefault();
    setBlockError("");
    const response = await apiFetch("/schedule-blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blockForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setBlockError(payload.error || "Não foi possível salvar o bloqueio.");
    }
    setBlockForm(defaultScheduleBlock());
    setBlockModalOpen(false);
    refreshBlocks();
  }

  async function removeBlock(block) {
    if (!window.confirm(`Apagar o bloqueio "${block.reason}"?`)) return;
    await apiFetch(`/schedule-blocks/${block.id}`, { method: "DELETE" });
    refreshBlocks();
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
        <a className="primary-button" href="/agendar" target="_blank" rel="noreferrer">Abrir link público</a>
      </header>
      <nav className="customization-tabs">
        {[
          ["servicos", "Serviços"],
          ["horarios", "Disponibilidade"],
          ["bloqueios", "Bloqueios"],
          ["solicitacoes", "Solicitações pendentes"]
        ].map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

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
                { key: "is_active", label: "Status", render: (service) => <span className="status-badge">{service.is_active ? "Ativo" : "Inativo"}</span> },
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
                { key: "is_active", label: "Status", render: (procedure) => <span className="status-badge">{procedure.is_active ? "Ativo" : "Inativo"}</span> },
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
        <div className="availability-grid">
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
      )}

      {tab === "bloqueios" && (
        <div className="stack">
          <div className="panel">
            <CrudHeader
              title="Bloqueios cadastrados"
              subtitle="Não aparece para o cliente"
              actionLabel="Novo bloqueio"
              onAction={openNewBlock}
            />
            <DataTable
              rows={safeBlocks}
              columns={[
                { key: "reason", label: "Motivo" },
                { key: "professional_name", label: "Profissional", render: (block) => block.professional_name || "Todos" },
                { key: "start_datetime", label: "Início", render: (block) => new Date(block.start_datetime).toLocaleString("pt-BR") },
                { key: "end_datetime", label: "Final", render: (block) => new Date(block.end_datetime).toLocaleString("pt-BR") },
              ]}
              actions={(block) => (
                <button type="button" onClick={() => removeBlock(block)}>Apagar</button>
              )}
              empty="Nenhum bloqueio cadastrado ainda."
            />
          </div>

          <Modal
            open={blockModalOpen}
            title="Novo bloqueio"
            subtitle="Não aparece para o cliente"
            onClose={() => setBlockModalOpen(false)}
            footer={(
              <>
                <button type="button" className="secondary-button" onClick={() => setBlockModalOpen(false)}>Cancelar</button>
                <button type="submit" form="block-form" className="primary-button">Salvar bloqueio</button>
              </>
            )}
          >
            <form id="block-form" onSubmit={saveBlock}>
              <div className="form-grid">
                <Select label="Profissional" value={blockForm.professional_id} onChange={(value) => setBlockForm({ ...blockForm, professional_id: value })}>
                  <option value="">Selecione</option>
                  {professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name}</option>)}
                </Select>
                <Input label="Motivo" value={blockForm.reason} onChange={(value) => setBlockForm({ ...blockForm, reason: value })} />
                <Input type="datetime-local" label="Início" value={blockForm.start_datetime} onChange={(value) => setBlockForm({ ...blockForm, start_datetime: value })} />
                <Input type="datetime-local" label="Final" value={blockForm.end_datetime} onChange={(value) => setBlockForm({ ...blockForm, end_datetime: value })} />
              </div>
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
                <div><h3>{item.full_name}</h3><p>{item.procedure} · {currency.format(item.deposit_value || 0)} de sinal</p><small>{item.professional_name} · {item.whatsapp}</small></div>
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
            <h3>{item.full_name}</h3>
            <p>{item.procedure} · {item.piercing_region}</p>
            <small>{item.professional_name} · {item.jewelry_name || "sem joia vinculada"}</small>
          </div>
          <span className={`status-badge ${statusClass[item.status]}`}>{item.status}</span>
          {!compact && <div className="row-actions">
            <a title="WhatsApp" href={whatsappUrl(item.whatsapp, `Ola ${item.full_name}, tudo bem Aqui e da Aura Clinic sobre seu atendimento de ${formatDate(item.appointment_date)} as ${item.appointment_time}.`)} target="_blank" rel="noreferrer">WhatsApp</a>
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

