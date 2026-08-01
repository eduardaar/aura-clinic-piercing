// Conteúdo embutido da landing pública ("/").
//
// É a MESMA semente de `backend/src/db/platformSchema.sql`
// (`platform.landing_sections`), copiada campo por campo. Existir duas vezes é
// proposital: a landing é a porta de entrada de quem vai assinar, e ela precisa
// subir inteira mesmo sem banco, sem API e sem rede. Uma tela branca aqui é
// venda perdida — nenhum bloco pode depender de uma requisição para existir.
//
// Mudou a semente do SQL? Mude aqui junto. O que o super-admin salva pelo
// painel vive só no banco; este arquivo é o piso, nunca o valor exibido quando
// a API responde.

/**
 * Conteúdo padrão por `section_key` — usado tanto para a página inteira (API
 * fora) quanto campo a campo (bloco salvo pela metade no painel).
 */
export const LANDING_DEFAULTS = {
  hero: {
    kicker: "Para estúdios de piercing",
    title: "Gestão premium para quem vive da perfuração.",
    subtitle: "Agenda, catálogo de joias, ficha digital e financeiro — num sistema só.",
    primary_label: "Criar minha clínica",
    primary_href: "/cadastro",
    secondary_label: "Já tenho conta",
    secondary_href: "/login",
    note: "7 dias grátis · sem cartão de crédito",
    image: "/assets/landing/hero-studio.jpg",
    image_alt: "Close de orelha com piercings de joias douradas no lóbulo",
    caption: "Agenda, catálogo e ficha digital num link só seu"
  },

  features: {
    title: "Tudo que o estúdio precisa",
    subtitle: "",
    items: [
      {
        title: "Agendamento online",
        text: "Seus clientes marcam horário sozinhos por um link só seu.",
        image: "/assets/landing/feature-agenda.jpg",
        image_alt: "Recepcionista de estúdio atendendo com um tablet em uma recepção clara"
      },
      {
        title: "Catálogo de joias",
        text: "Uma vitrine online da sua marca, pronta pra compartilhar.",
        image: "/assets/landing/feature-jewelry.jpg",
        image_alt: "Argolas douradas de piercing sobre uma base de pedra clara"
      },
      {
        title: "Ficha digital",
        text: "Anamnese e termo de consentimento assinados sem papel.",
        image: "/assets/landing/feature-care.jpg",
        image_alt: "Orelha com vários piercings cicatrizados no hélix e no lóbulo"
      },
      {
        title: "Financeiro e estoque",
        text: "Caixa, vendas e alertas de estoque baixo no mesmo lugar.",
        image: "/assets/landing/showcase-1.jpg",
        image_alt: "Brinco dourado texturizado em close-up"
      }
    ]
  },

  carousel: {
    title: "Feito para o seu trabalho",
    subtitle: "",
    autoplay_seconds: 6,
    items: [
      { image: "/assets/landing/showcase-1.jpg", image_alt: "Brinco dourado texturizado em close-up", caption: "" },
      { image: "/assets/landing/showcase-2.jpg", image_alt: "", caption: "" },
      { image: "/assets/landing/showcase-3.jpg", image_alt: "", caption: "" }
    ]
  },

  plans: {
    title: "Planos para cada fase",
    subtitle: "Todos começam com 7 dias grátis. Troque quando quiser.",
    cta_label: "Começar grátis",
    cta_href: "/cadastro"
  },

  showcase_links: {
    title: "Veja quem já usa",
    subtitle: "Explore as vitrines públicas das clínicas na plataforma.",
    items: [
      {
        title: "Catálogo online",
        text: "Veja as clínicas usando e abra a vitrine de joias de cada uma.",
        href: "/catalogo"
      },
      {
        title: "Agendamento online",
        text: "Encontre um estúdio e marque horário direto na agenda dele.",
        href: "/agendar"
      }
    ]
  },

  closing: {
    title: "Pronto para profissionalizar seu estúdio?",
    primary_label: "Criar minha clínica",
    primary_href: "/cadastro",
    note: "7 dias grátis · sem cartão de crédito",
    images: [
      { image: "/assets/landing/showcase-2.jpg", image_alt: "" },
      { image: "/assets/landing/showcase-3.jpg", image_alt: "" }
    ],
    footer_text: "Plataforma de gestão para estúdios de piercing.",
    footer_link_label: "Entrar na minha conta",
    footer_link_href: "/login"
  }
};

// A página inteira no formato que `GET /api/landing` devolve: já ordenada e só
// com os blocos LIGADOS. O `carousel` fica de fora de propósito — ele nasce
// desligado na semente, e incluí-lo aqui faria a landing mudar sozinha sempre
// que a API estivesse fora.
export const DEFAULT_LANDING_SECTIONS = [
  { section_key: "hero", enabled: true, sort_order: 10, content: LANDING_DEFAULTS.hero },
  { section_key: "features", enabled: true, sort_order: 20, content: LANDING_DEFAULTS.features },
  { section_key: "plans", enabled: true, sort_order: 40, content: LANDING_DEFAULTS.plans },
  { section_key: "showcase_links", enabled: true, sort_order: 50, content: LANDING_DEFAULTS.showcase_links },
  { section_key: "closing", enabled: true, sort_order: 60, content: LANDING_DEFAULTS.closing }
];
