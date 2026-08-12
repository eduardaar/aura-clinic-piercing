// Validação autoritativa dos plugins nativos do Catalog Builder.
//
// Este módulo não importa React, rotas ou banco: qualquer ponto que receba um
// snapshot (API, migração, IA ou job) pode aplicar exatamente as mesmas regras
// antes de persistir. A lista é fechada de propósito — plugin de tenant é
// configuração declarativa para componentes nativos, nunca HTML/CSS/JS.

const MAX_PLUGINS = 20;
const MAX_FAQ_ITEMS = 12;

const PLUGIN_IDS = new Set([
  "whatsapp_cta",
  "instagram_profile",
  "maps_location",
  "faq",
  "seo_metadata",
  "google_analytics",
  "google_review_link"
]);

const SINGLE_INSTANCE_PLUGINS = new Set([
  "maps_location",
  "seo_metadata",
  "google_analytics",
  "google_review_link"
]);
const PLUGIN_FEATURES = Object.freeze({
  whatsapp_cta: "whatsapp_link",
  instagram_profile: "public_catalog_customization",
  maps_location: "online_booking",
  faq: "public_catalog_customization",
  seo_metadata: "public_catalog_customization",
  google_analytics: "catalog_analytics",
  google_review_link: "public_catalog_customization"
});
const PLUGIN_FIELDS = {
  whatsapp_cta: new Set(["phone", "label", "message", "style"]),
  instagram_profile: new Set(["username", "label", "openInNewTab"]),
  maps_location: new Set(["title", "address", "display", "mapUrl", "embedUrl"]),
  faq: new Set(["title", "items"]),
  seo_metadata: new Set(["title", "description", "indexing"]),
  google_analytics: new Set(["measurementId"]),
  google_review_link: new Set(["title", "placeId", "label", "style"])
};

const INSTANCE_FIELDS = new Set(["id", "pluginId", "enabled", "config"]);
const GOOGLE_MAPS_HOSTS = new Set(["google.com", "www.google.com", "maps.google.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const FORBIDDEN_KEY = /^(?:html|css|js|javascript|script|stylesheet|style|__proto__|prototype|constructor)$/i;
const EVENT_HANDLER_KEY = /^on[a-z]/i;
const FORBIDDEN_CONTENT = /<\/?[a-z][^>]*>|\b(?:javascript|vbscript|data)\s*:|\bon[a-z][\w-]*\s*=|<\s*script\b|<\s*style\b|@import\b|\b(?:expression|url)\s*\(/i;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function issue(errors, path, code, message) {
  errors.push({ path, code, message });
}

function hasForbiddenKey(key) {
  return FORBIDDEN_KEY.test(key) || EVENT_HANDLER_KEY.test(key);
}

function rejectUnknownKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    const fieldPath = path ? `${path}.${key}` : key;
    issue(
      errors,
      fieldPath,
      hasForbiddenKey(key) ? "unsafe_plugin_key" : "unknown_plugin_key",
      hasForbiddenKey(key)
        ? "HTML, CSS, JavaScript e manipuladores de evento não são permitidos em plugins."
        : "Campo de plugin não reconhecido."
    );
  }
}

function textValue(value, { path, label, maxLength, multiline = false, required = false, fallback = "" }, errors) {
  if (value === undefined || value === null || value === "") {
    const result = String(fallback || "");
    if (required && !result) issue(errors, path, "required_plugin_field", `${label} é obrigatório.`);
    return result;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    issue(errors, path, "invalid_plugin_field", `${label} deve ser texto simples.`);
    return "";
  }
  const raw = String(value);
  if (raw.length > maxLength) issue(errors, path, "plugin_text_too_long", `${label} aceita no máximo ${maxLength} caracteres.`);
  if (FORBIDDEN_CONTENT.test(raw)) issue(errors, path, "unsafe_plugin_content", `${label} não pode conter HTML, CSS, JavaScript ou manipuladores de evento.`);
  const normalized = multiline
    ? raw.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join("\n")
    : raw.replace(/\s+/g, " ").trim();
  const result = normalized.slice(0, maxLength);
  if (required && !result) issue(errors, path, "required_plugin_field", `${label} é obrigatório.`);
  return result;
}

function booleanValue(value, { path, fallback = true }, errors) {
  if (value === undefined || value === null) return fallback;
  if ([true, 1, "1", "true"].includes(value)) return true;
  if ([false, 0, "0", "false"].includes(value)) return false;
  issue(errors, path, "invalid_plugin_field", "O valor deve ser verdadeiro ou falso.");
  return fallback;
}

function enumValue(value, allowed, { path, label, fallback }, errors) {
  const selected = value === undefined || value === null || value === "" ? fallback : String(value);
  if (allowed.has(selected)) return selected;
  issue(errors, path, "invalid_plugin_field", `${label} inválido.`);
  return fallback;
}

function normalizePhone(value, path, errors) {
  const raw = value === undefined || value === null ? "" : String(value);
  if (FORBIDDEN_CONTENT.test(raw)) issue(errors, path, "unsafe_plugin_content", "WhatsApp não pode conter código ou URL executável.");
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(digits)) issue(errors, path, "invalid_plugin_field", "Informe o WhatsApp com DDI, entre 10 e 15 dígitos.");
  return /^\d{10,15}$/.test(digits) ? digits : "";
}

