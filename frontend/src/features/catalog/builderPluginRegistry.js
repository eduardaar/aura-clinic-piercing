// Registro de integrações nativas do construtor de catálogo.
//
// Isto é deliberadamente uma lista fechada: cada item será renderizado por um
// componente React próprio quando o builder for conectado ao catálogo público.
// Configurações de cliente nunca carregam HTML, CSS ou JavaScript arbitrários.

export const CATALOG_BUILDER_PLUGIN_SCHEMA_VERSION = 1;

/**
 * @typedef {"text" | "textarea" | "phone" | "instagram_username" | "google_measurement_id" | "google_place_id" | "url" | "select" | "boolean" | "faq_items"} CatalogBuilderFieldType
 * @typedef {{ key: string, label: string, type: CatalogBuilderFieldType, required?: boolean, defaultValue?: unknown, maxLength?: number, options?: Array<{ value: string, label: string }>, urlPolicy?: string }} CatalogBuilderPluginField
 * @typedef {{ required: boolean, purpose: string | null, description: string }} CatalogBuilderConsent
 * @typedef {{ id: string, label: string, description: string, featureFlag: string, multiple: boolean, consent: CatalogBuilderConsent, allowedHosts: string[], fields: CatalogBuilderPluginField[], allowsArbitraryHtml: false, allowsArbitraryCss: false, allowsArbitraryJavaScript: false }} CatalogBuilderPlugin
 */

const BUTTON_STYLES = [
  { value: "primary", label: "Principal" },
  { value: "secondary", label: "Secundário" },
  { value: "outline", label: "Contorno" }
];

const MAP_DISPLAY_MODES = [
  { value: "link", label: "Abrir no Google Maps" },
  { value: "embed", label: "Mapa incorporado" }
];

const INDEXING_MODES = [
  { value: "index", label: "Permitir indexação" },
  { value: "noindex", label: "Não indexar" }
];

