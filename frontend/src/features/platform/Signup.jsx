import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, ChevronRight } from "lucide-react";
import { API, setTenantSlug } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { featureLabel } from "../../lib/planFeatures";
import { PublicTopNav } from "../../components/layout/PublicTopNav";
import { PublicFooter } from "../../components/layout/PublicFooter";
import { Modal } from "../../components/common/Crud";
import { Button, Checkbox, Input } from "../../components/common/Ui";

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
  { code: "start", name: "Pacote Start", price_cents: 3990, audience: "Para quem está organizando a operação solo", features: ["clients", "agenda", "basic_catalog", "basic_reports"] },
  { code: "profissional", name: "Pacote Profissional", price_cents: 6990, audience: "Para transformar atendimento em uma operação profissional", badge: "Mais recomendado", highlight: true, features: ["online_booking", "basic_finance", "digital_terms", "public_catalog_customization"] },
  { code: "studio", name: "Pacote Studio", price_cents: 11990, audience: "Para estúdios com equipe, vendas e crescimento", features: ["multi_user", "advanced_catalog", "campaigns", "catalog_analytics"] }
];

// A tela de contratação deve responder "o que eu levo?" antes de a pessoa
// criar a conta. As features vêm da API; estes pontos traduzem limites e valor
// comercial em linguagem direta, sem expor códigos internos ao cliente.
const PLAN_HIGHLIGHTS = {
  start: ["1 usuário", "300 clientes", "100 agendamentos/mês", "1 GB de armazenamento", "Estoque e catálogo básicos"],
  profissional: ["Até 3 usuários", "Clientes e agendamentos ilimitados", "Financeiro, termos e agendamento online", "5 GB + 3 integrações de catálogo", "Catálogo personalizável"],
  studio: ["Até 10 usuários", "Clientes e agendamentos ilimitados", "Financeiro avançado e comissões", "20 GB + 12 integrações de catálogo", "Campanhas, Analytics e suporte prioritário"]
};

const STEP_LABELS = ["Sua clínica", "Plano"];

function selectedPlanFromUrl() {
  try { return new URLSearchParams(window.location.search).get("plano") || "profissional"; } catch { return "profissional"; }
}

