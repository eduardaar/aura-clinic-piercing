import { useState } from "react";
import { Button, Input, Select, StatusBadge, Switch, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { defaultProcedureForm, defaultServiceForm } from "../../lib/defaultForms";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { currency } from "../shared/helpers";

function rowsOf(value) {
  return asArray(value).length ? asArray(value) : asArray(asObject(value).items);
}

export function ServicesWorkspace() {
  const { data: servicesData } = useFetch("/services");
  const { data: proceduresData } = useFetch("/procedures");
  const invalidate = useApiInvalidate();
  const [serviceForm, setServiceForm] = useState(defaultServiceForm());
  const [procedureForm, setProcedureForm] = useState(defaultProcedureForm());
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [editingProcedureId, setEditingProcedureId] = useState(null);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [procedureModalOpen, setProcedureModalOpen] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [procedureError, setProcedureError] = useState("");
  const [deleting, setDeleting] = useState(null);

  if (servicesData == null || proceduresData == null) return <Loading />;
  const services = rowsOf(servicesData);
  const procedures = rowsOf(proceduresData);
  const selectedService = services.find((item) => String(item.id) === String(selectedServiceId));
  const serviceVariations = procedures.filter((item) => String(item.service_id) === String(selectedServiceId));
  const refreshCatalog = () => invalidate("/services", "/procedures", "/options", "/booking/readiness");

  function openNewService() {
    setEditingServiceId(null);
    setServiceForm(defaultServiceForm());
    setServiceError("");
    setServiceModalOpen(true);
  }

  function editService(service) {
    setEditingServiceId(service.id);
    setServiceForm({ ...defaultServiceForm(), name: service.name || "", description: service.description || "", base_price: service.base_price ?? service.price ?? 0, deposit_value: service.deposit_value ?? 0, duration_minutes: service.duration_minutes || 40, is_active: Boolean(Number(service.is_active ?? service.active_online_booking)), pre_service_notes: service.pre_service_notes || "" });
    setServiceError("");
    setServiceModalOpen(true);
  }

  async function saveService(event) {
    event.preventDefault();
    if (!serviceForm.name.trim()) return setServiceError("Informe o nome do serviço.");
    if (Number(serviceForm.base_price || 0) < 0) return setServiceError("Preço não pode ser negativo.");
    if (Number(serviceForm.deposit_value || 0) < 0) return setServiceError("Sinal não pode ser negativo.");
    if (Number(serviceForm.duration_minutes || 0) <= 0) return setServiceError("Duração deve ser um número positivo.");
    setServiceError("");
    const response = await apiFetch(editingServiceId ? `/services/${editingServiceId}` : "/services", { method: editingServiceId ? "PUT" : "POST", body: JSON.stringify(serviceForm) });
    if (!response.ok) return setServiceError((await response.json().catch(() => ({}))).error || "Não foi possível salvar o serviço.");
    setServiceModalOpen(false);
    refreshCatalog();
  }

  function removeService(service) {
    setDeleting({ message: `Excluir ${service.name}? Se já houver uso, ele será arquivado e deixará de aparecer para novos agendamentos.`, run: async () => {
      const response = await apiFetch(`/services/${service.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível excluir o serviço.");
      if (String(selectedServiceId) === String(service.id)) setSelectedServiceId(null);
      refreshCatalog();
    } });
  }

  function openNewVariation(service = selectedService) {
    setEditingProcedureId(null);
    setProcedureForm({ ...defaultProcedureForm(), service_id: String(service?.id || "") });
    setProcedureError("");
    setProcedureModalOpen(true);
  }

  function editVariation(procedure) {
    setEditingProcedureId(procedure.id);
    setProcedureForm({ ...defaultProcedureForm(), service_id: String(procedure.service_id || ""), name: procedure.name || "", body_area: procedure.body_area || "", description: procedure.description || "", price: procedure.price || 0, duration_minutes: procedure.duration_minutes || 40, aftercare_instructions: procedure.aftercare_instructions || "", is_active: Boolean(Number(procedure.is_active)) });
    setProcedureError("");
    setProcedureModalOpen(true);
  }

  async function saveVariation(event) {
    event.preventDefault();
    if (!procedureForm.service_id) return setProcedureError("Escolha o serviço do catálogo.");
    if (!procedureForm.name.trim()) return setProcedureError("Informe o nome da variação.");
    if (Number(procedureForm.price || 0) < 0) return setProcedureError("Preço não pode ser negativo.");
    if (Number(procedureForm.duration_minutes || 0) <= 0) return setProcedureError("Duração deve ser um número positivo.");
    setProcedureError("");
    const response = await apiFetch(editingProcedureId ? `/procedures/${editingProcedureId}` : "/procedures", { method: editingProcedureId ? "PUT" : "POST", body: JSON.stringify(procedureForm) });
    if (!response.ok) return setProcedureError((await response.json().catch(() => ({}))).error || "Não foi possível salvar a variação.");
    setSelectedServiceId(procedureForm.service_id);
    setProcedureModalOpen(false);
    refreshCatalog();
  }

  function removeVariation(procedure) {
    setDeleting({ message: `Excluir a variação ${procedure.name}?`, run: async () => {
      const response = await apiFetch(`/procedures/${procedure.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível excluir a variação.");
      refreshCatalog();
    } });
  }

  return (
    <section className="booking-admin-page stack">
      <header className="availability-header agenda-settings-header"><div><span className="eyebrow">Configuração da Agenda</span><h2>Catálogo de serviços</h2><p>Configure o que a clínica oferece. O atendimento começa e termina exclusivamente na Agenda.</p></div></header>
      <div className="panel">
        <CrudHeader title="Serviços disponíveis" subtitle="Preço, duração, sinal e orientações usados nos agendamentos." actionLabel="Novo serviço" onAction={openNewService} />
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
            { key: "is_active", label: "Status", render: (item) => <StatusBadge status={Boolean(Number(item.is_active ?? item.active_online_booking)) ? "Ativo" : "Inativo"} /> }
          ]}
          actions={(item) => <RowActions actions={[{ label: "Variações clínicas", onClick: () => setSelectedServiceId(item.id), primary: true }, { label: "Editar", onClick: () => editService(item) }, { label: "Excluir", onClick: () => removeService(item), danger: true }]} />}
          empty="Cadastre o primeiro serviço para liberar a Agenda e o agendamento online."
          emptyFiltered="Nenhum serviço corresponde aos filtros aplicados."
        />
      </div>

      {selectedService && <div className="panel">
        <CrudHeader title={`Variações de ${selectedService.name}`} subtitle="Detalhes opcionais por região, técnica, preço ou pós-atendimento." actionLabel="Nova variação" onAction={() => openNewVariation(selectedService)} />
        <DataView rows={serviceVariations} defaultSort={{ key: "name", dir: "asc" }} searchPlaceholder="Buscar variação ou região" columns={[
          { key: "name", label: "Variação clínica" },
          { key: "body_area", label: "Região", render: (item) => item.body_area || "—" },
          { key: "duration_minutes", label: "Duração", render: (item) => `${item.duration_minutes || 0} min` },
          { key: "price", label: "Preço", render: (item) => currency.format(item.price || 0) },
          { key: "is_active", label: "Status", render: (item) => <StatusBadge status={Boolean(Number(item.is_active)) ? "Ativo" : "Inativo"} /> }
        ]} actions={(item) => <RowActions actions={[{ label: "Editar", onClick: () => editVariation(item), primary: true }, { label: "Excluir", onClick: () => removeVariation(item), danger: true }]} />} empty="Este serviço não precisa de variações. Cadastre somente se a clínica usar esse detalhamento." emptyFiltered="Nenhuma variação corresponde à busca." />
      </div>}

      <Modal open={serviceModalOpen} title={editingServiceId ? "Editar serviço" : "Novo serviço"} subtitle="Configuração reutilizada em todos os agendamentos." onClose={() => setServiceModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setServiceModalOpen(false)}>Cancelar</Button><Button type="submit" form="service-form">Salvar serviço</Button></>}>
        <form id="service-form" onSubmit={saveService} className="stack"><div className="form-grid">
          <Input label="Nome" value={serviceForm.name} onChange={(value) => setServiceForm({ ...serviceForm, name: value })} required />
          <Input type="number" label="Duração em minutos" value={serviceForm.duration_minutes} onChange={(value) => setServiceForm({ ...serviceForm, duration_minutes: Number(value) })} />
          <Input type="number" label="Preço base" value={serviceForm.base_price} onChange={(value) => setServiceForm({ ...serviceForm, base_price: Number(value) })} />
          <Input type="number" label="Sinal sugerido" value={serviceForm.deposit_value} onChange={(value) => setServiceForm({ ...serviceForm, deposit_value: Number(value) })} />
        </div><Textarea label="Descrição" value={serviceForm.description} onChange={(value) => setServiceForm({ ...serviceForm, description: value })} /><Textarea label="Orientações pré-atendimento (opcional)" value={serviceForm.pre_service_notes || ""} onChange={(value) => setServiceForm({ ...serviceForm, pre_service_notes: value })} /><Switch id="service-active" label="Disponível para novos agendamentos" description="" defaultChecked={undefined} checked={Boolean(serviceForm.is_active)} onChange={(value) => setServiceForm({ ...serviceForm, is_active: value })} />{serviceError && <span className="form-error">{serviceError}</span>}</form>
      </Modal>

      <Modal open={procedureModalOpen} title={editingProcedureId ? "Editar variação clínica" : "Nova variação clínica"} subtitle="Opcional: detalhe região, técnica ou orientação específica sem criar outro fluxo operacional." onClose={() => setProcedureModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setProcedureModalOpen(false)}>Cancelar</Button><Button type="submit" form="variation-form">Salvar variação</Button></>}>
        <form id="variation-form" onSubmit={saveVariation} className="stack"><div className="form-grid">
          <Select label="Serviço do catálogo" value={procedureForm.service_id} onChange={(value) => setProcedureForm({ ...procedureForm, service_id: value })} required><option value="">Selecione</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Input label="Nome da variação" value={procedureForm.name} onChange={(value) => setProcedureForm({ ...procedureForm, name: value })} required />
          <Input label="Região do corpo (opcional)" value={procedureForm.body_area} onChange={(value) => setProcedureForm({ ...procedureForm, body_area: value })} />
          <Input type="number" label="Preço" value={procedureForm.price} onChange={(value) => setProcedureForm({ ...procedureForm, price: Number(value) })} />
          <Input type="number" label="Duração em minutos" value={procedureForm.duration_minutes} onChange={(value) => setProcedureForm({ ...procedureForm, duration_minutes: Number(value) })} />
        </div><Textarea label="Descrição (opcional)" value={procedureForm.description} onChange={(value) => setProcedureForm({ ...procedureForm, description: value })} /><Textarea label="Orientações pós-atendimento (opcional)" value={procedureForm.aftercare_instructions} onChange={(value) => setProcedureForm({ ...procedureForm, aftercare_instructions: value })} /><Switch id="variation-active" label="Variação ativa" description="" defaultChecked={undefined} checked={Boolean(procedureForm.is_active)} onChange={(value) => setProcedureForm({ ...procedureForm, is_active: value })} />{procedureError && <span className="form-error">{procedureError}</span>}</form>
      </Modal>
      <ConfirmDeleteModal open={!!deleting} message={deleting?.message} onClose={() => setDeleting(null)} onConfirm={async () => { await deleting.run(); setDeleting(null); }} />
    </section>
  );
}