// Somente hosts conhecidos são aceitos em campos que resultam em navegação ou
// iframe. Nenhum plugin suporta script remoto, tag HTML ou código executável.
export const CATALOG_BUILDER_PLUGIN_REGISTRY = Object.freeze([
  {
    id: "whatsapp_cta",
    label: "Botão de WhatsApp",
    description: "Abre uma conversa com mensagem já preenchida.",
    featureFlag: "whatsapp_link",
    multiple: true,
    consent: { required: false, purpose: null, description: "Não incorpora conteúdo de terceiros." },
    allowedHosts: ["wa.me", "api.whatsapp.com"],
    allowsArbitraryHtml: false,
    allowsArbitraryCss: false,
    allowsArbitraryJavaScript: false,
    fields: [
      { key: "phone", label: "WhatsApp com DDI", type: "phone", required: true },
      { key: "label", label: "Texto do botão", type: "text", defaultValue: "Falar no WhatsApp", maxLength: 60 },
      { key: "message", label: "Mensagem inicial", type: "textarea", defaultValue: "Olá! Vim pelo catálogo online.", maxLength: 1000 },
      { key: "style", label: "Estilo", type: "select", defaultValue: "primary", options: BUTTON_STYLES }
    ]
  },
  {
    id: "instagram_profile",
    label: "Perfil do Instagram",
    description: "Exibe um link seguro para o perfil do estúdio, sem script de feed incorporado.",
    featureFlag: "public_catalog_customization",
    multiple: true,
    consent: { required: false, purpose: null, description: "O visitante só navega ao Instagram após clicar." },
    allowedHosts: ["instagram.com", "www.instagram.com"],
    allowsArbitraryHtml: false,
    allowsArbitraryCss: false,
    allowsArbitraryJavaScript: false,
    fields: [
      { key: "username", label: "Usuário do Instagram", type: "instagram_username", required: true },
      { key: "label", label: "Texto do link", type: "text", defaultValue: "Siga no Instagram", maxLength: 60 },
      { key: "openInNewTab", label: "Abrir em nova aba", type: "boolean", defaultValue: true }
    ]
  },
  {
    id: "maps_location",
    label: "Localização no Maps",
    description: "Mostra endereço e, quando autorizado, um mapa do Google Maps.",
    featureFlag: "online_booking",
    multiple: false,
    consent: {
      required: true,
      purpose: "third_party_maps",
      description: "A incorporação do mapa pode enviar dados de navegação ao Google. O renderer deve aguardar consentimento antes de criar o iframe."
    },
    allowedHosts: ["google.com", "www.google.com", "maps.google.com"],
    allowsArbitraryHtml: false,
    allowsArbitraryCss: false,
    allowsArbitraryJavaScript: false,
    fields: [
      { key: "title", label: "Título", type: "text", defaultValue: "Como chegar", maxLength: 80 },
      { key: "address", label: "Endereço", type: "textarea", required: true, maxLength: 300 },
      { key: "display", label: "Exibição", type: "select", defaultValue: "link", options: MAP_DISPLAY_MODES },
      { key: "mapUrl", label: "Link do Google Maps", type: "url", urlPolicy: "google_maps", maxLength: 2000 },
      { key: "embedUrl", label: "URL de incorporação", type: "url", urlPolicy: "google_maps_embed", maxLength: 2000 }
    ]
  },
  {
    id: "faq",
    label: "Perguntas frequentes",
    description: "Perguntas e respostas renderizadas pelo catálogo, sem HTML rico.",
    featureFlag: "public_catalog_customization",
    multiple: true,
    consent: { required: false, purpose: null, description: "Não usa serviços externos." },
    allowedHosts: [],
    allowsArbitraryHtml: false,
    allowsArbitraryCss: false,
    allowsArbitraryJavaScript: false,
    fields: [
      { key: "title", label: "Título", type: "text", defaultValue: "Dúvidas frequentes", maxLength: 100 },
      { key: "items", label: "Perguntas", type: "faq_items", required: true }
    ]
  },
  {
    id: "seo_metadata",
    label: "SEO da página",
    description: "Define metadados seguros do catálogo; não aceita tags ou scripts personalizados.",
    featureFlag: "public_catalog_customization",
    multiple: false,
    consent: { required: false, purpose: null, description: "Não usa serviços externos." },
    allowedHosts: [],
    allowsArbitraryHtml: false,
    allowsArbitraryCss: false,
    allowsArbitraryJavaScript: false,
    fields: [
      { key: "title", label: "Título para buscadores", type: "text", required: true, maxLength: 60 },
      { key: "description", label: "Descrição para buscadores", type: "textarea", required: true, maxLength: 160 },
      { key: "indexing", label: "Indexação", type: "select", defaultValue: "index", options: INDEXING_MODES }
    ]
  },
  {
    id: "google_analytics",
    label: "Google Analytics",
    description: "Mede visitas apenas depois do consentimento de analytics do visitante.",
    featureFlag: "catalog_analytics",
    multiple: false,
    consent: {
      required: true,
      purpose: "analytics",
      description: "O Google Analytics só será carregado quando o visitante autorizar a medição de visitas."
    },
    allowedHosts: ["www.googletagmanager.com"],
    allowsArbitraryHtml: false,
    allowsArbitraryCss: false,
    allowsArbitraryJavaScript: false,
    fields: [
      { key: "measurementId", label: "ID de medição do Google Analytics", type: "google_measurement_id", required: true, maxLength: 24 }
    ]
  },
  {
    id: "google_review_link",
    label: "Avaliações no Google",
    description: "Cria um link conhecido para o cliente avaliar o estúdio no Google.",
    featureFlag: "public_catalog_customization",
    multiple: false,
    consent: { required: false, purpose: null, description: "O visitante só abre o Google ao clicar no link." },
    allowedHosts: ["search.google.com"],
    allowsArbitraryHtml: false,
    allowsArbitraryCss: false,
    allowsArbitraryJavaScript: false,
    fields: [
      { key: "title", label: "Título", type: "text", defaultValue: "Avalie sua experiência", maxLength: 80 },
      { key: "placeId", label: "Place ID do Google", type: "google_place_id", required: true, maxLength: 256 },
      { key: "label", label: "Texto do botão", type: "text", defaultValue: "Avaliar no Google", maxLength: 60 },
      { key: "style", label: "Estilo", type: "select", defaultValue: "outline", options: BUTTON_STYLES }
    ]
  }
]);

const PLUGINS_BY_ID = new Map(CATALOG_BUILDER_PLUGIN_REGISTRY.map((plugin) => [plugin.id, plugin]));
const SAFE_OBJECT = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function compactText(value, maxLength = Infinity) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function compactMultilineText(value, maxLength = Infinity) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
}

