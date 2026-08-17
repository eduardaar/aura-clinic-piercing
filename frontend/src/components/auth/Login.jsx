import { useState } from "react";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { apiFetch, setTenantSlug, tenantSlug } from "../../lib/api";
import { PublicTopNav } from "../layout/PublicTopNav";
import { PublicFooter } from "../layout/PublicFooter";
import { Checkbox } from "../common/Ui";

export function Login({ onLogin }) {
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

  return (
    <div className="au-shell">
      <PublicTopNav current="login" />

      <main className="au-a-root au-a-login">
        <section className="au-a-panel">
          <div className="au-a-inner">
            {/* A marca vive no menu de topo agora — repeti-la aqui seria duplicata. */}
            <h1 className="au-a-title">Entrar na sua conta</h1>

            <form className="au-a-form" onSubmit={submit}>
              <div className="au-a-field">
                <label htmlFor="au-a-slug">Código da clínica</label>
                <input
                  id="au-a-slug"
                  className="au-a-input"
                  type="text"
                  autoComplete="organization"
                  required
                  value={form.slug}
                  onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
                  placeholder="ex.: aura"
                />
              </div>

              <div className="au-a-field">
                <label htmlFor="au-a-email">E-mail</label>
                <input
                  id="au-a-email"
                  className="au-a-input"
                  type="email"
                  autoComplete="username"
                  required
                  value={form.email}
                  onChange={(event) => {
                    setMfaRequired(false);
                    setForm({ ...form, email: event.target.value, mfa_code: "" });
                  }}
                  placeholder="seu@email.com"
                />
              </div>

              <div className="au-a-field">
                <label htmlFor="au-a-password">Senha</label>
                <div className="au-a-pass">
                  <input
                    id="au-a-password"
                    className="au-a-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={form.password}
                    onChange={(event) => {
                      setMfaRequired(false);
                      setForm({ ...form, password: event.target.value, mfa_code: "" });
                    }}
                    placeholder="Digite a senha"
                  />
                  <button
                    type="button"
                    className="au-a-eye"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>

              {mfaRequired && (
                <div className="au-a-field">
                  <label htmlFor="au-a-mfa">Código do autenticador</label>
                  <input
                    id="au-a-mfa"
                    className="au-a-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                    value={form.mfa_code}
                    onChange={(event) => setForm({ ...form, mfa_code: event.target.value.replace(/\D/g, "") })}
                    placeholder="000000"
                  />
                </div>
              )}

              <Checkbox className="au-a-check" label="Manter conectado" checked={rememberAccess} onChange={setRememberAccess} />

              {error && <p className="au-a-error" role="alert">{error}</p>}

              <button className="au-a-submit" disabled={loading}>
                {loading ? "Entrando…" : "Entrar"} <ChevronRight size={18} aria-hidden="true" />
              </button>
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
