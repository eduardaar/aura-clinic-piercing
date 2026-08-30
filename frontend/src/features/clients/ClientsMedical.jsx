// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useEffect, useState } from "react";
import { FileSignature, HeartPulse } from "lucide-react";
import { Button, Checkbox, Input, SecureImage, Select, StatusBadge, Tabs, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, Modal, CrudHeader, RowActions } from "../../components/common/Crud";
import { DataView, MONTH_OPTIONS } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { AdvancedFields, FormSection, FormWorkflow, ValidationSummary } from "../../components/common/FormWorkflow";
import { asArray, asObject, dateInputValue, formatDate, formatLongDate } from "../../lib/utils";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import {
  BRAZIL_STATE_OPTIONS,
  formatBrazilianPhone,
  formatCep,
  formatCpf,
  normalizeEmailInput,
  normalizeInstagramInput,
  validateClientForm,
} from "../../lib/clientFields";
import { useFormDraft } from "../../lib/useFormDraft";
import { defaultMedicalRecord } from "../../lib/defaultForms";
import { currency, personName, whatsappUrl } from "../../features/shared/helpers";
import "./clients.css";

const TermsIcon = ({ size }) => <FileSignature size={size} />;
const PostCareIcon = ({ size }) => <HeartPulse size={size} />;

export function ClientWorkspace({ onNavigate, createSignal = 0 }) {
  return <ClientsMedical onNavigate={onNavigate} createSignal={createSignal} />;
}

