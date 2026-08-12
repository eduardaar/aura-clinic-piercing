import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, ChevronRight, Instagram, Mail, MessageCircle, Sparkles, X } from "lucide-react";
import { API, API_ORIGIN } from "../lib/api";
import { asArray, asNumber, asObject } from "../lib/utils";
import { featureLabel } from "../lib/planFeatures";
import { BrandMark } from "../components/common/BrandMark";
import { PublicTopNav } from "../components/layout/PublicTopNav";
import { DEFAULT_LANDING_SECTIONS, LANDING_DEFAULTS } from "./landingDefaults";
import "../styles/landing-carousel.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// O conteúdo traz só a URL da imagem: quem manda no formato é o CSS
// (`aspect-ratio` + `object-fit: cover`). Estes números existem para o
// navegador reservar o espaço antes de a foto chegar — sem `width`/`height` a
// página pula a cada imagem carregada, e a landing é justamente onde o visitante
// está lendo enquanto o resto baixa.
const IMAGE_SIZE = {
  hero: { width: 1600, height: 1000 },
  feature: { width: 1200, height: 900 },
  carousel: { width: 1600, height: 1000 },
  shot: { width: 900, height: 900 }
};

// Imagem enviada pelo painel chega como "/uploads/...", servida pelo backend —
// em dev o front roda em outra porta, então o caminho relativo daria 404.
// Caminho do próprio site (/assets/...) e URL absoluta passam intactos.
function imageUrl(url) {
  const value = String(url || "").trim();
  return value.startsWith("/uploads") ? `${API_ORIGIN}${value}` : value;
}

// Mescla o que veio da API sobre o conteúdo embutido.
//
// Campo ausente OU vazio volta ao default: o painel salva bloco a bloco e um
// título apagado por engano viraria um buraco (ou um "undefined") na página
// pública. `autoplay_seconds: 0` é valor legítimo e passa — só string em branco
// e lista vazia contam como "não preenchido".
function mergeContent(sectionKey, rawContent) {
  const merged = { ...asObject(LANDING_DEFAULTS[sectionKey]) };
  for (const [field, value] of Object.entries(asObject(rawContent))) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    merged[field] = value;
  }
  return merged;
}

// Lista de itens de um bloco, já sem as linhas que o painel deixou pela metade.
//
// Cada item ganha um `key` estável derivado do próprio conteúdo (e não da
// posição): o painel reordena e remove itens, e uma chave posicional faria o
// React reaproveitar o slide errado — imagem de um item aparecendo com a
// legenda de outro. O sufixo cobre o caso legítimo de dois itens idênticos.
function contentItems(content, field, requiredField) {
  const seen = new Map();
  return asArray(content[field])
    .map((item) => asObject(item))
    .filter((item) => String(item[requiredField] || "").trim())
    .map((item) => {
      const base = String(item[requiredField]);
      const repeated = (seen.get(base) || 0) + 1;
      seen.set(base, repeated);
      return { ...item, key: repeated > 1 ? `${base}#${repeated}` : base };
    });
}

function whatsappUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function FloatingWhatsApp({ phone }) {
  const href = whatsappUrl(phone);
  if (!href) return null;
  return (
    <a
      className="au-l-whatsapp-float"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Falar conosco pelo WhatsApp"
    >
      <MessageCircle size={24} aria-hidden="true" />
    </a>
  );
}

/* ---------- blocos ------------------------------------------------------- */

function HeroSection({ content }) {
  return (
    <section className="au-l-hero">
      <div className="au-l-hero-inner">
        <div className="au-l-hero-copy">
          {content.kicker && <span className="au-l-kicker">{content.kicker}</span>}
          <h1>{content.title}</h1>
          <p>{content.subtitle}</p>
          <div className="au-l-hero-actions">
            <a className="au-l-btn au-l-btn-primary" href={content.primary_href}>
              {content.primary_label} <ChevronRight size={18} aria-hidden="true" />
            </a>
            {content.secondary_label && (
              <a className="au-l-btn au-l-btn-ghost" href={content.secondary_href}>{content.secondary_label}</a>
            )}
          </div>
          {content.note && <span className="au-l-note">{content.note}</span>}
        </div>

        <figure className="au-l-hero-media">
          <img
            src={imageUrl(content.image)}
            alt={content.image_alt}
            width={IMAGE_SIZE.hero.width}
            height={IMAGE_SIZE.hero.height}
            fetchpriority="high"
            decoding="async"
          />
          {content.caption && <figcaption className="au-l-hero-strip">{content.caption}</figcaption>}
        </figure>
      </div>
    </section>
  );
}

