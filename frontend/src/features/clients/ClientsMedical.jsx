// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { ChevronRight, FileSignature, HeartPulse, Instagram, Plus, Search, UsersRound } from "lucide-react";
import { Input, Select } from "../../components/common/Ui";
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
  const [editingClientId, setEditingClientId] = useState(null);
  const [creatingClient, setCreatingClient] = useState(false);
  const [error, setError] = useState("");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const clients = asArray(data);
  const filteredClients = clients.filter((client) => matchesClientSearch(client, search));

  async function removeClient(client) {
    if (!window.confirm(`Excluir ${client.name}?`)) return;
    setError("");
    const response = await apiFetch(`/clients/${client.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || "Não foi possível excluir o cliente.");
      return;
    }
    if (editingClientId === client.id) setEditingClientId(null);
    refresh();
  }

  return (
    <section className="medical-client-list simplified-client-list">
      <div className="panel-heading">
        <label className="client-search">
          <Search size={17} />
          <input placeholder="Pesquisar cliente, WhatsApp ou Instagram" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="button" className="primary-button" onClick={() => setCreatingClient(true)}>
          <Plus size={16} /> Novo cliente
        </button>
      </div>
      {creatingClient && (
        <article className="panel medical-card simplified-client-card">
          <ClientEditForm
            onCancel={() => setCreatingClient(false)}
            onSaved={() => {
              setCreatingClient(false);
              refresh();
            }}
          />
        </article>
      )}
      {error && <span className="form-error">{error}</span>}
      {filteredClients.map((client) => (
        <article className="panel medical-card simplified-client-card" key={client.id}>
          <div className="medical-header compact">
            <div>
              <h2>{client.name}</h2>
              <p>{client.whatsapp} · {client.instagram || "sem Instagram"}</p>
            </div>
            <div className="header-actions">
              <span className="status-badge status-atendido">Cliente Aura</span>
              <a className="secondary-button" href={whatsappUrl(client.whatsapp, `Ola ${client.name}, tudo bem Aqui e da Aura Clinic.`)} target="_blank" rel="noreferrer">WhatsApp</a>
              <button type="button" className="secondary-button" onClick={() => setEditingClientId(editingClientId === client.id ? null : client.id)}>Editar</button>
              <button type="button" className="danger-link" onClick={() => removeClient(client)}>Excluir</button>
            </div>
          </div>
          {client.birth_date && <small className="client-birth">Aniversário: {formatLongDate(client.birth_date)}</small>}
          {editingClientId === client.id && (
            <ClientEditForm
              client={client}
              onCancel={() => setEditingClientId(null)}
              onSaved={() => {
                setEditingClientId(null);
                refresh();
              }}
            />
          )}
          <div className="medical-summary-line">
            <span>Telefone: {client.phone || "Sem registro"}</span>
            <span>E-mail: {client.email || "Sem registro"}</span>
            <span>CPF: {client.cpf || "Sem registro"}</span>
          </div>
        </article>
      ))}
      {!clients.length && !creatingClient && <p className="empty-state">Você ainda não possui clientes cadastrados.</p>}
      {clients.length > 0 && !filteredClients.length && <p className="empty-state">Nenhum cliente encontrado.</p>}
    </section>
  );
}

export function ClientEditForm({ client, onSaved, onCancel }) {
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
    <form className="client-edit-form" onSubmit={submit}>
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
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>
        <button className="primary-button">Salvar cliente</button>
      </div>
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
              <button onClick={() => remove(record.id)}>Apagar</button>
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
    </div>
  );
}

