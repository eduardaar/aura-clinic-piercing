import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { API } from "../lib/api";
import { asArray } from "../lib/utils";
import { featureLabel } from "../lib/planFeatures";
import { BrandMark } from "../components/common/BrandMark";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// 4 recursos — os mais fortes do produto, uma linha de texto cada.
// Sem ícone: cada card já tem foto própria, e o ícone genérico ao lado do título
// só competia com ela.
const FEATURES = [
  {
    title: "Agendamento online",
    text: "Seus clientes marcam horário sozinhos por um link só seu.",
    img: "/assets/landing/feature-agenda.jpg",
    alt: "Recepcionista de estúdio atendendo com um tablet em uma recepção clara",
    w: 1200, h: 900
  },
  {
    title: "Catálogo de joias",
    text: "Uma vitrine online da sua marca, pronta pra compartilhar.",
    img: "/assets/landing/feature-jewelry.jpg",
    alt: "Argolas douradas de piercing sobre uma base de pedra clara",
    w: 1200, h: 900
  },
  {
    title: "Ficha digital",
    text: "Anamnese e termo de consentimento assinados sem papel.",
    img: "/assets/landing/feature-care.jpg",
    alt: "Orelha com vários piercings cicatrizados no hélix e no lóbulo",
    w: 1200, h: 900
  },
  {
    title: "Financeiro e estoque",
    text: "Caixa, vendas e alertas de estoque baixo no mesmo lugar.",
    img: "/assets/landing/showcase-1.jpg",
    alt: "Brinco dourado texturizado em close-up",
    w: 900, h: 900
  }
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
    <main className="au-l-root">
      <header className="au-l-nav">
        <div className="au-l-nav-inner">
          <a className="au-l-brand" href="/" aria-label="Aura — página inicial">
            <BrandMark className="au-l-mark" size={34} />
            <strong>Aura</strong>
          </a>
          <nav className="au-l-nav-links" aria-label="Navegação principal">
            <a className="au-l-nav-link" href="#recursos">Recursos</a>
            <a className="au-l-nav-link" href="#planos">Planos</a>
            <a className="au-l-nav-login" href="/login">Entrar</a>
          </nav>
          <a className="au-l-btn au-l-btn-primary au-l-btn-sm" href="/cadastro">Começar grátis</a>
        </div>
      </header>

      <section className="au-l-hero">
        <div className="au-l-hero-inner">
          <div className="au-l-hero-copy">
            <span className="au-l-kicker"><Sparkles size={14} aria-hidden="true" /> Para estúdios de piercing</span>
            <h1>Gestão premium para quem vive da perfuração.</h1>
            <p>Agenda, catálogo de joias, ficha digital e financeiro — num sistema só.</p>
            <div className="au-l-hero-actions">
              <a className="au-l-btn au-l-btn-primary" href="/cadastro">
                Criar minha clínica <ChevronRight size={18} aria-hidden="true" />
              </a>
              <a className="au-l-btn au-l-btn-ghost" href="/login">Já tenho conta</a>
            </div>
            <span className="au-l-note">7 dias grátis · sem cartão de crédito</span>
          </div>

          <figure className="au-l-hero-media">
            <img
              src="/assets/landing/hero-studio.jpg"
              alt="Close de orelha com piercings de joias douradas no lóbulo"
              width="1600"
              height="1000"
              fetchpriority="high"
              decoding="async"
            />
            <figcaption className="au-l-hero-strip">
              <Sparkles size={14} aria-hidden="true" />
              Agenda, catálogo e ficha digital num link só seu
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="au-l-sec" id="recursos">
        <div className="au-l-sec-head">
          <h2>Tudo que o estúdio precisa</h2>
        </div>
        <div className="au-l-features">
          {FEATURES.map(({ title, text, img, alt, w, h }) => (
            <article key={title} className="au-l-feature">
              <div className="au-l-feature-media">
                <img src={img} alt={alt} width={w} height={h} loading="lazy" decoding="async" />
              </div>
              <div className="au-l-feature-body">
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="au-l-sec au-l-sec-plans" id="planos">
        <div className="au-l-sec-head">
          <h2>Planos para cada fase</h2>
          <p>Todos começam com 7 dias grátis. Troque quando quiser.</p>
        </div>
        <div className="au-l-plan-scroller">
          <div className="au-l-plan-grid">
            {orderedPlans.map((plan) => (
              <article key={plan.code} className={`au-l-plan ${plan.highlight || plan.is_recommended ? "is-featured" : ""}`}>
                {(plan.badge || plan.is_recommended) && (
                  <span className="au-l-plan-badge">{plan.badge || "Recomendado"}</span>
                )}
                <h3>{plan.name}</h3>
                <p className="au-l-plan-price">
                  {currency.format(Number(plan.price_cents || 0) / 100)}<small>/mês</small>
                </p>
                <p className="au-l-plan-aud">{plan.audience}</p>
                <ul className="au-l-plan-list">
                  {asArray(plan.features).slice(0, 4).map((f) => <li key={f}>{featureLabel(f)}</li>)}
                </ul>
                <a className="au-l-btn au-l-btn-plan" href="/cadastro">Começar grátis</a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="au-l-close">
        <div className="au-l-close-inner">
          <div className="au-l-close-copy">
            <h2>Pronto para profissionalizar seu estúdio?</h2>
            <a className="au-l-btn au-l-btn-primary" href="/cadastro">
              Criar minha clínica <ChevronRight size={18} aria-hidden="true" />
            </a>
            <span className="au-l-note">7 dias grátis · sem cartão de crédito</span>
          </div>
          <div className="au-l-shots" aria-hidden="true">
            <img src="/assets/landing/showcase-2.jpg" alt="" width="900" height="900" loading="lazy" decoding="async" />
            <img src="/assets/landing/showcase-3.jpg" alt="" width="900" height="900" loading="lazy" decoding="async" />
          </div>
        </div>

        <footer className="au-l-foot">
          <div className="au-l-brand">
            <BrandMark className="au-l-mark" size={34} />
            <strong>Aura</strong>
          </div>
          <span className="au-l-foot-text">Plataforma de gestão para estúdios de piercing.</span>
          <a className="au-l-foot-link" href="/login">Entrar na minha conta</a>
        </footer>
      </section>
    </main>
  );
}