function normalizeHttpsUrl(value, { path, label, hosts, pathname }, errors) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    issue(errors, path, "invalid_plugin_field", `${label} deve ser uma URL HTTPS.`);
    return "";
  }
  const raw = value.trim();
  if (raw.length > 2000) issue(errors, path, "plugin_text_too_long", `${label} aceita no máximo 2000 caracteres.`);
  if (FORBIDDEN_CONTENT.test(raw)) issue(errors, path, "unsafe_plugin_content", `${label} não pode conter HTML, CSS ou JavaScript.`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    issue(errors, path, "invalid_plugin_url", `${label} é inválida.`);
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    issue(errors, path, "invalid_plugin_url", `${label} deve usar HTTPS e não pode ter credenciais.`);
    return "";
  }
  if (!hosts.has(url.hostname.toLowerCase()) || !pathname.test(url.pathname)) {
    issue(errors, path, "unallowed_plugin_url", `${label} não pertence a um endereço permitido para esta integração.`);
    return "";
  }
  url.hash = "";
  return url.toString();
}

function normalizeInstagramUsername(value, path, errors) {
  const raw = textValue(value, { path, label: "Usuário do Instagram", maxLength: 256, required: true }, errors).replace(/^@/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    const url = normalizeHttpsUrl(raw, {
      path,
      label: "Perfil do Instagram",
      hosts: INSTAGRAM_HOSTS,
      pathname: /^\/[A-Za-z0-9._]+\/?$/
    }, errors);
    if (!url) return "";
    return new URL(url).pathname.split("/").filter(Boolean)[0] || "";
  }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(raw)) {
    issue(errors, path, "invalid_plugin_field", "Informe um usuário válido do Instagram.");
    return "";
  }
  return raw;
}

function normalizeMeasurementId(value, path, errors) {
  const normalized = textValue(value, {
    path,
    label: "ID de medição do Google Analytics",
    maxLength: 32,
    required: true
  }, errors).toUpperCase();
  if (normalized && !/^G-[A-Z0-9]{6,20}$/.test(normalized)) {
    issue(errors, path, "invalid_plugin_field", "Informe um Measurement ID válido do Google Analytics (ex.: G-ABC1234567).");
    return "";
  }
  return normalized;
}

function normalizeGooglePlaceId(value, path, errors) {
  const placeId = textValue(value, {
    path,
    label: "Place ID do Google Maps",
    maxLength: 200,
    required: true
  }, errors);
  // Place IDs públicos do Google começam por `ChI`; aceitar URL ou HTML aqui
  // transformaria um componente nativo em um redirecionador arbitrário.
  if (placeId && !/^ChI[A-Za-z0-9_-]{10,197}$/.test(placeId)) {
    issue(errors, path, "invalid_plugin_field", "Informe um Place ID válido do Google Maps (começa com ChI).");
    return "";
  }
  return placeId;
}

function normalizeFaqItems(value, path, errors) {
  if (!Array.isArray(value)) {
    issue(errors, path, "invalid_plugin_field", "Informe ao menos uma pergunta e resposta.");
    return [];
  }
  if (!value.length) issue(errors, path, "required_plugin_field", "Informe ao menos uma pergunta e resposta.");
  if (value.length > MAX_FAQ_ITEMS) issue(errors, path, "too_many_plugin_items", `O FAQ aceita no máximo ${MAX_FAQ_ITEMS} itens.`);
  const items = [];
  for (const [index, item] of value.slice(0, MAX_FAQ_ITEMS).entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      issue(errors, itemPath, "invalid_plugin_field", "Cada item do FAQ deve ter pergunta e resposta.");
      continue;
    }
    rejectUnknownKeys(item, new Set(["question", "answer"]), itemPath, errors);
    const question = textValue(item.question, { path: `${itemPath}.question`, label: "Pergunta", maxLength: 180, required: true }, errors);
    const answer = textValue(item.answer, { path: `${itemPath}.answer`, label: "Resposta", maxLength: 2000, multiline: true, required: true }, errors);
    if (question && question.length < 3) issue(errors, `${itemPath}.question`, "invalid_plugin_field", "A pergunta precisa ter ao menos 3 caracteres.");
    if (answer && answer.length < 3) issue(errors, `${itemPath}.answer`, "invalid_plugin_field", "A resposta precisa ter ao menos 3 caracteres.");
    items.push({ question, answer });
  }
  return items;
}

