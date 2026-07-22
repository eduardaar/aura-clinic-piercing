import React, { useEffect, useMemo, useState } from "react";
import { CalendarCheck, ChevronRight, Gem, HeartPulse, LayoutGrid, ShieldCheck, Sparkles, Store, WalletCards } from "lucide-react";
import { API } from "../lib/api";
import { asArray } from "../lib/utils";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const featureLabels = {
  clients: "Clientes", agenda: "Agenda", procedures: "Procedimentos", basic_inventory: "Estoque",
  basic_catalog: "Catálogo", whatsapp_link: "WhatsApp", online_booking: "Agendamento online",
  anamnesis: "Anamnese digital", digital_terms: "Termo digital", basic_finance: "Financeiro",
  stock_alerts: "Alertas de estoque", public_catalog_customization: "Catálogo personalizado",
  multi_user: "Multiusuários", commissions: "Comissões", monthly_reports: "Relatórios mensais",
  coupons: "Cupons", advanced_catalog: "Catálogo avançado", campaigns: "Campanhas",
  advanced_finance: "Financeiro avançado", priority_support: "Suporte prioritário"
};

const BENEFITS = [
  { icon: CalendarCheck, title: "Agenda e agendamento online", text: "Seus clientes marcam horário sozinhos por um link só seu; você confirma com um toque." },
  { icon: Gem, title: "Catálogo de joias com link próprio", text: "Uma vitrine online personalizada por estúdio, pronta pra compartilhar no Instagram e WhatsApp." },
  { icon: HeartPulse, title: "Ficha e anamnese digital", text: "Prontuário, anamnese e termo de consentimento assinados digitalmente — sem papel." },
  { icon: WalletCards, title: "Financeiro e vendas", text: "Controle de caixa, vendas de joias, sinais de agendamento e relatórios no mesmo lugar." },
  { icon: LayoutGrid, title: "Estoque de joias", text: "Cadastro por medidas, variações, alertas de estoque baixo e importação em massa." },
  { icon: ShieldCheck, title: "Cada clínica isolada", text: "Multi-tenant de verdade: seus dados ficam separados dos de qualquer outro estúdio." }
];

export function Landing() {
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    fetch(`${API}/plans`)
      .then((response) => response.json())
      .then((payload) => setPlans(asArray(payload.plans)))
      .catch(() => setPlans([]));
  }, []);

  const orderedPlans = useMemo(
    () => [...plans].sort((a, b) => Number(a.price_cents || 0) - Number(b.price_cents || 0)),
    [plans]
  );

  return (
    <main className="landing">
      <header className="landing-nav">
        <div className="landing-brand">
          <span className="landing-monogram">A</span>
          <strong>Aura</strong>
        </div>
        <nav>
          <a href="#recursos">Recursos</a>
          <a href="#planos">Planos</a>
          <a className="landing-login" href="/login">Entrar</a>
          <a className="landing-cta-sm" href="/cadastro">Começar grátis</a>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-kicker"><Sparkles size={14} /> Plataforma para estúdios de piercing</span>
          <h1>Gestão premium para quem vive da perfuração.</h1>
          <p>Agenda, catálogo de joias com link próprio, ficha digital, financeiro e biossegurança — tudo num sistema só, feito por body piercer para body piercers.</p>
          <div className="landing-hero-actions">
            <a className="landing-cta" href="/cadastro">Criar minha clínica grátis <ChevronRight size={18} /></a>
            <a className="landing-ghost" href="/login">Já tenho conta</a>
          </div>
          <span className="landing-note">7 dias grátis · sem cartão de crédito</span>
        </div>
        <div className="landing-hero-cards" aria-hidden="true">
          <article><CalendarCheck size={18} /><span>Agenda do dia</span><strong>08 atendimentos</strong></article>
          <article><Gem size={18} /><span>Catálogo online</span><strong>link exclusivo</strong></article>
          <article><Store size={18} /><span>Vendas do mês</span><strong>R$ 18.420</strong></article>
        </div>
      </section>

      <section className="landing-section" id="recursos">
        <div className="landing-section-head">
          <span className="landing-kicker">Tudo que seu estúdio precisa</span>
          <h2>Um sistema completo, sem gambiarra</h2>
        </div>
        <div className="landing-benefits">
          {BENEFITS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="landing-benefit">
              <div className="landing-benefit-icon"><Icon size={22} /></div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-pricing" id="planos">
        <div className="landing-section-head">
          <span className="landing-kicker"><Sparkles size={14} /> Planos para cada fase</span>
          <h2>Comece grátis, cresça no seu ritmo</h2>
          <p>Todos os planos começam com 7 dias grátis. Troque de plano quando quiser.</p>
        </div>
        <div className="landing-plan-grid">
          {orderedPlans.map((plan) => (
            <div key={plan.code} className={`landing-plan ${plan.highlight || plan.is_recommended ? "featured" : ""}`}>
              {(plan.badge || plan.is_recommended) && <span className="landing-plan-badge">{plan.badge || "Mais recomendado"}</span>}
              <h3>{plan.name}</h3>
              <div className="landing-plan-price">{currency.format(Number(plan.price_cents || 0) / 100)}<small>/mês</small></div>
              <p className="landing-plan-aud">{plan.audience}</p>
              <ul>{asArray(plan.features).slice(0, 7).map((f) => <li key={f}>{featureLabels[f] || f}</li>)}</ul>
              <a className="landing-plan-cta" href="/cadastro">Começar grátis</a>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-final">
        <h2>Pronto para profissionalizar seu estúdio?</h2>
        <p>Crie sua conta em menos de um minuto e comece o teste grátis hoje.</p>
        <a className="landing-cta" href="/cadastro">Criar minha clínica grátis <ChevronRight size={18} /></a>
      </section>

      <footer className="landing-footer">
        <div className="landing-brand"><span className="landing-monogram">A</span><strong>Aura</strong></div>
        <span>Plataforma de gestão para estúdios de piercing.</span>
        <a href="/login">Entrar na minha conta</a>
      </footer>
    </main>
  );
}
