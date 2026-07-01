import React, { useState } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { API, setTenantSlug } from "../../lib/api";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

// Página pública de cadastro de clínica (/cadastro). Cria o tenant + admin inicial
// via POST /api/signup (sem X-Tenant — a clínica ainda não existe).
export function Signup() {
  const [form, setForm] = useState({
    name: "",
    slug: "",
    admin_name: "",
    admin_email: "",
    admin_password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdTenant, setCreatedTenant] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const slug = form.slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      setError("Código inválido: use apenas letras minúsculas, números e hífens (ex.: minha-clinica).");
      return;
    }
    if (form.admin_password.length < 8) {
      setError("A senha do administrador deve ter pelo menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${API}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          slug,
          admin_name: form.admin_name.trim() || undefined,
          admin_email: form.admin_email.trim(),
          admin_password: form.admin_password,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // 400 slug inválido/senha curta · 409 código em uso · 403 cadastro desabilitado.
        setError(payload.error || "Não foi possível criar a clínica. Verifique os dados e tente novamente.");
        return;
      }
      setCreatedTenant(payload.tenant || { slug, name: form.name.trim() });
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function goToLogin() {
    if (createdTenant?.slug) setTenantSlug(createdTenant.slug);
    window.location.href = "/login";
  }

  if (createdTenant) {
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
            <span className="login-kicker"><CheckCircle2 size={14} /> Cadastro concluído</span>
            <h1>Clínica criada!</h1>
            <p>
              {createdTenant.name ? `A clínica ${createdTenant.name} está pronta.` : "Sua clínica está pronta."}{" "}
              Guarde o código de acesso abaixo — sua equipe vai usá-lo para entrar no sistema.
            </p>
            <p><strong>Código da clínica: {createdTenant.slug}</strong></p>
          </div>

          <div className="login-form">
            <button type="button" className="login-submit" onClick={goToLogin}>
              Ir para o login <ChevronRight size={18} />
            </button>
          </div>
        </section>
      </main>
    );
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
          <span className="login-kicker">Nova clínica</span>
          <h1>Crie a conta da sua clínica</h1>
          <p>Cadastre sua clínica para gerenciar agenda, clientes, estoque e financeiro em um único lugar.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            Nome da clínica
            <input
              type="text"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="ex.: Aura Clinic Piercing"
            />
          </label>
          <label>
            Código da clínica
            <input
              type="text"
              required
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
              placeholder="ex.: aura"
            />
            <small>Apenas letras minúsculas, números e hífens. Sua equipe usará este código no login.</small>
          </label>
          <label>
            Nome do responsável (opcional)
            <input
              type="text"
              value={form.admin_name}
              onChange={(event) => setForm({ ...form, admin_name: event.target.value })}
              placeholder="ex.: Eduarda Santos"
            />
          </label>
          <label>
            E-mail do administrador
            <input
              type="email"
              autoComplete="username"
              required
              value={form.admin_email}
              onChange={(event) => setForm({ ...form, admin_email: event.target.value })}
              placeholder="seu@email.com"
            />
          </label>
          <label>
            Senha (mínimo 8 caracteres)
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.admin_password}
              onChange={(event) => setForm({ ...form, admin_password: event.target.value })}
              placeholder="Crie uma senha segura"
            />
          </label>
          {error && <span className="form-error">{error}</span>}
          <button className="login-submit" disabled={loading}>
            {loading ? "Criando clínica…" : "Criar minha clínica"} <ChevronRight size={18} />
          </button>
          <a className="remember-access" href="/login">Já tenho uma clínica — fazer login</a>
        </form>

        <footer className="login-footer">
          <strong>Sistema proprietário Aura Clinic®</strong>
          <span>Desenvolvido por Eduarda Santos</span>
        </footer>
      </section>
    </main>
  );
}