function FeaturesSection({ content }) {
  const items = contentItems(content, "items", "title");
  if (!items.length) return null;
  return (
    <section className="au-l-sec" id="recursos">
      <div className="au-l-sec-head">
        <h2>{content.title}</h2>
        {content.subtitle && <p>{content.subtitle}</p>}
      </div>
      <div className="au-l-features">
        {items.map((item) => (
          <article key={item.key} className="au-l-feature">
            <div className="au-l-feature-media">
              <img
                src={imageUrl(item.image)}
                alt={item.image_alt || ""}
                width={IMAGE_SIZE.feature.width}
                height={IMAGE_SIZE.feature.height}
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="au-l-feature-body">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// Faixa de valor comercial entre os recursos e a escolha de plano. Não é mais
// um card: o contraste intencional cria pausa na rolagem e explica por que o
// Aura resolve a operação inteira, não apenas a agenda.
function PlatformValueSection() {
  const items = [
    { icon: Sparkles, title: "Assistente com IA", text: "Crie mensagens, resumos e respostas para ganhar tempo no atendimento." },
    { icon: MessageCircle, title: "WhatsApp integrado", text: "Centralize lembretes, confirmações e conversas com crédito controlado." },
    { icon: BellRing, title: "Automação que acompanha", text: "Avise, faça pós-atendimento e mantenha cada cliente no fluxo certo." }
  ];
  return (
    <section className="au-l-value" id="plataforma">
      <div className="au-l-value-inner">
        <div className="au-l-value-copy">
          <span className="au-l-kicker">Feito para a rotina real</span>
          <h2>Mais que agenda: uma operação conectada.</h2>
          <p>Do primeiro contato à recompra, o Aura organiza atendimento, estoque, financeiro e comunicação em um só lugar.</p>
        </div>
        <div className="au-l-value-list">
          {items.map(({ icon: Icon, title, text }) => <article key={title}>
            <Icon size={22} aria-hidden="true" />
            <div><h3>{title}</h3><p>{text}</p></div>
          </article>)}
        </div>
      </div>
    </section>
  );
}

// Preferência de sistema, lida ao vivo: quem liga "reduzir movimento" no meio da
// visita para o autoplay na hora, sem recarregar a página.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let media;
    try {
      media = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const onChange = (event) => setReduced(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function CarouselSection({ content }) {
  const items = contentItems(content, "items", "image");
  const [active, setActive] = useState(0);
  // Hover e foco pausam: ninguém consegue ler uma legenda (nem clicar num ponto)
  // que troca sozinha embaixo do cursor.
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const seconds = asNumber(content.autoplay_seconds, 0);
  // Uma imagem só não é carrossel: sem pontos e sem rotação.
  const canRotate = items.length > 1 && seconds > 0 && !paused && !reducedMotion;
  const total = items.length;

  useEffect(() => {
    if (!canRotate) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % total);
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [canRotate, seconds, total]);

  if (!total) return null;
  // O painel pode ter removido imagens desde o último clique nos pontos.
  const current = active % total;

  return (
    <section
      className="au-l-sec au-l-carousel-sec"
      aria-roledescription="carrossel"
      aria-label={content.title || "Galeria"}
    >
      <div className="au-l-sec-head">
        <h2>{content.title}</h2>
        {content.subtitle && <p>{content.subtitle}</p>}
      </div>

      <div
        className="au-l-carousel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div className="au-l-carousel-stage">
          {items.map((item, index) => (
            <figure
              key={item.key}
              className={`au-l-carousel-slide ${index === current ? "is-active" : ""}`}
              aria-hidden={index === current ? undefined : "true"}
            >
              <img
                src={imageUrl(item.image)}
                alt={item.image_alt || ""}
                width={IMAGE_SIZE.carousel.width}
                height={IMAGE_SIZE.carousel.height}
                loading="lazy"
                decoding="async"
              />
              {item.caption && <figcaption className="au-l-carousel-caption">{item.caption}</figcaption>}
            </figure>
          ))}
        </div>

        {total > 1 && (
          <div className="au-l-carousel-dots">
            {items.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={index === current ? "is-active" : ""}
                aria-label={`Ver imagem ${index + 1} de ${total}`}
                aria-current={index === current ? "true" : undefined}
                onClick={() => setActive(index)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// Os planos continuam vindo de `GET /api/plans` — preço e recursos são dado
// vivo da plataforma, não texto de marketing. Do conteúdo editável vêm só o
// título, o subtítulo e o rótulo/destino do botão.
function PlansSection({ content, plans }) {
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const visibleFeatures = (plan) => asArray(plan.features).slice(0, 5);
  const allFeatures = [...new Set(plans.flatMap((plan) => asArray(plan.features)))];
  return (
    <section className="au-l-sec au-l-sec-plans" id="planos">
      <div className="au-l-sec-head">
        <h2>{content.title}</h2>
        {content.subtitle && <p>{content.subtitle}</p>}
        {plans.length > 1 && <button type="button" className="au-l-compare-button" onClick={() => setComparisonOpen(true)}>Comparar planos</button>}
      </div>
      <div className="au-l-plan-scroller">
        <div className="au-l-plan-grid">
          {plans.map((plan) => (
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
                {visibleFeatures(plan).map((f) => <li key={f}>{featureLabel(f)}</li>)}
              </ul>
              {asArray(plan.features).length > 5 && <span className="au-l-plan-more">E mais recursos para sua operação.</span>}
              <a className="au-l-btn au-l-btn-plan" href={content.cta_href}>{content.cta_label}</a>
            </article>
          ))}
        </div>
      </div>
      {comparisonOpen && (
        <div className="au-l-plan-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setComparisonOpen(false); }}>
          <section className="au-l-plan-modal" role="dialog" aria-modal="true" aria-label="Comparativo detalhado de planos">
            <div className="au-l-plan-modal-head">
              <div><h2>Compare os planos</h2><p>Escolha pelo momento do seu estúdio. Você pode evoluir quando precisar.</p></div>
              <button type="button" aria-label="Fechar comparativo" onClick={() => setComparisonOpen(false)}><X size={20} /></button>
            </div>
            <div className="au-l-plan-compare-scroll">
              <table>
                <thead><tr><th>Recurso</th>{plans.map((plan) => <th key={plan.code}><strong>{plan.name}</strong><small>{currency.format(Number(plan.price_cents || 0) / 100)}/mês</small></th>)}</tr></thead>
                <tbody>{allFeatures.map((feature) => <tr key={feature}><th>{featureLabel(feature)}</th>{plans.map((plan) => <td key={plan.code}>{asArray(plan.features).includes(feature) ? <Check size={18} aria-label="Incluído" /> : "—"}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="au-l-plan-modal-actions"><button type="button" className="au-l-btn au-l-btn-ghost" onClick={() => setComparisonOpen(false)}>Fechar</button><a className="au-l-btn au-l-btn-primary" href={content.cta_href}>{content.cta_label}</a></div>
          </section>
        </div>
      )}
    </section>
  );
}

function ClosingSection({ content }) {
  const shots = contentItems(content, "images", "image");
  // Fotos sem texto alternativo são enfeite: escondê-las do leitor de tela evita
  // anunciar "imagem" três vezes sem dizer nada. Se o painel descrever alguma,
  // ela passa a contar como conteúdo.
  const decorative = shots.every((shot) => !String(shot.image_alt || "").trim());

  return (
    <section className="au-l-close">
      <div className="au-l-close-inner">
        <div className="au-l-close-copy">
          <h2>{content.title}</h2>
          <a className="au-l-btn au-l-btn-primary" href={content.primary_href}>
            {content.primary_label} <ChevronRight size={18} aria-hidden="true" />
          </a>
          {content.note && <span className="au-l-note">{content.note}</span>}
        </div>
        {shots.length > 0 && (
          <div className="au-l-shots" aria-hidden={decorative ? "true" : undefined}>
            {shots.map((shot) => (
              <img
                key={shot.key}
                src={imageUrl(shot.image)}
                alt={shot.image_alt || ""}
                width={IMAGE_SIZE.shot.width}
                height={IMAGE_SIZE.shot.height}
                loading="lazy"
                decoding="async"
              />
            ))}
          </div>
        )}
      </div>

      <footer className="au-l-foot">
        <div className="au-l-foot-brand">
          <div className="au-l-brand">
            <BrandMark className="au-l-mark" size={34} />
            <strong>Aura</strong>
          </div>
          <span className="au-l-foot-text">{content.footer_text}</span>
        </div>
        <div className="au-l-contact" aria-label="Canais de contato">
          {content.contact_whatsapp && <a href={whatsappUrl(content.contact_whatsapp)} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> WhatsApp</a>}
          {content.contact_email && <a href={`mailto:${content.contact_email}`}><Mail size={18} aria-hidden="true" /> E-mail</a>}
          {content.contact_instagram && <a href={content.contact_instagram} target="_blank" rel="noreferrer"><Instagram size={18} aria-hidden="true" /> Instagram</a>}
        </div>
        <a className="au-l-foot-link" href={content.footer_link_href}>{content.footer_link_label}</a>
      </footer>
    </section>
  );
}

// Um componente por tipo de bloco. Chave fora desta tabela é ignorada em
// silêncio: o backend pode ganhar um bloco novo antes de o frontend saber
// desenhá-lo, e nesse intervalo a landing tem de continuar de pé.
const SECTION_COMPONENTS = {
  hero: HeroSection,
  features: FeaturesSection,
  carousel: CarouselSection,
  plans: PlansSection,
  closing: ClosingSection
};

export function Landing() {
  // Começa JÁ com o conteúdo embutido, não com lista vazia. A landing é a porta
  // de entrada de quem vai assinar: API fora, lenta ou devolvendo lista vazia
  // não pode virar tela branca — isso é venda perdida na hora. Quando a resposta
  // chega, ela substitui o embutido; até lá a página está inteira.
  const [sections, setSections] = useState(DEFAULT_LANDING_SECTIONS);
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    let active = true;
    // Rota pública, sem token e sem tenant — a landing é da plataforma, não de
    // uma clínica.
    fetch(`${API}/landing`)
      .then((response) => response.json())
      .then((payload) => {
        const received = asArray(payload?.sections)
          .map((section) => asObject(section))
          .filter((section) => SECTION_COMPONENTS[section.section_key]);
        // Lista vazia = mantém o embutido. Melhor a página de ontem que página
        // nenhuma.
        if (active && received.length) setSections(received);
      })
      .catch(() => {
        // Silêncio proposital: o visitante não tem o que fazer com um erro de
        // API, e a página embutida já está na tela.
      });
    return () => { active = false; };
  }, []);

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
  const closingContent = useMemo(() => {
    const closing = sections.find((section) => section.section_key === "closing");
    return mergeContent("closing", closing?.content);
  }, [sections]);

  return (
    <div className="au-shell">
      <PublicTopNav current="landing" />

      <main className="au-l-root">
        {/* Ordem da API (já vem ordenada); sem ela, a ordem do embutido. */}
        {sections.map((section) => {
          const Section = SECTION_COMPONENTS[section.section_key];
          if (!Section) return null;
          const rendered = (
            <Section
              key={section.section_key}
              content={mergeContent(section.section_key, section.content)}
              plans={orderedPlans}
            />
          );
          if (section.section_key === "plans") {
            return [<PlatformValueSection key="platform-value-before-plans" />, rendered];
          }
          if (section.section_key === "closing") {
            return [<PlatformValueSection key="platform-value-before-closing" />, rendered];
          }
          return rendered;
        })}
      </main>
      <FloatingWhatsApp phone={closingContent.contact_whatsapp} />
    </div>
  );
}