export function ClientsMedical({ onNavigate, createSignal = 0 }) {
  const { data } = useFetch("/clients");
  // Uma invalidação de "/clients" cobre a listagem, os filtros e o detalhe
  // "/clients/:id"; o dashboard conta clientes, então acompanha.
  const invalidate = useApiInvalidate();
  const refresh = () => invalidate("/clients", "/dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [merging, setMerging] = useState(null);
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!createSignal) return;
    setEditing(null);
    setError("");
    setProfile(null);
    setModalOpen(true);
  }, [createSignal]);
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

  function openMerge(client) {
    setError("");
    setProfile(null);
    setMerging(client);
  }

  async function openDeletion(client) {
    setError("");
    const response = await apiFetch(`/clients/${client.id}/deletion-impact`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível analisar o cadastro.");
    setDeleting({
      client,
      impact: payload.impact || {},
      action: payload.action,
      confirmation: "",
      reason: "",
      busy: false,
    });
  }

  async function removeClient() {
    const client = deleting?.client;
    if (!client) return;
    setDeleting({ ...deleting, busy: true });
    setError("");
    const response = await apiFetch(`/clients/${client.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: deleting.confirmation, reason: deleting.reason }),
    });
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
    <section className="stack clients-page">
      <div className="panel">
        <CrudHeader
          title="Clientes"
          subtitle="Base de clientes da Aura Clinic"
          actions={[
            { label: "Termos digitais", icon: TermsIcon, onClick: () => onNavigate?.("terms") },
            { label: "Pós-atendimento", icon: PostCareIcon, onClick: () => onNavigate?.("postcare") },
          ]}
          actionLabel="Novo cliente"
          onAction={openNew}
        />
        {error && <span className="form-error">{error}</span>}
        <DataView
          rows={clients}
          defaultSort={{ key: "full_name", dir: "asc" }}
          searchPlaceholder="Buscar por nome, CPF, telefone, e-mail ou Instagram"
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
            {
              key: "full_name",
              label: "Cliente",
              value: (client) =>
                `${client.full_name || ""} ${client.social_name || ""} ${client.cpf || ""} ${formatCpf(client.cpf)}`,
              render: (client) => (
                <span className="client-list-name">
                  <strong>{client.social_name || personName(client)}</strong>
                  {client.social_name && <small>{client.full_name}</small>}
                </span>
              ),
            },
            {
              key: "whatsapp",
              label: "WhatsApp",
              value: (client) => client.whatsapp,
              render: (client) => formatBrazilianPhone(client.whatsapp) || "—",
            },
            { key: "instagram", label: "Instagram", render: (client) => client.instagram || "sem Instagram" },
            {
              key: "contact",
              label: "Contato",
              value: (client) =>
                `${client.phone || ""} ${formatBrazilianPhone(client.phone)} ${client.email || ""} ${client.postal_code || ""} ${formatCep(client.postal_code)}`,
              render: (client) => (
                <span>
                  {formatBrazilianPhone(client.phone) || "Sem telefone"} · {client.email || "Sem e-mail"}
                </span>
              ),
            },
          ]}
          actions={(client) => (
            <div className="client-row-actions">
              <Button variant="ghost" onClick={() => setProfile(client)}>
                Ver perfil
              </Button>
              <RowActions
                actions={[
                  { label: "Editar", onClick: () => openEdit(client) },
                  {
                    label: "WhatsApp",
                    href: whatsappUrl(
                      client.whatsapp,
                      `Olá, ${personName(client)}, tudo bem? Aqui é da Aura Clinic. Estamos entrando em contato para confirmar informações, acompanhar seu atendimento ou informar uma atualização importante.`,
                    ),
                    target: "_blank",
                    rel: "noreferrer",
                  },
                  ...(isAdmin ? [{ label: "Mesclar cadastro", onClick: () => openMerge(client), danger: true }] : []),
                  ...(isAdmin ? [{ label: "Excluir cliente", onClick: () => openDeletion(client), danger: true }] : []),
                ]}
              />
            </div>
          )}
          empty="Você ainda não possui clientes cadastrados."
        />
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Editar cliente" : "Novo cliente"}
        subtitle="Dados cadastrais do cliente"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="client-form" variant="primary">
              {editing ? "Salvar alterações" : "Salvar cliente"}
            </Button>
          </>
        }
      >
        <ClientEditForm
          key={editing ? editing.id : "new"}
          formId="client-form"
          client={editing || undefined}
          clients={clients}
          onSaved={() => {
            setModalOpen(false);
            setEditing(null);
            refresh();
          }}
        />
      </Modal>

      <Modal
        open={!!deleting}
        title="Excluir cliente"
        subtitle="Análise segura do histórico"
        onClose={() => !deleting?.busy && setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleting?.busy}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={removeClient}
              disabled={deleting?.busy || deleting?.confirmation !== "EXCLUIR CLIENTE" || !deleting?.reason?.trim()}
            >
              {deleting?.busy
                ? "Processando…"
                : deleting?.action === "anonymize"
                  ? "Anonimizar e arquivar"
                  : "Excluir definitivamente"}
            </Button>
          </>
        }
      >
        {deleting && (
          <div className="stack">
            <div className="soft-card">
              <strong>{personName(deleting.client)}</strong>
              <p>
                {deleting.action === "anonymize"
                  ? "Há histórico vinculado. Os dados pessoais serão anonimizados e o histórico financeiro/clínico será preservado."
                  : "Não há histórico vinculado. O cadastro será excluído definitivamente."}
              </p>
            </div>
            <div className="summary-grid">
              {Object.entries(deleting.impact).map(([key, value]) => (
                <span key={key}>
                  {key.replaceAll("_", " ")}: <strong>{value}</strong>
                </span>
              ))}
            </div>
            <Input
              label="Motivo obrigatório"
              value={deleting.reason}
              onChange={(reason) => setDeleting({ ...deleting, reason })}
            />
            <Input
              label="Digite EXCLUIR CLIENTE"
              value={deleting.confirmation}
              onChange={(confirmation) => setDeleting({ ...deleting, confirmation })}
            />
          </div>
        )}
      </Modal>
      {profile && (
        <Modal
          open
          title={personName(profile)}
          subtitle="Timeline, histórico clínico e relacionamento"
          size="lg"
          onClose={() => setProfile(null)}
          footer={
            <>
              {isAdmin && <Button variant="danger" onClick={() => openMerge(profile)}>Mesclar cadastro</Button>}
              <Button variant="secondary" onClick={() => setProfile(null)}>Fechar</Button>
            </>
          }
        >
          <ClientProfileLoader
            clientId={profile.id}
            fallback={profile}
            onChanged={refresh}
            onNavigate={onNavigate}
            onEdit={() => {
              setProfile(null);
              openEdit(profile);
            }}
          />
        </Modal>
      )}
      {merging && (
        <ClientMergeModal
          source={merging}
          onClose={() => setMerging(null)}
          onMerged={() => {
            setMerging(null);
            setProfile(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function ClientMergeModal({ source, onClose, onMerged }) {
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = new URLSearchParams({ limit: "100", ...(search.trim() ? { search: search.trim() } : {}) });
  const { data } = useFetch(`/clients?${query}`);
  const candidateRows = asArray(data).length ? asArray(data) : asArray(asObject(data).items);
  const candidates = candidateRows.filter((client) => Number(client.id) !== Number(source.id));

  async function submit() {
    setBusy(true);
    setError("");
    const response = await apiFetch(`/clients/${source.id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_client_id: Number(targetId), reason, confirmation }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error || "Não foi possível mesclar os clientes.");
      setBusy(false);
      return;
    }
    onMerged(payload);
  }

  return (
    <Modal
      open
      title="Mesclar cadastro duplicado"
      subtitle="Todo o histórico será movido para o cliente mantido"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger" onClick={submit} disabled={busy || !targetId || reason.trim().length < 5 || confirmation !== "MESCLAR CLIENTES"}>
            {busy ? "Mesclando…" : "Mesclar definitivamente"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="soft-card">
          <strong>Cadastro duplicado: {personName(source)}</strong>
          <p>Este cadastro será anonimizado e não poderá ser reutilizado. Agenda, pagamentos, vendas e históricos serão vinculados ao destino.</p>
        </div>
        <Input label="Buscar cliente que será mantido" value={search} onChange={setSearch} placeholder="Nome, CPF, telefone ou e-mail" />
        <Select label="Cliente de destino" value={targetId} onChange={setTargetId}>
          <option value="">Selecione o cadastro correto</option>
          {candidates.map((client) => <option key={client.id} value={client.id}>{personName(client)} · {formatCpf(client.cpf) || formatBrazilianPhone(client.whatsapp)}</option>)}
        </Select>
        <Textarea label="Motivo obrigatório" value={reason} onChange={setReason} placeholder="Ex.: cadastro duplicado confirmado pelo CPF" />
        <Input label="Digite MESCLAR CLIENTES" value={confirmation} onChange={setConfirmation} />
        {error && <span className="form-error">{error}</span>}
      </div>
    </Modal>
  );
}