function normalizePluginConfig(pluginId, value, path, errors) {
  if (!isRecord(value)) {
    issue(errors, path, "invalid_plugin_config", "A configuração do plugin deve ser um objeto.");
    return {};
  }
  rejectUnknownKeys(value, PLUGIN_FIELDS[pluginId], path, errors);

  if (pluginId === "whatsapp_cta") {
    return {
      phone: normalizePhone(value.phone, `${path}.phone`, errors),
      label: textValue(value.label, { path: `${path}.label`, label: "Texto do botão", maxLength: 60, fallback: "Falar no WhatsApp" }, errors),
      message: textValue(value.message, { path: `${path}.message`, label: "Mensagem inicial", maxLength: 1000, multiline: true, fallback: "Olá! Vim pelo catálogo online." }, errors),
      style: enumValue(value.style, new Set(["primary", "secondary", "outline"]), { path: `${path}.style`, label: "Estilo", fallback: "primary" }, errors)
    };
  }

  if (pluginId === "instagram_profile") {
    return {
      username: normalizeInstagramUsername(value.username, `${path}.username`, errors),
      label: textValue(value.label, { path: `${path}.label`, label: "Texto do link", maxLength: 60, fallback: "Siga no Instagram" }, errors),
      openInNewTab: booleanValue(value.openInNewTab, { path: `${path}.openInNewTab`, fallback: true }, errors)
    };
  }

  if (pluginId === "maps_location") {
    const address = textValue(value.address, { path: `${path}.address`, label: "Endereço", maxLength: 300, multiline: true, required: true }, errors);
    const display = enumValue(value.display, new Set(["link", "embed"]), { path: `${path}.display`, label: "Exibição", fallback: "link" }, errors);
    const mapUrl = normalizeHttpsUrl(value.mapUrl, {
      path: `${path}.mapUrl`, label: "Link do Google Maps", hosts: GOOGLE_MAPS_HOSTS, pathname: /^\/maps(?:\/|$)/
    }, errors) || (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "");
    const embedUrl = normalizeHttpsUrl(value.embedUrl, {
      path: `${path}.embedUrl`, label: "URL de incorporação", hosts: GOOGLE_MAPS_HOSTS, pathname: /^\/maps\/embed(?:\/|$)/
    }, errors);
    if (display === "embed" && !embedUrl) issue(errors, `${path}.embedUrl`, "required_plugin_field", "Informe a URL de incorporação do Google Maps.");
    return {
      title: textValue(value.title, { path: `${path}.title`, label: "Título", maxLength: 80, fallback: "Como chegar" }, errors),
      address,
      display,
      mapUrl,
      embedUrl
    };
  }

  if (pluginId === "faq") {
    return {
      title: textValue(value.title, { path: `${path}.title`, label: "Título", maxLength: 100, fallback: "Dúvidas frequentes" }, errors),
      items: normalizeFaqItems(value.items, `${path}.items`, errors)
    };
  }

  if (pluginId === "google_analytics") {
    return {
      measurementId: normalizeMeasurementId(value.measurementId, `${path}.measurementId`, errors)
    };
  }

  if (pluginId === "google_review_link") {
    return {
      title: textValue(value.title, { path: `${path}.title`, label: "Título", maxLength: 100, fallback: "Gostou do atendimento?" }, errors),
      placeId: normalizeGooglePlaceId(value.placeId, `${path}.placeId`, errors),
      label: textValue(value.label, { path: `${path}.label`, label: "Texto do link", maxLength: 80, fallback: "Avalie no Google" }, errors),
      style: enumValue(value.style, new Set(["primary", "secondary", "outline"]), { path: `${path}.style`, label: "Estilo", fallback: "primary" }, errors)
    };
  }

  // `pluginId` já foi validado por quem chamou; este fallback protege contra
  // mudança futura no registro sem regra correspondente no backend.
  return {
    title: textValue(value.title, { path: `${path}.title`, label: "Título para buscadores", maxLength: 60, required: true }, errors),
    description: textValue(value.description, { path: `${path}.description`, label: "Descrição para buscadores", maxLength: 160, multiline: true, required: true }, errors),
    indexing: enumValue(value.indexing, new Set(["index", "noindex"]), { path: `${path}.indexing`, label: "Indexação", fallback: "index" }, errors)
  };
}

