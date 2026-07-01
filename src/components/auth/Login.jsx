import React, { useState } from "react";
import { AlertTriangle, Calendar, ChevronRight, UserRound, WalletCards } from "lucide-react";

export function Login({ onLogin }) {
  const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || "aura123";
  const [form, setForm] = useState({ password: "" });
  const [rememberAccess, setRememberAccess] = useState(Boolean(localStorage.getItem("aura-admin-authenticated")));
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (form.password === adminPassword) {
      const user = {
        id: 1,
        name: "Administrador Aura",
        email: "admin@auraclinic.com",
        role: "admin",
      };

      localStorage.setItem("aura-admin-authenticated", rememberAccess ? "true" : "");
      localStorage.setItem("aura-session", JSON.stringify({ user }));
      onLogin({ user });
      return;
    }

    setError("Senha incorreta. Por favor, tente novamente.");
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
            Senha da Central Administrativa
            <input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Digite a senha" />
          </label>
          <label className="remember-access">
            <input type="checkbox" checked={rememberAccess} onChange={(event) => setRememberAccess(event.target.checked)} />
            <span>Manter conectado</span>
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="login-submit">Entrar no sistema <ChevronRight size={18} /></button>
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
