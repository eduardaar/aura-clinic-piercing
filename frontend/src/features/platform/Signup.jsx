import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, ChevronRight } from "lucide-react";
import { API, setTenantSlug } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { featureLabel } from "../../lib/planFeatures";
import { PublicTopNav } from "../../components/layout/PublicTopNav";

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
  { code: "start", name: "Pacote Start", price_cents: 3990, audience: "Piercers iniciantes ou autônomos", features: ["clients", "agenda", "procedures", "basic_catalog", "whatsapp_link"] },
  { code: "profissional", name: "Pacote Profissional", price_cents: 6990, audience: "Estúdios que querem agendamento online", badge: "Mais recomendado", highlight: true, features: ["online_booking", "anamnesis", "digital_terms", "basic_finance", "stock_alerts"] },
  { code: "studio", name: "Pacote Studio", price_cents: 9990, audience: "Estúdios com equipe", features: ["multi_user", "commissions", "monthly_reports", "coupons"] },
  { code: "premium", name: "Pacote Premium", price_cents: 14990, audience: "Operações completas", features: ["advanced_catalog", "campaigns", "advanced_finance", "priority_support"] }
];

const STEP_LABELS = ["Sua clínica", "Plano"];

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
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === form.plan_code) || plans.find((plan) => plan.code === "profissional") || plans[0],
    [plans, form.plan_code]
  );
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
      <div className="au-shell">
        <PublicTopNav current="signup" />

        <main className="au-a-root au-a-signup">
        <section className="au-a-panel">
          <div className="au-a-inner">
            <span className="au-a-success-icon" aria-hidden="true"><CheckCircle2 size={26} /></span>
            <h1 className="au-a-title">{createdTenant.name} está pronta.</h1>
            <p className="au-a-subtitle">Seu teste grátis de 7 dias começou. Use o código abaixo para acessar sua loja.</p>

            <p className="au-a-code">Código da loja: <strong>{createdTenant.slug}</strong></p>

            <button type="button" className="au-a-submit" onClick={goToLogin}>
              Ir para o login <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="au-shell">
      <PublicTopNav current="signup" />

      <main className={`au-a-root au-a-signup${step === 2 ? " is-wide" : ""}`}>
      <section className="au-a-panel">
        <div className="au-a-inner">
          <nav className="au-a-steps" aria-label="Etapas do cadastro">
            {STEP_LABELS.map((label, index) => {
              const number = index + 1;
              const state = step === number ? "is-active" : step > number ? "is-done" : "";
              return (
                <button
                  key={label}
                  type="button"
                  className={`au-a-step ${state}`.trim()}
                  aria-current={step === number ? "step" : undefined}
                  onClick={() => step > number && setStep(number)}
                >
                  {number}. {label}
                </button>
              );
            })}
          </nav>

          <form className="au-a-form" onSubmit={submit}>
            {step === 1 && (
              <>
                <div className="au-a-head">
                  <h1 className="au-a-title">Crie sua clínica</h1>
                  <p className="au-a-subtitle">Teste grátis por 7 dias. Só o essencial — o resto você ajusta depois.</p>
                </div>

                <div className="au-a-field">
                  <label htmlFor="au-a-name">Nome da clínica ou studio</label>
                  <input
                    id="au-a-name"
                    className="au-a-input"
                    required
                    autoFocus
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="ex.: Studio Lua Piercing"
                  />
                  {slug.length >= 3 && <small className="au-a-hint">Endereço da sua loja: <strong>/{slug}</strong></small>}
                </div>

                <div className="au-a-field">
                  <label htmlFor="au-a-admin-name">Seu nome <span className="au-a-optional">(opcional)</span></label>
                  <input
                    id="au-a-admin-name"
                    className="au-a-input"
                    value={form.admin_name}
                    onChange={(event) => setForm({ ...form, admin_name: event.target.value })}
                    placeholder="ex.: Ana Souza"
                  />
                </div>

                <div className="au-a-field">
                  <label htmlFor="au-a-admin-email">E-mail de acesso</label>
                  <input
                    id="au-a-admin-email"
                    className="au-a-input"
                    type="email"
                    required
                    value={form.admin_email}
                    onChange={(event) => setForm({ ...form, admin_email: event.target.value })}
                    placeholder="seu@email.com"
                  />
                </div>

                <div className="au-a-field">
                  <label htmlFor="au-a-admin-password">Senha</label>
                  <input
                    id="au-a-admin-password"
                    className="au-a-input"
                    type="password"
                    minLength={8}
                    required
                    value={form.admin_password}
                    onChange={(event) => setForm({ ...form, admin_password: event.target.value })}
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="au-a-head">
                  <h1 className="au-a-title">Escolha seu plano</h1>
                  <p className="au-a-subtitle">Sem cobrança agora. Você pode trocar quando quiser.</p>
                </div>

                <div className="au-a-plans" role="radiogroup" aria-label="Planos disponíveis">
                  {plans.map((plan) => {
                    const active = form.plan_code === plan.code;
                    const badge = plan.badge || (plan.is_recommended ? "Mais recomendado" : "");
                    return (
                      <button
                        key={plan.code}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`au-a-plan${active ? " is-active" : ""}${badge ? " has-badge" : ""}`}
                        onClick={() => setForm({ ...form, plan_code: plan.code })}
                      >
                        {badge && <span className="au-a-plan-badge">{badge}</span>}
                        {active && <span className="au-a-plan-check" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>}
                        <span className="au-a-plan-top">
                          <span className="au-a-plan-name">{plan.name}</span>
                          <span className="au-a-plan-price">{currency.format(Number(plan.price_cents || 0) / 100)}<span>/mês</span></span>
                        </span>
                        <span className="au-a-plan-audience">{plan.audience}</span>
                        <span className="au-a-plan-features">
                          {asArray(plan.features).slice(0, 3).map((feature) => (
                            <span key={feature}>{featureLabel(feature)}</span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="au-a-review">
                  <span><strong>{form.name}</strong> · /{slug}</span>
                  <span><strong>{selectedPlan?.name}</strong> · 7 dias grátis</span>
                </p>
              </>
            )}

            {error && <p className="au-a-error" role="alert">{error}</p>}

            <div className="au-a-actions">
              {step > 1 && (
                <button type="button" className="au-a-ghost" onClick={() => setStep((current) => current - 1)}>
                  <ArrowLeft size={16} aria-hidden="true" /> Voltar
                </button>
              )}
              {/* As `key` distintas são obrigatórias, não cosméticas: sem elas o React
                  reaproveita o MESMO nó DOM entre os dois ramos do ternário e só troca o
                  atributo type de "button" para "submit". Como isso acontece durante o
                  próprio clique em "Continuar" (setStep é síncrono para eventos discretos),
                  o browser executa a ação padrão já com o elemento virado em submit e envia
                  o formulário — criando a clínica no passo 1 e pulando a escolha de plano. */}
              {step < 2 ? (
                <button key="signup-next" type="button" className="au-a-submit" onClick={next}>
                  Continuar <ChevronRight size={18} aria-hidden="true" />
                </button>
              ) : (
                <button key="signup-submit" type="submit" className="au-a-submit" disabled={loading}>
                  {loading ? "Criando…" : "Criar conta"} <ChevronRight size={18} aria-hidden="true" />
                </button>
              )}
            </div>
          </form>

          <p className="au-a-alt">Já tem uma loja? <a href="/login">Fazer login</a></p>
        </div>
        </section>
      </main>
    </div>
  );
}