// A lista de clientes é enxuta (só as colunas da tabela): histórico, pagamentos,
// prontuários e fidelidade vêm de /clients/:id, sob demanda. Antes tudo isso
// vinha embutido na listagem, que chegava a 845 KB.
function ClientProfileLoader({ clientId, fallback, onChanged, onNavigate, onEdit }) {
  const { data } = useFetch(`/clients/${clientId}`);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  // `onChanged` já invalida "/clients" inteiro — o detalhe recarrega junto.
  return (
    <ClientProfile
      client={{ ...fallback, ...data }}
      onChanged={() => onChanged?.()}
      onNavigate={onNavigate}
      onEdit={onEdit}
    />
  );
}

function ClientProfile({ client, onChanged, onNavigate, onEdit }) {
  const [tab, setTab] = useState("data");
  const timeline = asArray(client.timeline);
  const paid = Number(client.summary?.total_spent || 0);
  const pending = Number(client.summary?.pending_amount || 0);
  const { data: creditsData } = useFetch(`/clients/${client.id}/credits`);
  const availableCredit = Number(creditsData?.open_amount || 0);
  const lastAppointment = client.summary?.last_appointment;
  const nextAppointment = client.summary?.next_appointment;
  return (
    <div className="stack client-360">
      <div className="client-360-metrics">
        <article>
          <span>Último atendimento</span>
          <strong>{lastAppointment ? formatDate(lastAppointment.appointment_date) : "Nenhum"}</strong>
        </article>
        <article>
          <span>Próximo atendimento</span>
          <strong>
            {nextAppointment
              ? `${formatDate(nextAppointment.appointment_date)} às ${nextAppointment.appointment_time}`
              : "Não agendado"}
          </strong>
        </article>
        <article>
          <span>Total gasto</span>
          <strong>{currency.format(paid)}</strong>
        </article>
        <article>
          <span>Pendências</span>
          <strong>{currency.format(pending)}</strong>
        </article>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.List className="client-360-tabs" aria-label="Perfil do cliente">
          <Tabs.Trigger value="data">Dados</Tabs.Trigger>
          <Tabs.Trigger value="history">Histórico e atendimentos</Tabs.Trigger>
          <Tabs.Trigger value="terms">Termos digitais</Tabs.Trigger>
          <Tabs.Trigger value="postcare">Pós-atendimento</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="data">
          <section className="client-360-panel">
            <header>
              <div>
                <h3>Dados do cliente</h3>
                <p>Cadastro, contato e preferências.</p>
              </div>
              <Button variant="secondary" onClick={onEdit}>
                Editar dados
              </Button>
            </header>
            <dl className="client-360-details">
              <div>
                <dt>Nome civil</dt>
                <dd>{client.full_name}</dd>
              </div>
              <div>
                <dt>Nome social</dt>
                <dd>{client.social_name || "Não informado"}</dd>
              </div>
              <div>
                <dt>Nascimento</dt>
                <dd>{client.birth_date ? formatDate(client.birth_date) : "Não informado"}</dd>
              </div>
              <div>
                <dt>CPF</dt>
                <dd>{formatCpf(client.cpf) || "Não informado"}</dd>
              </div>
              <div>
                <dt>WhatsApp</dt>
                <dd>{formatBrazilianPhone(client.whatsapp)}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{formatBrazilianPhone(client.phone) || "Não informado"}</dd>
              </div>
              <div>
                <dt>E-mail</dt>
                <dd>{client.email || "Não informado"}</dd>
              </div>
              <div>
                <dt>Canal preferido</dt>
                <dd>
                  {{ whatsapp: "WhatsApp", email: "E-mail", phone: "Telefone" }[client.preferred_contact] || "WhatsApp"}
                </dd>
              </div>
              <div>
                <dt>Instagram</dt>
                <dd>{client.instagram || "Não informado"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{{ active: "Ativo", inactive: "Inativo", blocked: "Bloqueado" }[client.lifecycle_status] || "Ativo"}</dd>
              </div>
              <div>
                <dt>Origem</dt>
                <dd>{client.acquisition_source || "Não informada"}</dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{asArray(client.tags).join(", ") || "Nenhuma"}</dd>
              </div>
              <div>
                <dt>Endereço</dt>
                <dd>
                  {[
                    client.address_line,
                    client.address_number,
                    client.address_complement,
                    client.neighborhood,
                    client.city,
                    client.state,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Não informado"}
                  {client.postal_code ? ` · CEP ${formatCep(client.postal_code)}` : ""}
                </dd>
              </div>
              <div className="client-360-details-wide">
                <dt>Observações</dt>
                <dd>{client.notes || "Nenhuma observação cadastrada."}</dd>
              </div>
              <div>
                <dt>Cadastrado em</dt>
                <dd>{client.created_at ? formatLongDate(String(client.created_at).slice(0, 10)) : "Não informado"}</dd>
              </div>
            </dl>
            {(availableCredit > 0 || client.loyalty?.availablePoints > 0) && (
              <div className="client-360-balance">
                <span>
                  Crédito: <strong>{currency.format(availableCredit)}</strong>
                </span>
                <span>
                  Fidelidade: <strong>{client.loyalty?.availablePoints || 0} pts</strong>
                </span>
              </div>
            )}
          </section>
        </Tabs.Content>

        <Tabs.Content value="history">
          <section className="client-360-panel">
            <h3>Linha do tempo</h3>
            <div className="medical-timeline">
              {timeline.map((item) => (
                <article className="record-entry" key={`${item.type}-${item.date}-${item.title}`}>
                  <header>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {formatLongDate(String(item.date || "").slice(0, 10))} · {item.type}
                      </span>
                    </div>
                    <StatusBadge status={item.status}>{item.status}</StatusBadge>
                  </header>
                  {item.value !== undefined && <small>{currency.format(Number(item.value || 0))}</small>}
                </article>
              ))}
              {!timeline.length && <p className="empty-state">Nenhum evento registrado para este cliente.</p>}
            </div>
          </section>
          {client.clinical_access ? (
            <>
              <MedicalRecordForm client={client} onSaved={onChanged} />
              <MedicalRecordTimeline client={client} onChanged={onChanged} />
            </>
          ) : (
            <p className="empty-state">Seu perfil não possui acesso ao prontuário clínico.</p>
          )}
        </Tabs.Content>

        <Tabs.Content value="terms">
          <section className="client-360-panel">
            <header>
              <div>
                <h3>Termos digitais</h3>
                <p>Histórico de documentos assinados.</p>
              </div>
              {client.clinical_access && (
                <Button variant="secondary" onClick={() => onNavigate?.("terms")}>
                  Abrir termos
                </Button>
              )}
            </header>
            {!client.clinical_access ? (
              <p className="empty-state">Seu perfil não possui acesso aos termos clínicos.</p>
            ) : (
              <div className="client-360-list">
                {asArray(client.terms).map((term) => (
                  <article key={term.id}>
                    <div>
                      <strong>{term.procedure || "Termo de consentimento"}</strong>
                      <span>{term.piercing_region || "Região não informada"}</span>
                    </div>
                    <small>{formatLongDate(String(term.signed_at || "").slice(0, 10))}</small>
                  </article>
                ))}
                {!asArray(client.terms).length && <p className="empty-state">Nenhum termo digital assinado.</p>}
              </div>
            )}
          </section>
        </Tabs.Content>

        <Tabs.Content value="postcare">
          <section className="client-360-panel">
            <header>
              <div>
                <h3>Pós-atendimento</h3>
                <p>Acompanhamentos e evolução de cicatrização.</p>
              </div>
              {client.clinical_access && (
                <Button variant="secondary" onClick={() => onNavigate?.("postcare")}>
                  Abrir pós-atendimento
                </Button>
              )}
            </header>
            {!client.clinical_access ? (
              <p className="empty-state">Seu perfil não possui acesso ao pós-atendimento clínico.</p>
            ) : (
              <div className="client-360-list">
                {asArray(client.followups).map((followup) => (
                  <article key={followup.id}>
                    <div>
                      <strong>Retorno de {followup.reminder_day} dias</strong>
                      <span>{followup.healing_status || "Aguardando retorno"}</span>
                    </div>
                    <div>
                      <StatusBadge status={followup.status}>{followup.status}</StatusBadge>
                      <small>{formatDate(followup.due_date)}</small>
                    </div>
                  </article>
                ))}
                {!asArray(client.followups).length && <p className="empty-state">Nenhum acompanhamento programado.</p>}
              </div>
            )}
          </section>
        </Tabs.Content>
      </Tabs>
    </div>
  );
}

function initialClientForm(client) {
  return {
    full_name: client?.full_name || "",
    social_name: client?.social_name || "",
    phone: formatBrazilianPhone(client?.phone),
    whatsapp: formatBrazilianPhone(client?.whatsapp),
    instagram: client?.instagram || "",
    email: client?.email || "",
    birth_date: dateInputValue(client?.birth_date),
    cpf: formatCpf(client?.cpf),
    preferred_contact: client?.preferred_contact || "whatsapp",
    postal_code: formatCep(client?.postal_code),
    address_line: client?.address_line || "",
    address_number: client?.address_number || "",
    address_complement: client?.address_complement || "",
    neighborhood: client?.neighborhood || "",
    city: client?.city || "",
    state: client?.state || "",
    acquisition_source: client?.acquisition_source || "",
    referred_by_client_id: client?.referred_by_client_id || "",
    tags: asArray(client?.tags).join(", "),
    lifecycle_status: client?.lifecycle_status || "active",
    blocked_reason: client?.blocked_reason || "",
    operational_consent: Boolean(client?.operational_consent),
    marketing_consent: Boolean(client?.marketing_consent),
    emergency_contact_name: client?.emergency_contact_name || "",
    emergency_contact_phone: formatBrazilianPhone(client?.emergency_contact_phone),
    guardian_client_id: client?.guardian_client_id || "",
    guardian_relationship: client?.guardian_relationship || "",
    notes: client?.notes || "",
  };
}

export function ClientEditForm({ client, clients = [], onSaved, onCancel = () => {}, formId }) {
  const [form, setForm] = useState(() => initialClientForm(client));
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState(/** @type {Record<string, string | undefined>} */ ({}));
  const session = readStoredSession();
  const draft = useFormDraft({
    tenantId: tenantSlug(),
    userId: session?.user?.id,
    formId: `client:${client?.id || "new"}`,
    schemaKey: "client-profile-v1",
    value: form,
    onRestore: setForm,
  });

  function change(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const validation = validateClientForm(form);
    setFieldErrors(validation);
    if (Object.keys(validation).length) return;
    const response = await apiFetch(client?.id ? `/clients/${client.id}` : "/clients", {
      method: client?.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setFieldErrors(payload.field_errors || {});
      return setError(payload.error || "Não foi possível salvar o cliente.");
    }
    draft.discardDraft();
    onSaved();
  }

  return (
    <form id={formId} className="client-edit-form" onSubmit={submit}>
      <FormWorkflow
        title="Cadastro do cliente"
        description="Dados brasileiros padronizados para contato e atendimento."
        draft={draft}
      >
        {draft.hasDraft && (
          <div className="client-draft-recovery" role="status">
            <div>
              <strong>Há um preenchimento não salvo.</strong>
              <span>Restaure para continuar de onde parou ou descarte o rascunho.</span>
            </div>
            <Button variant="secondary" onClick={draft.restoreDraft}>
              Restaurar
            </Button>
            <Button variant="ghost" onClick={draft.discardDraft}>
              Descartar
            </Button>
          </div>
        )}
        <ValidationSummary
          errors={Object.entries(fieldErrors)
            .filter(([, message]) => message)
            .map(([field, message]) => ({ field, message }))}
          onErrorClick={(field) => {
            const target = document.querySelector(`[name="${field}"]`);
            if (target instanceof HTMLElement) target.focus();
          }}
        />
        <FormSection
          title="Dados principais"
          description="Nome, nascimento e documento para identificar o cliente corretamente."
        >
          <div className="form-grid">
            <Input
              name="full_name"
              label="Nome civil completo"
              value={form.full_name}
              onChange={(value) => change("full_name", value)}
              required
              aria-invalid={Boolean(fieldErrors.full_name)}
            />
            <Input
              name="social_name"
              label="Nome social"
              value={form.social_name}
              onChange={(value) => change("social_name", value)}
              autoComplete="name"
            />
            <Input
              name="birth_date"
              type="date"
              label="Nascimento"
              value={form.birth_date}
              onChange={(value) => change("birth_date", value)}
              required
              aria-invalid={Boolean(fieldErrors.birth_date)}
            />
            <Input
              name="cpf"
              label="CPF"
              value={form.cpf}
              onChange={(value) => change("cpf", formatCpf(value))}
              inputMode="numeric"
              maxLength={14}
              placeholder="000.000.000-00"
              aria-invalid={Boolean(fieldErrors.cpf)}
            />
          </div>
        </FormSection>

        <FormSection
          title="Contato"
          description="O canal preferido é apenas indicativo e não apaga os demais contatos."
        >
          <div className="form-grid">
            <Input
              name="whatsapp"
              label="WhatsApp"
              value={form.whatsapp}
              onChange={(value) => change("whatsapp", formatBrazilianPhone(value))}
              inputMode="tel"
              maxLength={15}
              placeholder="(11) 99999-9999"
              required
              aria-invalid={Boolean(fieldErrors.whatsapp)}
            />
            <Input
              name="phone"
              label="Telefone"
              value={form.phone}
              onChange={(value) => change("phone", formatBrazilianPhone(value))}
              inputMode="tel"
              maxLength={15}
              placeholder="(11) 99999-9999"
              aria-invalid={Boolean(fieldErrors.phone)}
            />
            <Input
              name="email"
              type="email"
              label="E-mail"
              value={form.email}
              onChange={(value) => change("email", normalizeEmailInput(value))}
              autoComplete="email"
              aria-invalid={Boolean(fieldErrors.email)}
            />
            <Select
              label="Canal preferido de contato"
              value={form.preferred_contact}
              onChange={(value) => change("preferred_contact", value)}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="phone">Telefone</option>
            </Select>
          </div>
        </FormSection>

        <AdvancedFields
          title="Endereço e dados adicionais"
          description="Campos opcionais para entrega, documento fiscal ou relacionamento."
        >
          <div className="form-grid">
            <Input
              name="postal_code"
              label="CEP"
              value={form.postal_code}
              onChange={(value) => change("postal_code", formatCep(value))}
              inputMode="numeric"
              maxLength={9}
              placeholder="00000-000"
              aria-invalid={Boolean(fieldErrors.postal_code)}
            />
            <Input
              name="address_line"
              label="Logradouro"
              value={form.address_line}
              onChange={(value) => change("address_line", value)}
              autoComplete="address-line1"
            />
            <Input
              name="address_number"
              label="Número"
              value={form.address_number}
              onChange={(value) => change("address_number", value)}
            />
            <Input
              name="address_complement"
              label="Complemento"
              value={form.address_complement}
              onChange={(value) => change("address_complement", value)}
              autoComplete="address-line2"
            />
            <Input
              name="neighborhood"
              label="Bairro"
              value={form.neighborhood}
              onChange={(value) => change("neighborhood", value)}
            />
            <Input
              name="city"
              label="Cidade"
              value={form.city}
              onChange={(value) => change("city", value)}
              autoComplete="address-level2"
            />
            <Select label="UF" value={form.state} onChange={(value) => change("state", value)}>
              <option value="">Selecione</option>
              {BRAZIL_STATE_OPTIONS.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </Select>
            <Input
              name="instagram"
              label="Instagram"
              value={form.instagram}
              onChange={(value) => change("instagram", normalizeInstagramInput(value))}
              placeholder="@usuario"
            />
          </div>
        </AdvancedFields>

        <AdvancedFields
          title="Relacionamento e preferências"
          description="Informações opcionais para organizar o atendimento e a comunicação da clínica."
        >
          <div className="form-grid">
            <Select label="Origem do cliente" value={form.acquisition_source} onChange={(value) => change("acquisition_source", value)}>
              <option value="">Não informada</option>
              {["Instagram", "Indicação", "Google", "Passagem", "Evento", "Outro"].map((source) => <option key={source} value={source}>{source}</option>)}
            </Select>
            <Select label="Indicado por" value={form.referred_by_client_id} onChange={(value) => change("referred_by_client_id", value)}>
              <option value="">Não informado</option>
              {asArray(clients).filter((item) => item.id !== client?.id).map((item) => <option key={item.id} value={item.id}>{personName(item)}</option>)}
            </Select>
            <Input name="tags" label="Tags" value={form.tags} onChange={(value) => change("tags", value)} placeholder="vip, retorno, indicação" />
            <Select label="Status do cliente" value={form.lifecycle_status} onChange={(value) => change("lifecycle_status", value)}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
              <option value="blocked">Bloqueado</option>
            </Select>
            {form.lifecycle_status === "blocked" && <Input name="blocked_reason" label="Motivo interno do bloqueio" value={form.blocked_reason} onChange={(value) => change("blocked_reason", value)} />}
            <Input name="emergency_contact_name" label="Contato de emergência" value={form.emergency_contact_name} onChange={(value) => change("emergency_contact_name", value)} />
            <Input name="emergency_contact_phone" label="Telefone de emergência" value={form.emergency_contact_phone} onChange={(value) => change("emergency_contact_phone", formatBrazilianPhone(value))} inputMode="tel" maxLength={15} placeholder="(11) 99999-9999" />
            <Select label="Responsável legal cadastrado" value={form.guardian_client_id} onChange={(value) => change("guardian_client_id", value)}>
              <option value="">Não informado</option>
              {asArray(clients).filter((item) => item.id !== client?.id).map((item) => <option key={item.id} value={item.id}>{personName(item)}</option>)}
            </Select>
            <Input name="guardian_relationship" label="Vínculo do responsável" value={form.guardian_relationship} onChange={(value) => change("guardian_relationship", value)} placeholder="Mãe, pai, tutor…" />
          </div>
          <div className="stack">
            <Checkbox checked={form.operational_consent} onChange={(value) => change("operational_consent", value)} label="Aceita comunicações operacionais sobre agendamentos e atendimento" />
            <Checkbox checked={form.marketing_consent} onChange={(value) => change("marketing_consent", value)} label="Aceita comunicações de marketing e novidades" />
          </div>
        </AdvancedFields>

        <FormSection title="Observações">
          <Textarea
            name="notes"
            label="Observações"
            value={form.notes}
            onChange={(value) => change("notes", value)}
            rows={4}
          />
        </FormSection>
      </FormWorkflow>
      {error && <span className="form-error">{error}</span>}
      {!formId && (
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
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
    Object.entries(record).forEach(([key, value]) => {
      formData.append(key, value);
    });
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
        <Input
          type="date"
          label="Data do registro"
          value={record.record_date}
          onChange={(value) => setRecord({ ...record, record_date: value })}
        />
        <Select
          label="Atendimento vinculado"
          value={record.appointment_id}
          onChange={(value) => setRecord({ ...record, appointment_id: value })}
        >
          <option value="">Sem vínculo</option>
          {asArray(client.history).map((item) => (
            <option key={item.id} value={item.id}>
              {formatDate(item.appointment_date)} · {item.procedure}
            </option>
          ))}
        </Select>
      </div>
      <Textarea
        label="Histórico de perfurações"
        value={record.piercing_history}
        onChange={(piercing_history) => setRecord({ ...record, piercing_history })}
      />
      <Textarea
        label="Joias usadas"
        value={record.jewelry_used}
        onChange={(jewelry_used) => setRecord({ ...record, jewelry_used })}
      />
      <div className="form-grid">
        <label>
          Foto antes
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setFiles({ ...files, before_photo: event.target.files[0] })}
          />
        </label>
        <label>
          Foto depois
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setFiles({ ...files, after_photo: event.target.files[0] })}
          />
        </label>
      </div>
      <Textarea
        label="Intercorrências"
        value={record.occurrences}
        onChange={(occurrences) => setRecord({ ...record, occurrences })}
      />
      <Textarea
        label="Orientações passadas"
        value={record.guidance}
        onChange={(guidance) => setRecord({ ...record, guidance })}
      />
      <Textarea
        label="Alergias ou observações importantes"
        value={record.allergies_notes}
        onChange={(allergies_notes) => setRecord({ ...record, allergies_notes })}
      />
      <Textarea
        label="Evolução da cicatrização"
        value={record.healing_evolution}
        onChange={(healing_evolution) => setRecord({ ...record, healing_evolution })}
      />
      <Textarea
        label="Retornos realizados"
        value={record.returns_done}
        onChange={(returns_done) => setRecord({ ...record, returns_done })}
      />
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
        {asArray(client.medicalRecords).length ? (
          asArray(client.medicalRecords).map((record) => (
            <article className="record-entry" key={record.id}>
              <header>
                <div>
                  <strong>{formatLongDate(record.record_date)}</strong>
                  <span>
                    {record.procedure || "Registro avulso"} · {record.piercing_region || "sem região vinculada"}
                  </span>
                </div>
                <Button
                  variant="danger"
                  onClick={() =>
                    setDeleting({ message: "Excluir este registro do prontuário?", run: () => remove(record.id) })
                  }
                >
                  Excluir
                </Button>
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
                <div>
                  <dt>Joias usadas</dt>
                  <dd>{record.jewelry_used || record.appointment_jewelry || "Não informado"}</dd>
                </div>
                <div>
                  <dt>Intercorrências</dt>
                  <dd>{record.occurrences || "Sem intercorrências registradas"}</dd>
                </div>
                <div>
                  <dt>Orientações</dt>
                  <dd>{record.guidance || "Não informado"}</dd>
                </div>
                <div>
                  <dt>Alergias/observações</dt>
                  <dd>{record.allergies_notes || client.notes || "Não informado"}</dd>
                </div>
                <div>
                  <dt>Evolução</dt>
                  <dd>{record.healing_evolution || "Não informado"}</dd>
                </div>
                <div>
                  <dt>Retornos</dt>
                  <dd>{record.returns_done || "Não informado"}</dd>
                </div>
              </dl>
            </article>
          ))
        ) : (
          <p className="empty-state">Nenhum registro de prontuário ainda.</p>
        )}
      </div>

      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await deleting.run();
          setDeleting(null);
        }}
      />
    </div>
  );
}
