import React, { useMemo, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";

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
  featured_products: "Produtos em destaque", promotional_banner: "Banner promocional", campaigns: "Campanhas",
  advanced_finance: "Financeiro avançado", variation_inventory: "Estoque por variação",
  alert_center: "Central de alertas", courses: "Cursos", priority_support: "Suporte prioritário"
};

// Tela "Meu plano": mostra o plano atual, o status do trial e permite trocar de
// plano (self-service via PATCH /api/subscription). role só admin chega aqui.
export function MyPlan({ subscription, plans, onChanged }) {
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const list = asArray(plans);
  const currentCode = subscription?.plan_code || "";
  const daysLeft = Number(subscription?.days_left ?? 0);
  const status = String(subscription?.status || "");
  const isTrial = status === "trial_active";
  const isInactive = status && status !== "active" && !(isTrial && daysLeft > 0);

  const currentPlan = useMemo(() => list.find((p) => p.code === currentCode), [list, currentCode]);

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

      <section className="panel">
        <div className="panel-heading">
          <h2><Sparkles size={16} /> Trocar de plano</h2>
          <span>Escolha o pacote ideal — a troca é imediata.</span>
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
                <button
                  type="button"
                  className={active ? "secondary-button" : "primary-button"}
                  disabled={active || saving === plan.code}
                  onClick={() => changePlan(plan.code)}
                >
                  {active ? "Plano atual" : saving === plan.code ? "Trocando…" : "Escolher"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
