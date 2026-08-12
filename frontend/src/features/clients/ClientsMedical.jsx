// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useState } from "react";
import { ChevronRight, FileSignature, HeartPulse, UsersRound } from "lucide-react";
import { Button, Input, SecureImage, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, RowActions } from "../../components/common/Crud";
import { DataView, MONTH_OPTIONS } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, dateInputValue, formatDate, formatLongDate } from "../../lib/utils";
import { apiFetch, readStoredSession, useApiInvalidate, useFetch } from "../../lib/api";
import { defaultMedicalRecord } from "../../lib/defaultForms";
import { currency, personName, whatsappUrl } from "../../features/shared/helpers";
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
  const { data } = useFetch("/clients");
  // Uma invalidação de "/clients" cobre a listagem, os filtros e o detalhe
  // "/clients/:id"; o dashboard conta clientes, então acompanha.
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/clients", "/dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [profile, setProfile] = useState(null);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const clients = asArray(data);

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

  const isAdmin = readStoredSession()?.user?.role === "admin";

  async function openDeletion(client) {
    setError("");
    const response = await apiFetch(`/clients/${client.id}/deletion-impact`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível analisar o cadastro.");
    setDeleting({ client, impact: payload.impact || {}, action: payload.action, confirmation: "", reason: "", busy: false });
  }

  async function removeClient() {
    const client = deleting?.client;
    if (!client) return;
    setDeleting({ ...deleting, busy: true });
    setError("");
    const response = await apiFetch(`/clients/${client.id}`, { method: "DELETE", body: JSON.stringify({ confirmation: deleting.confirmation, reason: deleting.reason }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || "Não foi possível excluir o cliente.");
      setDeleting({ ...deleting, busy: false });
      return;
    }
    if (editing && editing.id === client.id) {
      setEditing(null);
      setModalOpen(false);
    }
    refresh();
    setDeleting(null);
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
        {error && <span className="form-error">{error}</span>}
        <DataView
          rows={clients}
          defaultSort={{ key: "full_name", dir: "asc" }}
          searchPlaceholder="Buscar por nome, WhatsApp, Instagram, e-mail ou telefone"
          filters={[
            {
              key: "contato",
              label: "Contato cadastrado",
              type: "select",
              options: [
                { value: "whatsapp", label: "Com WhatsApp" },
                { value: "email", label: "Com e-mail" },
                { value: "instagram", label: "Com Instagram" },
                { value: "incompleto", label: "Sem e-mail e sem telefone" },
              ],
              match: (client, value) => {
                if (value === "whatsapp") return Boolean(client.whatsapp);
                if (value === "email") return Boolean(client.email);
                if (value === "instagram") return Boolean(client.instagram);
                return !client.email && !client.phone;
              },
            },
            {
              key: "aniversario",
              label: "Aniversário no mês",
              type: "select",
              options: MONTH_OPTIONS,
              match: (client, value) => String(client.birth_date || "").slice(5, 7) === value,
            },
          ]}
          columns={[
            { key: "full_name", label: "Nome", value: (client) => personName(client), render: (client) => personName(client) },
            { key: "whatsapp", label: "WhatsApp", render: (client) => client.whatsapp || "—" },
            { key: "instagram", label: "Instagram", render: (client) => client.instagram || "sem Instagram" },
            {
              key: "contact",
              label: "Contato",
              value: (client) => `${client.phone || ""} ${client.email || ""}`,
              render: (client) => (
                <span>{client.phone || "Sem telefone"} · {client.email || "Sem e-mail"}</span>
              ),
            },
          ]}
          actions={(client) => (
            <RowActions
              actions={[
                { label: "Ver perfil", onClick: () => setProfile(client), primary: true },
                { label: "Editar", onClick: () => openEdit(client) },
                { label: "WhatsApp", href: whatsappUrl(client.whatsapp, `Olá, ${personName(client)}, tudo bem? Aqui é da Aura Clinic. Estamos entrando em contato para confirmar informações, acompanhar seu atendimento ou informar uma atualização importante.`), target: "_blank", rel: "noreferrer" },
                ...(isAdmin ? [{ label: "Excluir cliente", onClick: () => openDeletion(client), danger: true }] : []),
              ]}
            />
          )}
          empty="Você ainda não possui clientes cadastrados."
        />
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Editar cliente" : "Novo cliente"}
        subtitle="Dados cadastrais do cliente"
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" form="client-form" variant="primary">{editing ? "Salvar alterações" : "Salvar cliente"}</Button>
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

      <Modal open={!!deleting} title="Excluir cliente" subtitle="Análise segura do histórico" onClose={() => !deleting?.busy && setDeleting(null)} footer={<><Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleting?.busy}>Cancelar</Button><Button variant="danger" onClick={removeClient} disabled={deleting?.busy || deleting?.confirmation !== "EXCLUIR CLIENTE" || !deleting?.reason?.trim()}>{deleting?.busy ? "Processando…" : deleting?.action === "anonymize" ? "Anonimizar e arquivar" : "Excluir definitivamente"}</Button></>}>
        {deleting && <div className="stack">
          <div className="soft-card"><strong>{personName(deleting.client)}</strong><p>{deleting.action === "anonymize" ? "Há histórico vinculado. Os dados pessoais serão anonimizados e o histórico financeiro/clínico será preservado." : "Não há histórico vinculado. O cadastro será excluído definitivamente."}</p></div>
          <div className="summary-grid">{Object.entries(deleting.impact).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")}: <strong>{value}</strong></span>)}</div>
          <Input label="Motivo obrigatório" value={deleting.reason} onChange={(reason) => setDeleting({ ...deleting, reason })} />
          <Input label="Digite EXCLUIR CLIENTE" value={deleting.confirmation} onChange={(confirmation) => setDeleting({ ...deleting, confirmation })} />
        </div>}
      </Modal>
      {profile && (
        <Modal open title={personName(profile)} subtitle="Timeline, histórico clínico e relacionamento" size="lg" onClose={() => setProfile(null)}
          footer={<Button variant="secondary" onClick={() => setProfile(null)}>Fechar</Button>}>
          <ClientProfileLoader clientId={profile.id} fallback={profile} onChanged={refresh} />
        </Modal>
      )}
    </section>
  );
}

// A lista de clientes é enxuta (só as colunas da tabela): histórico, pagamentos,
// prontuários e fidelidade vêm de /clients/:id, sob demanda. Antes tudo isso
// vinha embutido na listagem, que chegava a 845 KB.
function ClientProfileLoader({ clientId, fallback, onChanged }) {
  const { data } = useFetch(`/clients/${clientId}`);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  // `onChanged` já invalida "/clients" inteiro — o detalhe recarrega junto.
  return <ClientProfile client={{ ...fallback, ...data }} onChanged={() => onChanged?.()} />;
}

function ClientProfile({ client, onChanged }) {
  const timeline = asArray(client.timeline);
  const paid = asArray(client.payments).filter((item) => item.status === "pago").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return (
    <div className="stack">
      <div className="metric-grid">
        <article className="metric-card"><span>Atendimentos</span><strong>{asArray(client.history).length}</strong></article>
        <article className="metric-card"><span>Total pago</span><strong>{currency.format(paid)}</strong></article>
        <article className="metric-card"><span>Termos</span><strong>{asArray(client.terms).length}</strong></article>
        <article className="metric-card"><span>Retornos</span><strong>{asArray(client.followups).length}</strong></article>
        <article className="metric-card"><span>Fidelidade</span><strong>{client.loyalty?.availablePoints || 0} pts</strong></article>
      </div>
      <section className="detail-card">
        <h3>Preferências e observações</h3>
        <p>{client.notes || "Nenhuma observação cadastrada."}</p>
        <small>{client.whatsapp} · {client.email || "sem e-mail"} · {client.instagram || "sem Instagram"}</small>
      </section>
      <section className="detail-card">
        <h3>Timeline completa</h3>
        <div className="medical-timeline">
          {timeline.map((item, index) => (
            <article className="record-entry" key={`${item.type}-${item.date}-${index}`}>
              <header><div><strong>{item.title}</strong><span>{formatLongDate(String(item.date || "").slice(0, 10))} · {item.type}</span></div><StatusBadge status={item.status}>{item.status}</StatusBadge></header>
              {item.value !== undefined && <small>{currency.format(Number(item.value || 0))}</small>}
            </article>
          ))}
          {!timeline.length && <p className="empty-state">Nenhum evento registrado para esta cliente.</p>}
        </div>
      </section>
      <MedicalRecordForm client={client} onSaved={onChanged} />
      <MedicalRecordTimeline client={client} onChanged={onChanged} />
    </div>
  );
}

export function ClientEditForm({ client, onSaved, onCancel, formId }) {
  const [form, setForm] = useState({
    full_name: client?.full_name || "",
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
        <Input label="Nome" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required />
        <Input label="Telefone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} required />
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
          <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary">Salvar cliente</Button>
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
      <Button variant="primary">Salvar prontuário</Button>
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
              <button onClick={() => setDeleting({ message: "Excluir este registro do prontuário?", run: () => remove(record.id) })}>Excluir</button>
            </header>
            <div className="record-photos">
              {record.before_photo_url && (
  <figure>
    <SecureImage src={record.before_photo_url} alt="Antes" />
    <figcaption>Antes</figcaption>
  </figure>
)}

{record.after_photo_url && (
  <figure>
    <SecureImage src={record.after_photo_url} alt="Depois" />
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
