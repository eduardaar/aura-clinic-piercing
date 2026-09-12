// Envio de termo digital para o cliente assinar: gera um link individual
// (para abrir no tablet/celular do estúdio ou mandar pelo WhatsApp) e mostra
// o link pronto com as ações de copiar, enviar e abrir.
import { useEffect, useState } from "react";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { Button, Input, Select, Textarea } from "../../components/common/Ui";
import { Modal } from "../../components/common/Crud";
import { apiFetch, useFetch } from "../../lib/api";
import { asArray, asObject } from "../../lib/utils";
import { personName } from "../shared/helpers";

export const TERM_REQUEST_STATUS_LABELS = Object.freeze({
  pending: "Aguardando",
  completed: "Assinado",
  cancelled: "Cancelado",
  expired: "Expirado"
});
export const TERM_REQUEST_STATUS_TONES = Object.freeze({ pending: "warn", completed: "ok", cancelled: "neutral", expired: "danger" });
export const TERM_REQUEST_CHANNEL_LABELS = Object.freeze({ in_studio: "No estúdio", remote: "Por link (à distância)" });

export async function requestTermJson(path, options) {
  const response = await apiFetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

export function formatExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Link pronto: copiar, mandar pelo WhatsApp ou abrir agora (no estúdio).
export function TermLinkPanel({ result }) {
  const [copied, setCopied] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  if (!result?.url) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="term-link-panel">
      <p>
        <strong>Link pronto para {result.client_name || "o cliente"}.</strong>{" "}
        É individual, vale até {formatExpiry(result.expires_at)} e só pode ser usado uma vez.
      </p>
      <Input label="Link do termo" value={result.url} readOnly onFocus={(event) => event.target.select()} />
      <div className="term-link-actions">
        <Button type="button" variant="secondary" onClick={copy}><Copy size={16} /> {copied ? "Copiado!" : "Copiar link"}</Button>
        {result.whatsapp_url && (
          <a className="primary-button" href={result.whatsapp_url} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Enviar pelo WhatsApp</a>
        )}
        <a className="secondary-button" href={result.url} target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> {result.channel === "in_studio" ? "Abrir para o cliente preencher" : "Abrir o link"}
        </a>
      </div>
      {result.message_text && (
        <div className="term-link-message">
          <Button type="button" variant="ghost" onClick={() => setShowMessage((current) => !current)} aria-expanded={showMessage}>
            {showMessage ? "Ocultar mensagem sugerida" : "Ver mensagem sugerida"}
          </Button>
          {showMessage && <pre>{result.message_text}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {any} [props.client] Cliente fixo (perfil); sem ele, a lista `clients` é oferecida.
 * @param {any[]} [props.clients]
 * @param {any[]} [props.appointments] Agendamentos do cliente para vincular (opcional).
 * @param {(result: any) => void} [props.onCreated]
 */
export function TermRequestModal({ open, onClose, client = null, clients = [], appointments = [], onCreated }) {
  const templatesQuery = useFetch(open ? "/term-templates" : "");
  const templates = asArray(asObject(templatesQuery.data).items);
  const [form, setForm] = useState({ client_id: "", template_id: "", appointment_id: "", channel: "remote", expires_in_hours: "72", message: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError("");
    setForm((current) => ({
      ...current,
      client_id: client?.id ? String(client.id) : "",
      appointment_id: "",
      template_id: current.template_id || (templates[0]?.id ? String(templates[0].id) : "")
    }));
  }, [open, client?.id]);
  useEffect(() => {
    if (!form.template_id && templates[0]?.id) setForm((current) => ({ ...current, template_id: String(templates[0].id) }));
  }, [templates.length]);

  const selectedClient = client || clients.find((item) => String(item.id) === String(form.client_id)) || null;
  const clientAppointments = asArray(appointments).filter((item) => !selectedClient || String(item.client_id) === String(selectedClient.id));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeChannel(channel) {
    setForm((current) => ({ ...current, channel, expires_in_hours: channel === "in_studio" ? "6" : "72" }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.client_id) return setError("Selecione o cliente.");
    if (!form.template_id) return setError("Selecione o modelo de termo.");
    setBusy(true);
    try {
      const payload = await requestTermJson("/term-requests", {
        method: "POST",
        body: JSON.stringify({
          client_id: form.client_id,
          template_id: form.template_id,
          appointment_id: form.appointment_id || null,
          channel: form.channel,
          expires_in_hours: Number(form.expires_in_hours) || undefined,
          message: form.message
        })
      });
      setResult(payload);
      onCreated?.(payload);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={result ? "Link gerado" : "Enviar termo para o cliente"}
      subtitle={result ? "Compartilhe o link com o cliente." : "O cliente lê, preenche e assina no próprio celular ou no tablet do estúdio."}
      onClose={onClose}
      confirmClose={!result}
      footer={result
        ? <Button type="button" onClick={onClose}>Concluir</Button>
        : <><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" form="term-request-form" disabled={busy}>{busy ? "Gerando…" : "Gerar link"}</Button></>}
    >
      {result ? <TermLinkPanel result={result} /> : (
        <form id="term-request-form" className="stack" onSubmit={submit}>
          {client ? (
            <p><strong>Cliente:</strong> {personName(client)}{client.whatsapp ? ` · ${client.whatsapp}` : ""}</p>
          ) : (
            <Select label="Cliente" value={form.client_id} onChange={(value) => update("client_id", value)} required>
              <option value="">Selecione</option>
              {clients.map((item) => <option key={item.id} value={item.id}>{personName(item)}{item.whatsapp ? ` · ${item.whatsapp}` : ""}</option>)}
            </Select>
          )}
          <Select label="Modelo de termo" value={form.template_id} onChange={(value) => update("template_id", value)} required>
            <option value="">{templatesQuery.loading ? "Carregando…" : "Selecione"}</option>
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          {clientAppointments.length > 0 && (
            <Select label="Vincular ao atendimento (opcional)" value={form.appointment_id} onChange={(value) => update("appointment_id", value)}>
              <option value="">Sem vínculo</option>
              {clientAppointments.map((item) => <option key={item.id} value={item.id}>{String(item.appointment_date || "").split("-").reverse().join("/")} {item.appointment_time || ""} · {item.procedure || "Atendimento"}</option>)}
            </Select>
          )}
          <Select label="Como o cliente vai assinar" value={form.channel} onChange={changeChannel}>
            <option value="remote">À distância: envio o link pelo WhatsApp</option>
            <option value="in_studio">No estúdio: abro o link no celular ou tablet</option>
          </Select>
          <Select label="Validade do link" value={form.expires_in_hours} onChange={(value) => update("expires_in_hours", value)}>
            <option value="6">6 horas</option>
            <option value="24">24 horas</option>
            <option value="72">3 dias</option>
            <option value="168">7 dias</option>
          </Select>
          <Textarea label="Mensagem para o cliente (opcional)" value={form.message} onChange={(value) => update("message", value)} hint="Aparece no topo da página do termo." />
          {error && <span className="form-error">{error}</span>}
        </form>
      )}
    </Modal>
  );
}
