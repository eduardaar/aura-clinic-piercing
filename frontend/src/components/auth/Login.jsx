import React, { useState } from "react";
import { AlertTriangle, Calendar, ChevronRight, UserRound, WalletCards } from "lucide-react";
import { apiFetch, setTenantSlug, tenantSlug } from "../../lib/api";

const DEFAULT_LOGIN_EMAIL = "admin@auraclinic.com";

export function Login({ onLogin }) {
  const [form, setForm] = useState({
    slug: tenantSlug(),
    email: localStorage.getItem("aura-last-email") || DEFAULT_LOGIN_EMAIL,
    password: "",
  });
  const [rememberAccess, setRememberAccess] = useState(Boolean(localStorage.getItem("aura-admin-authenticated")));
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
        body: JSON.stringify({ email, password: form.password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
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
    <main className="login-screen">
      <section className="login-panel">
        <header className="login-brand">
          <div className="login-monogram" aria-hidden="true">AC</div>
          <div>
            <strong>Aura Clinic</strong>
            <span>Gestão Premium</span>
          </div>
        </header>

        <div className="login-copy">
          <span className="login-kicker">Central Administrativa</span>
          <h1>Acesse sua central administrativa</h1>
          <p>Controle estoque, agenda, clientes, biossegurança e financeiro em um único lugar.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            Código da clínica
            <input
              type="text"
              autoComplete="organization"
              required
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
              placeholder="ex.: aura"
            />
          </label>
          <label>
            E-mail
            <input type="email" autoComplete="username" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="seu@email.com" />
          </label>
          <label>
            Senha da Central Administrativa
            <input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Digite a senha" />
          </label>
          <label className="remember-access">
            <input type="checkbox" checked={rememberAccess} onChange={(event) => setRememberAccess(event.target.checked)} />
            <span>Manter conectado</span>
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="login-submit" disabled={loading}>{loading ? "Entrando…" : "Entrar no sistema"} <ChevronRight size={18} /></button>
          <a className="remember-access" href="/cadastro">Criar minha clínica</a>
        </form>

        <footer className="login-footer">
          <strong>Sistema proprietário Aura Clinic®</strong>
          <span>Desenvolvido por Eduarda Santos</span>
        </footer>
      </section>

      <section className="login-visual" aria-label="Aura Clinic">
        <div className="login-visual-content">
          <div className="gold-line" />
          <span className="login-visual-kicker">Aura Clinic Piercing</span>
          <h2>Gestão inteligente para quem vive da perfuração.</h2>
          <p>Desenvolvido por body piercer para body piercers.</p>

          <div className="login-metrics" aria-label="Indicadores Aura Clinic">
            <div><strong>+3500</strong><span>Perfurações registradas</span></div>
            <div><strong>+1200</strong><span>Joias cadastradas</span></div>
            <div><strong>+800</strong><span>Clientes atendidos</span></div>
          </div>
        </div>

        <div className="login-floating-cards" aria-hidden="true">
          <article><Calendar size={18} /><span>Agenda do Dia</span><strong>08 atendimentos</strong></article>
          <article><AlertTriangle size={18} /><span>Estoque Crítico</span><strong>03 peças</strong></article>
          <article><UserRound size={18} /><span>Último Atendimento</span><strong>Hélix · 16:30</strong></article>
          <article><WalletCards size={18} /><span>Financeiro do Mês</span><strong>R$ 18.420</strong></article>
        </div>
      </section>
    </main>
  );
}
