// Contrato puro compartilhado com o editor. Não importa módulos do servidor.
// O mesmo registro define os campos do painel e sua validação no servidor.
const text = (group, label, value = "", multiline = false) => ({ group, label, type: multiline ? "textarea" : "text", default: value });
const toggle = (group, label, value = true) => ({ group, label, type: "boolean", default: value });
const number = (group, label, value, min, max) => ({ group, label, type: "number", default: value, min, max });
const color = (group, label, value) => ({ group, label, type: "color", default: value });
const url = (group, label, value = "") => ({ group, label, type: "url", default: value });
const choice = (group, label, value, options) => ({ group, label, type: "select", default: value, options });

export const BOUTIQUE_GROUPS = { header: "Cabeçalho e navegação", hero: "Destaque principal", benefits: "Benefícios", categories: "Categorias com fotos", products: "Grade e cartões", details: "Detalhes do produto", footer: "Rodapé", design: "Cores, medidas e celular" };
/** @type {Record<string, any>} */
export const BOUTIQUE_FIELDS = {
  announcement_enabled: toggle("header", "Mostrar faixa superior"),
  announcement_text: text("header", "Texto da faixa", "Joias selecionadas. Detalhes que fazem a diferença."),
  announcement_link_label: text("header", "Texto do link da faixa", "Agende sua visita"),
  announcement_link_url: url("header", "Destino do link da faixa", "/agendar"),
  header_sticky: toggle("header", "Manter cabeçalho visível ao rolar"),
  header_show_logo: toggle("header", "Mostrar logo"),
  header_show_name: toggle("header", "Mostrar nome da marca"),
  header_show_slogan: toggle("header", "Mostrar assinatura da marca"),
  header_signature: text("header", "Assinatura quando não houver slogan", "PIERCING & JOIAS"),
  header_show_search: toggle("header", "Mostrar pesquisa"),
  search_placeholder: text("header", "Sugestão da pesquisa", "Buscar por joia, material, pedra ou SKU..."),
  header_show_contact: toggle("header", "Mostrar contato no cabeçalho"),
  header_contact_mobile: toggle("header", "Mostrar contato do cabeçalho no celular", false),
  announcement_link_mobile: toggle("header", "Mostrar link da faixa no celular", false),
  contact_label: text("header", "Texto do contato", "Atendimento"),
  navigation_enabled: toggle("header", "Mostrar menu de categorias"),
  navigation_show_categories: toggle("header", "Incluir categorias no menu"),
  navigation_show_campaigns: toggle("header", "Incluir campanhas no menu"),
  navigation_show_tree: toggle("header", "Mostrar árvore de subcategorias"),
  navigation_tree_label: text("header", "Texto da árvore de categorias", "Todas as categorias"),
  hide_presentation_when_filtered: toggle("hero", "Recolher apresentação durante pesquisa e filtros"),
  hero_kicker: text("hero", "Chamada acima do título", "CURADORIA DE JOIAS"),
  hero_note: text("hero", "Nota abaixo do botão", "Uma seleção para expressar quem você é."),
  hero_show_title: toggle("hero", "Mostrar título do banner"),
  hero_show_subtitle: toggle("hero", "Mostrar descrição do banner"),
  hero_show_button: toggle("hero", "Mostrar botão do banner"),
  hero_button_fallback: text("hero", "Texto do botão quando não preenchido no banner", "Explorar coleção"),
  hero_button_url: url("hero", "Destino do botão quando não preenchido no banner", "#catalog-products"),
  hero_autoplay: toggle("hero", "Trocar banners automaticamente"),
  hero_interval: number("hero", "Intervalo dos banners (ms)", 4500, 2000, 30000),
  hero_height_desktop: number("hero", "Altura mínima do destaque no computador (px)", 450, 240, 900),
  hero_height_mobile: number("hero", "Altura mínima do destaque no celular (px)", 460, 220, 800),
  hero_mobile_image_opacity: number("hero", "Intensidade da imagem no celular (%)", 42, 0, 100),
  hero_layout: choice("hero", "Composição do destaque", "split-right", [{ value: "split-right", label: "Imagem à direita" }, { value: "split-left", label: "Imagem à esquerda" }, { value: "background", label: "Imagem de fundo" }, { value: "image-only", label: "Somente imagem" }]),
  hero_mobile_layout: choice("hero", "Composição do destaque no celular", "overlay", [{ value: "overlay", label: "Texto sobre a imagem" }, { value: "stack", label: "Texto e imagem empilhados" }]),
  benefits_columns: number("benefits", "Colunas de benefícios no computador", 4, 1, 6),
  benefits_mobile_columns: number("benefits", "Colunas de benefícios no celular", 2, 1, 3),
  categories_kicker: text("categories", "Chamada das categorias", "ESCOLHA SEU ESTILO"),
  categories_title: text("categories", "Título das categorias", "Categorias em destaque"),
  categories_description: text("categories", "Descrição das categorias", "Explore a nossa seleção por tipo de joia."),
  categories_link_label: text("categories", "Texto do atalho para a grade", "Ver todas as joias"),
  categories_link_url: url("categories", "Destino do atalho das categorias", "#catalog-products"),
  categories_limit: number("categories", "Máximo de categorias em destaque", 6, 1, 30),
  categories_columns: number("categories", "Colunas de categorias no computador", 6, 1, 8),
  categories_mobile_columns: number("categories", "Colunas de categorias no celular", 3, 1, 4),
  categories_use_product_image: toggle("categories", "Usar foto de produto quando a categoria não tiver imagem"),
  products_kicker: text("products", "Chamada da grade", "NOSSA SELEÇÃO"),
  products_title: text("products", "Título da grade", "Encontre sua próxima joia"),
  products_search_title: text("products", "Título dos resultados de pesquisa", "Resultado da busca"),
  products_show_count: toggle("products", "Mostrar contagem de resultados"),
  products_show_filters: toggle("products", "Mostrar filtros"),
  products_show_sort: toggle("products", "Mostrar ordenação"),
  products_load_more_label: text("products", "Botão de carregar produtos ({remaining} usa a quantidade restante)", "Mostrar mais ({remaining} restantes)"),
  products_empty_text: text("products", "Mensagem sem resultados ({category} usa a categoria)", "Nenhuma joia encontrada em {category} com os filtros selecionados."),
  filters_clear_label: text("products", "Botão de limpar filtros", "Limpar filtros"),
  products_default_sort: choice("products", "Ordenação inicial", "recentes", [{ value: "recentes", label: "Mais recentes" }, { value: "relevancia", label: "Relevância" }, { value: "lancamentos", label: "Lançamentos" }, { value: "menor-preco", label: "Menor preço" }, { value: "maior-preco", label: "Maior preço" }, { value: "nome-az", label: "Nome de A a Z" }, { value: "nome-za", label: "Nome de Z a A" }, { value: "estoque", label: "Em estoque primeiro" }]),
  products_page_size: number("products", "Produtos por carregamento", 24, 1, 96),
  products_columns: number("products", "Colunas de produtos no computador", 3, 1, 6),
  products_tablet_columns: number("products", "Colunas de produtos no tablet", 2, 1, 4),
  products_mobile_columns: number("products", "Colunas de produtos no celular", 2, 1, 3),
  filters_width: number("products", "Largura dos filtros no computador (px)", 230, 160, 360),
  products_filters_mobile_open: toggle("products", "Abrir filtros por padrão no celular", false),
  filters_title: text("products", "Título dos filtros", "Refine sua escolha"),
  filters_toggle_label: text("products", "Botão dos filtros no celular", "Filtrar joias"),
  card_show_material: toggle("products", "Cartão: mostrar material ou categoria"),
  card_show_sku: toggle("products", "Cartão: mostrar SKU"),
  card_show_summary: toggle("products", "Cartão: mostrar resumo técnico"),
  card_show_price: toggle("products", "Cartão: mostrar preço"),
  card_show_variants: toggle("products", "Cartão: mostrar quantidade de variações"),
  card_show_stock: toggle("products", "Cartão: mostrar disponibilidade"),
  card_show_share: toggle("products", "Cartão: mostrar compartilhamento"),
  card_show_actions: toggle("products", "Cartão: mostrar botões de ação"),
  card_details_label: text("products", "Cartão: botão de detalhes", "Ver detalhes"),
  card_variant_label: text("products", "Cartão: botão de variações", "Escolher variação"),
  card_add_label: text("products", "Cartão: botão de compra", "Adicionar ao carrinho"),
  card_unavailable_label: text("products", "Cartão: botão de consulta", "Consultar"),
  detail_show_description: toggle("details", "Mostrar descrição do produto"),
  detail_show_sku: toggle("details", "Mostrar SKU do produto"),
  detail_show_price: toggle("details", "Mostrar preço nos detalhes"),
  detail_show_stock: toggle("details", "Mostrar disponibilidade nos detalhes"),
  detail_show_attributes: toggle("details", "Mostrar ficha técnica"),
  detail_show_notes: toggle("details", "Mostrar observações do produto"),
  detail_show_contact: toggle("details", "Mostrar contato nos detalhes"),
  detail_show_share: toggle("details", "Mostrar compartilhamento nos detalhes"),
  detail_show_related: toggle("details", "Mostrar produtos relacionados"),
  detail_related_limit: number("details", "Quantidade de produtos relacionados", 4, 1, 12),
  detail_schedule_label: text("details", "Botão de agendamento com produto", "Quero agendar com essa joia"),
  detail_consult_label: text("details", "Botão de consulta de disponibilidade", "Pedir pelo WhatsApp"),
  detail_contact_label: text("details", "Botão de contato ({brand} usa a marca)", "Falar com {brand}"),
  detail_share_label: text("details", "Botão de compartilhar produto", "Compartilhar"),
  detail_related_title: text("details", "Título dos produtos relacionados", "Mais opções parecidas"),
  detail_notes_title: text("details", "Título das observações", "Observações"),
  footer_bottom_text: text("footer", "Texto inferior esquerdo ({brand} usa o nome da marca)", "{brand} · Joias & piercing"),
  footer_bottom_note: text("footer", "Texto inferior direito", "Feito para o seu estilo."),
  footer_mobile_columns: number("footer", "Colunas do rodapé no celular", 2, 1, 3),
  footer_show_whatsapp: toggle("footer", "Contatos: mostrar WhatsApp"),
  footer_whatsapp_label: text("footer", "Contatos: texto do WhatsApp", "WhatsApp"),
  footer_show_email: toggle("footer", "Contatos: mostrar e-mail"),
  footer_show_schedule: toggle("footer", "Contatos: mostrar agendamento"),
  footer_schedule_label: text("footer", "Contatos: texto do agendamento", "Agendar atendimento"),
  footer_show_hours: toggle("footer", "Contatos: mostrar horários"),
  footer_show_maps: toggle("footer", "Localização: mostrar link do mapa"),
  footer_maps_label: text("footer", "Localização: texto do mapa", "Como chegar"),
  footer_instagram_label: text("footer", "Texto do Instagram", "Instagram"),
  floating_contact_label: text("header", "Texto do contato flutuante", "WhatsApp"),
  content_width: number("design", "Largura do conteúdo (px)", 1280, 800, 1800),
  section_gap: number("design", "Espaço entre componentes (px)", 0, 0, 100),
  section_padding: number("design", "Respiro interno dos componentes (px)", 28, 0, 100),
  body_size: number("design", "Tamanho base dos textos (px)", 14, 12, 20),
  heading_size: number("design", "Tamanho do título principal no computador (px)", 68, 32, 96),
  heading_mobile_size: number("design", "Tamanho do título principal no celular (px)", 44, 26, 64),
  card_radius: number("design", "Arredondamento dos cartões (px)", 10, 0, 32),
  button_radius: number("design", "Arredondamento dos botões (px)", 99, 0, 99),
  navigation_background: color("design", "Menu: fundo", "#1a1a1a"),
  navigation_text: color("design", "Menu: texto", "#f4f0e9"),
  navigation_active: color("design", "Menu: destaque", "#e4c995"),
  announcement_background: color("design", "Faixa superior: fundo", "#1a1a1a"),
  announcement_color: color("design", "Faixa superior: texto", "#ffffff"),
  hero_background: color("design", "Destaque: fundo", "#080808"),
  hero_color: color("design", "Destaque: título", "#ffffff"),
  hero_muted: color("design", "Destaque: descrição", "#d2cfca"),
  hero_accent: color("design", "Destaque: chamada", "#dcc18c"),
  benefits_background: color("design", "Benefícios: fundo", "#f8f5f0"),
  benefits_icon_background: color("design", "Benefícios: fundo do ícone", "#f2ecdf"),
  contact_color: color("design", "Ícone de contato", "#25815d"),
  favorite_active_color: color("design", "Favorito selecionado", "#a7444e"),
  category_overlay_color: color("design", "Categorias: sombra do texto", "#000000"),
  category_text_color: color("design", "Categorias: texto sobre a imagem", "#ffffff"),
  card_button_background: color("design", "Cartões: fundo dos botões", "#1a1a1a"),
  card_button_text: color("design", "Cartões: texto dos botões", "#ffffff")
};