export function Signup() {
  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState(fallbackPlans);
  const [form, setForm] = useState({
    name: "",
    admin_email: "",
    admin_password: "",
    admin_password_confirmation: "",
    plan_code: selectedPlanFromUrl()
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdTenant, setCreatedTenant] = useState(null);
  const [legalDocuments, setLegalDocuments] = useState([]);
  const [legalAccepted, setLegalAccepted] = useState({ terms_of_use: false, privacy_policy: false });
  const [openLegalDocument, setOpenLegalDocument] = useState(null);
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === form.plan_code) || plans.find((plan) => plan.code === "profissional") || plans[0],
    [plans, form.plan_code]
  );
  const slug = useMemo(() => slugPreview(form.name), [form.name]);
  const legalDocument = useMemo(
    () => legalDocuments.find((document) => document.key === openLegalDocument) || null,
    [legalDocuments, openLegalDocument]
  );

  useEffect(() => {
    fetch(`${API}/plans`)
      .then((response) => response.json())
      .then((payload) => setPlans(asArray(payload.plans).length ? payload.plans : fallbackPlans))
      .catch(() => setPlans(fallbackPlans));
  }, []);

  useEffect(() => {
    if (plans.some((plan) => plan.code === form.plan_code)) return;
    setForm((current) => ({ ...current, plan_code: plans.find((plan) => plan.code === "profissional")?.code || plans[0]?.code || "profissional" }));
  }, [plans, form.plan_code]);

  useEffect(() => {
    fetch(`${API}/legal-documents`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setLegalDocuments(asArray(payload.documents)))
      .catch(() => setLegalDocuments([]));
  }, []);

  function next() {
    setError("");
    if (step === 1) {
      if (!form.name.trim()) return setError("Informe o nome da sua clínica ou studio.");
      if (!form.admin_email.trim()) return setError("Informe um e-mail para acesso.");
      if (form.admin_password.length < 8) return setError("Crie uma senha com no mínimo 8 caracteres.");
      if (form.admin_password !== form.admin_password_confirmation) return setError("As senhas não conferem.");
      if (slug.length < 3) return setError("Use um nome com pelo menos 3 letras para gerar o endereço da loja.");
    }
    setStep((current) => Math.min(current + 1, 2));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.admin_email.trim() || form.admin_password.length < 8 || form.admin_password !== form.admin_password_confirmation) {
      setStep(1);
      return setError("Preencha nome da clínica, e-mail e as duas senhas iguais (mín. 8 caracteres).");
    }
    const terms = legalDocuments.find((document) => document.key === "terms_of_use");
    const privacy = legalDocuments.find((document) => document.key === "privacy_policy");
    if (!legalAccepted.terms_of_use || !legalAccepted.privacy_policy || !terms || !privacy) {
      return setError("Leia e aceite os Termos de Uso e a Política de Privacidade para criar a conta.");
    }
    setLoading(true);
    try {
      const response = await fetch(`${API}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // slug é OMITIDO de propósito: o backend deriva do nome e garante unicidade.
        body: JSON.stringify({
          name: form.name.trim(),
          admin_email: form.admin_email.trim(),
          admin_password: form.admin_password,
          plan_code: form.plan_code,
          legal_acceptances: { terms_of_use: terms.version, privacy_policy: privacy.version }
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
        window.location.href = "/app/onboarding";
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

            <Button type="button" className="au-a-submit" onClick={goToLogin}>
              Ir para o login <ChevronRight size={18} aria-hidden="true" />
            </Button>
          </div>
          </section>
        </main>
        <PublicFooter />
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
                  <p className="au-a-subtitle">Teste grátis de 7 dias em todos os recursos do plano escolhido. Sem cartão agora.</p>
                </div>

                <div className="au-a-field">
                  <label htmlFor="au-a-name">Nome da clínica ou studio</label>
                  <Input
                    label={null}
                    fieldClassName="au-a-signup-name-control"
                    id="au-a-name"
                    className="au-a-input"
                    required
                    autoFocus
                    value={form.name}
                    onChange={(name) => setForm({ ...form, name })}
                    placeholder="ex.: Studio Lua Piercing"
                  />
                  {slug.length >= 3 && <small className="au-a-hint">Endereço da sua loja: <strong>/{slug}</strong></small>}
                </div>

                <Input fieldClassName="au-a-field" label="E-mail de acesso" id="au-a-admin-email" className="au-a-input" type="email" required value={form.admin_email} onChange={(admin_email) => setForm({ ...form, admin_email })} placeholder="seu@email.com" />

                <Input fieldClassName="au-a-field" label="Senha" id="au-a-admin-password" className="au-a-input" type="password" minLength={8} required value={form.admin_password} onChange={(admin_password) => setForm({ ...form, admin_password })} placeholder="Mínimo 8 caracteres" />

                <Input fieldClassName="au-a-field" label="Confirme a senha" id="au-a-admin-password-confirmation" className="au-a-input" type="password" minLength={8} required value={form.admin_password_confirmation} onChange={(admin_password_confirmation) => setForm({ ...form, admin_password_confirmation })} placeholder="Digite a mesma senha novamente" />
              </>
            )}

            {step === 2 && (
              <>
                <div className="au-a-head">
                  <div className="au-a-plan-heading">
                    <Button type="button" variant="ghost" className="au-a-plan-back" aria-label="Voltar para os dados da clínica" title="Voltar" onClick={() => setStep(1)}>
                      <ArrowLeft size={18} aria-hidden="true" />
                    </Button>
                    <h1 className="au-a-title">Escolha seu plano</h1>
                  </div>
                  <p className="au-a-subtitle">Sem cobrança agora. Você pode trocar quando quiser.</p>
                </div>

                <div className="au-a-plans" role="radiogroup" aria-label="Planos disponíveis">
                  {plans.map((plan) => {
                    const active = form.plan_code === plan.code;
                    const badge = plan.badge || (plan.is_recommended ? "Mais recomendado" : "");
                    const highlights = PLAN_HIGHLIGHTS[plan.code] || asArray(plan.features).slice(0, 5).map(featureLabel);
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
                        <ul className="au-a-plan-features">
                          {highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                        </ul>
                      </button>
                    );
                  })}
                </div>

                <p className="au-a-review">
                  <span><strong>{form.name}</strong> · /{slug}</span>
                  <span><strong>{selectedPlan?.name}</strong> · 7 dias grátis · depois {currency.format(Number(selectedPlan?.price_cents || 0) / 100)}/mês</span>
                </p>
                <div className="au-a-legal" aria-label="Aceites obrigatórios">
                  <Checkbox
                    className="au-a-legal-checkbox"
                    checked={legalAccepted.terms_of_use && legalAccepted.privacy_policy}
                    onChange={(checked) => setLegalAccepted({ terms_of_use: checked, privacy_policy: checked })}
                    label={<>
                      Li e aceito os <Button type="button" variant="ghost" className="au-a-legal-link" onClick={() => setOpenLegalDocument("terms_of_use")}>Termos de Uso</Button> e a <Button type="button" variant="ghost" className="au-a-legal-link" onClick={() => setOpenLegalDocument("privacy_policy")}>Política de Privacidade</Button>.
                    </>}
                  />
                </div>
                <div className="au-a-actions au-a-plan-submit">
                  <Button key="signup-submit" type="submit" className="au-a-submit" disabled={loading}>
                    {loading ? "Criando…" : "Criar conta"} <ChevronRight size={18} aria-hidden="true" />
                  </Button>
                </div>
              </>
            )}

            {error && <p className="au-a-error" role="alert">{error}</p>}

            <div className="au-a-actions">
              {/* As `key` distintas são obrigatórias, não cosméticas: sem elas o React
                  reaproveita o MESMO nó DOM entre os dois ramos do ternário e só troca o
                  atributo type de "button" para "submit". Como isso acontece durante o
                  próprio clique em "Continuar" (setStep é síncrono para eventos discretos),
                  o browser executa a ação padrão já com o elemento virado em submit e envia
                  o formulário — criando a clínica no passo 1 e pulando a escolha de plano. */}
              {step < 2 ? (
                <Button key="signup-next" type="button" className="au-a-submit" onClick={next}>
                  Continuar <ChevronRight size={18} aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </form>

          <p className="au-a-alt">Já tem uma loja? <a href="/login">Fazer login</a></p>
        </div>
        </section>
      </main>
      <PublicFooter />
      <Modal
        open={Boolean(openLegalDocument)}
        title={legalDocument?.title || "Documento legal"}
        subtitle={legalDocument?.version ? `Versão ${legalDocument.version}` : undefined}
        size="lg"
        onClose={() => setOpenLegalDocument(null)}
      >
        <div className="au-a-legal-modal-content">
          {String(legalDocument?.content || "Este documento está sendo carregado. Tente novamente em instantes.").split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
      </Modal>
    </div>
  );
}
