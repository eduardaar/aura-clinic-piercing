import { useCallback, useEffect, useState } from "react";
import { Button, Input, StatusBadge } from "../../components/common/Ui";
import { API } from "../../lib/api";

export function PlatformSecurity({ token, onUnauthorized, onSessionUpdated }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [feedback, setFeedback] = useState("");

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      onUnauthorized?.();
      throw new Error("Sua sessão expirou.");
    }
    if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
    return payload;
  }, [onUnauthorized, token]);

  useEffect(() => {
    request("/platform/mfa")
      .then((payload) => setEnabled(Boolean(payload.enabled)))
      .catch((error) => setFeedback(error.message))
      .finally(() => setLoading(false));
  }, [request]);

  async function beginSetup(event) {
    event.preventDefault();
    setBusy("setup");
    setFeedback("");
    try {
      const payload = await request("/platform/mfa/setup", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword }),
      });
      setSetup(payload);
      setCurrentPassword("");
      setFeedback("Adicione a chave no aplicativo autenticador e confirme o código gerado.");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function verifySetup(event) {
    event.preventDefault();
    setBusy("verify");
    setFeedback("");
    try {
      const payload = await request("/platform/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      if (payload.token) onSessionUpdated?.({ token: payload.token, user: payload.user });
      setEnabled(true);
      setSetup(null);
      setCode("");
      setFeedback("Autenticação em duas etapas ativada.");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function disableMfa(event) {
    event.preventDefault();
    setBusy("disable");
    setFeedback("");
    try {
      const payload = await request("/platform/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, code }),
      });
      if (payload.token) onSessionUpdated?.({ token: payload.token, user: payload.user });
      setEnabled(false);
      setCurrentPassword("");
      setCode("");
      setFeedback("Autenticação em duas etapas desativada.");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  if (loading) return <p className="muted">Carregando segurança da conta…</p>;

  return (
    <section className="stack platform-security">
      <section className="panel stack">
        <div className="panel-heading">
          <div>
            <h2>Segurança da conta</h2>
            <p>Proteja o acesso administrativo da plataforma com um aplicativo autenticador.</p>
          </div>
          <StatusBadge tone={enabled ? "ok" : "warn"}>{enabled ? "Proteção ativa" : "Proteção desativada"}</StatusBadge>
        </div>

        {feedback && <p className="platform-notice">{feedback}</p>}

        {!enabled && !setup && (
          <form className="stack" onSubmit={beginSetup}>
            <Input label="Senha atual" type="password" required value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            <div className="header-actions">
              <Button type="submit" disabled={busy === "setup"}>{busy === "setup" ? "Preparando…" : "Ativar autenticação em duas etapas"}</Button>
            </div>
          </form>
        )}

        {!enabled && setup && (
          <form className="stack" onSubmit={verifySetup}>
            <Input label="Chave do autenticador" value={setup.secret || ""} readOnly />
            <a className="secondary-button platform-authenticator-link" href={setup.otpauth_url}>Abrir no aplicativo autenticador</a>
            <Input label="Código de 6 dígitos" inputMode="numeric" maxLength={6} required value={code} onChange={(value) => setCode(value.replace(/\D/g, ""))} placeholder="000000" />
            <div className="header-actions">
              <Button type="submit" disabled={busy === "verify" || code.length !== 6}>{busy === "verify" ? "Confirmando…" : "Confirmar e ativar"}</Button>
            </div>
          </form>
        )}

        {enabled && (
          <form className="stack" onSubmit={disableMfa}>
            <p className="muted">Para desativar, confirme a senha atual e um código válido do autenticador.</p>
            <div className="form-grid">
              <Input label="Senha atual" type="password" required value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
              <Input label="Código de 6 dígitos" inputMode="numeric" maxLength={6} required value={code} onChange={(value) => setCode(value.replace(/\D/g, ""))} placeholder="000000" />
            </div>
            <div className="header-actions">
              <Button type="submit" variant="danger" disabled={busy === "disable" || code.length !== 6}>{busy === "disable" ? "Desativando…" : "Desativar proteção"}</Button>
            </div>
          </form>
        )}
      </section>
    </section>
  );
}
