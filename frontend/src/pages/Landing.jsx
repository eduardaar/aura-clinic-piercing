import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { API, API_ORIGIN } from "../lib/api";
import { asArray, asObject } from "../lib/utils";
import { featureLabel, highlightedPlanFeatures } from "../lib/planFeatures";
import { PublicTopNav } from "../components/layout/PublicTopNav";
import { PublicFooter } from "../components/layout/PublicFooter";
import { Accordion } from "../components/common/Ui";
import { DEFAULT_LANDING_SECTIONS, LANDING_DEFAULTS } from "./landingDefaults";
import "../styles/landing-carousel.css";
import "../styles/content-hub.css";

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
      return /** @type {Record<string, any>} */ ({ ...item, key: repeated > 1 ? `${base}#${repeated}` : base });
    });
}

function whatsappUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12.04 2A9.78 9.78 0 0 0 3.7 16.9L2.5 21.5l4.7-1.24A9.78 9.78 0 1 0 12.04 2Zm0 17.8a8 8 0 0 1-4.08-1.12l-.3-.18-2.79.73.75-2.72-.2-.32a8 8 0 1 1 6.62 3.61Zm4.39-5.97c-.24-.12-1.44-.71-1.66-.79-.22-.08-.38-.12-.54.12-.16.24-.63.79-.77.95-.14.16-.29.18-.53.06-1.45-.72-2.4-1.28-3.35-2.9-.25-.43.25-.4.72-1.34.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2 0 1.18.86 2.32.98 2.48.12.16 1.7 2.6 4.12 3.64.57.25 1.02.4 1.37.51.58.18 1.1.16 1.52.1.46-.07 1.44-.59 1.64-1.15.2-.57.2-1.05.14-1.15-.06-.1-.22-.16-.46-.28Z" />
  </svg>;
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
      <WhatsAppIcon />
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
            <a className="au-l-btn au-l-hero-primary" href="/cadastro">Criar minha clínica</a>
            <a className="au-l-btn au-l-btn-ghost" href="#planos">Ver planos e recursos</a>
          </div>
          {content.note && <span className="au-l-note">{content.note}</span>}
        </div>
      </div>
    </section>
  );
}

const FAQ_ITEMS = [
  {
    question: "Como funciona o teste grátis?",
    answer: "Você cria sua clínica e usa o sistema gratuitamente por 7 dias, sem cadastrar cartão. Durante o teste, pode configurar o estúdio e conhecer os recursos do plano escolhido."
  },
  {
    question: "Como meus clientes fazem agendamentos?",
    answer: "A clínica recebe um link próprio de agendamento. O cliente escolhe o serviço, o profissional e um horário disponível; o compromisso entra automaticamente na agenda."
  },
  {
    question: "Consigo guardar fichas e termos assinados?",
    answer: "Sim. O histórico do cliente, anamnese, autorizações e termos digitais ficam organizados no cadastro dele para consulta nos próximos atendimentos."
  },
  {
    question: "O sistema controla joias, produtos e estoque?",
    answer: "Sim. Você cadastra produtos e variações, acompanha entradas e saídas, recebe alertas de reposição e pode montar um catálogo online para compartilhar com clientes."
  },
  {
    question: "Também posso controlar o financeiro?",
    answer: "Sim. A Aura reúne vendas, contas a pagar e receber, movimentações de caixa e relatórios para acompanhar os resultados do estúdio."
  },
  {
    question: "Posso trocar de plano depois?",
    answer: "Sim. Você pode mudar de plano conforme o estúdio cresce. Os valores e recursos de cada opção ficam disponíveis nesta mesma página."
  },
  {
    question: "Meus dados ficam seguros?",
    answer: "O acesso é protegido por login e cada clínica possui seu próprio ambiente. As informações ficam separadas e só usuários autorizados conseguem acessar o painel."
  },
  {
    question: "Tenho suporte para começar?",
    answer: "Sim. Você conta com suporte para configurar a clínica, entender os recursos e tirar dúvidas durante o uso do sistema."
  }
];