export const BOUTIQUE_SECTION_TYPES = { hero: "Destaque principal", benefits: "Benefícios", categories: "Categorias com fotos", campaigns: "Campanhas", products: "Grade de produtos", plugins: "Integrações", footer: "Rodapé", custom: "Conteúdo personalizado" };
export const BOUTIQUE_ICONS = ["gem", "heart", "shield", "message", "star", "clock", "map", "instagram"];
export const BOUTIQUE_FILTERS = { material: "Material", color: "Cor", stone: "Pedra", size: "Tamanho", thickness: "Espessura", thread: "Fixação", topSize: "Tamanho do topo", availability: "Disponibilidade", price: "Faixa de preço" };
/** @returns {Record<string, any>} */
const base = () => ({
  ...Object.fromEntries(Object.entries(BOUTIQUE_FIELDS).map(([key, field]) => [key, field.default])),
  sections: Object.keys(BOUTIQUE_SECTION_TYPES).filter((type) => type !== "custom").map((type) => ({ id: type, type, enabled: true })),
  category_keys: [],
  filters: Object.keys(BOUTIQUE_FILTERS),
  navigation_links: [],
  benefits: [
    { id: "selection", icon: "gem", title: "Joias selecionadas", text: "Materiais e acabamentos para seu estilo", url: "", enabled: true },
    { id: "compositions", icon: "heart", title: "Composições únicas", text: "Encontre sua combinação de peças", url: "", enabled: true },
    { id: "guidance", icon: "shield", title: "Escolha com orientação", text: "Conte com a equipe do estúdio", url: "", enabled: true },
    { id: "contact", icon: "message", title: "Atendimento próximo", text: "Tire suas dúvidas pelo WhatsApp", url: "@whatsapp", enabled: true }
  ],
  footer_columns: [
    { id: "brand", type: "brand", title: "", text: "", links: [], enabled: true, show_logo: false, show_instagram: true },
    { id: "categories", type: "categories", title: "Explore", text: "", links: [], enabled: true },
    { id: "contact", type: "contact", title: "Atendimento", text: "", links: [], enabled: true },
    { id: "location", type: "location", title: "Visite o estúdio", text: "Fale com a equipe para planejar sua visita.", links: [], enabled: true, show_logo: true }
  ]
});
export const defaultBoutiqueConfig = () => base();
const bool = (value) => ![false, 0, "0", "false", "off"].includes(value);
const safeUrl = (value) => !value || value === "@whatsapp" || /^(?:https:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']*|#[a-zA-Z][\w-]*|mailto:[^\s<>"']+|tel:\+?[\d ()-]+)$/.test(value);

