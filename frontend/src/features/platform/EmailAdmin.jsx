import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, StatusBadge, Switch } from "../../components/common/Ui";
import { API } from "../../lib/api";

const EMPTY_FORM = {
  host: "",
  port: "587",
  secure: false,
  require_tls: true,
  username: "",
  password: "",
  from_name: "",
  from_email: "",
  reply_to: "",
  enabled: false,
};

class EmailSettingsApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function providerLabel(provider) {
  if (provider === "smtp") return "SMTP do painel";
  if (provider === "resend") return "Resend (fallback do servidor)";
  return "Nenhum provedor ativo";
}

export function EmailAdmin({ token, onUnauthorized }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [smtp, setSmtp] = useState(null);
  const [active, setActive] = useState(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState(null);
  const unauthorizedRef = useRef(onUnauthorized);

  useEffect(() => {
    unauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const request = useCallback(async (path, options = {}) => {
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      unauthorizedRef.current?.();
      throw new EmailSettingsApiError("Sua sessão expirou.", 401);
    }
    if (!response.ok) {
      throw new EmailSettingsApiError(payload.error || "Não foi possível concluir a operação.", response.status);
    }
    return payload;
  }, [token]);

  const applySettings = useCallback((payload) => {
    const current = payload.smtp || {};
    setSmtp(current);
    setActive(payload.active || null);
    setForm({
      host: current.host || "",
      port: String(current.port || 587),
      secure: Boolean(current.secure),
      require_tls: current.require_tls !== false,
      username: current.username || "",
      password: "",
      from_name: current.from_name || "",
      from_email: current.from_email || "",
      reply_to: current.reply_to || "",
      enabled: Boolean(current.enabled),
    });
  }, []);

  useEffect(() => {
    let activeRequest = true;
    setLoading(true);
    request("/platform/email-settings")
      .then((payload) => activeRequest && applySettings(payload))
      .catch((error) => {
        if (activeRequest && error.status !== 401) setFeedback({ tone: "error", text: error.message });
      })
      .finally(() => activeRequest && setLoading(false));
    return () => { activeRequest = false; };
  }, [applySettings, request]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setBusy("save");
    setFeedback(null);
    try {
      const payload = await request("/platform/email-settings", {
        method: "PUT",
        body: JSON.stringify({ ...form, port: Number(form.port) }),
      });
      applySettings(payload);
      setFeedback({ tone: "success", text: "Configuração SMTP salva com segurança." });
    } catch (error) {
      if (error.status !== 401) setFeedback({ tone: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  async function verifyConnection() {
    setBusy("verify");
    setFeedback(null);
    try {
      await request("/platform/email-settings/verify", { method: "POST" });
      setFeedback({ tone: "success", text: "Conexão, TLS e autenticação SMTP validados." });
    } catch (error) {
      if (error.status !== 401) setFeedback({ tone: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  async function sendTest() {
    setBusy("test");
    setFeedback(null);
    try {
      await request("/platform/email-settings/test", {
        method: "POST",
        body: JSON.stringify({ to: testRecipient.trim() }),
      });
      setFeedback({ tone: "success", text: `E-mail de teste enviado para ${testRecipient.trim()}.` });
    } catch (error) {
      if (error.status !== 401) setFeedback({ tone: "error", text: error.message });
    } finally {
      setBusy("");
    }
  }

  if (loading) return <p className="muted">Carregando configuração de e-mail…</p>;

  return (
    <section className="stack smtp-admin">
      <section className="panel stack">
        <div className="panel-heading">
          <div>
            <h2>Envio de e-mail</h2>
            <p>Use qualquer provedor compatível com SMTP para as mensagens automáticas enviadas aos clientes.</p>
          </div>
          <StatusBadge tone={active?.enabled ? "ok" : "warn"}>
            {active?.enabled ? "Envio ativo" : "Envio inativo"}
          </StatusBadge>
        </div>

        <dl className="platform-facts">
          <div className="platform-fact">
            <dt>Provedor em uso</dt>
            <dd>{providerLabel(active?.provider)}</dd>
          </div>
          <div className="platform-fact">
            <dt>Credencial SMTP</dt>
            <dd>{smtp?.password_configured ? "Senha armazenada e criptografada" : smtp?.username ? "Senha ainda não informada" : "Servidor sem autenticação"}</dd>
          </div>
          <div className="platform-fact">
            <dt>Última alteração</dt>
            <dd>{smtp?.updated_at ? new Date(smtp.updated_at).toLocaleString("pt-BR") : "Ainda não configurado"}</dd>
          </div>
        </dl>

        {smtp?.credential_error && (
          <p className="platform-notice smtp-feedback is-error" role="alert">
            A senha armazenada não pôde ser aberta. Informe-a novamente antes de ativar o SMTP.
          </p>
        )}
        {feedback && (
          <p className={`platform-notice smtp-feedback is-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
            {feedback.text}
          </p>
        )}
      </section>

      <form className="panel stack" onSubmit={save}>
        <div className="panel-heading">
          <div>
            <h2>Servidor SMTP</h2>
            <p>Copie estes dados do seu provedor de e-mail. Informe apenas o host, sem “smtp://”.</p>
          </div>
        </div>

        <div className="form-grid">
          <Input label="Host SMTP" required maxLength={255} value={form.host} onChange={(value) => update("host", value)} placeholder="smtp.seudominio.com" />
          <Input label="Porta" required type="number" min="1" max="65535" value={form.port} onChange={(value) => update("port", value)} placeholder="587" />
          <Input label="Usuário (opcional)" maxLength={320} autoComplete="username" value={form.username} onChange={(value) => update("username", value)} placeholder="contato@seudominio.com" />
          <Input
            label={smtp?.password_configured ? "Nova senha (deixe vazio para manter)" : "Senha SMTP"}
            type="password"
            maxLength={1024}
            autoComplete="new-password"
            required={Boolean(form.username && !smtp?.password_configured)}
            value={form.password}
            onChange={(value) => update("password", value)}
            placeholder={smtp?.password_configured ? "Senha já armazenada" : "Senha ou senha de aplicativo"}
          />
        </div>

        <div className="smtp-security-options">
          <Checkbox
            label="TLS direto (normalmente porta 465)"
            checked={form.secure}
            onChange={(checked) => setForm((current) => ({ ...current, secure: checked, require_tls: checked ? false : current.require_tls }))}
          />
          <Checkbox
            label="Exigir STARTTLS (normalmente porta 587)"
            checked={form.require_tls}
            disabled={form.secure}
            onChange={(checked) => update("require_tls", checked)}
          />
        </div>

        <div className="form-grid">
          <Input label="Nome do remetente" maxLength={160} value={form.from_name} onChange={(value) => update("from_name", value)} placeholder="Aura Clinic" />
          <Input label="E-mail do remetente" required type="email" maxLength={320} value={form.from_email} onChange={(value) => update("from_email", value)} placeholder="avisos@seudominio.com" />
          <Input label="Responder para (opcional)" type="email" maxLength={320} value={form.reply_to} onChange={(value) => update("reply_to", value)} placeholder="atendimento@seudominio.com" />
        </div>

        <Switch
          label="Usar este SMTP para os envios"
          description="Quando desligado, a plataforma usa o Resend configurado no servidor, se disponível."
          checked={form.enabled}
          onChange={(checked) => update("enabled", checked)}
        />

        <div className="header-actions smtp-actions">
          <Button type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Salvando…" : "Salvar configuração"}</Button>
          <Button type="button" variant="secondary" disabled={Boolean(busy) || !smtp?.configured} onClick={verifyConnection}>
            {busy === "verify" ? "Verificando…" : "Verificar conexão"}
          </Button>
        </div>
      </form>

      <section className="panel stack">
        <div className="panel-heading">
          <div>
            <h2>Envio de teste</h2>
            <p>O teste usa diretamente o SMTP salvo, mesmo que ele ainda esteja desativado.</p>
          </div>
        </div>
        <div className="smtp-test-row">
          <Input label="Destinatário" type="email" value={testRecipient} onChange={setTestRecipient} placeholder="voce@exemplo.com" />
          <Button type="button" variant="secondary" disabled={Boolean(busy) || !smtp?.configured || !testRecipient.trim()} onClick={sendTest}>
            {busy === "test" ? "Enviando…" : "Enviar teste"}
          </Button>
        </div>
      </section>
    </section>
  );
}
