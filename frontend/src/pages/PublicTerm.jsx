// Termo digital assinado pelo próprio cliente, pelo link individual gerado no
// painel (/termo/<token>?t=<clínica>). Funciona no celular do cliente, no
// tablet do estúdio ou à distância; não exige sessão.
import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";
import { apiFetch } from "../lib/api";
import { Checkbox, Input, Textarea } from "../components/common/Ui";
import { SignaturePad } from "../components/common/SignaturePad";
import { DIGITAL_TERM_HEALTH_ITEMS } from "../lib/defaultForms";
import "../styles/public-term.css";

function tokenFromPath(pathname = window.location.pathname) {
  const match = /^\/termo\/([A-Za-z0-9_-]+)/.exec(String(pathname || ""));
  return match ? match[1] : "";
}

function ageFromBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const birth = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

const KIND_LABELS = { consent: "Termo de consentimento", authorization: "Autorização", procedure: "Termo do procedimento", other: "Documento de aceite" };

export function PublicTerm() {
  const token = tokenFromPath();
  const [state, setState] = useState({ status: "loading", data: null, error: "", code: "" });
  const [form, setForm] = useState({
    full_name: "", social_name: "", document_number: "", birth_date: "", whatsapp: "", email: "",
    health_history: Object.fromEntries(DIGITAL_TERM_HEALTH_ITEMS.map((item) => [item.key, false])),
    health_declaration: "", orientations_confirmed: false, signature_data_url: "",
    is_minor: false, responsible_name: "", responsible_document: "", guardian_signature_data_url: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    if (!token) { setState({ status: "error", data: null, error: "Link inválido. Peça um novo link ao estúdio.", code: "not_found" }); return undefined; }
    apiFetch(`/public/terms/${encodeURIComponent(token)}`)
      .then(async (response) => ({ ok: response.ok, payload: await response.json().catch(() => ({})) }))
      .then(({ ok, payload }) => {
        if (!active) return;
        if (!ok) { setState({ status: "error", data: null, error: payload.error || "Não foi possível abrir o termo.", code: payload.code || "" }); return; }
        setState({ status: "ready", data: payload, error: "", code: "" });
        setForm((current) => ({
          ...current,
          full_name: payload.client?.full_name || "",
          social_name: payload.client?.social_name || "",
          document_number: payload.client?.document_number || "",
          birth_date: payload.client?.birth_date || "",
          whatsapp: payload.client?.whatsapp || "",
          email: payload.client?.email || ""
        }));
      })
      .catch(() => { if (active) setState({ status: "error", data: null, error: "Sem conexão com o estúdio. Tente novamente em instantes.", code: "" }); });
    return () => { active = false; };
  }, [token]);

  const data = state.data;
  const template = data?.template;
  const requiresHealth = template ? template.requires_health_history : true;
  const age = ageFromBirthDate(form.birth_date);
  const minorByAge = age !== null && age < 18;
  const isMinor = form.is_minor || minorByAge;

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setFormError("");
    if (!form.full_name.trim()) return setFormError("Informe seu nome completo.");
    if (!form.orientations_confirmed) return setFormError("Confirme que leu o termo e recebeu as orientações.");
    if (!form.signature_data_url) return setFormError("Assine no quadro antes de enviar.");
    if (isMinor && (!form.responsible_name.trim() || !form.responsible_document.trim())) return setFormError("Informe nome e documento do responsável legal.");
    if (isMinor && !form.guardian_signature_data_url) return setFormError("A assinatura do responsável legal é obrigatória.");
    setSubmitting(true);
    try {
      const response = await apiFetch(`/public/terms/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          social_name: form.social_name.trim(),
          document_number: form.document_number.trim(),
          birth_date: form.birth_date,
          whatsapp: form.whatsapp.trim(),
          email: form.email.trim(),
          orientations_confirmed: true,
          health_declaration: form.health_declaration.trim(),
          signature_data_url: form.signature_data_url,
          guardian_signature_data_url: isMinor ? form.guardian_signature_data_url : "",
          form_data: {
            health_history: form.health_history,
            minor: { is_minor: isMinor, responsible_name: form.responsible_name.trim(), responsible_document: form.responsible_document.trim(), minor_name: isMinor ? form.full_name.trim() : "" }
          }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.code === "completed") { setState({ status: "done", data, error: "", code: "completed" }); return; }
        setFormError(payload.error || "Não foi possível enviar o termo. Tente novamente.");
        return;
      }
      setState({ status: "done", data: { ...data, signed: payload.term }, error: "", code: "" });
      window.scrollTo({ top: 0 });
    } catch {
      setFormError("Sem conexão. Verifique a internet e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  const clinicName = data?.clinic?.name || "Estúdio";

  return (
    <div className="term-public">
      <header className="term-public-header">
        <div className="term-public-header-inner">
          <span className="term-public-kicker">Termo digital · {clinicName}</span>
          <h1>{template?.name || "Termo digital"}</h1>
          {template?.kind && <p>{KIND_LABELS[template.kind] || "Documento de aceite"}{data?.appointment?.date ? ` · atendimento em ${String(data.appointment.date).split("-").reverse().join("/")}${data.appointment.time ? ` às ${data.appointment.time}` : ""}` : ""}</p>}
        </div>
      </header>

      <main className="term-public-main">
        {state.status === "loading" && <section className="term-public-card term-public-state"><p>Carregando o termo…</p></section>}

        {state.status === "error" && (
          <section className="term-public-card term-public-state is-error" role="alert">
            <span className="term-public-icon" aria-hidden="true"><TriangleAlert size={30} /></span>
            <h2>{state.code === "completed" ? "Termo já assinado" : "Não foi possível abrir o termo"}</h2>
            <p>{state.error}</p>
          </section>
        )}

        {state.status === "done" && (
          <section className="term-public-card term-public-state" role="status">
            <span className="term-public-icon" aria-hidden="true"><CheckCircle2 size={32} /></span>
            <h2>Termo assinado com sucesso</h2>
            <p>Obrigado, {form.full_name.split(" ")[0] || "cliente"}. O documento ficou registrado no seu histórico em {clinicName}.</p>
            <p className="term-public-muted">Você já pode fechar esta página.</p>
          </section>
        )}

        {state.status === "ready" && (
          <form className="stack" onSubmit={submit}>
            {data?.request?.message && <section className="term-public-card"><p className="term-public-muted">Mensagem do estúdio</p><p>{data.request.message}</p></section>}

            <section className="term-public-card">
              <h2>1. Leia o termo</h2>
              {template?.description && <p className="field-hint">{template.description}</p>}
              <div className="term-public-content" tabIndex={0} aria-label="Texto do termo">{template?.content || "Texto do termo indisponível."}</div>
            </section>

            <section className="term-public-card">
              <h2>2. Confira seus dados</h2>
              <div className="term-public-grid">
                <Input label="Nome completo" value={form.full_name} onChange={(value) => update("full_name", value)} required autoComplete="name" />
                <Input label="Nome social (opcional)" value={form.social_name} onChange={(value) => update("social_name", value)} />
                <Input label="CPF ou RG" value={form.document_number} onChange={(value) => update("document_number", value)} inputMode="numeric" />
                <Input type="date" label="Data de nascimento" value={form.birth_date} onChange={(value) => update("birth_date", value)} required />
                <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => update("whatsapp", value)} inputMode="tel" autoComplete="tel" />
                <Input type="email" label="E-mail (opcional)" value={form.email} onChange={(value) => update("email", value)} autoComplete="email" />
              </div>
            </section>

            {requiresHealth && (
              <section className="term-public-card">
                <h2>3. Histórico de saúde</h2>
                <p className="field-hint">Toque no que se aplica a você. Isso ajuda a equipe a cuidar bem do seu procedimento.</p>
                <div className="term-public-check-grid">
                  {DIGITAL_TERM_HEALTH_ITEMS.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className="term-public-check"
                      aria-pressed={Boolean(form.health_history[item.key])}
                      onClick={() => update("health_history", { ...form.health_history, [item.key]: !form.health_history[item.key] })}
                    >
                      <span aria-hidden="true">{form.health_history[item.key] ? "✓" : ""}</span>
                      {item.label}
                    </button>
                  ))}
                </div>
                <Textarea label="Alergias, medicamentos em uso ou outras observações (opcional)" value={form.health_declaration} onChange={(value) => update("health_declaration", value)} />
              </section>
            )}

            <section className="term-public-card">
              <h2>{requiresHealth ? "4" : "3"}. Responsável legal</h2>
              <Checkbox
                className="term-public-consent"
                checked={isMinor}
                disabled={minorByAge}
                onChange={(value) => update("is_minor", value)}
                label={<><strong>Tenho menos de 18 anos</strong>{minorByAge ? "Pela data de nascimento informada, o responsável legal precisa autorizar e assinar." : "Marque se um responsável legal precisa autorizar o procedimento."}</>}
              />
              {isMinor && (
                <div className="term-public-grid">
                  <Input label="Nome do responsável legal" value={form.responsible_name} onChange={(value) => update("responsible_name", value)} required />
                  <Input label="Documento do responsável" value={form.responsible_document} onChange={(value) => update("responsible_document", value)} required />
                </div>
              )}
            </section>

            <section className="term-public-card">
              <h2>{requiresHealth ? "5" : "4"}. Aceite e assinatura</h2>
              <Checkbox
                className="term-public-consent"
                checked={form.orientations_confirmed}
                onChange={(value) => update("orientations_confirmed", value)}
                label={<><strong>Li e aceito o termo acima</strong>Confirmo que recebi as orientações sobre cuidados, higienização, riscos, cicatrização e retornos, e que as informações prestadas são verdadeiras.</>}
              />
              <SignaturePad label={isMinor ? "Assinatura do(a) cliente" : "Sua assinatura"} onChange={(value) => update("signature_data_url", value)} clearKey={token} />
              {isMinor && <SignaturePad label="Assinatura do responsável legal" onChange={(value) => update("guardian_signature_data_url", value)} clearKey={`guardian-${token}`} />}
              <p className="term-public-muted"><ShieldCheck size={14} aria-hidden="true" /> O aceite fica registrado com data, hora e uma verificação de integridade; depois de enviado, o termo não pode ser alterado.</p>
            </section>

            {formError && <p className="term-public-error" role="alert">{formError}</p>}
            <div className="term-public-actions">
              <button type="submit" className="primary-button" disabled={submitting}>{submitting ? "Enviando…" : "Assinar e enviar"}</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