export function normalizeBoutiqueConfig(input) {
  const errors = [];
  let source = input;
  if (typeof source === "string") { try { source = JSON.parse(source); } catch { errors.push("Configuração da vitrine inválida."); source = {}; } }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    if (source !== undefined) errors.push("Configuração da vitrine deve ser um objeto.");
    source = {};
  }
  const config = base();
  for (const [key, field] of Object.entries(BOUTIQUE_FIELDS)) {
    if (source[key] === undefined) continue;
    const value = source[key];
    if (field.type === "boolean") config[key] = bool(value);
    else if (field.type === "number") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < field.min || n > field.max) errors.push(`${field.label}: use ${field.min} a ${field.max}.`);
      else config[key] = n;
    } else if (field.type === "select") {
      if (!field.options.some((option) => option.value === value)) errors.push(`${field.label}: escolha uma opção válida.`);
      else config[key] = value;
    } else {
      const s = String(value ?? "").trim().slice(0, field.type === "textarea" ? 3000 : 600);
      if (field.type === "color" && !/^#[0-9a-f]{6}$/i.test(s)) errors.push(`${field.label}: cor inválida.`);
      else if (field.type === "url" && !safeUrl(s)) errors.push(`${field.label}: use HTTPS, caminho interno, e-mail ou telefone.`);
      else config[key] = s;
    }
  }
  const list = (key, max, mapper) => {
    if (source[key] === undefined) return;
    const label = { category_keys: "Categorias em destaque", filters: "Filtros", navigation_links: "Links de navegação", benefits: "Benefícios", sections: "Componentes", footer_columns: "Colunas do rodapé" }[key];
    if (!Array.isArray(source[key]) || source[key].length > max) { errors.push(`${label}: lista inválida (máximo ${max}).`); return; }
    config[key] = source[key].map(mapper).filter(Boolean);
  };
  const clean = (value, limit = 600) => String(value ?? "").trim().slice(0, limit);
  const link = (row, index) => { const url = clean(row?.url, 1000); if (!safeUrl(url)) { errors.push("Um link da vitrine é inválido."); return null; } return { id: clean(row?.id || `link-${index}`), label: clean(row?.label, 100), url }; };
  list("category_keys", 60, (key) => clean(key, 100));
  list("filters", 9, (key) => Object.hasOwn(BOUTIQUE_FILTERS, key) ? key : null);
  list("navigation_links", 20, link);
  list("benefits", 12, (row, index) => ({ id: clean(row?.id || `benefit-${index}`), icon: BOUTIQUE_ICONS.includes(row?.icon) ? row.icon : "gem", title: clean(row?.title, 100), text: clean(row?.text, 300), url: link(row, index)?.url || "", enabled: bool(row?.enabled) }));
  const seen = new Set();
  list("sections", 24, (row, index) => {
    if (!Object.hasOwn(BOUTIQUE_SECTION_TYPES, row?.type)) { errors.push("Tipo de componente da vitrine inválido."); return null; }
    const id = clean(row.id || `${row.type}-${index}`, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id) || (row.type !== "custom" && seen.has(`type:${row.type}`))) { errors.push("Componentes duplicados ou sem identificador válido."); return null; }
    seen.add(id); seen.add(`type:${row.type}`);
    const image = clean(row.image_url, 1000);
    if (image && !/^(?:https:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']+)$/.test(image)) errors.push("Imagem de componente inválida: use HTTPS ou arquivo interno.");
    return { id, type: row.type, enabled: bool(row.enabled), title: clean(row.title), text: clean(row.text, 3000), image_url: image, link_label: clean(row.link_label, 100), link_url: link({ url: row.link_url }, index)?.url || "" };
  });
  list("footer_columns", 6, (row, index) => {
    if (!["brand", "categories", "contact", "location", "text", "links"].includes(row?.type)) { errors.push("Tipo de coluna do rodapé inválido."); return null; }
    return { id: clean(row.id || `column-${index}`), type: row.type, title: clean(row.title, 120), text: clean(row.text, 3000), links: Array.isArray(row.links) ? row.links.slice(0, 20).map(link).filter(Boolean) : [], enabled: bool(row.enabled), show_logo: bool(row.show_logo ?? false), show_instagram: bool(row.show_instagram ?? false) };
  });
  config.category_keys = [...new Set(config.category_keys)];
  config.filters = [...new Set(config.filters)];
  for (const key of ["benefits", "navigation_links", "footer_columns"]) {
    if (new Set(config[key].map((row) => row.id)).size !== config[key].length) errors.push("Há itens com identificadores repetidos na vitrine.");
  }
  return { config, errors };
}
