// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useState } from "react";
import { Download, Instagram } from "lucide-react";
import { Input, Select } from "../../components/common/Ui";
import { asArray, formatDate } from "../../lib/utils";
import { API_ORIGIN, apiFetch, useFetch } from "../../lib/api";
import { DIGITAL_TERM_HEALTH_ITEMS, DIGITAL_TERM_LIFESTYLE_ITEMS, defaultDigitalTerm } from "../../lib/defaultForms";
import { currency } from "../../features/shared/helpers";

export function DigitalTerms() {
  const { data: appointments } = useFetch("/appointments");
  const { data: terms, refresh } = useFetch("/digital-terms");
  const [form, setForm] = useState(defaultDigitalTerm());
  const [error, setError] = useState("");
  const [savedTerm, setSavedTerm] = useState(null);

  const safeAppointments = asArray(appointments);
  const safeTerms = asArray(terms);
  const selectedAppointment = safeAppointments.find((item) => String(item.id) === String(form.appointment_id));

  useEffect(() => {
    if (!selectedAppointment) return;
    setForm((current) => ({
      ...current,
      client_id: selectedAppointment.client_id,
      full_name: current.full_name || selectedAppointment.full_name,
      whatsapp: current.whatsapp || selectedAppointment.whatsapp,
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

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSavedTerm(null);
    if (!form.signature_data_url) return setError("Assinatura digital obrigatória.");
    const response = await apiFetch(`/digital-terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Não foi possível salvar o termo.");
    setSavedTerm(data);
    setForm(defaultDigitalTerm());
    refresh();
  }

  return (
    <section className="terms-layout terms-anamnesis-layout">
      <form className="panel term-form" onSubmit={submit}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Termos Digitais</span>
            <h2>Ficha De Anamnese</h2>
          </div>
          <span>{safeAppointments.length} agendamento(s)</span>
        </div>

        <div className="term-intro">
          <strong>Estrutura clínica fiel ao documento físico.</strong>
          <p>Dados pessoais, histórico de saúde, estilo de vida, consentimento, autorização para menores e assinatura digital.</p>
        </div>

        <div className="term-chip-row">
          <span>Dados Pessoais</span>
          <span>Histórico De Saúde</span>
          <span>Estilo De Vida</span>
          <span>Consentimento</span>
          <span>Assinatura Digital</span>
        </div>

        <section className="term-section">
          <h3>Agendamento Vinculado</h3>
          <Select label="Agendamento" value={form.appointment_id} onChange={(value) => updateField("appointment_id", value)} required>
            <option value="">Selecione</option>
            {safeAppointments.map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)}  {item.appointment_time}  {item.full_name}  {item.procedure}</option>)}
          </Select>
        </section>

        <section className="term-section">
          <h3>Dados Pessoais</h3>
          <div className="form-grid">
            <Input label="Nome Completo" value={form.full_name} onChange={(value) => updateField("full_name", value)} required />
            <Input label="Nome Social" value={form.social_name} onChange={(value) => updateField("social_name", value)} />
            <Input label="CPF / RG" value={form.document_number} onChange={(value) => updateField("document_number", value)} />
            <Input type="date" label="Data De Nascimento" value={form.birth_date} onChange={(value) => updateField("birth_date", value)} />
            <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => updateField("whatsapp", value)} />
            <Input label="Instagram" value={form.instagram} onChange={(value) => updateField("instagram", value)} />
          </div>
          <Input label="Endereço" value={form.address} onChange={(value) => updateField("address", value)} />
        </section>

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
              <label key={item.key} className="term-choice">
                {item.label}
                <select value={form.form_data.lifestyle[item.key]} onChange={(event) => updateFormData("lifestyle", item.key, event.target.value)}>
                  <option value="">Não Informado</option>
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                  <option value="Às Vezes">Às Vezes</option>
                  {item.key === "blood_pressure" && <option value="Normal">Normal</option>}
                  {item.key === "blood_pressure" && <option value="Alterada">Alterada</option>}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="term-section">
          <h3>Informações do Atendimento</h3>
          <div className="form-grid">
            <Input label="Procedimento" value={form.procedure} onChange={(value) => updateField("procedure", value)} />
            <Input label="Região da Perfuração" value={form.piercing_region} onChange={(value) => updateField("piercing_region", value)} />
            <Input label="Local da Aplicação" value={form.form_data.information.application_location} onChange={(value) => updateFormData("information", "application_location", value)} />
            <Input label="Joia" value={form.form_data.information.jewelry} onChange={(value) => updateFormData("information", "jewelry", value)} />
            <Input label="Valor" value={form.form_data.information.value} onChange={(value) => updateFormData("information", "value", value)} />
          </div>
          <label className="term-notes">
            Observação
            <textarea
              value={form.form_data.information.observation}
              onChange={(event) => updateFormData("information", "observation", event.target.value)}
              placeholder="Alergias, medicamentos, gestação, queloide, observações clínicas ou qualquer detalhe importante."
            />
          </label>
          <label className="term-notes">
            Declaração de Saúde e Observações
            <textarea
              value={form.health_declaration}
              onChange={(event) => updateField("health_declaration", event.target.value)}
              placeholder="Texto complementar livre, se necessário."
            />
          </label>
        </section>

        <section className="term-section term-consent-section">
          <label className="checkbox-line">
            <input type="checkbox" checked={form.orientations_confirmed} onChange={(event) => updateField("orientations_confirmed", event.target.checked)} />
            Confirmo que recebi orientações sobre cuidados, higienização, riscos, cicatrização e retornos.
          </label>
          <p>Declaro que recebi todas as informações referentes ao procedimento e que os materiais utilizados são devidamente esterilizados, lacrados e descartados após o atendimento.</p>
        </section>

        <section className="term-section">
          <div className="term-section-heading">
          <h3>Autorização para Menores</h3>
            <label className="checkbox-line compact">
              <input
                type="checkbox"
                checked={form.form_data.minor.is_minor}
                onChange={(event) => updateFormData("minor", "is_minor", event.target.checked)}
              />
              Cliente Menor De Idade
            </label>
          </div>
          {form.form_data.minor.is_minor && (
            <div className="form-grid">
              <Input label="Nome do Responsável" value={form.form_data.minor.responsible_name} onChange={(value) => updateFormData("minor", "responsible_name", value)} />
              <Input label="Documento Do Responsável" value={form.form_data.minor.responsible_document} onChange={(value) => updateFormData("minor", "responsible_document", value)} />
              <Input label="Nome Do Menor" value={form.form_data.minor.minor_name} onChange={(value) => updateFormData("minor", "minor_name", value)} />
            </div>
          )}
        </section>

        <SignaturePad onChange={(signature) => updateField("signature_data_url", signature)} clearKey={form.appointment_id || "empty"} />
        {error && <span className="form-error">{error}</span>}
        <div className="modal-actions">
          {savedTerm?.pdf_url && <a className="secondary-button" href={`${API_ORIGIN}${savedTerm.pdf_url}`} target="_blank" rel="noreferrer"><Download size={16} /> Abrir PDF Salvo</a>}
          <button className="primary-button">Salvar Termo Em PDF</button>
        </div>
      </form>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Registro</span>
            <h2>Termos Salvos</h2>
          </div>
          <span>{safeTerms.length} registro(s)</span>
        </div>
        <div className="terms-list">
          {safeTerms.map((term) => (
            <article className="term-row" key={term.id}>
              <div>
                <strong>{term.full_name}</strong>
                <span>{formatDate(term.appointment_date)}  {term.appointment_time}  {term.procedure}</span>
                <small>{term.professional_name}  assinado em {new Date(term.signed_at).toLocaleDateString("pt-BR")}</small>
              </div>
              {term.pdf_url && <a className="secondary-button" href={`${API_ORIGIN}${term.pdf_url}`} target="_blank" rel="noreferrer">PDF</a>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LoyaltyPanel({ client, onChanged }) {
  const loyalty = client.loyalty || { availablePoints: 0, totalEarned: 0, level: "Cliente Aura", benefits: [], history: [], redemptions: [], redeemedPoints: 0 };
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
        <span className="status-badge status-confirmado">{loyalty.redeemedPoints} pontos resgatados</span>
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
          <button className="primary-button">Resgatar</button>
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

export function SignaturePad({ onChange, clearKey }) {
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
        <span>Assinatura digital</span>
        <button type="button" onClick={clear}>Limpar</button>
      </div>
      <canvas ref={canvasRef} width="720" height="220" onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={move} onTouchEnd={stop} />
    </div>
  );
}

