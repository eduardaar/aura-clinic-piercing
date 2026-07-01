// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { ChevronRight, FileSignature, HeartPulse, Search, UsersRound } from "lucide-react";
import { Input, Select } from "../../components/common/Ui";
import { Modal, CrudHeader, DataTable, ConfirmDeleteModal } from "../../components/common/Crud";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, dateInputValue, formatDate, formatLongDate } from "../../lib/utils";
import { API_ORIGIN, apiFetch, useFetch } from "../../lib/api";
import { defaultMedicalRecord } from "../../lib/defaultForms";
import { matchesClientSearch, whatsappUrl } from "../../features/shared/helpers";
import { DigitalTerms } from "../terms/DigitalTerms";
import { PostCare } from "../postcare/PostCare";

export function ClientWorkspace() {
  const [tab, setTab] = useState("clientes");
  const tabs = [
    { id: "clientes", title: "Clientes", description: "Histórico, prontuários, pagamentos e fidelidade.", icon: UsersRound },
    { id: "termos", title: "Termos digitais", description: "Assinatura, aceite, PDF e vínculo ao agendamento.", icon: FileSignature },
    { id: "retornos", title: "Pós-atendimento", description: "Lembretes, fotos, status de cicatrização e retornos.", icon: HeartPulse }
  ];
  return (
    <section className="workspace-page">
      <div className="workspace-hub">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={20} />
            <span><strong>{title}</strong><small>{description}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      <div className="workspace-panel">
        {tab === "clientes" && <ClientsMedical />}
        {tab === "termos" && <DigitalTerms />}
        {tab === "retornos" && <PostCare />}
      </div>
    </section>
  );
}

