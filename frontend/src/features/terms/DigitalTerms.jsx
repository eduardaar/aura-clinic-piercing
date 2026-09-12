// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Checkbox, Input, Select, StatusBadge, Tabs, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, Modal, CrudHeader, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { asArray, asObject, formatDate } from "../../lib/utils";
import { apiFetch, downloadApiFile, openApiFile, useFetch } from "../../lib/api";
import { DIGITAL_TERM_HEALTH_ITEMS, DIGITAL_TERM_LIFESTYLE_ITEMS, defaultDigitalTerm } from "../../lib/defaultForms";
import { currency, personName } from "../../features/shared/helpers";
import { SignaturePad } from "../../components/common/SignaturePad";
import {
  TERM_REQUEST_CHANNEL_LABELS, TERM_REQUEST_STATUS_LABELS, TERM_REQUEST_STATUS_TONES,
  TermLinkPanel, TermRequestModal, formatExpiry, requestTermJson
} from "./TermRequestModal";

const emptyTemplate = () => ({
  name: "", kind: "consent", description: "", content: "",
  requires_health_history: true, requires_guardian_for_minors: true, is_active: true
});

// O <select> de vínculo só precisa dos agendamentos recentes: sem `limit` o
// endpoint devolvia a base inteira (295 registros / ~446 KB) para preencher uma
// caixa de seleção. Com `limit`/`offset` a resposta vira { items, total, … }.
const APPOINTMENTS_QUERY = "/appointments?limit=100&sort=date:desc";

// `formatDate` de lib/utils devolve dd/MM sem ano: termos de anos diferentes
// ficariam com a mesma data na coluna de assinatura.
function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

