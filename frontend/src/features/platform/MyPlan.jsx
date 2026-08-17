import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Button, Input } from "../../components/common/Ui";
import { apiFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import "../../styles/myplan.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const featureLabels = {
  clients: "Clientes", agenda: "Agenda", procedures: "Procedimentos", manual_reminders: "Lembretes manuais",
  basic_inventory: "Estoque simples", basic_catalog: "Catálogo simples", whatsapp_link: "Link WhatsApp",
  basic_reports: "Relatórios básicos", online_booking: "Agendamento online", anamnesis: "Anamnese digital",
  digital_terms: "Termo digital", basic_finance: "Financeiro básico", deposits: "Sinais/entradas",
  stock_alerts: "Alertas de estoque", automatic_followup: "Pós-atendimento automático",
  message_templates: "Modelos de mensagem", public_catalog_customization: "Catálogo personalizado",
  multi_user: "Multiusuários", commissions: "Comissões", monthly_reports: "Relatórios mensais",
  coupons: "Cupons", returns: "Trocas e devoluções", full_client_history: "Histórico completo do cliente",
  jewelry_sales_report: "Relatório de vendas de joias", advanced_catalog: "Catálogo avançado",
  catalog_analytics: "Google Analytics no catálogo", featured_products: "Produtos em destaque", promotional_banner: "Banner promocional", campaigns: "Campanhas",
  advanced_finance: "Financeiro avançado", variation_inventory: "Estoque por variação",
  alert_center: "Central de alertas", courses: "Cursos", priority_support: "Suporte prioritário"
};