export function ClientsMedical() {
  const { data, refresh } = useFetch("/clients");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const clients = asArray(data);
  const filteredClients = clients.filter((client) => matchesClientSearch(client, search));

  function openNew() {
    setEditing(null);
    setError("");
    setModalOpen(true);
  }

  function openEdit(client) {
    setEditing(client);
    setError("");
    setModalOpen(true);
  }

  async function removeClient(client) {
    setError("");
    const response = await apiFetch(`/clients/${client.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || "Não foi possível excluir o cliente.");
      return;
    }
    if (editing && editing.id === client.id) {
      setEditing(null);
      setModalOpen(false);
    }
    refresh();
  }

  return (
    <section className="stack">
      <div className="panel">
        <CrudHeader
          title="Clientes"
          subtitle="Base de clientes da Aura Clinic"
          actionLabel="Novo cliente"
          onAction={openNew}
        />
        <label className="client-search">
          <Search size={17} />
          <input placeholder="Pesquisar cliente, WhatsApp ou Instagram" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {error && <span className="form-error">{error}</span>}
        <DataTable
          rows={filteredClients}
          columns={[
            { key: "name", label: "Nome" },
            { key: "whatsapp", label: "WhatsApp", render: (client) => client.whatsapp || "—" },
            { key: "instagram", label: "Instagram", render: (client) => client.instagram || "sem Instagram" },
            { key: "contact", label: "Contato", render: (client) => (
              <span>{client.phone || "Sem telefone"} · {client.email || "Sem e-mail"}</span>
            ) },
          ]}
          actions={(client) => (
            <>
              <a className="secondary-button" href={whatsappUrl(client.whatsapp, `Ola ${client.name}, tudo bem Aqui e da Aura Clinic.`)} target="_blank" rel="noreferrer">WhatsApp</a>
              <button type="button" onClick={() => openEdit(client)}>Editar</button>
              <button type="button" onClick={() => setDeleting({ message: `Excluir ${client.name}?`, run: () => removeClient(client) })}>Apagar</button>
            </>
          )}
          empty={clients.length ? "Nenhum cliente encontrado." : "Você ainda não possui clientes cadastrados."}
        />
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Editar cliente" : "Novo cliente"}
        subtitle="Dados cadastrais do cliente"
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" form="client-form" className="primary-button">{editing ? "Salvar alterações" : "Salvar cliente"}</button>
          </>
        )}
      >
        <ClientEditForm
          key={editing ? editing.id : "new"}
          formId="client-form"
          client={editing || undefined}
          onSaved={() => {
            setModalOpen(false);
            setEditing(null);
            refresh();
          }}
        />
      </Modal>

      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
    </section>
  );
}

export function ClientEditForm({ client, onSaved, onCancel, formId }) {
  const [form, setForm] = useState({
    name: client?.name || "",
    phone: client?.phone || "",
    whatsapp: client?.whatsapp || "",
    instagram: client?.instagram || "",
    email: client?.email || "",
    birth_date: dateInputValue(client?.birth_date),
    cpf: client?.cpf || "",
    notes: client?.notes || ""
  });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(client?.id ? `/clients/${client.id}` : "/clients", {
      method: client?.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar o cliente.");
    onSaved();
  }

  return (
    <form id={formId} className="client-edit-form" onSubmit={submit}>
      <div className="form-grid">
        <Input label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
        <Input label="Telefone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} />
        <Input label="Instagram" value={form.instagram} onChange={(value) => setForm({ ...form, instagram: value })} />
        <Input label="E-mail" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
        <Input label="CPF" value={form.cpf} onChange={(value) => setForm({ ...form, cpf: value })} />
        <Input type="date" label="Nascimento" value={form.birth_date} onChange={(value) => setForm({ ...form, birth_date: value })} />
      </div>
      <label>Observacoes importantes
        <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      </label>
      {error && <span className="form-error">{error}</span>}
      {!formId && (
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>
          <button className="primary-button">Salvar cliente</button>
        </div>
      )}
    </form>
  );
}

export function MedicalRecordForm({ client, onSaved }) {
  const [record, setRecord] = useState(defaultMedicalRecord());
  const [files, setFiles] = useState({ before_photo: null, after_photo: null });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const formData = new FormData();
    Object.entries(record).forEach(([key, value]) => formData.append(key, value));
    if (files.before_photo) formData.append("before_photo", files.before_photo);
    if (files.after_photo) formData.append("after_photo", files.after_photo);
    const response = await apiFetch(`/clients/${client.id}/medical-records`, { method: "POST", body: formData });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar o prontuário.");
    setRecord(defaultMedicalRecord());
    setFiles({ before_photo: null, after_photo: null });
    event.currentTarget.reset();
    onSaved();
  }

  return (
    <form className="medical-form" onSubmit={submit}>
      <h3>Novo registro de prontuário</h3>
      <div className="form-grid">
        <Input type="date" label="Data do registro" value={record.record_date} onChange={(value) => setRecord({ ...record, record_date: value })} />
        <Select label="Atendimento vinculado" value={record.appointment_id} onChange={(value) => setRecord({ ...record, appointment_id: value })}>
          <option value="">Sem vínculo</option>
          {asArray(client.history).map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} · {item.procedure}</option>)}
        </Select>
      </div>
      <label>Histórico de perfurações
        <textarea value={record.piercing_history} onChange={(event) => setRecord({ ...record, piercing_history: event.target.value })} />
      </label>
      <label>Joias usadas
        <textarea value={record.jewelry_used} onChange={(event) => setRecord({ ...record, jewelry_used: event.target.value })} />
      </label>
      <div className="form-grid">
        <label>Foto antes
          <input type="file" accept="image/*" onChange={(event) => setFiles({ ...files, before_photo: event.target.files[0] })} />
        </label>
        <label>Foto depois
          <input type="file" accept="image/*" onChange={(event) => setFiles({ ...files, after_photo: event.target.files[0] })} />
        </label>
      </div>
      <label>Intercorrências
        <textarea value={record.occurrences} onChange={(event) => setRecord({ ...record, occurrences: event.target.value })} />
      </label>
      <label>Orientações passadas
        <textarea value={record.guidance} onChange={(event) => setRecord({ ...record, guidance: event.target.value })} />
      </label>
      <label>Alergias ou observações importantes
        <textarea value={record.allergies_notes} onChange={(event) => setRecord({ ...record, allergies_notes: event.target.value })} />
      </label>
      <label>Evolução da cicatrização
        <textarea value={record.healing_evolution} onChange={(event) => setRecord({ ...record, healing_evolution: event.target.value })} />
      </label>
      <label>Retornos realizados
        <textarea value={record.returns_done} onChange={(event) => setRecord({ ...record, returns_done: event.target.value })} />
      </label>
      {error && <span className="form-error">{error}</span>}
      <button className="primary-button">Salvar prontuário</button>
    </form>
  );
}

export function MedicalRecordTimeline({ client, onChanged }) {
  const [deleting, setDeleting] = useState(null);

  async function remove(recordId) {
    await apiFetch(`/clients/${client.id}/medical-records/${recordId}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="medical-section">
      <h3>Prontuário individual</h3>
      <div className="medical-timeline">
        {asArray(client.medicalRecords).length ? asArray(client.medicalRecords).map((record) => (
          <article className="record-entry" key={record.id}>
            <header>
              <div>
                <strong>{formatLongDate(record.record_date)}</strong>
                <span>{record.procedure || "Registro avulso"} · {record.piercing_region || "sem região vinculada"}</span>
              </div>
              <button onClick={() => setDeleting({ message: "Excluir este registro do prontuário?", run: () => remove(record.id) })}>Apagar</button>
            </header>
            <div className="record-photos">
              {record.before_photo_url && (
  <figure>
    <img src={`${API_ORIGIN}${record.before_photo_url}`} alt="Antes" />
    <figcaption>Antes</figcaption>
  </figure>
)}

{record.after_photo_url && (
  <figure>
    <img src={`${API_ORIGIN}${record.after_photo_url}`} alt="Depois" />
    <figcaption>Depois</figcaption>
  </figure>
)}
            </div>
            <dl className="record-details">
              <div><dt>Joias usadas</dt><dd>{record.jewelry_used || record.appointment_jewelry || "Não informado"}</dd></div>
              <div><dt>Intercorrências</dt><dd>{record.occurrences || "Sem intercorrências registradas"}</dd></div>
              <div><dt>Orientações</dt><dd>{record.guidance || "Não informado"}</dd></div>
              <div><dt>Alergias/observações</dt><dd>{record.allergies_notes || client.notes || "Não informado"}</dd></div>
              <div><dt>Evolução</dt><dd>{record.healing_evolution || "Não informado"}</dd></div>
              <div><dt>Retornos</dt><dd>{record.returns_done || "Não informado"}</dd></div>
            </dl>
          </article>
        )) : <p className="empty-state">Nenhum registro de prontuário ainda.</p>}
      </div>

      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
    </div>
  );
}

