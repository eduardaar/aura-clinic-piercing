import { useState } from "react";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { apiFetch, setTenantSlug, tenantSlug } from "../../lib/api";
import { PublicTopNav } from "../layout/PublicTopNav";
import { PublicFooter } from "../layout/PublicFooter";
import { Button, Checkbox, Input } from "../common/Ui";

export function Login({ onLogin }) {
  const resetToken = new URLSearchParams(window.location.search).get("reset") || "";
  const [form, setForm] = useState({
    slug: tenantSlug(),
    // Pré-preenche só o último e-mail usado NESTE dispositivo. Nunca sugerimos
    // credenciais de super-admin (isso é conta de plataforma, não de clínica).
    email: localStorage.getItem("aura-last-email") || "",
    password: "",
    mfa_code: "",
  });
  const [rememberAccess, setRememberAccess] = useState(Boolean(localStorage.getItem("aura-admin-authenticated")));
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [resetForm, setResetForm] = useState({ password: "", confirmation: "" });

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Autentica no backend e obtém um token assinado (necessário em produção).
      // Envia e-mail + senha do formulário: o backend suporta contas por usuário
      // com papéis (reception/finance/piercer/admin). Sem checagem de senha no cliente.
      const email = form.email.trim();
      // Multi-tenant: grava o código da clínica ANTES do apiFetch para o header X-Tenant ir correto.
      const slug = form.slug.trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(slug)) {
        setError("Código da clínica inválido: use apenas letras minúsculas, números e hífens.");
        return;
      }
      setTenantSlug(slug);
      const response = await apiFetch("/login", {
        method: "POST",
        body: JSON.stringify({ email, password: form.password, ...(form.mfa_code ? { mfa_code: form.mfa_code.trim() } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMfaRequired(payload.code === "mfa_required");
        // 404 clínica não encontrada / 403 suspensa / credenciais inválidas: o backend explica no payload.error.
        setError(payload.error || "E-mail ou senha incorretos. Por favor, tente novamente.");
        return;
      }
      const session = { token: payload.token, user: payload.user, tenant: payload.tenant };
      // Persiste o código da clínica confirmado pelo backend.
      if (payload.tenant?.slug) setTenantSlug(payload.tenant.slug);
      // Guarda o último e-mail usado para pré-preencher no próximo acesso.
      localStorage.setItem("aura-last-email", email);
      localStorage.setItem("aura-admin-authenticated", rememberAccess ? "true" : "");
      localStorage.setItem("aura-session", JSON.stringify(session));
      onLogin(session);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function requestRecovery(event) {
    event.preventDefault();
    setError("");
    setRecoveryMessage("");
    const slug = form.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) return setError("Informe o código válido da clínica.");
    setTenantSlug(slug);
    setLoading(true);
    try {
      const response = await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: form.email.trim().toLowerCase() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível solicitar a recuperação.");
      setRecoveryMessage(payload.message || "Confira seu e-mail para continuar.");
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    setError("");
    setRecoveryMessage("");
    if (resetForm.password.length < 12) return setError("A nova senha deve ter pelo menos 12 caracteres.");
    if (resetForm.password !== resetForm.confirmation) return setError("As senhas não conferem.");
    setLoading(true);
    try {
      const response = await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: resetToken, password: resetForm.password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível redefinir a senha.");
      setRecoveryMessage(payload.message || "Senha redefinida com sucesso.");
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (resetToken) {
    return (
      <div className="au-shell">
        <PublicTopNav current="login" />
        <main className="au-a-root au-a-login">
          <section className="au-a-panel"><div className="au-a-inner">
            <h1 className="au-a-title">Criar nova senha</h1>
            {recoveryMessage ? (
              <><p className="au-a-success" role="status">{recoveryMessage}</p><p className="au-a-alt"><a href="/login">Voltar para entrar</a></p></>
            ) : (
              <form className="au-a-form" onSubmit={resetPassword}>
                <Input fieldClassName="au-a-field" label="Nova senha" type="password" autoComplete="new-password" minLength={12} required value={resetForm.password} onChange={(password) => setResetForm({ ...resetForm, password })} />
                <Input fieldClassName="au-a-field" label="Confirmar nova senha" type="password" autoComplete="new-password" minLength={12} required value={resetForm.confirmation} onChange={(confirmation) => setResetForm({ ...resetForm, confirmation })} />
                {error && <p className="au-a-error" role="alert">{error}</p>}
                <Button type="submit" className="au-a-submit" disabled={loading}>{loading ? "Salvando…" : "Redefinir senha"}</Button>
              </form>
            )}
          </div></section>
          <aside className="au-a-aside" aria-hidden="true"><span className="au-a-aside-rule" /><p className="au-a-aside-quote">Acesso seguro à rotina da sua clínica.</p></aside>
        </main>
        <PublicFooter />
      </div>
    );
  }

  if (recoveryMode) {
    return (
      <div className="au-shell">
        <PublicTopNav current="login" />
        <main className="au-a-root au-a-login">
          <section className="au-a-panel"><div className="au-a-inner">
            <h1 className="au-a-title">Recuperar acesso</h1>
            <form className="au-a-form" onSubmit={requestRecovery}>
              <Input fieldClassName="au-a-field" label="Código da clínica" value={form.slug} required onChange={(slug) => setForm({ ...form, slug: slug.toLowerCase() })} placeholder="ex.: aura" />
              <Input fieldClassName="au-a-field" label="E-mail" type="email" autoComplete="username" value={form.email} required onChange={(email) => setForm({ ...form, email })} placeholder="seu@email.com" />
              {error && <p className="au-a-error" role="alert">{error}</p>}
              {recoveryMessage && <p className="au-a-success" role="status">{recoveryMessage}</p>}
              <Button type="submit" className="au-a-submit" disabled={loading}>{loading ? "Enviando…" : "Enviar instruções"}</Button>
              <Button type="button" variant="ghost" onClick={() => { setRecoveryMode(false); setError(""); setRecoveryMessage(""); }}>Voltar para entrar</Button>
            </form>
          </div></section>
          <aside className="au-a-aside" aria-hidden="true"><span className="au-a-aside-rule" /><p className="au-a-aside-quote">Recupere o acesso por um link seguro e temporário.</p></aside>
        </main>
        <PublicFooter />
      </div>
    );
  }

  return (
    <div className="au-shell">
      <PublicTopNav current="login" />

      <main className="au-a-root au-a-login">
        <section className="au-a-panel">
          <div className="au-a-inner">
            {/* A marca vive no menu de topo agora — repeti-la aqui seria duplicata. */}
            <h1 className="au-a-title">Entrar na sua conta</h1>

            <form className="au-a-form" onSubmit={submit}>
              <Input
                fieldClassName="au-a-field"
                label="Código da clínica"
                id="au-a-slug"
                className="au-a-input"
                autoComplete="organization"
                required
                value={form.slug}
                onChange={(slug) => setForm({ ...form, slug: slug.toLowerCase() })}
                placeholder="ex.: aura"
              />

              <Input
                fieldClassName="au-a-field"
                label="E-mail"
                id="au-a-email"
                className="au-a-input"
                type="email"
                autoComplete="username"
                required
                value={form.email}
                onChange={(email) => {
                    setMfaRequired(false);
                    setForm({ ...form, email, mfa_code: "" });
                }}
                placeholder="seu@email.com"
              />

              <div className="au-a-field">
                <label htmlFor="au-a-password">Senha</label>
                <div className="au-a-pass">
                  <Input
                    label={null}
                    fieldClassName="au-a-pass-control"
                    id="au-a-password"
                    className="au-a-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={form.password}
                    onChange={(password) => {
                      setMfaRequired(false);
                      setForm({ ...form, password, mfa_code: "" });
                    }}
                    placeholder="Digite a senha"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="au-a-eye"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </Button>
                </div>
              </div>

              {mfaRequired && (
                <Input
                  fieldClassName="au-a-field"
                  label="Código do autenticador"
                  id="au-a-mfa"
                  className="au-a-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={form.mfa_code}
                  onChange={(mfa_code) => setForm({ ...form, mfa_code: mfa_code.replace(/\D/g, "") })}
                  placeholder="000000"
                />
              )}

              <Checkbox className="au-a-check" label="Manter conectado" checked={rememberAccess} onChange={setRememberAccess} />

              <Button type="button" variant="ghost" onClick={() => { setRecoveryMode(true); setError(""); }}>
                Esqueci minha senha
              </Button>

              {error && <p className="au-a-error" role="alert">{error}</p>}

              <Button type="submit" className="au-a-submit" disabled={loading}>
                {loading ? "Entrando…" : "Entrar"} <ChevronRight size={18} aria-hidden="true" />
              </Button>
            </form>

            <p className="au-a-alt">
              Ainda não tem uma clínica? <a href="/cadastro">Criar minha clínica</a>
            </p>

          </div>
        </section>

        <aside className="au-a-aside" aria-hidden="true">
          <span className="au-a-aside-rule" />
          <p className="au-a-aside-quote">Gestão inteligente para quem vive da perfuração.</p>
        </aside>
      </main>
      <PublicFooter />
    </div>
  );
}