function selectedValue(field, value) {
  const options = field.options || [];
  return options.some((option) => option.value === value) ? value : field.defaultValue;
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  // Aceita telefone internacional em E.164, sem + no valor persistido.
  return /^\d{10,15}$/.test(digits) ? digits : "";
}

function normalizeInstagramUsername(value) {
  const raw = compactText(value, 256).replace(/^@/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    const normalized = normalizeAllowedUrl(raw, "instagram_profile");
    if (!normalized.value) return "";
    const username = new URL(normalized.value).pathname.split("/").filter(Boolean)[0] || "";
    return /^[a-zA-Z0-9._]{1,30}$/.test(username) ? username : "";
  }
  return /^[a-zA-Z0-9._]{1,30}$/.test(raw) ? raw : "";
}

function normalizeGoogleMeasurementId(value) {
  const measurementId = compactText(value, 24).toUpperCase();
  return /^G-[A-Z0-9]{6,20}$/.test(measurementId) ? measurementId : "";
}

function normalizeGooglePlaceId(value) {
  const placeId = compactText(value, 256);
  // Place IDs públicos do Google começam com ChI e não precisam aceitar URL,
  // HTML nem parâmetros adicionais. O link de avaliação é sempre construído.
  return /^ChI[A-Za-z0-9_-]{6,253}$/.test(placeId) ? placeId : "";
}

function hostAllowed(hostname, allowedHosts) {
  return allowedHosts.includes(hostname);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) return Boolean(fallback);
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return true;
}

/**
 * Normaliza URLs em uma allowlist pequena. Nunca aceita URL com credenciais,
 * `javascript:`, `data:` ou host não conhecido para aquele plugin.
 */
export function normalizeAllowedUrl(value, policy) {
  const raw = compactText(value, 2000);
  if (!raw) return { value: "", error: "" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { value: "", error: "URL inválida." };
  }
  if (url.protocol !== "https:") return { value: "", error: "Use uma URL HTTPS." };
  if (url.username || url.password) return { value: "", error: "URLs com credenciais não são permitidas." };

  const hostname = url.hostname.toLowerCase();
  const rules = {
    instagram_profile: { hosts: ["instagram.com", "www.instagram.com"], path: /^\/[a-zA-Z0-9._]+\/?$/ },
    google_maps: { hosts: ["google.com", "www.google.com", "maps.google.com"], path: /^\/maps(?:\/|$)/ },
    google_maps_embed: { hosts: ["google.com", "www.google.com", "maps.google.com"], path: /^\/maps\/embed(?:\/|$)/ }
  };
  const rule = rules[policy];
  if (!rule) return { value: "", error: "Política de URL desconhecida." };
  if (!hostAllowed(hostname, rule.hosts) || !rule.path.test(url.pathname)) return { value: "", error: "Host ou caminho não permitido para esta integração." };

  url.hash = "";
  return { value: url.toString(), error: "" };
}

function normalizeFaqItems(value, errors, { preserveEmptyItems = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push({ field: "items", message: "Informe ao menos uma pergunta e resposta." });
    return [];
  }
  const items = [];
  value.slice(0, 12).forEach((item, index) => {
    const safeItem = SAFE_OBJECT(item);
    const question = compactText(safeItem.question, 180);
    const answer = compactMultilineText(safeItem.answer, 2000);
    if (!question && !answer) {
      // O editor precisa de uma linha vazia transitória para o usuário começar
      // uma pergunta. O serializador de publicação usa o padrão (false) e a
      // remove do snapshot final.
      if (!preserveEmptyItems) return;
      errors.push({ field: `items.${index}.question`, message: "A pergunta precisa ter ao menos 3 caracteres." });
      errors.push({ field: `items.${index}.answer`, message: "A resposta precisa ter ao menos 3 caracteres." });
      items.push({ question, answer });
      return;
    }
    if (question.length < 3) errors.push({ field: `items.${index}.question`, message: "A pergunta precisa ter ao menos 3 caracteres." });
    if (answer.length < 3) errors.push({ field: `items.${index}.answer`, message: "A resposta precisa ter ao menos 3 caracteres." });
    items.push({ question, answer });
  });
  if (!items.length) errors.push({ field: "items", message: "Informe ao menos uma pergunta e resposta." });
  return items;
}

