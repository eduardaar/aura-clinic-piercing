import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import { API, setTenantSlug } from "../../lib/api";
import { asArray } from "../../lib/utils";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Deriva um preview do "código da loja" a partir do nome digitado.
// Espelha a lógica do backend (generateUniqueSlug) — o backend é a fonte da
// verdade e resolve colisões; aqui é só para o usuário ver o endereço final.
function slugPreview(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

const fallbackPlans = [
  { code: "essencial", name: "Pacote Essencial", price_cents: 1990, audience: "Piercers iniciantes", features: ["clients", "agenda", "procedures", "basic_inventory"] },
  { code: "start", name: "Pacote Start", price_cents: 3990, audience: "Piercers iniciantes ou autônomos", features: ["clients", "agenda", "procedures", "basic_catalog", "whatsapp_link"] },
  { code: "profissional", name: "Pacote Profissional", price_cents: 6990, audience: "Estúdios que querem agendamento online", badge: "Mais recomendado", highlight: true, features: ["online_booking", "anamnesis", "digital_terms", "basic_finance", "stock_alerts"] },
  { code: "studio", name: "Pacote Studio", price_cents: 9990, audience: "Estúdios com equipe", features: ["multi_user", "commissions", "monthly_reports", "coupons"] },
  { code: "premium", name: "Pacote Premium", price_cents: 14990, audience: "Operações completas", features: ["advanced_catalog", "campaigns", "advanced_finance", "priority_support"] }
];

const featureLabels = {
  clients: "Clientes",
  agenda: "Agenda",
  procedures: "Procedimentos",
  manual_reminders: "Lembretes manuais",
  basic_inventory: "Estoque simples",
  basic_catalog: "Catálogo simples",
  whatsapp_link: "Link WhatsApp",
  basic_reports: "Relatórios básicos",
  online_booking: "Agendamento online",
  anamnesis: "Anamnese digital",
  digital_terms: "Termo digital",
  basic_finance: "Financeiro básico",
  stock_alerts: "Alertas de estoque",
  automatic_followup: "Pós-atendimento automático",
  public_catalog_customization: "Catálogo personalizado",
  multi_user: "Multiusuários",
  commissions: "Comissões",
  monthly_reports: "Relatórios mensais",
  coupons: "Cupons",
  advanced_catalog: "Catálogo avançado",
  campaigns: "Campanhas",
  advanced_finance: "Financeiro avançado",
  priority_support: "Suporte prioritário"
};

export function Signup() {
  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState(fallbackPlans);
  const [form, setForm] = useState({
    name: "",
    admin_name: "",
    admin_email: "",
    admin_password: "",
    plan_code: "profissional"
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdTenant, setCreatedTenant] = useState(null);
  const selectedPlan = useMemo(() => plans.find((plan) => plan.code === form.plan_code) || plans[2] || plans[0], [plans, form.plan_code]);
  const slug = useMemo(() => slugPreview(form.name), [form.name]);

  useEffect(() => {
    fetch(`${API}/plans`)
      .then((response) => response.json())
      .then((payload) => setPlans(asArray(payload.plans).length ? payload.plans : fallbackPlans))
      .catch(() => setPlans(fallbackPlans));
  }, []);

  function next() {
    setError("");
    if (step === 1) {
      if (!form.name.trim()) return setError("Informe o nome da sua clínica ou studio.");
      if (!form.admin_email.trim()) return setError("Informe um e-mail para acesso.");
      if (form.admin_password.length < 8) return setError("Crie uma senha com no mínimo 8 caracteres.");
      if (slug.length < 3) return setError("Use um nome com pelo menos 3 letras para gerar o endereço da loja.");
    }
    setStep((current) => Math.min(current + 1, 2));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.admin_email.trim() || form.admin_password.length < 8) {
      setStep(1);
      return setError("Preencha nome da clínica, e-mail e senha (mín. 8 caracteres).");
    }
    setLoading(true);
    try {
      const response = await fetch(`${API}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // slug é OMITIDO de propósito: o backend deriva do nome e garante unicidade.
        body: JSON.stringify({
          name: form.name.trim(),
          admin_name: form.admin_name.trim() || undefined,
          admin_email: form.admin_email.trim(),
          admin_password: form.admin_password,
          plan_code: form.plan_code
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Não foi possível criar a clínica. Verifique os dados e tente novamente.");
        return;
      }
      const tenant = payload.tenant || { slug, name: form.name.trim(), plan: form.plan_code };
      if (tenant.slug) setTenantSlug(tenant.slug);
      // Login automático: se o backend devolveu token, já grava a sessão e entra
      // direto no app — sem passar pela tela de login digitando o código.
      if (payload.token && payload.user) {
        const session = { token: payload.token, user: payload.user, tenant };
        localStorage.setItem("aura-session", JSON.stringify(session));
        localStorage.setItem("aura-last-email", form.admin_email.trim());
        localStorage.setItem("aura-admin-authenticated", "true");
        window.location.href = "/";
        return;
      }
      // Fallback (backend antigo sem token): mostra o código e leva ao login.
      setCreatedTenant(tenant);
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
      <main className="login-screen signup-screen">
        <section className="login-panel signup-panel">
          <header className="login-brand">
            <div className="login-monogram" aria-hidden="true">AC</div>
            <div><strong>Aura</strong><span>Plataforma para studios</span></div>
          </header>
          <div className="login-copy">
            <span className="login-kicker"><CheckCircle2 size={14} /> Teste grátis iniciado</span>
            <h1>{createdTenant.name} está pronta.</h1>
            <p>Seu período gratuito de 7 dias começou. Use o código abaixo no login para acessar sua loja.</p>
            <p><strong>Código da loja: {createdTenant.slug}</strong></p>
          </div>
          <button type="button" className="login-submit" onClick={goToLogin}>Ir para o login <ChevronRight size={18} /></button>
        </section>
      </main>
    );
  }

  return (
    <main className="login-screen signup-screen">
      <section className="login-panel signup-panel">
        <header className="login-brand">
          <div className="login-monogram" aria-hidden="true">AC</div>
          <div><strong>Aura</strong><span>Teste grátis por 7 dias</span></div>
        </header>
        <div className="signup-steps">
          {["Sua clínica", "Plano"].map((label, index) => (
            <button key={label} type="button" className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => step > index + 1 && setStep(index + 1)}>
              {index + 1}. {label}
            </button>
          ))}
        </div>
        <form className="login-form signup-form" onSubmit={submit}>
          {step === 1 && (
            <>
              <div className="login-copy"><span className="login-kicker">Comece em 1 minuto</span><h1>Crie sua clínica.</h1><p>Só o essencial — o resto você ajusta depois, já dentro do sistema.</p></div>
              <label>Nome da clínica ou studio<input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="ex.: Studio Lua Piercing" />
                {slug.length >= 3 && <small>Endereço da sua loja: <strong>/{slug}</strong></small>}
              </label>
              <label>Seu nome <span className="field-optional">(opcional)</span><input value={form.admin_name} onChange={(event) => setForm({ ...form, admin_name: event.target.value })} placeholder="ex.: Ana Souza" /></label>
              <label>E-mail de acesso<input type="email" required value={form.admin_email} onChange={(event) => setForm({ ...form, admin_email: event.target.value })} placeholder="seu@email.com" /></label>
              <label>Senha<input type="password" minLength={8} required value={form.admin_password} onChange={(event) => setForm({ ...form, admin_password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label>
            </>
          )}
          {step === 2 && (
            <>
              <div className="login-copy"><span className="login-kicker"><Sparkles size={14} /> Escolha seu plano</span><h1>Teste grátis por 7 dias</h1><p>Sem cobrança agora. Você pode trocar de plano quando quiser.</p></div>
              <div className="plan-grid">
                {plans.map((plan) => (
                  <button key={plan.code} type="button" className={`plan-card ${form.plan_code === plan.code ? "active" : ""} ${plan.highlight || plan.is_recommended ? "recommended" : ""}`} onClick={() => setForm({ ...form, plan_code: plan.code })}>
                    {(plan.badge || plan.is_recommended) && <span className="plan-badge">{plan.badge || "Mais recomendado"}</span>}
                    <strong>{plan.name}</strong>
                    <b>{currency.format(Number(plan.price_cents || 0) / 100)}<small>/mês</small></b>
                    <em>{plan.audience}</em>
                    <ul>{asArray(plan.features).slice(0, 6).map((feature) => <li key={feature}>{featureLabels[feature] || feature}</li>)}</ul>
                    <span>{form.plan_code === plan.code ? "Selecionado" : "Escolher plano"}</span>
                  </button>
                ))}
              </div>
              <div className="signup-review">
                <p><strong>Clínica:</strong> {form.name} <span className="field-optional">(/{slug})</span></p>
                <p><strong>Plano:</strong> {selectedPlan?.name} · 7 dias grátis</p>
              </div>
            </>
          )}
          {error && <span className="form-error">{error}</span>}
          <div className="signup-actions">
            {step > 1 && <button type="button" className="secondary-button" onClick={() => setStep((current) => current - 1)}>Voltar</button>}
            {step < 2 ? <button type="button" className="login-submit" onClick={next}>Continuar <ChevronRight size={18} /></button> : <button className="login-submit" disabled={loading}>{loading ? "Criando..." : "Criar conta e começar"} <ChevronRight size={18} /></button>}
          </div>
          <a className="remember-access" href="/login">Já tenho uma loja - fazer login</a>
        </form>
      </section>
    </main>
  );
}