function pluginArray(input, errors) {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input)) return input;
  if (isRecord(input)) {
    // Aceitamos também `{ plugins: [...] }` para facilitar o uso a partir de
    // snapshots, mas a envoltória não vira uma porta para propriedades soltas.
    rejectUnknownKeys(input, new Set(["plugins"]), "", errors);
    if (Array.isArray(input.plugins)) return input.plugins;
  }
  issue(errors, "plugins", "invalid_plugin_list", "Plugins devem ser enviados em uma lista.");
  return [];
}

/**
 * Normaliza e valida a lista que será persistida no snapshot de catálogo.
 *
 * Instâncias com algum erro são propositalmente excluídas de `plugins`: quem
 * integra a função deve recusar a persistência caso `errors.length > 0`, mas
 * mesmo em um uso incorreto nenhum HTML/CSS/JS ou chave surpresa chega ao DB.
 *
 * @param {unknown[] | {plugins?: unknown[]}} input
 * @returns {{plugins: Array<{id?: string, pluginId: string, enabled: boolean, config: object}>, errors: Array<{path: string, code: string, message: string}>}}
 */
export function normalizeCatalogPlugins(input) {
  const errors = [];
  const source = pluginArray(input, errors);
  if (source.length > MAX_PLUGINS) issue(errors, "plugins", "too_many_plugins", `O catálogo aceita no máximo ${MAX_PLUGINS} plugins.`);

  const plugins = [];
  const ids = new Set();
  const counts = new Map();
  for (const [index, rawInstance] of source.slice(0, MAX_PLUGINS).entries()) {
    const start = errors.length;
    const path = `plugins[${index}]`;
    if (!isRecord(rawInstance)) {
      issue(errors, path, "invalid_plugin_instance", "Cada plugin deve ser um objeto.");
      continue;
    }
    rejectUnknownKeys(rawInstance, INSTANCE_FIELDS, path, errors);
    const pluginId = typeof rawInstance.pluginId === "string" ? rawInstance.pluginId.trim() : "";
    if (!PLUGIN_IDS.has(pluginId)) {
      issue(errors, `${path}.pluginId`, "unknown_catalog_plugin", "Plugin não permitido.");
      continue;
    }

    const rawId = rawInstance.id === undefined || rawInstance.id === null ? "" : String(rawInstance.id).trim();
    if (rawId && !/^[A-Za-z0-9_-]{1,100}$/.test(rawId)) issue(errors, `${path}.id`, "invalid_plugin_id", "O identificador do plugin é inválido.");
    if (rawId && ids.has(rawId)) issue(errors, `${path}.id`, "duplicate_plugin_id", "O identificador do plugin já está em uso.");
    if (rawId) ids.add(rawId);

    const count = Number(counts.get(pluginId) || 0) + 1;
    counts.set(pluginId, count);
    if (SINGLE_INSTANCE_PLUGINS.has(pluginId) && count > 1) {
      issue(errors, `${path}.pluginId`, "duplicate_catalog_plugin", "Este plugin pode ser usado apenas uma vez no catálogo.");
    }

    const enabled = booleanValue(rawInstance.enabled, { path: `${path}.enabled`, fallback: true }, errors);
    const config = normalizePluginConfig(pluginId, rawInstance.config, `${path}.config`, errors);
    if (errors.length !== start) continue;
    plugins.push({ ...(rawId ? { id: rawId } : {}), pluginId, enabled, config });
  }

  return { plugins, errors };
}

/** Feature de plano necessária para instalar um plugin nativo conhecido. */
export function catalogPluginRequiredFeature(pluginId) {
  return PLUGIN_FEATURES[String(pluginId || "")] || null;
}

/** Quantos plugins efetivamente entram na vitrine e consomem a cota do plano. */
export function countEnabledCatalogPlugins(plugins) {
  return Array.isArray(plugins)
    ? plugins.filter((plugin) => plugin && plugin.enabled !== false).length
    : 0;
}