export function DigitalTerms({ onBack }) {
  const { data: appointmentsPage } = useFetch(APPOINTMENTS_QUERY);
  const { data: terms, refresh } = useFetch("/digital-terms");
  const [form, setForm] = useState(defaultDigitalTerm());
  const [modalOpen, setModalOpen] = useState(false);
  const [formTab, setFormTab] = useState("dados");
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  // Solicitações por link e modelos de termo vivem na mesma tela, em abas.
  const [pageTab, setPageTab] = useState("signed");
  const [requestOpen, setRequestOpen] = useState(false);
  const [linkResult, setLinkResult] = useState(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [templateModal, setTemplateModal] = useState({ open: false, editing: null });
  const [templateForm, setTemplateForm] = useState(emptyTemplate());
  const [deletingTemplate, setDeletingTemplate] = useState(null);
  const clientsQuery = useFetch("/clients?limit=200");
  const requestsQuery = useFetch("/term-requests");
  const templatesQuery = useFetch("/term-templates?include_inactive=1");
  const clients = asArray(asObject(clientsQuery.data).items).length ? asArray(asObject(clientsQuery.data).items) : asArray(clientsQuery.data);
  const requests = asArray(asObject(requestsQuery.data).items);
  const templates = asArray(asObject(templatesQuery.data).items);
  const templateKinds = asArray(asObject(templatesQuery.data).kinds);
  const pendingCount = requests.filter((item) => item.status === "pending").length;

  function openNewTemplate() {
    setTemplateForm(emptyTemplate());
    setTemplateModal({ open: true, editing: null });
    setActionError("");
    setPageTab("templates");
  }

  function openEditTemplate(item) {
    setTemplateForm({
      name: item.name || "", kind: item.kind || "consent", description: item.description || "", content: item.content || "",
      requires_health_history: Boolean(item.requires_health_history), requires_guardian_for_minors: Boolean(item.requires_guardian_for_minors),
      is_active: item.is_active !== false
    });
    setTemplateModal({ open: true, editing: item });
    setActionError("");
  }

  function closeTemplateModal() {
    setTemplateModal({ open: false, editing: null });
  }

  async function saveTemplate(event) {
    event.preventDefault();
    setActionError("");
    setBusy(true);
    try {
      const editing = templateModal.editing;
      await requestTermJson(`/term-templates${editing ? `/${editing.id}` : ""}`, { method: editing ? "PATCH" : "POST", body: JSON.stringify(templateForm) });
      closeTemplateModal();
      templatesQuery.refresh();
    } catch (caught) {
      setActionError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function renewRequest(request) {
    setActionError("");
    try {
      setLinkResult(await requestTermJson(`/term-requests/${request.id}/renew`, { method: "POST", body: JSON.stringify({}) }));
      requestsQuery.refresh();
    } catch (caught) {
      setActionError(caught.message);
    }
  }

  async function cancelRequest(request) {
    setActionError("");
    try {
      await requestTermJson(`/term-requests/${request.id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      requestsQuery.refresh();
    } catch (caught) {
      setActionError(caught.message);
    }
  }

  const safeAppointments = asArray(asObject(appointmentsPage).items);
  const appointmentTotal = Number(asObject(appointmentsPage).total || safeAppointments.length);
  const hasAppointments = safeAppointments.length > 0;
  const safeTerms = asArray(terms);
  const selectedAppointment = safeAppointments.find((item) => String(item.id) === String(form.appointment_id));

  useEffect(() => {
    if (!selectedAppointment) return;
    setForm((current) => ({
      ...current,
      client_id: selectedAppointment.client_id,
      full_name: current.full_name || personName(selectedAppointment),
      whatsapp: current.whatsapp || selectedAppointment.whatsapp,
      phone: current.phone || selectedAppointment.phone || "",
      email: current.email || selectedAppointment.email || "",
      instagram: current.instagram || selectedAppointment.instagram || "",
      procedure: current.procedure || selectedAppointment.procedure,
      piercing_region: current.piercing_region || selectedAppointment.piercing_region,
      address: current.address || selectedAppointment.address || ""
    }));
  }, [selectedAppointment?.id]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFormData(group, field, value) {
    setForm((current) => ({
      ...current,
      form_data: {
        ...current.form_data,
        [group]: {
          ...current.form_data[group],
          [field]: value
        }
      }
    }));
  }

  function toggleHealthItem(key) {
    updateFormData("health_history", key, !form.form_data.health_history[key]);
  }

  function openNew() {
    setForm(defaultDigitalTerm());
    setError("");
    setFormTab("dados");
    setModalOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.signature_data_url) return setError("Assinatura digital obrigatória.");
    if (form.form_data.minor.is_minor) {
      if (!form.form_data.minor.responsible_name.trim() || !form.form_data.minor.responsible_document.trim()) {
        return setError("Informe nome e documento do responsável legal.");
      }
      if (!form.guardian_signature_data_url) return setError("Assinatura do responsável legal obrigatória.");
    }
    const response = await apiFetch(`/digital-terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Não foi possível salvar o termo.");
    setForm(defaultDigitalTerm());
    refresh();
    setModalOpen(false);
  }

  async function handlePdf(action, term) {
    setFileError("");
    try {
      const path = String(term.pdf_url || "").replace(/^\/api/, "");
      if (action === "download") await downloadApiFile(path, `ficha-anamnese-${term.id}.pdf`);
      else await openApiFile(path);
    } catch (error) {
      setFileError(error.message || "Não foi possível abrir a ficha em PDF.");
    }
  }

  return (
    <section className="stack terms-page">
      <div className="panel">
        <CrudHeader
          title="Termos digitais"
          subtitle="Consentimentos e autorizações assinados no balcão, no estúdio ou por link."
          actionLabel="Novo termo"
          onAction={openNew}
          actions={[
            { label: "Enviar termo para o cliente", onClick: () => setRequestOpen(true) },
            { label: "Novo modelo de termo", onClick: openNewTemplate }
          ]}
        />
        <div className="module-backbar"><Button variant="secondary" onClick={onBack}><ArrowLeft size={16} /> Voltar para clientes</Button></div>
        {fileError && <p className="form-error" role="alert">{fileError}</p>}
        {actionError && !templateModal.open && <p className="form-error" role="alert">{actionError}</p>}
        <Tabs value={pageTab} onValueChange={setPageTab}>
          <Tabs.List aria-label="Seções dos termos digitais">
            <Tabs.Trigger value="signed">Assinados</Tabs.Trigger>
            <Tabs.Trigger value="requests">Solicitações{pendingCount ? ` (${pendingCount})` : ""}</Tabs.Trigger>
            <Tabs.Trigger value="templates">Modelos</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="signed">
            <DataView
              rows={safeTerms}
              loading={!terms}
              error={terms?.error || ""}
              defaultSort={{ key: "signed_at", dir: "desc" }}
              searchPlaceholder="Buscar por cliente, procedimento ou profissional"
              filters={[{ key: "from", label: "Assinado a partir de", type: "date", match: (term, value) => String(term.signed_at || "").slice(0, 10) >= value }, { key: "to", label: "Assinado até", type: "date", match: (term, value) => String(term.signed_at || "").slice(0, 10) <= value }]}
              columns={[
                { key: "full_name", label: "Cliente", render: (term) => <strong>{term.full_name}</strong> },
                { key: "template_name", label: "Termo", value: (term) => `${term.template_name || ""} ${term.procedure || ""} ${term.appointment_date || ""}`, render: (term) => <div><span>{term.template_name || term.procedure || "Ficha sem procedimento informado"}</span>{term.template_name && term.procedure && <><br /><small>{term.procedure}</small></>}{term.appointment_id && <><br /><small>{formatDateWithYear(term.appointment_date)} · {term.appointment_time || ""}</small></>}</div> },
                { key: "channel", label: "Origem", value: (term) => term.channel === "remote" ? "Por link" : term.channel === "in_studio" ? "No estúdio" : "Equipe", render: (term) => term.channel === "remote" ? "Assinado por link" : term.channel === "in_studio" ? "Assinado no estúdio" : "Registrado pela equipe" },
                { key: "professional_name", label: "Profissional", render: (term) => term.professional_name || "Sem profissional vinculado" },
                { key: "signed_at", label: "Assinado em", value: (term) => String(term.signed_at || ""), render: (term) => formatDateWithYear(term.signed_at) },
                { key: "pdf_url", label: "PDF", sortable: false, searchable: false, render: (term) => term.pdf_url ? "Disponível" : "—" }
              ]}
              actions={(term) => term.pdf_url ? <RowActions actions={[{ label: "Abrir PDF", onClick: () => handlePdf("open", term), primary: true }, { label: "Baixar PDF", onClick: () => handlePdf("download", term) }]} /> : null}
              empty="Nenhum termo assinado ainda."
              emptyFiltered="Nenhum termo corresponde à busca ou ao período."
            />
          </Tabs.Content>
          <Tabs.Content value="requests">
            <DataView
              rows={requests}
              loading={!requestsQuery.data}
              error={requestsQuery.data?.error || ""}
              defaultSort={{ key: "created_at", dir: "desc" }}
              searchPlaceholder="Buscar por cliente ou modelo"
              filters={[{ key: "status", label: "Status", type: "select", options: Object.entries(TERM_REQUEST_STATUS_LABELS).map(([value, label]) => ({ value, label })) }]}
              columns={[
                { key: "client_name", label: "Cliente", render: (item) => <strong>{item.client_name}</strong> },
                { key: "template_name", label: "Modelo", render: (item) => item.template_name || "Termo digital" },
                { key: "channel", label: "Canal", value: (item) => TERM_REQUEST_CHANNEL_LABELS[item.channel] || item.channel, render: (item) => TERM_REQUEST_CHANNEL_LABELS[item.channel] || item.channel },
                { key: "status", label: "Status", value: (item) => TERM_REQUEST_STATUS_LABELS[item.status] || item.status, render: (item) => <StatusBadge tone={TERM_REQUEST_STATUS_TONES[item.status]} status={TERM_REQUEST_STATUS_LABELS[item.status] || item.status} /> },
                { key: "created_at", label: "Criado em", value: (item) => String(item.created_at || ""), render: (item) => formatExpiry(item.created_at) },
                { key: "expires_at", label: "Válido até", value: (item) => String(item.expires_at || ""), render: (item) => item.status === "pending" ? formatExpiry(item.expires_at) : "—" }
              ]}
              actions={(item) => (
                <RowActions actions={[
                  item.status !== "completed" && { label: "Gerar novo link", onClick: () => renewRequest(item), primary: true },
                  item.status === "pending" && { label: "Cancelar solicitação", onClick: () => cancelRequest(item), danger: true },
                  item.status === "completed" && item.term_pdf_url && { label: "Abrir PDF", onClick: () => handlePdf("open", { id: item.digital_term_id, pdf_url: item.term_pdf_url }), primary: true }
                ]} />
              )}
              empty="Nenhuma solicitação enviada ainda. Use “Enviar termo para o cliente” para gerar o primeiro link."
              emptyFiltered="Nenhuma solicitação corresponde à busca."
            />
          </Tabs.Content>
          <Tabs.Content value="templates">
            <DataView
              rows={templates}
              loading={!templatesQuery.data}
              error={templatesQuery.data?.error || ""}
              defaultSort={{ key: "name", dir: "asc" }}
              searchPlaceholder="Buscar modelo"
              columns={[
                { key: "name", label: "Modelo", render: (item) => <div><strong>{item.name}</strong>{item.description && <><br /><small>{item.description}</small></>}</div> },
                { key: "kind_label", label: "Tipo" },
                { key: "is_active", label: "Situação", value: (item) => item.is_active ? "Ativo" : "Inativo", render: (item) => <StatusBadge status={item.is_active ? "Ativo" : "Inativo"} tone={item.is_active ? "ok" : "neutral"} /> },
                { key: "signed_count", label: "Assinados", value: (item) => Number(item.signed_count || 0) },
                { key: "pending_count", label: "Aguardando", value: (item) => Number(item.pending_count || 0) }
              ]}
              actions={(item) => (
                <RowActions actions={[
                  { label: "Editar modelo", onClick: () => openEditTemplate(item), primary: true },
                  { label: Number(item.signed_count || 0) + Number(item.pending_count || 0) > 0 ? "Arquivar modelo" : "Excluir modelo", onClick: () => setDeletingTemplate(item), danger: true }
                ]} />
              )}
              empty="Nenhum modelo cadastrado."
              emptyFiltered="Nenhum modelo corresponde à busca."
            />
          </Tabs.Content>
        </Tabs>
      </div>
      <TermRequestModal open={requestOpen} clients={clients} appointments={safeAppointments} onClose={() => { setRequestOpen(false); requestsQuery.refresh(); }} />
      <Modal open={Boolean(linkResult)} title="Novo link gerado" subtitle="O link anterior deixou de valer." onClose={() => setLinkResult(null)} footer={<Button onClick={() => setLinkResult(null)}>Concluir</Button>}>
        <TermLinkPanel result={linkResult} />
      </Modal>
      <Modal
        open={templateModal.open}
        size="lg"
        title={templateModal.editing ? "Editar modelo de termo" : "Novo modelo de termo"}
        subtitle="O cliente lê este texto antes de assinar."
        onClose={closeTemplateModal}
        footer={<><Button variant="secondary" onClick={closeTemplateModal} disabled={busy}>Cancelar</Button><Button type="submit" form="term-template-form" disabled={busy}>{busy ? "Salvando…" : "Salvar modelo"}</Button></>}
      >
        <form id="term-template-form" className="stack" onSubmit={saveTemplate}>
          <div className="form-grid">
            <Input label="Nome do modelo" value={templateForm.name} onChange={(name) => setTemplateForm({ ...templateForm, name })} required />
            <Select label="Tipo" value={templateForm.kind} onChange={(kind) => setTemplateForm({ ...templateForm, kind })}>
              {(templateKinds.length ? templateKinds : [{ value: "consent", label: "Termo de consentimento" }]).map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </Select>
          </div>
          <Input label="Descrição curta (opcional)" value={templateForm.description} onChange={(description) => setTemplateForm({ ...templateForm, description })} />
          <Textarea label="Texto do termo" rows={12} value={templateForm.content} onChange={(content) => setTemplateForm({ ...templateForm, content })} required hint="Escreva em parágrafos. Evite copiar termos genéricos: descreva o procedimento, os riscos e os cuidados da sua clínica." />
          <Checkbox label="Pedir o histórico de saúde antes da assinatura" checked={templateForm.requires_health_history} onChange={(value) => setTemplateForm({ ...templateForm, requires_health_history: value })} />
          <Checkbox label="Exigir responsável legal para menores de 18 anos" checked={templateForm.requires_guardian_for_minors} onChange={(value) => setTemplateForm({ ...templateForm, requires_guardian_for_minors: value })} />
          {templateModal.editing && <Checkbox label="Modelo ativo (disponível para envio)" checked={templateForm.is_active} onChange={(value) => setTemplateForm({ ...templateForm, is_active: value })} />}
          {actionError && <span className="form-error">{actionError}</span>}
        </form>
      </Modal>
      <ConfirmDeleteModal
        open={Boolean(deletingTemplate)}
        title={Number(deletingTemplate?.signed_count || 0) + Number(deletingTemplate?.pending_count || 0) > 0 ? "Arquivar modelo" : "Excluir modelo"}
        message={Number(deletingTemplate?.signed_count || 0) + Number(deletingTemplate?.pending_count || 0) > 0
          ? `O modelo “${deletingTemplate?.name}” já foi usado em termos assinados; ele será arquivado e deixa de aparecer para envio, mas o histórico continua íntegro.`
          : `Excluir o modelo “${deletingTemplate?.name}”?`}
        onClose={() => setDeletingTemplate(null)}
        onConfirm={async () => {
          await requestTermJson(`/term-templates/${deletingTemplate.id}`, { method: "DELETE" });
          setDeletingTemplate(null);
          templatesQuery.refresh();
        }}
      />
      <Modal open={modalOpen} size="lg" title="Novo termo digital" subtitle="Preencha a ficha por etapas e colete a assinatura." onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" form="digital-term-form">Salvar termo</Button></>}>
      <form id="digital-term-form" className="term-form" onSubmit={submit}>
        <Tabs value={formTab} onValueChange={setFormTab}>
          <Tabs.List className="term-form-tabs" aria-label="Etapas do termo">
            {[["dados", "Dados"], ["saude", "Saúde"], ["consentimento", "Consentimento"], ["assinatura", "Assinatura"]].map(([id, label]) => <Tabs.Trigger value={id} key={id}>{label}</Tabs.Trigger>)}
          </Tabs.List>
        </Tabs>
        {formTab === "dados" && <>
        <section className="term-section">
          <h3>Agendamento Vinculado</h3>
          <Select label="Agendamento" value={form.appointment_id} onChange={(value) => updateField("appointment_id", value)}>
            <option value="">{hasAppointments ? "Sem vínculo / preencher manualmente" : "Nenhum agendamento disponível"}</option>
            {safeAppointments.map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)}  {item.appointment_time}  {personName(item)}  {item.procedure}</option>)}
          </Select>
          {hasAppointments && appointmentTotal > safeAppointments.length && (
            <small>Exibindo os {safeAppointments.length} agendamentos mais recentes de {appointmentTotal}.</small>
          )}
          {!hasAppointments && <p className="empty-state">Você pode salvar a ficha sem agendamento vinculado. Quando houver agendamentos cadastrados, eles aparecerão aqui para seleção.</p>}
        </section>

        <section className="term-section">
          <h3>Dados Pessoais</h3>
          <div className="form-grid">
            <Input label="Nome Completo" value={form.full_name} onChange={(value) => updateField("full_name", value)} required />
            <Input label="Nome Social" value={form.social_name} onChange={(value) => updateField("social_name", value)} />
            <Input label="CPF / RG" value={form.document_number} onChange={(value) => updateField("document_number", value)} />
            <Input type="date" label="Data De Nascimento" value={form.birth_date} onChange={(value) => updateField("birth_date", value)} />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => updateField("whatsapp", value)} />
            <Input label="Telefone" value={form.phone} onChange={(value) => updateField("phone", value)} />
            <Input type="email" label="E-mail" value={form.email} onChange={(value) => updateField("email", value)} />
            <Input label="Instagram" value={form.instagram} onChange={(value) => updateField("instagram", value)} />
          </div>
          <Input label="Endereço" value={form.address} onChange={(value) => updateField("address", value)} />
        </section>
        </>}

        {formTab === "saude" && <>
        <section className="term-section">
          <h3>Histórico De Saúde</h3>
          <div className="term-check-grid">
            {DIGITAL_TERM_HEALTH_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`term-check-item ${form.form_data.health_history[item.key] ? "active" : ""}`}
                onClick={() => toggleHealthItem(item.key)}
              >
                <span>{form.form_data.health_history[item.key] ? "Sim" : "Não"}</span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="term-section">
          <h3>Estilo De Vida</h3>
          <div className="term-lifestyle-grid">
            {DIGITAL_TERM_LIFESTYLE_ITEMS.map((item) => (
              <Select key={item.key} className="term-choice" label={item.label} value={form.form_data.lifestyle[item.key]} onChange={(value) => updateFormData("lifestyle", item.key, value)}>
                  <option value="">Não Informado</option>
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                  <option value="Às Vezes">Às Vezes</option>
                  {item.key === "blood_pressure" && <option value="Normal">Normal</option>}
                  {item.key === "blood_pressure" && <option value="Alterada">Alterada</option>}
              </Select>
            ))}
          </div>
        </section>
        </>}

        {formTab === "consentimento" && <>
        <section className="term-section term-consent-section">
          <Checkbox className="checkbox-line" checked={form.orientations_confirmed} onChange={(value) => updateField("orientations_confirmed", value)} label="Confirmo que recebi orientações sobre cuidados, higienização, riscos, cicatrização e retornos." />
          <p>Declaro que recebi todas as informações referentes ao procedimento e que os materiais utilizados são devidamente esterilizados, lacrados e descartados após o atendimento.</p>
        </section>

        <section className="term-section">
          <div className="term-section-heading">
          <h3>Autorização para Menores</h3>
            <Checkbox className="checkbox-line compact" checked={form.form_data.minor.is_minor} onChange={(value) => updateFormData("minor", "is_minor", value)} label="Cliente Menor De Idade" />
          </div>
          {form.form_data.minor.is_minor && (
            <div className="form-grid">
              <Input label="Nome do Responsável" required value={form.form_data.minor.responsible_name} onChange={(value) => updateFormData("minor", "responsible_name", value)} />
              <Input label="Documento Do Responsável" required value={form.form_data.minor.responsible_document} onChange={(value) => updateFormData("minor", "responsible_document", value)} />
              <Input label="Nome Do Menor" value={form.form_data.minor.minor_name} onChange={(value) => updateFormData("minor", "minor_name", value)} />
            </div>
          )}
        </section>
        </>}

        {formTab === "assinatura" && <>
        <SignaturePad label="Assinatura da cliente" onChange={(signature) => updateField("signature_data_url", signature)} clearKey={form.appointment_id || "empty"} />
        {form.form_data.minor.is_minor && (
          <SignaturePad
            label="Assinatura do responsável legal"
            onChange={(signature) => updateField("guardian_signature_data_url", signature)}
            clearKey={`guardian-${form.appointment_id || "empty"}`}
          />
        )}
        <section className="term-section term-operational-section">
          <h3>Informações do Atendimento</h3>
          <p className="field-hint">Contexto operacional do atendimento. Os valores financeiros oficiais continuam no agendamento, pagamentos e financeiro.</p>
          <div className="form-grid">
            <Input label="Procedimento" value={form.procedure} onChange={(value) => updateField("procedure", value)} />
            <Input label="Região da Perfuração" value={form.piercing_region} onChange={(value) => updateField("piercing_region", value)} />
            <Input label="Local da Aplicação" value={form.form_data.information.application_location} onChange={(value) => updateFormData("information", "application_location", value)} />
            <Input label="Joia" value={form.form_data.information.jewelry} onChange={(value) => updateFormData("information", "jewelry", value)} />
            <Input label="Valor informado no contexto" value={form.form_data.information.value} onChange={(value) => updateFormData("information", "value", value)} />
          </div>
          <div className="term-notes"><Textarea label="Observação operacional" value={form.form_data.information.observation} onChange={(value) => updateFormData("information", "observation", value)} /></div>
          <div className="term-notes"><Textarea label="Declaração de Saúde e Observações" value={form.health_declaration} onChange={(value) => updateField("health_declaration", value)} /></div>
        </section>
        </>}
        {error && <span className="form-error">{error}</span>}
      </form>
      </Modal>

      <div className="panel" hidden>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Registro</span>
            <h2>Termos Salvos</h2>
          </div>
          <span>{safeTerms.length} registro(s)</span>
        </div>
        <DataView
          rows={safeTerms}
          loading={!terms}
          error={terms?.error || ""}
          defaultSort={{ key: "signed_at", dir: "desc" }}
          searchPlaceholder="Buscar por cliente, procedimento ou profissional"
          filters={[
            {
              key: "from",
              label: "Assinado a partir de",
              type: "date",
              match: (term, value) => String(term.signed_at || "").slice(0, 10) >= value
            },
            {
              key: "to",
              label: "Assinado até",
              type: "date",
              match: (term, value) => String(term.signed_at || "").slice(0, 10) <= value
            }
          ]}
          columns={[
            { key: "full_name", label: "Cliente", render: (term) => <strong>{term.full_name}</strong> },
            {
              key: "procedure",
              label: "Procedimento",
              value: (term) => `${term.procedure || ""} ${term.appointment_id ? `${term.appointment_date || ""} ${term.appointment_time || ""}` : ""}`,
              render: (term) => (
                <div>
                  <span>{term.procedure || "Ficha sem procedimento informado"}</span>
                  {term.appointment_id && <><br /><small>{formatDateWithYear(term.appointment_date)} · {term.appointment_time || ""}</small></>}
                </div>
              )
            },
            {
              key: "professional_name",
              label: "Profissional",
              render: (term) => term.professional_name || "Sem profissional vinculado"
            },
            {
              key: "signed_at",
              label: "Assinado em",
              value: (term) => String(term.signed_at || ""),
              render: (term) => formatDateWithYear(term.signed_at)
            },
            { key: "pdf_url", label: "PDF", sortable: false, searchable: false, render: (term) => term.pdf_url ? "Disponível" : "—" }
          ]}
          actions={(term) => term.pdf_url ? <RowActions
            actions={[
              { label: "Abrir PDF", onClick: () => handlePdf("open", term), primary: true },
              { label: "Baixar PDF", onClick: () => handlePdf("download", term) },
            ]}
          /> : null}
          empty="Nenhum termo assinado ainda."
          emptyFiltered="Nenhum termo corresponde à busca ou ao período."
        />
      </div>
    </section>
  );
}

export function LoyaltyPanel({ client, onChanged }) {
  const loyalty = client.loyalty || { availablePoints: 0, totalEarned: 0, level: "Cliente Aura", benefits: [], history: [], redemptions: [], redeemedPoints: 0 };
  /** @type {[Record<string, any>, React.Dispatch<React.SetStateAction<Record<string, any>>>]} */
  const [redeem, setRedeem] = useState({ points_used: 10, discount_value: 0, notes: "" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/clients/${client.id}/loyalty-redemptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(redeem)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível resgatar desconto.");
    setRedeem({ points_used: 10, discount_value: 0, notes: "" });
    onChanged();
  }

  return (
    <div className="loyalty-panel">
      <div className="loyalty-summary">
        <div>
          <span className="eyebrow">Programa de fidelidade</span>
          <h3>{loyalty.level}</h3>
          <p>{loyalty.availablePoints} pontos disponíveis · {loyalty.totalEarned} pontos acumulados</p>
        </div>
        <StatusBadge tone="ok">{loyalty.redeemedPoints} pontos resgatados</StatusBadge>
      </div>
      <div className="loyalty-grid">
        <div>
          <h4>Benefícios por nível</h4>
          <ul className="benefit-list">
            {asArray(loyalty.benefits).map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </div>
        <form onSubmit={submit} className="redeem-form">
          <h4>Resgatar desconto</h4>
          <div className="form-grid">
            <Input type="number" label="Pontos" value={redeem.points_used} onChange={(value) => setRedeem({ ...redeem, points_used: value })} />
            <Input type="number" label="Desconto R$" value={redeem.discount_value} onChange={(value) => setRedeem({ ...redeem, discount_value: value })} />
          </div>
          <Input label="Observação" value={redeem.notes} onChange={(value) => setRedeem({ ...redeem, notes: value })} />
          {error && <span className="form-error">{error}</span>}
          <Button variant="primary" type="submit">Resgatar</Button>
        </form>
      </div>
      <div className="loyalty-history">
        <div>
          <h4>Histórico de pontos</h4>
          {(loyalty.history || []).slice(0, 5).map((item) => <p key={item.id}><strong>+{item.points}</strong> {item.description}</p>)}
          {!loyalty.history?.length && <small>Sem pontos registrados ainda.</small>}
        </div>
        <div>
          <h4>Resgates</h4>
          {(loyalty.redemptions || []).slice(0, 5).map((item) => <p key={item.id}><strong>-{item.points_used}</strong> {currency.format(item.discount_value)} · {item.notes || "desconto"}</p>)}
          {!loyalty.redemptions?.length && <small>Nenhum resgate realizado.</small>}
        </div>
      </div>
    </div>
  );
}

// Compatibilidade: o componente mora em components/common e é usado também na
// página pública do termo.
export { SignaturePad };
