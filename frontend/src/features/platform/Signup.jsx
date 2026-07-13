import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import { API, setTenantSlug } from "../../lib/api";
import { asArray } from "../../lib/utils";

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

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
    slug: "",
    admin_name: "",
    admin_email: "",
    admin_password: "",
    phone: "",
    city: "",
    state: "",
    logo_url: "",
    plan_code: "profissional"
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdTenant, setCreatedTenant] = useState(null);
  const selectedPlan = useMemo(() => plans.find((plan) => plan.code === form.plan_code) || plans[2] || plans[0], [plans, form.plan_code]);

  useEffect(() => {
    fetch(`${API}/plans`)
      .then((response) => response.json())
      .then((payload) => setPlans(asArray(payload.plans).length ? payload.plans : fallbackPlans))
      .catch(() => setPlans(fallbackPlans));
  }, []);

  function next() {
    setError("");
    if (step === 1 && (!form.admin_name.trim() || !form.admin_email.trim() || form.admin_password.length < 8)) {
      setError("Informe responsável, e-mail e uma senha com no mínimo 8 caracteres.");
      return;
    }
    if (step === 2 && (!form.name.trim() || !SLUG_PATTERN.test(form.slug.trim().toLowerCase()))) {
      setError("Informe o nome da loja e um código válido usando letras minúsculas, números e hífens.");
      return;
    }
    setStep((current) => Math.min(current + 1, 4));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const slug = form.slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) return setError("Código inválido: use apenas letras minúsculas, números e hífens.");
    setLoading(true);
    try {
      const response = await fetch(`${API}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, slug })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Não foi possível criar a loja. Verifique os dados e tente novamente.");
        return;
      }
      setCreatedTenant(payload.tenant || { slug, name: form.name.trim(), plan: form.plan_code });
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
            <div><strong>Aura Clinic ERP</strong><span>Plataforma para studios</span></div>
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
          <div><strong>Aura Clinic ERP</strong><span>Teste grátis por 7 dias</span></div>
        </header>
        <div className="signup-steps">
          {["Responsável", "Loja", "Plano", "Revisão"].map((label, index) => (
            <button key={label} type="button" className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => step > index + 1 && setStep(index + 1)}>
              {index + 1}. {label}
            </button>
          ))}
        </div>
        <form className="login-form signup-form" onSubmit={submit}>
          {step === 1 && (
            <>
              <div className="login-copy"><span className="login-kicker">Dados do responsável</span><h1>Quem vai administrar a loja?</h1></div>
              <label>Nome do responsável<input required value={form.admin_name} onChange={(event) => setForm({ ...form, admin_name: event.target.value })} placeholder="ex.: Ana Souza" /></label>
              <label>E-mail<input type="email" required value={form.admin_email} onChange={(event) => setForm({ ...form, admin_email: event.target.value })} placeholder="seu@email.com" /></label>
              <label>Senha<input type="password" minLength={8} required value={form.admin_password} onChange={(event) => setForm({ ...form, admin_password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label>
            </>
          )}
          {step === 2 && (
            <>
              <div className="login-copy"><span className="login-kicker">Identidade da loja</span><h1>Use o nome real do seu studio.</h1></div>
              <label>Nome da loja, studio ou clínica<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="ex.: Studio Lua Piercing" /></label>
              <label>Código da loja<input required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })} placeholder="ex.: studio-lua" /><small>Sua equipe usará este código no login.</small></label>
              <label>Telefone / WhatsApp<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="(00) 00000-0000" /></label>
              <div className="signup-inline">
                <label>Cidade<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
                <label>Estado<input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase().slice(0, 2) })} placeholder="SP" /></label>
              </div>
              <label>Logotipo por URL<input value={form.logo_url} onChange={(event) => setForm({ ...form, logo_url: event.target.value })} placeholder="https://..." /></label>
            </>
          )}
          {step === 3 && (
            <>
              <div className="login-copy"><span className="login-kicker"><Sparkles size={14} /> Pacotes Aura Clinic ERP</span><h1>Teste grátis por 7 dias</h1></div>
              <div className="plan-grid">
                {plans.map((plan) => (
                  <button key={plan.code} type="button" className={`plan-card ${form.plan_code === plan.code ? "active" : ""} ${plan.highlight || plan.is_recommended ? "recommended" : ""}`} onClick={() => setForm({ ...form, plan_code: plan.code })}>
                    {(plan.badge || plan.is_recommended) && <span className="plan-badge">{plan.badge || "Mais recomendado"}</span>}
                    <strong>{plan.name}</strong>
                    <b>{currency.format(Number(plan.price_cents || 0) / 100)}<small>/mês</small></b>
                    <em>{plan.audience}</em>
                    <ul>{asArray(plan.features).slice(0, 6).map((feature) => <li key={feature}>{featureLabels[feature] || feature}</li>)}</ul>
                    <span>Escolher plano</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <div className="login-copy"><span className="login-kicker">Revisão</span><h1>Confirmar criação da loja</h1></div>
              <div className="signup-review">
                <p><strong>Loja:</strong> {form.name}</p>
                <p><strong>Código:</strong> {form.slug}</p>
                <p><strong>Responsável:</strong> {form.admin_name}</p>
                <p><strong>Plano:</strong> {selectedPlan?.name} - 7 dias grátis</p>
              </div>
            </>
          )}
          {error && <span className="form-error">{error}</span>}
          <div className="signup-actions">
            {step > 1 && <button type="button" className="secondary-button" onClick={() => setStep((current) => current - 1)}>Voltar</button>}
            {step < 4 ? <button type="button" className="login-submit" onClick={next}>Continuar <ChevronRight size={18} /></button> : <button className="login-submit" disabled={loading}>{loading ? "Criando loja..." : "Criar conta e iniciar teste grátis"} <ChevronRight size={18} /></button>}
          </div>
          <a className="remember-access" href="/login">Já tenho uma loja - fazer login</a>
        </form>
      </section>
    </main>
  );
}
