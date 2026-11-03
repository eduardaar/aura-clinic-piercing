export { BOUTIQUE_FIELDS, BOUTIQUE_GROUPS, BOUTIQUE_SECTION_TYPES, BOUTIQUE_ICONS, BOUTIQUE_FILTERS, defaultBoutiqueConfig } from "../../../../backend/src/config/catalogBoutique.js";
import { normalizeBoutiqueConfig } from "../../../../backend/src/config/catalogBoutique.js";

export const boutiqueConfig = (value) => normalizeBoutiqueConfig(value).config;

export function boutiqueStyle(config, settings, theme) {
  const inherit = settings.footer_inherit_main_palette === "1";
  const footerBackground = inherit ? settings.site_background || theme.background_color || "#fbf9f5" : settings.footer_background_type === "gradient"
    ? `linear-gradient(${settings.footer_gradient_direction || "135deg"}, ${settings.footer_gradient_start_color || "#1a1a1a"}, ${settings.footer_gradient_end_color || "#34302b"})`
    : settings.footer_background_color || "#1a1a1a";
  const image = String(settings.footer_background_image_url || "");
  const footerImage = !inherit && settings.footer_background_type === "image" && /^(?:https:\/\/[^\s<>"']+|\/uploads\/[^\s<>"']+)$/.test(image);
  const logoAlignment = settings.footer_logo_alignment || "left";
  const overlayOpacity = Math.min(1, Math.max(0, Number(settings.footer_overlay_opacity || 0)));
  return {
    "--boutique-dark": settings.heading_color || "#1a1a1a",
    "--boutique-line": settings.border_color || "#e5e1da",
    "--boutique-gold": settings.link_color || theme.primary_color || "#987332",
    "--boutique-surface": settings.section_background || "#ffffff",
    "--boutique-text": settings.text_color || "#1a1a1a",
    "--boutique-muted": settings.muted_text_color || "#71717a",
    "--boutique-button": theme.button_color || "#b38b40",
    "--boutique-button-text": settings.button_text_color || "#ffffff",
    "--boutique-width": `${config.content_width}px`,
    "--boutique-section-gap": `${config.section_gap}px`,
    "--boutique-section-padding": `${config.section_padding}px`,
    "--boutique-body-size": `${config.body_size}px`,
    "--boutique-heading-size": `${config.heading_size}px`,
    "--boutique-heading-mobile-size": `${config.heading_mobile_size}px`,
    "--boutique-card-radius": `${config.card_radius}px`,
    "--boutique-button-radius": `${config.button_radius}px`,
    "--boutique-hero-height": `${config.hero_height_desktop}px`,
    "--boutique-hero-mobile-height": `${config.hero_height_mobile}px`,
    "--boutique-hero-mobile-opacity": config.hero_mobile_image_opacity / 100,
    "--boutique-filter-width": `${config.filters_width}px`,
    "--boutique-footer-mobile-columns": config.footer_mobile_columns,
    "--boutique-mobile-contact-display": config.header_contact_mobile ? "inline-flex" : "none",
    "--boutique-mobile-announcement-link-display": config.announcement_link_mobile ? "inline-flex" : "none",
    "--boutique-product-columns": config.products_columns,
    "--boutique-product-tablet-columns": config.products_tablet_columns,
    "--boutique-product-mobile-columns": config.products_mobile_columns,
    "--boutique-category-columns": config.categories_columns,
    "--boutique-category-mobile-columns": config.categories_mobile_columns,
    "--boutique-benefit-columns": config.benefits_columns,
    "--boutique-benefit-mobile-columns": config.benefits_mobile_columns,
    ...Object.fromEntries(["navigation_background", "navigation_text", "navigation_active", "announcement_background", "announcement_color", "hero_background", "hero_color", "hero_muted", "hero_accent", "benefits_background", "benefits_icon_background", "contact_color", "favorite_active_color", "category_overlay_color", "category_text_color", "card_button_background", "card_button_text"].map((key) => [`--boutique-${key.replaceAll("_", "-")}`, config[key]])),
    "--boutique-footer-bg": footerImage ? `linear-gradient(color-mix(in srgb, ${settings.footer_overlay_color || "#000000"} ${overlayOpacity * 100}%, transparent), color-mix(in srgb, ${settings.footer_overlay_color || "#000000"} ${overlayOpacity * 100}%, transparent)), url("${image}")` : footerBackground,
    "--boutique-footer-position": settings.footer_background_position || "50% 50%",
    "--boutique-footer-size": settings.footer_background_size || "cover",
    "--boutique-footer-radius": `${Number(settings.footer_border_radius || 0)}px`,
    "--boutique-footer-brand-bg": settings.footer_brand_background_color || "transparent",
    "--boutique-footer-logo-left": ["center", "right"].includes(logoAlignment) ? "auto" : "0",
    "--boutique-footer-logo-right": ["center", "left"].includes(logoAlignment) ? "auto" : "0",
    "--boutique-footer-text": inherit ? settings.text_color : settings.footer_text_color || "#d2cec6",
    "--boutique-footer-heading": inherit ? settings.heading_color : settings.footer_heading_color || "#ffffff",
    "--boutique-footer-muted": inherit ? settings.muted_text_color : settings.footer_muted_text_color || "#b8b3aa",
    "--boutique-footer-link": inherit ? settings.link_color : settings.footer_link_color || "#ccc6bc",
    "--boutique-footer-hover": inherit ? settings.link_hover_color : settings.footer_link_hover_color || theme.primary_color || "#e4c995",
    "--boutique-footer-border": inherit ? settings.border_color : settings.footer_border_color || "#38342e",
    "--boutique-footer-spacing": `${Number(settings.footer_spacing || 40)}px`,
    "--boutique-footer-width": `${Number(settings.footer_container_width || config.content_width)}px`,
    "--boutique-footer-logo-width": `${Number(settings.footer_logo_max_width || 60)}px`,
    "--boutique-footer-logo-height": `${Number(settings.footer_logo_max_height || 60)}px`
  };
}
