import { useState } from "react";
import { Button, Input, Select, StatusBadge, Switch, Tabs, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { defaultProcedureForm, defaultServiceForm } from "../../lib/defaultForms";
import { asArray, asNumber, formatDate } from "../../lib/utils";
import { currency, personName } from "../shared/helpers";

function rowsOf(value) {
  return Array.isArray(value) ? value : asArray(value?.items);
}

function attendedStatus(value) {
  return value === "atendido" ? "Atendido" : value || "Sem status";
}

export function ServicesWorkspace({ onNavigate }) {
  const { data: servicesData } = useFetch("/services");
  const { data: proceduresData } = useFetch("/procedures");
  const { data: attendedData } = useFetch("/appointments?status=atendido&limit=250");
  const invalidate = useApiInvalidate();
  const [tab, setTab] = useState("catalogo");
  const [serviceForm, setServiceForm] = useState(defaultServiceForm());
  const [procedureForm, setProcedureForm] = useState(defaultProcedureForm());
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [editingProcedureId, setEditingProcedureId] = useState(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [procedureModalOpen, setProcedureModalOpen] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [procedureError, setProcedureError] = useState("");
  const [deleting, setDeleting] = useState(null);

  if (servicesData == null || proceduresData == null || attendedData == null) return <Loading />;

  const services = rowsOf(servicesData);
  const procedures = rowsOf(proceduresData);
  const attendedAppointments = rowsOf(attendedData);
  const refreshCatalog = () => invalidate("/services", "/procedures", "/options", "/booking/readiness");

  function validateService() {
    if (!serviceForm.name.trim()) return "Informe o nome do serviço.";
    if (Number(serviceForm.base_price || 0) < 0) return "Preço não pode ser negativo.";
    if (Number(serviceForm.deposit_value || 0) < 0) return "Sinal não pode ser negativo.";
    if (Number(serviceForm.duration_minutes || 0) <= 0) return "Duração deve ser um número positivo.";
    return "";
  }

  function validateProcedure() {
    if (!procedureForm.service_id) return "Procedimento precisa ter um serviço vinculado.";
    if (!procedureForm.name.trim()) return "Informe o nome do procedimento.";
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

  function editService(service) {
    setEditingServiceId(service.id);
    setServiceForm({
      ...defaultServiceForm(),
      name: service.name || "",
      description: service.description || "",
      base_price: service.base_price ?? service.price ?? 0,
      deposit_value: service.deposit_value ?? 0,
      duration_minutes: service.duration_minutes || 40,
      is_active: Boolean(Number(service.is_active ?? service.active_online_booking)),
      pre_service_notes: service.pre_service_notes || ""
    });
    setServiceError("");
    setServiceModalOpen(true);
  }

  async function saveService(event) {
    event.preventDefault();
    const error = validateService();
    if (error) return setServiceError(error);
    setServiceError("");
    const response = await apiFetch(editingServiceId ? `/services/${editingServiceId}` : "/services", {
      method: editingServiceId ? "PUT" : "POST",
      body: JSON.stringify(serviceForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setServiceError(payload.error || "Não foi possível salvar o serviço.");
    }
    setServiceModalOpen(false);
    refreshCatalog();
  }

  function openNewProcedure() {
    setEditingProcedureId(null);
    setProcedureForm(defaultProcedureForm());
    setProcedureError("");
    setProcedureModalOpen(true);
  }

  function editProcedure(procedure) {
    setEditingProcedureId(procedure.id);
    setProcedureForm({
      ...defaultProcedureForm(),
      service_id: String(procedure.service_id || ""),
      name: procedure.name || "",
      body_area: procedure.body_area || "",
      description: procedure.description || "",
      price: procedure.price || 0,
      duration_minutes: procedure.duration_minutes || 40,
      aftercare_instructions: procedure.aftercare_instructions || "",
      is_active: Boolean(Number(procedure.is_active))
    });
    setProcedureError("");
    setProcedureModalOpen(true);
  }

  async function saveProcedure(event) {
    event.preventDefault();
    const error = validateProcedure();
    if (error) return setProcedureError(error);
    setProcedureError("");
    const response = await apiFetch(editingProcedureId ? `/procedures/${editingProcedureId}` : "/procedures", {
      method: editingProcedureId ? "PUT" : "POST",
      body: JSON.stringify(procedureForm)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setProcedureError(payload.error || "Não foi possível salvar o procedimento.");
    }
    setProcedureModalOpen(false);
    refreshCatalog();
  }

  function removeService(service) {
    setDeleting({
      message: `Excluir ${service.name}? Se já houver uso, ele será arquivado e deixará de aparecer para novos agendamentos.`,
      run: async () => {
        const response = await apiFetch(`/services/${service.id}`, { method: "DELETE" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Não foi possível excluir o serviço.");
        }
        refreshCatalog();
      }
    });
  }

  function removeProcedure(procedure) {
    setDeleting({
      message: `Excluir ${procedure.name}?`,
      run: async () => {
        const response = await apiFetch(`/procedures/${procedure.id}`, { method: "DELETE" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Não foi possível excluir o procedimento.");
        }
        refreshCatalog();
      }
    });
  }

  return (
    <section className="booking-admin-page stack">
      <header className="availability-header agenda-settings-header">
        <div>
          <span className="eyebrow">Operação clínica</span>
          <h2>Serviços</h2>
          <p>O catálogo define o que pode ser agendado. Os atendimentos realizados são gerados somente pela Agenda.</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.List className="customization-tabs" aria-label="Módulo de serviços">
          <Tabs.Trigger value="catalogo">Catálogo de serviços</Tabs.Trigger>
          <Tabs.Trigger value="procedimentos">Procedimentos</Tabs.Trigger>
          <Tabs.Trigger value="realizados">Serviços realizados</Tabs.Trigger>
        </Tabs.List>
      </Tabs>

      {tab === "catalogo" && <div className="panel">
        <CrudHeader title="Serviços cadastrados" subtitle="Estes serviços ficam disponíveis na Agenda e no agendamento online." actionLabel="Novo serviço" onAction={openNewService} />
        <DataView
          rows={services}
          defaultSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Buscar por nome ou descrição"
          filters={[{ key: "status", label: "Status", type: "select", options: [{ value: "ativo", label: "Ativo" }, { value: "inativo", label: "Inativo" }], match: (item, value) => (Boolean(Number(item.is_active ?? item.active_online_booking)) ? "ativo" : "inativo") === value }]}
          columns={[
            { key: "name", label: "Serviço", value: (item) => `${item.name || ""} ${item.description || ""}`, render: (item) => <><strong>{item.name}</strong>{item.description && <><br /><small>{item.description}</small></>}</> },
            { key: "duration_minutes", label: "Duração", value: (item) => asNumber(item.duration_minutes), render: (item) => `${item.duration_minutes || 0} min` },
            { key: "base_price", label: "Preço base", value: (item) => asNumber(item.base_price ?? item.price), render: (item) => currency.format(item.base_price ?? item.price ?? 0) },
            { key: "deposit_value", label: "Sinal", value: (item) => asNumber(item.deposit_value), render: (item) => currency.format(item.deposit_value || 0) },
            { key: "is_active", label: "Status", value: (item) => Boolean(Number(item.is_active ?? item.active_online_booking)) ? "Ativo" : "Inativo", render: (item) => <StatusBadge status={Boolean(Number(item.is_active ?? item.active_online_booking)) ? "Ativo" : "Inativo"} /> }
          ]}
          actions={(item) => <RowActions actions={[{ label: "Editar", onClick: () => editService(item), primary: true }, { label: "Excluir", onClick: () => removeService(item), danger: true }]} />}
          empty="Você ainda não possui serviços cadastrados."
          emptyFiltered="Nenhum serviço corresponde aos filtros aplicados."
        />
      </div>}

      {tab === "procedimentos" && <div className="panel">
        <CrudHeader title="Procedimentos cadastrados" subtitle="Detalhe o procedimento e vincule-o a um serviço do catálogo." actionLabel="Novo procedimento" onAction={openNewProcedure} />
        <DataView
          rows={procedures}
          defaultSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Buscar por procedimento, serviço ou região"
          filters={[{ key: "service_id", label: "Serviço", type: "select", options: services.map((item) => ({ value: String(item.id), label: item.name })), match: (item, value) => String(item.service_id) === value }]}
          columns={[
            { key: "name", label: "Procedimento" },
            { key: "service_name", label: "Serviço", value: (item) => item.service_name || "Sem serviço", render: (item) => item.service_name || "Sem serviço" },
            { key: "body_area", label: "Região", value: (item) => item.body_area || "—", render: (item) => item.body_area || "—" },
            { key: "duration_minutes", label: "Duração", value: (item) => asNumber(item.duration_minutes), render: (item) => `${item.duration_minutes || 0} min` },
            { key: "price", label: "Preço", value: (item) => asNumber(item.price), render: (item) => currency.format(item.price || 0) },
            { key: "is_active", label: "Status", value: (item) => Boolean(Number(item.is_active)) ? "Ativo" : "Inativo", render: (item) => <StatusBadge status={Boolean(Number(item.is_active)) ? "Ativo" : "Inativo"} /> }
          ]}
          actions={(item) => <RowActions actions={[{ label: "Editar", onClick: () => editProcedure(item), primary: true }, { label: "Excluir", onClick: () => removeProcedure(item), danger: true }]} />}
          empty="Cadastre um procedimento para detalhar a execução do serviço."
          emptyFiltered="Nenhum procedimento corresponde aos filtros aplicados."
        />
      </div>}

      {tab === "realizados" && <div className="panel">
        <CrudHeader title="Serviços realizados" subtitle="Registros criados ao finalizar um agendamento. Não é possível criar um atendimento manualmente aqui." />
        <DataView
          rows={attendedAppointments}
          defaultSort={{ key: "appointment_date", dir: "desc" }}
          searchPlaceholder="Buscar por cliente, serviço, profissional ou região"
          filters={[{ key: "professional_name", label: "Profissional", type: "select", options: [...new Set(attendedAppointments.map((item) => item.professional_name).filter(Boolean))].sort().map((value) => ({ value, label: value })), match: (item, value) => item.professional_name === value }]}
          columns={[
            { key: "appointment_date", label: "Data", value: (item) => `${item.appointment_date || ""} ${item.appointment_time || ""}`, render: (item) => <>{formatDate(item.appointment_date)}{item.appointment_time && ` · ${item.appointment_time}`}</> },
            { key: "client", label: "Cliente", value: (item) => `${personName(item)} ${item.whatsapp || ""}`, render: (item) => personName(item) },
            { key: "service", label: "Serviço", value: (item) => `${item.service_name || ""} ${item.procedure || ""} ${item.piercing_region || ""}`, render: (item) => <><strong>{item.service_name || item.procedure || "Atendimento"}</strong>{item.piercing_region && <><br /><small>{item.piercing_region}</small></>}</> },
            { key: "professional_name", label: "Profissional", value: (item) => item.professional_name || "—", render: (item) => item.professional_name || "—" },
            { key: "total_value", label: "Valor do atendimento", value: (item) => asNumber(item.total_value), render: (item) => currency.format(item.total_value || 0) },
            { key: "status", label: "Status", value: (item) => attendedStatus(item.status), render: (item) => <StatusBadge status={attendedStatus(item.status)} /> }
          ]}
          actions={() => <RowActions actions={[{ label: "Abrir na Agenda", onClick: () => onNavigate?.("agenda"), primary: true }]} />}
          empty="Nenhum serviço realizado ainda. Finalize um agendamento para ele aparecer aqui."
          emptyFiltered="Nenhum atendimento corresponde aos filtros aplicados."
        />
      </div>}

      <Modal open={serviceModalOpen} title={editingServiceId ? "Editar serviço" : "Novo serviço"} subtitle="O serviço será disponibilizado para a Agenda." onClose={() => setServiceModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setServiceModalOpen(false)}>Cancelar</Button><Button type="submit" form="service-form">{editingServiceId ? "Salvar alterações" : "Salvar serviço"}</Button></>}>
        <form id="service-form" onSubmit={saveService}>
          <div className="form-grid">
            <Input label="Nome" value={serviceForm.name} onChange={(value) => setServiceForm({ ...serviceForm, name: value })} required />
            <Input type="number" label="Duração em minutos" value={serviceForm.duration_minutes} onChange={(value) => setServiceForm({ ...serviceForm, duration_minutes: value })} />
            <Input type="number" label="Preço base" value={serviceForm.base_price} onChange={(value) => setServiceForm({ ...serviceForm, base_price: value })} />
            <Input type="number" label="Sinal sugerido" value={serviceForm.deposit_value} onChange={(value) => setServiceForm({ ...serviceForm, deposit_value: value })} />
          </div>
          <Textarea label="Descrição" value={serviceForm.description} onChange={(value) => setServiceForm({ ...serviceForm, description: value })} />
          <Textarea label="Orientações pré-serviço" value={serviceForm.pre_service_notes || ""} onChange={(value) => setServiceForm({ ...serviceForm, pre_service_notes: value })} />
          <Switch label="Serviço ativo para novos agendamentos" checked={Boolean(serviceForm.is_active)} onChange={(value) => setServiceForm({ ...serviceForm, is_active: value })} />
          {serviceError && <span className="form-error">{serviceError}</span>}
        </form>
      </Modal>

      <Modal open={procedureModalOpen} title={editingProcedureId ? "Editar procedimento" : "Novo procedimento"} subtitle="O procedimento detalha o serviço selecionado na Agenda." onClose={() => setProcedureModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setProcedureModalOpen(false)}>Cancelar</Button><Button type="submit" form="procedure-form">{editingProcedureId ? "Salvar alterações" : "Salvar procedimento"}</Button></>}>
        <form id="procedure-form" onSubmit={saveProcedure}>
          <div className="form-grid">
            <Select label="Serviço" value={procedureForm.service_id} onChange={(value) => setProcedureForm({ ...procedureForm, service_id: value })} required><option value="">Selecione</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
            <Input label="Nome" value={procedureForm.name} onChange={(value) => setProcedureForm({ ...procedureForm, name: value })} required />
            <Input label="Área do corpo" value={procedureForm.body_area} onChange={(value) => setProcedureForm({ ...procedureForm, body_area: value })} />
            <Input type="number" label="Preço" value={procedureForm.price} onChange={(value) => setProcedureForm({ ...procedureForm, price: value })} />
            <Input type="number" label="Duração em minutos" value={procedureForm.duration_minutes} onChange={(value) => setProcedureForm({ ...procedureForm, duration_minutes: value })} />
          </div>
          <Textarea label="Descrição" value={procedureForm.description} onChange={(value) => setProcedureForm({ ...procedureForm, description: value })} />
          <Textarea label="Instruções de pós-atendimento" value={procedureForm.aftercare_instructions} onChange={(value) => setProcedureForm({ ...procedureForm, aftercare_instructions: value })} />
          <Switch label="Procedimento ativo" checked={Boolean(procedureForm.is_active)} onChange={(value) => setProcedureForm({ ...procedureForm, is_active: value })} />
          {procedureError && <span className="form-error">{procedureError}</span>}
        </form>
      </Modal>

      <ConfirmDeleteModal open={!!deleting} message={deleting?.message} onClose={() => setDeleting(null)} onConfirm={async () => { await deleting.run(); setDeleting(null); }} />
    </section>
  );
}
