import { useEffect, useState } from "react";
import { Instagram, MapPin, MessageCircle, Star } from "lucide-react";
import { tenantSlug } from "../../lib/api";
import { normalizeCatalogBuilderPluginConfig } from "./builderPluginRegistry";
import styles from "./CatalogNativePlugins.module.css";

const EMPTY_OBJECT = Object.freeze({});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : EMPTY_OBJECT;
}

function text(value, maxLength = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isEnabled(value) {
  return value !== false && value !== 0 && value !== "0" && value !== "false";
}

function rawPluginId(plugin) {
  return text(plugin.pluginId || plugin.plugin_id || plugin.type, 80);
}

function rawPluginConfig(plugin) {
  return asObject(plugin.config || plugin.configuration || plugin.settings);
}

/**
 * Prepara instâncias para o renderer público. Mesmo que o servidor já tenha
 * normalizado o snapshot, repetimos a fronteira no cliente: só campos e IDs do
 * registro fechado chegam ao React. HTML, CSS e JavaScript são ignorados.
 */
export function normalizeCatalogNativePlugins(plugins) {
  return asArray(plugins).flatMap((raw, index) => {
    const plugin = asObject(raw);
    const pluginId = rawPluginId(plugin);
    if (!pluginId || !isEnabled(plugin.enabled)) return [];

    const normalized = normalizeCatalogBuilderPluginConfig(pluginId, rawPluginConfig(plugin));
    if (!normalized.plugin || normalized.errors.length) return [];

    return [{
      id: text(plugin.id || `${pluginId}-${index + 1}`, 100),
      pluginId: normalized.plugin.id,
      config: normalized.config
    }];
  });
}

/**
 * SEO não é um bloco visual. O integrador da rota pode usar este retorno para
 * atualizar as meta tags; o componente abaixo nunca injeta tags, scripts ou
 * HTML no DOM por conta própria.
 */
export function getCatalogNativeSeoMetadata(plugins, settings = {}, theme = {}) {
  const seo = normalizeCatalogNativePlugins(plugins).find((plugin) => plugin.pluginId === "seo_metadata")?.config;
  const safeSettings = asObject(settings);
  const safeTheme = asObject(theme);
  return {
    title: text(seo?.title || safeSettings.seo_title || safeSettings.page_title || safeTheme.brand_name, 60),
    description: text(seo?.description || safeSettings.seo_description, 160),
    indexing: seo?.indexing === "noindex" ? "noindex" : "index"
  };
}

const CONSENT_STORAGE_PREFIX = "aura-catalog-plugin-consent:v1";
const CONSENT_PURPOSES = ["third_party_maps", "analytics"];

function consentStorageKey() {
  try {
    // A mesma clínica pode ser acessada sem `?t` (tenant padrão). Reusar a
    // resolução central evita que consentimento de uma vitrine seja aplicado
    // a outra no mesmo navegador.
    const tenant = tenantSlug() || "public";
    return `${CONSENT_STORAGE_PREFIX}:${tenant}`;
  } catch {
    return `${CONSENT_STORAGE_PREFIX}:public`;
  }
}

function safeConsentPurposes(value) {
  const source = asObject(value);
  return Object.fromEntries(CONSENT_PURPOSES.map((purpose) => [purpose, source[purpose] === true]));
}

export function readCatalogNativePluginConsent() {
  try {
    const value = JSON.parse(localStorage.getItem(consentStorageKey()) || "null");
    if (!asObject(value).configured) return { configured: false, purposes: safeConsentPurposes() };
    return { configured: true, purposes: safeConsentPurposes(value.purposes) };
  } catch {
    return { configured: false, purposes: safeConsentPurposes() };
  }
}

function persistCatalogNativePluginConsent(purposes) {
  const consent = { configured: true, purposes: safeConsentPurposes(purposes) };
  try {
    localStorage.setItem(consentStorageKey(), JSON.stringify(consent));
  } catch {
    // LocalStorage pode estar indisponível no modo privado; o estado continua
    // válido durante a sessão atual, sem recorrer a cookies de terceiros.
  }
  return consent;
}

function mapEmbedHref(value) {
  const url = text(value, 2000);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowedHost = ["google.com", "www.google.com", "maps.google.com"].includes(host);
    if (parsed.protocol !== "https:" || !allowedHost || !/^\/maps\/embed(?:\/|$)/.test(parsed.pathname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function consentPurposesFor(instances) {
  const purposes = new Set();
  for (const plugin of instances) {
    if (plugin.pluginId === "maps_location" && plugin.config.display === "embed" && mapEmbedHref(plugin.config.embedUrl)) purposes.add("third_party_maps");
    if (plugin.pluginId === "google_analytics") purposes.add("analytics");
  }
  return [...purposes];
}

function GoogleConsent({ purpose, granted }) {
  if (typeof window === "undefined") return;
  const gtag = typeof window.gtag === "function"
    ? window.gtag
    : (...args) => {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(args);
    };
  if (typeof window.gtag !== "function") window.gtag = gtag;
  const denied = {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied"
  };
  const update = purpose === "analytics" && granted ? { ...denied, analytics_storage: "granted" } : denied;
  gtag("consent", "update", update);
}

function ConsentPreferences({ purposes, consent, onSave }) {
  const [editing, setEditing] = useState(() => !consent.configured);
  const [draft, setDraft] = useState(() => consent.purposes);

  useEffect(() => {
    setDraft(consent.purposes);
    if (!consent.configured) setEditing(true);
  }, [consent]);

  if (!purposes.length) return null;
  const labels = {
    third_party_maps: "Mapa do Google",
    analytics: "Medição de visitas"
  };
  const save = (next) => {
    onSave(next);
    setEditing(false);
  };
  const all = Object.fromEntries(purposes.map((purpose) => [purpose, true]));
  const none = Object.fromEntries(purposes.map((purpose) => [purpose, false]));

  return (
    <section className={styles.consent} aria-label="Preferências de privacidade">
      {!editing && <button className={styles.preferenceButton} type="button" onClick={() => setEditing(true)}>Preferências de privacidade</button>}
      {editing && <>
        <div>
          <strong>Sua privacidade</strong>
          <p>{consent.configured ? "Atualize suas escolhas a qualquer momento." : "Escolha se deseja liberar integrações opcionais deste catálogo."}</p>
        </div>
        <fieldset>
          <legend>Integrações opcionais</legend>
          {purposes.map((purpose) => (
            <label key={purpose}>
              <input type="checkbox" checked={Boolean(draft[purpose])} onChange={(event) => setDraft((current) => ({ ...current, [purpose]: event.target.checked }))} />
              <span>{labels[purpose]}</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.consentActions}>
          <button className={styles.preferenceButton} type="button" onClick={() => save(none)}>Recusar opcionais</button>
          <button className={styles.preferenceButton} type="button" onClick={() => save(draft)}>Salvar escolhas</button>
          <button className={`${styles.preferenceButton} ${styles.acceptAll}`} type="button" onClick={() => save(all)}>Aceitar todos</button>
        </div>
      </>}
    </section>
  );
}

function whatsappHref(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(digits)) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message || "Olá! Vim pelo catálogo online.")}`;
}

function instagramHref(username) {
  const safeUsername = text(username, 30);
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(safeUsername)) return "";
  return `https://www.instagram.com/${encodeURIComponent(safeUsername)}/`;
}

function mapHref(value) {
  const url = text(value, 2000);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowedHost = ["google.com", "www.google.com", "maps.google.com"].includes(host);
    if (parsed.protocol !== "https:" || !allowedHost || !/^\/maps(?:\/|$)/.test(parsed.pathname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function pluginButtonClass(style) {
  return style === "secondary" || style === "outline" ? styles[style] : styles.primary;
}

function WhatsAppPlugin({ config }) {
  const href = whatsappHref(config.phone, config.message);
  if (!href) return null;
  return (
    <section className={styles.block} aria-label="Atendimento pelo WhatsApp">
      <a className={`${styles.action} ${pluginButtonClass(config.style)}`} href={href} target="_blank" rel="noreferrer">
        <MessageCircle size={18} aria-hidden="true" />
        {config.label || "Falar no WhatsApp"}
      </a>
    </section>
  );
}

function InstagramPlugin({ config }) {
  const href = instagramHref(config.username);
  if (!href) return null;
  const openInNewTab = config.openInNewTab !== false;
  return (
    <section className={styles.block} aria-label="Perfil do Instagram">
      <a className={`${styles.action} ${styles.outline}`} href={href} {...(openInNewTab ? { target: "_blank", rel: "noreferrer" } : {})}>
        <Instagram size={18} aria-hidden="true" />
        {config.label || "Siga no Instagram"}
      </a>
    </section>
  );
}

function MapsPlugin({ config, consentGranted }) {
  const href = mapHref(config.mapUrl);
  if (!href) return null;
  const embedUrl = config.display === "embed" ? mapEmbedHref(config.embedUrl) : "";
  const canEmbed = Boolean(embedUrl && consentGranted);
  return (
    <section className={`${styles.block} ${styles.maps}`} aria-label={config.title || "Como chegar"}>
      <div>
        <MapPin size={21} aria-hidden="true" />
        <span>
          <strong>{config.title || "Como chegar"}</strong>
          <small>{config.address}</small>
        </span>
      </div>
      <a className={`${styles.action} ${styles.outline}`} href={href} target="_blank" rel="noreferrer">Abrir no Google Maps</a>
      {embedUrl && !canEmbed && <p className={styles.consentHint}>O mapa será carregado somente após sua autorização nas preferências de privacidade.</p>}
      {canEmbed && <iframe title={config.title || "Mapa do Google"} src={embedUrl} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />}
    </section>
  );
}

function FaqPlugin({ config }) {
  const items = asArray(config.items).filter((item) => text(item?.question, 180) && text(item?.answer, 2000));
  if (!items.length) return null;
  return (
    <section className={`${styles.block} ${styles.faq}`} aria-label={config.title || "Dúvidas frequentes"}>
      <h2>{config.title || "Dúvidas frequentes"}</h2>
      {items.map((item) => (
        <details key={`${item.question}-${item.answer}`}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </section>
  );
}

function googleReviewHref(placeId) {
  const safePlaceId = text(placeId, 256);
  if (!/^ChI[A-Za-z0-9_-]{6,253}$/.test(safePlaceId)) return "";
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(safePlaceId)}`;
}

function GoogleReviewPlugin({ config }) {
  const href = googleReviewHref(config.placeId);
  if (!href) return null;
  return (
    <section className={`${styles.block} ${styles.review}`} aria-label={config.title || "Avaliações no Google"}>
      <div><Star size={21} aria-hidden="true" /><strong>{config.title || "Avalie sua experiência"}</strong></div>
      <a className={`${styles.action} ${pluginButtonClass(config.style)}`} href={href} target="_blank" rel="noreferrer">{config.label || "Avaliar no Google"}</a>
    </section>
  );
}

function GoogleAnalyticsPlugin({ config, consentGranted }) {
  useEffect(() => {
    const measurementId = text(config.measurementId, 24);
    if (!/^G-[A-Z0-9]{6,20}$/.test(measurementId)) return undefined;

    // Sempre comunica a negativa quando não há consentimento (inclusive após
    // retirada). Assim uma preferência revogada tem efeito sem reload.
    GoogleConsent({ purpose: "analytics", granted: consentGranted });
    if (!consentGranted || typeof document === "undefined") return undefined;

    const selector = `script[data-aura-google-analytics="${measurementId}"]`;
    const previous = document.querySelector(selector);
    if (previous) return undefined;

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.auraGoogleAnalytics = measurementId;
    script.onload = () => {
      GoogleConsent({ purpose: "analytics", granted: true });
      window.gtag?.("js", new Date());
      window.gtag?.("config", measurementId, { anonymize_ip: true });
    };
    document.head.append(script);
    return () => {
      // A remoção não é o único mecanismo: antes dela já enviamos o estado
      // `denied`, o que também cobre scripts que tenham terminado de carregar.
      GoogleConsent({ purpose: "analytics", granted: false });
      script.remove();
    };
  }, [config.measurementId, consentGranted]);
  return null;
}

function CatalogNativePlugin({ plugin, consent }) {
  if (plugin.pluginId === "whatsapp_cta") return <WhatsAppPlugin config={plugin.config} />;
  if (plugin.pluginId === "instagram_profile") return <InstagramPlugin config={plugin.config} />;
  if (plugin.pluginId === "maps_location") return <MapsPlugin config={plugin.config} consentGranted={consent.purposes.third_party_maps === true} />;
  if (plugin.pluginId === "faq") return <FaqPlugin config={plugin.config} />;
  if (plugin.pluginId === "google_review_link") return <GoogleReviewPlugin config={plugin.config} />;
  if (plugin.pluginId === "google_analytics") return <GoogleAnalyticsPlugin config={plugin.config} consentGranted={consent.purposes.analytics === true} />;
  // `seo_metadata` é propositalmente não visual.
  return null;
}

/**
 * Renderer público para integrações nativas do catálogo. Ele não executa nem
 * interpreta HTML/CSS/JS de clientes; o snapshot só escolhe componentes do
 * registro fechado em `builderPluginRegistry`.
 */
export function CatalogNativePlugins({ plugins, settings = {}, theme = {} }) {
  const instances = normalizeCatalogNativePlugins(plugins);
  const visiblePlugins = instances.filter((plugin) => plugin.pluginId !== "seo_metadata");
  const seo = getCatalogNativeSeoMetadata(plugins, settings, theme);
  const consentPurposes = consentPurposesFor(instances);
  const [consent, setConsent] = useState(readCatalogNativePluginConsent);

  function saveConsent(purposes) {
    setConsent(persistCatalogNativePluginConsent({ ...consent.purposes, ...purposes }));
  }

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute("content") ?? null;
    let robots = document.querySelector('meta[name="robots"]');
    const createdRobots = !robots;
    const previousRobots = robots?.getAttribute("content") ?? null;
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    if (seo.title) document.title = seo.title;
    if (description && seo.description) description.setAttribute("content", seo.description);
    robots.setAttribute("content", seo.indexing === "noindex" ? "noindex,nofollow" : "index,follow");
    return () => {
      document.title = previousTitle;
      if (description) {
        if (previousDescription === null) description.removeAttribute("content");
        else description.setAttribute("content", previousDescription);
      }
      if (createdRobots) robots.remove();
      else if (previousRobots === null) robots.removeAttribute("content");
      else robots.setAttribute("content", previousRobots);
    };
  }, [seo.title, seo.description, seo.indexing]);
  if (!visiblePlugins.length) return null;

  return (
    <div className={styles.root} data-catalog-indexing={seo.indexing}>
      {visiblePlugins.map((plugin) => <CatalogNativePlugin key={plugin.id} plugin={plugin} consent={consent} />)}
      <ConsentPreferences purposes={consentPurposes} consent={consent} onSave={saveConsent} />
    </div>
  );
}