// Tela "Meu plano": durante o trial permite experimentar outro pacote. Depois
// de contratada a assinatura, o backend exige suporte/fluxo de cobrança para
// não conceder recursos antes de confirmar a alteração financeira.
export function MyPlan({ subscription, plans, onChanged }) {
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [billing, setBilling] = useState(null);
  const [billingForm, setBillingForm] = useState({ tax_id: "", email: "", phone: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [checkingOut, setCheckingOut] = useState("");
  const list = asArray(plans);
  const currentCode = subscription?.plan_code || "";
  const daysLeft = Number(subscription?.days_left ?? 0);
  const status = String(subscription?.status || "");
  const isTrial = status === "trial_active";
  const isInactive = status && status !== "active" && !(isTrial && daysLeft > 0);

  const currentPlan = useMemo(() => list.find((p) => p.code === currentCode), [list, currentCode]);
  const billingProfile = billing?.billing_profile;
  const checkoutAvailable = Boolean(billing?.gateway_enabled && billingProfile?.complete && !billing?.subscription?.asaas_subscription_id);

  useEffect(() => {
    let active = true;
    apiFetch("/billing/subscription")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (!active) return;
        setBilling(payload);
        setBillingForm((current) => ({
          ...current,
          email: payload?.billing_profile?.email || "",
          phone: payload?.billing_profile?.phone || ""
        }));
      })
      .catch(() => { if (active) setBilling(null); });
    return () => { active = false; };
  }, []);

  async function changePlan(code) {
    if (code === currentCode || saving) return;
    setSaving(code);
    setError("");
    try {
      const response = await apiFetch("/subscription", { method: "PATCH", body: JSON.stringify({ plan_code: code }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Não foi possível trocar de plano.");
        return;
      }
      if (onChanged) onChanged();
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setSaving("");
    }
  }

  async function saveBillingProfile(event) {
    event.preventDefault();
    setError("");
    setSavingProfile(true);
    try {
      const response = await apiFetch("/billing/profile", {
        method: "PUT",
        body: JSON.stringify(billingForm)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível salvar os dados de cobrança.");
      setBilling((current) => current ? { ...current, billing_profile: payload } : current);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function startCheckout(planCode) {
    if (checkingOut) return;
    if (!billing?.gateway_enabled) return setError("Pagamento online ainda não está configurado.");
    if (!billingProfile?.complete) return setError("Informe o CPF ou CNPJ antes de contratar.");
    setCheckingOut(planCode);
    setError("");
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `subscription-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await apiFetch("/billing/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ plan_code: planCode, billing_type: "UNDEFINED" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível iniciar a contratação.");
      if (payload.invoice_url) {
        window.location.assign(payload.invoice_url);
        return;
      }
      setError("Assinatura criada. Aguarde alguns instantes e consulte a primeira fatura em Meu plano.");
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setCheckingOut("");
    }
  }

  return (
    <div className="stack myplan">
      <section className="panel">
        <div className="panel-heading">
          <h2>Seu plano atual</h2>
          <span>{currentPlan ? currentPlan.name : "—"}</span>
        </div>
        <div className={`plan-status ${isInactive ? "danger" : isTrial ? "warn" : "ok"}`}>
          {isInactive
            ? "Seu período de teste terminou. Escolha um plano — a ativação é liberada pela equipe Aura."
            : isTrial
              ? `Teste grátis: ${daysLeft} dia(s) restante(s).`
              : "Assinatura ativa."}
        </div>
        {error && <span className="form-error">{error}</span>}
      </section>

      {billing && !billing.gateway_enabled && (
        <section className="panel myplan-billing-notice">
          <strong>Pagamento online indisponível</strong>
          <p>A cobrança automática ainda não está configurada. Fale com a Monitence para concluir a contratação.</p>
        </section>
      )}

      {billing?.gateway_enabled && !billingProfile?.complete && (
        <section className="panel myplan-billing-profile">
          <div className="panel-heading">
            <div><h2>Dados para pagamento</h2><span>Informe o CPF ou CNPJ do responsável para continuar no checkout seguro.</span></div>
          </div>
          <form className="form-grid" onSubmit={saveBillingProfile}>
            <Input label="CPF ou CNPJ" required value={billingForm.tax_id} onChange={(tax_id) => setBillingForm((current) => ({ ...current, tax_id }))} placeholder="Somente números" inputMode="numeric" />
            <Input label="E-mail para cobrança" type="email" value={billingForm.email} onChange={(email) => setBillingForm((current) => ({ ...current, email }))} placeholder="financeiro@clinica.com" />
            <Input label="Telefone" value={billingForm.phone} onChange={(phone) => setBillingForm((current) => ({ ...current, phone }))} placeholder="(00) 00000-0000" inputMode="tel" />
            <div className="myplan-billing-action"><Button type="submit" disabled={savingProfile}>{savingProfile ? "Salvando…" : "Continuar para pagamento"}</Button></div>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="panel-heading">
          <h2><Sparkles size={16} /> Trocar de plano</h2>
          <span>{isTrial ? "Durante o teste, a troca é imediata." : "Planos contratados são alterados com apoio do suporte para ajustar a cobrança."}</span>
        </div>
        <div className="plan-grid">
          {list.map((plan) => {
            const active = plan.code === currentCode;
            return (
              <div key={plan.code} className={`plan-card ${active ? "active" : ""} ${plan.highlight || plan.is_recommended ? "recommended" : ""}`}>
                {(plan.badge || plan.is_recommended) && <span className="plan-badge">{plan.badge || "Mais recomendado"}</span>}
                <strong>{plan.name}</strong>
                <b>{currency.format(Number(plan.price_cents || 0) / 100)}<small>/mês</small></b>
                <em>{plan.audience}</em>
                <ul>{asArray(plan.features).slice(0, 8).map((feature) => (
                  <li key={feature}><CheckCircle2 size={13} /> {featureLabels[feature] || feature}</li>
                ))}</ul>
                {checkoutAvailable ? (
                  <Button disabled={checkingOut === plan.code} onClick={() => startCheckout(plan.code)}>
                    {checkingOut === plan.code ? "Abrindo pagamento…" : active ? "Contratar agora" : "Contratar este plano"}
                  </Button>
                ) : (
                  <Button
                    variant={active ? "secondary" : "primary"}
                    disabled={active || saving === plan.code}
                    onClick={() => changePlan(plan.code)}
                  >
                    {active ? "Plano atual" : saving === plan.code ? "Trocando…" : "Escolher"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