function FaqSection() {
  return (
    <section className="au-l-sec au-l-faq-section" id="perguntas-frequentes">
      <div className="au-l-sec-head">
        <h2>Perguntas frequentes</h2>
        <p>Entenda como a Aura funciona no dia a dia do seu estúdio.</p>
      </div>
      <Accordion className="au-l-faq" type="single" defaultValue="faq-0" collapsible>
        {FAQ_ITEMS.map((item, index) => (
          <Accordion.Item key={item.question} value={`faq-${index}`}>
            <Accordion.Header>
              <Accordion.Trigger>{item.question}</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content><p>{item.answer}</p></Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion>
    </section>
  );
}

function NewsSection({ articles }) {
  if (!articles.length) return null;
  return (
    <section className="au-l-sec au-l-news" id="novidades">
      <div className="au-l-sec-head">
        <span className="au-l-kicker">Produto e gestão</span>
        <h2>Notícias e novidades</h2>
        <p>Acompanhe as evoluções da Aura e conteúdos para a rotina da sua clínica.</p>
      </div>
      <div className="content-public-grid">
        {articles.map((article) => (
          <article className="content-public-card" key={article.id}>
            <span>{article.published_at ? new Date(article.published_at).toLocaleDateString("pt-BR") : "Novidade"}</span>
            <h3>{article.title}</h3>
            <p>{article.summary}</p>
            <a href={`/novidades/${article.slug}`}>Ler novidade <ChevronRight size={16} aria-hidden="true" /></a>
          </article>
        ))}
      </div>
      <a className="content-public-all" href="/novidades">Ver todas as novidades</a>
    </section>
  );
}

function FeaturesSection({ content }) {
  const items = contentItems(content, "items", "title");
  if (!items.length) return null;
  return (
    <section className="au-l-sec" id="recursos">
      <div className="au-l-features">
        {items.map((item, index) => (
          <article key={item.key} className={`au-l-feature${index % 2 ? " is-reversed" : ""}`}>
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

export function AboutSection({ content }) {
  const paragraphs = String(content.body || "").split(/\n\s*\n/).filter(Boolean);

  return <section className="au-l-about" id="sobre">
    <div className="au-l-about-inner">
      <div className="au-l-sec-head">
        {content.kicker && <span className="au-l-kicker">{content.kicker}</span>}
        <h2>{content.title}</h2>
      </div>
      <div className="au-l-about-layout">
        {content.image && <figure className="au-l-about-media">
          <img src={content.image} alt={content.image_alt || "Eduarda, idealizadora da Aura Clinic"} />
          {content.image_caption && <figcaption>{content.image_caption}</figcaption>}
        </figure>}
        <div className="au-l-about-copy">
          {paragraphs.length > 0 ? paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>) : <>
            <p>{content.aura_text}</p>
            <p>{content.monitence_text}</p>
          </>}
          {content.signature && <p className="au-l-about-signature"><em>{content.signature}</em></p>}
        </div>
      </div>
    </div>
  </section>;
}

// Os planos continuam vindo de `GET /api/plans` — preço e recursos são dado
// vivo da plataforma, não texto de marketing. Do conteúdo editável vêm só o
// título, o subtítulo e o rótulo/destino do botão.
export function PlansSection({ content, plans }) {
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const visibleFeatures = (plan) => highlightedPlanFeatures(plan, 5);
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
              <a className="au-l-btn au-l-btn-plan" href={`/cadastro?plano=${encodeURIComponent(plan.code)}`}>Quero esse</a>
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
            <div className="au-l-plan-modal-actions"><button type="button" className="au-l-btn au-l-btn-ghost" onClick={() => setComparisonOpen(false)}>Fechar</button></div>
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
      <div className="au-l-close-inner au-l-close-dark">
        <div className="au-l-close-copy">
          <h2>{content.title}</h2>
          <a className="au-l-btn au-l-final-cta" href={content.primary_href}>
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
    </section>
  );
}

// Um componente por tipo de bloco. Chave fora desta tabela é ignorada em
// silêncio: o backend pode ganhar um bloco novo antes de o frontend saber
// desenhá-lo, e nesse intervalo a landing tem de continuar de pé.
const SECTION_COMPONENTS = {
  hero: HeroSection,
  features: FeaturesSection,
  plans: PlansSection,
  closing: ClosingSection
};

export function AboutPage() {
  /** @type {[Record<string, any>, React.Dispatch<React.SetStateAction<Record<string, any>>>]} */
  const [content, setContent] = useState(LANDING_DEFAULTS.about);
  useEffect(() => {
    let active = true;
    fetch(`${API}/landing`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        const about = asArray(payload.sections).find((section) => section.section_key === "about");
        if (active && about) setContent(mergeContent("about", about.content));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return <div className="au-shell">
    <PublicTopNav current="about" />
    <main className="au-l-root au-l-about-page"><AboutSection content={content} /></main>
    <PublicFooter />
  </div>;
}

export function PlansPage() {
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    let active = true;
    fetch(`${API}/plans`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => { if (active) setPlans(asArray(payload.plans)); })
      .catch(() => { if (active) setPlans([]); });
    return () => { active = false; };
  }, []);
  const orderedPlans = useMemo(
    () => [...plans].sort((a, b) => Number(a.price_cents || 0) - Number(b.price_cents || 0)),
    [plans]
  );
  return <div className="au-shell">
    <PublicTopNav current="plans" />
    <main className="au-l-root"><PlansSection content={LANDING_DEFAULTS.plans} plans={orderedPlans} /></main>
    <PublicFooter />
  </div>;
}

export function Landing() {
  // Começa JÁ com o conteúdo embutido, não com lista vazia. A landing é a porta
  // de entrada de quem vai assinar: API fora, lenta ou devolvendo lista vazia
  // não pode virar tela branca — isso é venda perdida na hora. Quando a resposta
  // chega, ela substitui o embutido; até lá a página está inteira.
  /** @type {[Record<string, any>[], React.Dispatch<React.SetStateAction<Record<string, any>[]>>]} */
  const [sections, setSections] = useState(DEFAULT_LANDING_SECTIONS);
  const [plans, setPlans] = useState([]);
  const [news, setNews] = useState([]);

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

  useEffect(() => {
    let active = true;
    fetch(`${API}/news?limit=3`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => { if (active) setNews(asArray(payload.articles)); })
      .catch(() => { if (active) setNews([]); });
    return () => { active = false; };
  }, []);

  const orderedPlans = useMemo(
    () => [...plans].sort((a, b) => Number(a.price_cents || 0) - Number(b.price_cents || 0)),
    [plans]
  );
  const closingContent = useMemo(() => {
    const closing = sections.find((section) => section.section_key === "closing");
    return mergeContent("closing", closing?.content);
  }, [sections]);
  const heroContent = useMemo(() => {
    const hero = sections.find((section) => section.section_key === "hero");
    return hero ? mergeContent("hero", hero.content) : null;
  }, [sections]);
  const featuresContent = useMemo(() => {
    const features = sections.find((section) => section.section_key === "features");
    return features ? mergeContent("features", features.content) : null;
  }, [sections]);
  const plansContent = useMemo(() => {
    const plansSection = sections.find((section) => section.section_key === "plans");
    // A vitrine de planos agora é parte fixa da landing. Instâncias criadas
    // antes deste bloco existir ainda a recebem com o conteúdo padrão.
    return mergeContent("plans", plansSection?.content);
  }, [sections]);

  return (
    <div className="au-shell">
      <PublicTopNav current="landing" />

      <main className="au-l-root">
        {heroContent && <HeroSection content={heroContent} />}
        {featuresContent && <FeaturesSection content={featuresContent} />}
        {plansContent && <PlansSection content={plansContent} plans={orderedPlans} />}
        <NewsSection articles={news} />

        {/* Os blocos institucionais restantes respeitam a ordem da API. Hero,
            recursos e planos têm uma sequência comercial fixa definida acima. */}
        {sections.filter((section) => !["hero", "features", "plans", "carousel"].includes(section.section_key)).map((section) => {
          const Section = SECTION_COMPONENTS[section.section_key];
          if (!Section) return null;
          const rendered = (
            <Section
              key={section.section_key}
              content={mergeContent(section.section_key, section.content)}
              plans={orderedPlans}
            />
          );
          return rendered;
        })}
        <FaqSection />
      </main>
      <PublicFooter content={closingContent} />
      <FloatingWhatsApp phone={closingContent.contact_whatsapp} />
    </div>
  );
}
