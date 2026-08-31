// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Checkbox, Input, Select, StatusBadge, Tabs, Textarea } from "../../components/common/Ui";
import { Modal, CrudHeader, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { asArray, asObject, formatDate } from "../../lib/utils";
import { apiFetch, downloadApiFile, openApiFile, useFetch } from "../../lib/api";
import { DIGITAL_TERM_HEALTH_ITEMS, DIGITAL_TERM_LIFESTYLE_ITEMS, defaultDigitalTerm } from "../../lib/defaultForms";
import { currency, personName } from "../../features/shared/helpers";

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
        <CrudHeader title="Termos digitais" subtitle="Fichas assinadas e prontas para PDF." actionLabel="Novo termo" onAction={openNew} />
        <div className="module-backbar"><Button variant="secondary" onClick={onBack}><ArrowLeft size={16} /> Voltar para clientes</Button></div>
        {fileError && <p className="form-error" role="alert">{fileError}</p>}
        <DataView
          rows={safeTerms}
          loading={!terms}
          error={terms?.error || ""}
          defaultSort={{ key: "signed_at", dir: "desc" }}
          searchPlaceholder="Buscar por cliente, procedimento ou profissional"
          filters={[{ key: "from", label: "Assinado a partir de", type: "date", match: (term, value) => String(term.signed_at || "").slice(0, 10) >= value }, { key: "to", label: "Assinado até", type: "date", match: (term, value) => String(term.signed_at || "").slice(0, 10) <= value }]}
          columns={[{ key: "full_name", label: "Cliente", render: (term) => <strong>{term.full_name}</strong> }, { key: "procedure", label: "Procedimento", value: (term) => `${term.procedure || ""} ${term.appointment_date || ""}`, render: (term) => <div><span>{term.procedure || "Ficha sem procedimento informado"}</span>{term.appointment_id && <><br /><small>{formatDateWithYear(term.appointment_date)} · {term.appointment_time || ""}</small></>}</div> }, { key: "professional_name", label: "Profissional", render: (term) => term.professional_name || "Sem profissional vinculado" }, { key: "signed_at", label: "Assinado em", value: (term) => String(term.signed_at || ""), render: (term) => formatDateWithYear(term.signed_at) }, { key: "pdf_url", label: "PDF", sortable: false, searchable: false, render: (term) => term.pdf_url ? "Disponível" : "—" }]}
          actions={(term) => term.pdf_url ? <RowActions actions={[{ label: "Abrir PDF", onClick: () => handlePdf("open", term), primary: true }, { label: "Baixar PDF", onClick: () => handlePdf("download", term) }]} /> : null}
          empty="Nenhum termo assinado ainda."
          emptyFiltered="Nenhum termo corresponde à busca ou ao período."
        />
      </div>
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

export function SignaturePad({ onChange, clearKey, label = "Assinatura digital" }) {
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fffdfb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#171412";
    context.lineWidth = 2;
    context.lineCap = "round";
    onChange("");
  }, [clearKey]);

  function point(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0];
    return {
      x: ((touch?.clientX ?? event.clientX) - rect.left) * (canvas.width / rect.width),
      y: ((touch?.clientY ?? event.clientY) - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(event) {
    event.preventDefault();
    drawingRef.current = true;
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
  }

  function move(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
    onChange(canvasRef.current.toDataURL("image/png"));
  }

  function stop() {
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdfb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="signature-box">
      <div className="signature-heading">
        <span>{label}</span>
        <Button type="button" variant="secondary" onClick={clear}>Limpar</Button>
      </div>
      <canvas ref={canvasRef} width="720" height="220" onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={move} onTouchEnd={stop} />
    </div>
  );
}
