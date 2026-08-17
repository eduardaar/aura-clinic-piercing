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
    caption: "Agenda, catálogo e ficha digital num link só seu",
    screens: [
      { image: "/assets/landing/system/agenda-demo.png", image_alt: "Tela demonstrativa da agenda do sistema" },
      { image: "/assets/landing/system/catalogo-demo.png", image_alt: "Tela demonstrativa de produtos e estoque" },
      { image: "/assets/landing/system/financeiro-demo.png", image_alt: "Tela demonstrativa do painel financeiro" }
    ]
  },

  features: {
    title: "Tudo que o estúdio precisa",
    subtitle: "",
    items: [
      {
        title: "Agendamento online",
        text: "Seus clientes marcam horário sozinhos por um link só seu.",
        image: "/assets/landing/aura-portfolio/portfolio-01.jpeg",
        image_alt: "Orelha com composição de piercings em joias prateadas"
      },
      {
        title: "Catálogo de joias",
        text: "Uma vitrine online da sua marca, pronta pra compartilhar.",
        image: "/assets/landing/aura-portfolio/portfolio-02.jpeg",
        image_alt: "Composição de piercing em orelha com joias"
      },
      {
        title: "Ficha digital",
        text: "Anamnese e termo de consentimento assinados sem papel.",
        image: "/assets/landing/aura-portfolio/portfolio-03.jpeg",
        image_alt: "Detalhe de piercing em orelha"
      },
      {
        title: "Financeiro e estoque",
        text: "Caixa, vendas e alertas de estoque baixo no mesmo lugar.",
        image: "/assets/landing/aura-portfolio/portfolio-04.jpeg",
        image_alt: "Joias de piercing em composição autoral"
      }
    ]
  },

  carousel: {
    title: "Piercing é identidade",
    subtitle: "Resultados reais de quem transforma detalhes em expressão.",
    autoplay_seconds: 6,
    items: [
      { image: "/assets/landing/aura-portfolio/portfolio-01.jpeg", image_alt: "Orelha com composição de piercings em joias prateadas", caption: "" },
      { image: "/assets/landing/aura-portfolio/portfolio-02.jpeg", image_alt: "Composição de piercing em orelha com joias", caption: "" },
      { image: "/assets/landing/aura-portfolio/portfolio-03.jpeg", image_alt: "Detalhe de piercing em orelha", caption: "" },
      { image: "/assets/landing/aura-portfolio/portfolio-04.jpeg", image_alt: "Joias de piercing em composição autoral", caption: "" },
      { image: "/assets/landing/aura-portfolio/portfolio-05.jpeg", image_alt: "Detalhe de piercing com joias", caption: "" },
      { image: "/assets/landing/aura-portfolio/portfolio-06.jpeg", image_alt: "Composição final de piercings", caption: "" }
    ]
  },

  plans: {
    title: "Planos para cada fase",
    subtitle: "Todos começam com 7 dias grátis. Troque quando quiser.",
    cta_label: "Começar grátis",
    cta_href: "/cadastro"
  },

  about: {
    kicker: "Sobre nós",
    title: "Sobre a Aura Clinic",
    body: "A Aura Clinic nasceu com o propósito de transformar o body piercing em uma experiência que une estética, segurança e cuidado.\n\nCada atendimento é realizado de forma individualizada, respeitando a anatomia, o estilo e as necessidades de cada cliente. Trabalhamos com protocolos rigorosos de biossegurança e esterilização, priorizando materiais de alta qualidade, como titânio grau implante ASTM F136 e ouro sólido 14k e 18k.\n\nMais do que realizar uma perfuração, buscamos acompanhar cada etapa da experiência — desde a escolha da joia e planejamento da composição até as orientações de cuidados e acompanhamento da cicatrização.\n\nNa Aura Clinic, acreditamos que cada joia pode representar uma escolha, um momento ou uma parte da sua identidade.",
    signature: "Aura Clinic — técnica, cuidado e joalheria para valorizar a sua essência.",
    image: "/assets/landing/aura-portfolio/sobre-nos-eduarda.jpeg",
    image_alt: "Eduarda, idealizadora e proprietária da Aura Clinic",
    image_caption: "Eduarda Santos · idealizadora do projeto"
  },

  closing: {
    title: "Pronto para profissionalizar seu estúdio?",
    primary_label: "Criar minha clínica",
    primary_href: "/cadastro",
    note: "7 dias grátis · sem cartão de crédito",
    images: [
      { image: "/assets/landing/aura-portfolio/eduarda.jpeg", image_alt: "Eduarda, body piercer e criadora da Aura Clinic" }
    ],
    footer_text: "Plataforma de gestão para estúdios de piercing.",
    footer_link_label: "Entrar na minha conta",
    footer_link_href: "/login",
    contact_whatsapp: "+55 77 9863-2417",
    contact_email: "",
    contact_instagram: "https://www.instagram.com/eduarda.bodypiercer/"
  }
};

// A página inteira no formato que `GET /api/landing` devolve: já ordenada e só
// com os blocos LIGADOS. O carrossel é opcional e nasce desligado: a galeria
// principal fica nos próprios cards de recursos.
export const DEFAULT_LANDING_SECTIONS = [
  { section_key: "hero", enabled: true, sort_order: 10, content: LANDING_DEFAULTS.hero },
  { section_key: "features", enabled: true, sort_order: 20, content: LANDING_DEFAULTS.features },
  { section_key: "about", enabled: true, sort_order: 30, content: LANDING_DEFAULTS.about },
  { section_key: "plans", enabled: true, sort_order: 40, content: LANDING_DEFAULTS.plans },
  { section_key: "closing", enabled: true, sort_order: 60, content: LANDING_DEFAULTS.closing }
];