/** @returns {CatalogBuilderPlugin | null} */
export function getCatalogBuilderPlugin(pluginId) {
  return PLUGINS_BY_ID.get(String(pluginId || "")) || null;
}

export function listCatalogBuilderPlugins() {
  return CATALOG_BUILDER_PLUGIN_REGISTRY.slice();
}

export function hasRequiredPluginFeature(plugin, enabledFeatures = []) {
  const enabled = new Set(Array.isArray(enabledFeatures) ? enabledFeatures : []);
  return Boolean(plugin) && enabled.has(plugin.featureFlag);
}

/**
 * Produz apenas os campos conhecidos de uma configuração. A chamada não muta o
 * objeto recebido e ignora chaves como `html`, `css`, `script` e `onClick`.
 */
export function normalizeCatalogBuilderPluginConfig(pluginId, input = {}, options = {}) {
  const plugin = getCatalogBuilderPlugin(pluginId);
  if (!plugin) return { plugin: null, config: {}, errors: [{ field: "pluginId", message: "Plugin não permitido." }] };

  const source = SAFE_OBJECT(input);
  const config = {};
  const errors = [];

  for (const field of plugin.fields) {
    const value = source[field.key];
    if (field.type === "text") config[field.key] = compactText(value || field.defaultValue || "", field.maxLength);
    if (field.type === "textarea") config[field.key] = compactMultilineText(value || field.defaultValue || "", field.maxLength);
    if (field.type === "phone") config[field.key] = normalizePhone(value);
    if (field.type === "instagram_username") config[field.key] = normalizeInstagramUsername(value);
    if (field.type === "google_measurement_id") {
      config[field.key] = normalizeGoogleMeasurementId(value);
      if (value && !config[field.key]) errors.push({ field: field.key, message: "Informe um ID de medição válido no formato G-XXXXXXXX." });
    }
    if (field.type === "google_place_id") {
      config[field.key] = normalizeGooglePlaceId(value);
      if (value && !config[field.key]) errors.push({ field: field.key, message: "Informe um Place ID do Google válido (começa com ChI)." });
    }
    if (field.type === "boolean") config[field.key] = normalizeBoolean(value, field.defaultValue);
    if (field.type === "select") config[field.key] = selectedValue(field, value === undefined ? field.defaultValue : value);
    if (field.type === "url") {
      const normalized = normalizeAllowedUrl(value, field.urlPolicy);
      config[field.key] = normalized.value;
      if (normalized.error) errors.push({ field: field.key, message: normalized.error });
    }
    if (field.type === "faq_items") config[field.key] = normalizeFaqItems(value, errors, options);

    if (field.required && !config[field.key]) errors.push({ field: field.key, message: `${field.label} é obrigatório.` });
  }

  if (plugin.id === "maps_location") {
    // A partir do endereço construímos um link conhecido em vez de aceitar uma
    // URL livre. É útil para o usuário e reduz a superfície de navegação externa.
    if (!config.mapUrl && config.address) config.mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(config.address)}`;
    if (config.display === "embed" && !config.embedUrl) errors.push({ field: "embedUrl", message: "Informe a URL de incorporação do Google Maps." });
  }

  return { plugin, config, errors };
}

/**
 * Forma de snapshot preparada para a próxima fase. O estado de consentimento
 * não é persistido no bloco: o renderer deve consultá-lo em tempo real.
 */
export function normalizeCatalogBuilderPluginInstance(input = {}, options = {}) {
  const source = SAFE_OBJECT(input);
  const result = normalizeCatalogBuilderPluginConfig(source.pluginId, source.config);
  if (!result.plugin) return { ...result, instance: null, available: false, consentRequired: false };

  const enabledFeatures = Array.isArray(options.enabledFeatures) ? options.enabledFeatures : [];
  const consentByPurpose = SAFE_OBJECT(options.consentByPurpose);
  const consent = result.plugin.consent;
  const consentGranted = !consent.required || consentByPurpose[consent.purpose] === true;
  return {
    ...result,
    instance: {
      id: compactText(source.id, 100),
      pluginId: result.plugin.id,
      enabled: source.enabled !== false,
      config: result.config
    },
    available: hasRequiredPluginFeature(result.plugin, enabledFeatures),
    consentRequired: consent.required,
    consentGranted,
    readyToRender: result.errors.length === 0 && source.enabled !== false && hasRequiredPluginFeature(result.plugin, enabledFeatures) && consentGranted
  };
}
