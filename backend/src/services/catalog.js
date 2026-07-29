// Serviços de configuração e personalização do catálogo online.
import { JEWELRY_CATEGORIES } from "../config/index.js";
import { boolNumber, defaultCatalogTheme } from "./utils.js";

export async function getCatalogSettings(db) {
  const rows = await db.all("SELECT key, value FROM catalog_settings");
  const defaults = {
    brand_name: "",
    slogan: "",
    logo_url: "",
    title: "Escolha a joia perfeita para você",
    subtitle: "",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realçar sua essência",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: `Todos,${JEWELRY_CATEGORIES.join(",")}`,
    whatsapp_phone: "",
    whatsapp_message: "Olá! Vim pelo catálogo online e quero ajuda para escolher uma joia.",
    company_instagram: "",
    company_legal_name: "",
    company_display_name: "",
    company_short_description: "",
    company_phone: "",
    company_whatsapp: "",
    company_email: "",
    company_support_email: "",
    company_address: "",
    company_hours: "",
    company_service_days: "",
    company_website: "",
    company_maps_url: "",
    service_policy: "",
    deposit_policy: "",
    cancellation_policy: "",
    exchange_policy: "",
    biosafety_text: "",
    materials_text: "",
    layout_style: "premium",
    page_title: "Catálogo Online",
    unavailable_message: "Produto indisponível no momento.",
    low_stock_message: "Poucas unidades",
    institutional_text: "Joias selecionadas com cuidado, segurança e estética premium.",
    footer_text: "",
    seo_title: "Catálogo Online",
    seo_description: "Escolha joias para piercing no catálogo online.",
    share_image_url: "",
    product_share_text: "Olha essa joia:",
    footer_enabled: "1",
    footer_display_name: "",
    footer_slogan: "",
    footer_logo_url: "",
    footer_light_logo_url: "",
    footer_dark_logo_url: "",
    footer_logo_alignment: "center",
    footer_logo_max_width: "180",
    footer_logo_max_height: "96",
    footer_show_business_name: "1",
    footer_show_slogan: "1",
    footer_background_type: "solid",
    footer_background_color: "#1c1c1c",
    footer_background_image_url: "",
    footer_background_position: "50% 50%",
    footer_background_size: "cover",
    footer_overlay_color: "#000000",
    footer_overlay_opacity: "0",
    footer_gradient_start_color: "#1c1c1c",
    footer_gradient_end_color: "#34302b",
    footer_gradient_direction: "135deg",
    footer_brand_background_color: "transparent",
    footer_text_color: "#f8f5f0",
    footer_muted_text_color: "#c9c2b8",
    footer_heading_color: "#ffffff",
    footer_link_color: "#f8f5f0",
    footer_link_hover_color: "#ffffff",
    footer_icon_color: "#c8a96a",
    footer_border_color: "#514a42",
    footer_accent_color: "#c8a96a",
    footer_border_radius: "24",
    footer_container_width: "1280",
    footer_spacing: "40",
    footer_copyright_text: "",
    footer_inherit_main_palette: "1",
    site_background: "#f8f5f0",
    section_background: "#ffffff",
    text_color: "#1c1c1c",
    muted_text_color: "#74685e",
    heading_color: "#1c1c1c",
    link_color: "#8b642f",
    link_hover_color: "#5f421d",
    icon_color: "#8b642f",
    border_color: "#d8c3a5",
    button_text_color: "#ffffff",
    content_sections: JSON.stringify([{
      kicker: "Guia",
      title: "Escolha sua joia com orientação profissional",
      text: "Veja materiais, medidas, anodização e cuidados antes de reservar sua joia.",
      media_type: "image",
      media_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
      button_text: "Agendar atendimento",
      button_link: "/agendar",
      active: true,
      order: 1
    }]
    )
  };
  return rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), defaults);
}

export async function getCatalogCustomization(db, { published = false } = {}) {
  const settings = await getCatalogSettings(db);
  const theme = await db.get("SELECT * FROM catalog_theme WHERE id = 1") || defaultCatalogTheme();
  const banners = await db.all("SELECT * FROM catalog_banners ORDER BY sort_order, id");
  const featuredCategories = await db.all("SELECT * FROM catalog_featured_categories ORDER BY sort_order, id");
  const featuredProducts = await db.all(`
    SELECT fp.*, j.name, j.photo_url, j.category, j.material, j.sale_value, j.quantity
    FROM catalog_featured_products fp
    JOIN jewelry_inventory j ON j.id = fp.product_id
    ORDER BY fp.sort_order, fp.id
  `);
  const promotions = await db.all("SELECT * FROM catalog_promotions ORDER BY start_date DESC, id DESC");
  const catalogSections = await getCatalogSections(db, published ? "published" : "draft");
  return {
    settings: {
      ...settings,
      brand_name: theme.brand_name || settings.brand_name,
      slogan: theme.slogan || settings.slogan,
      logo_url: theme.logo_url || settings.logo_url,
      footer_text: theme.footer_text || settings.footer_text,
      layout_style: theme.theme || settings.layout_style
    },
    theme,
    banners,
    featuredCategories,
    featuredProducts,
    promotions,
    catalogSections
  };
}

export async function getCatalogSections(db, status = "draft") {
  const layout = await db.get("SELECT * FROM catalog_layouts WHERE status = ?", [status]);
  if (!layout) return [];
  return db.all("SELECT * FROM catalog_sections WHERE layout_id = ? ORDER BY sort_order, id", [layout.id]);
}

export async function saveCatalogLayoutDraft(db, sections = [], userId = null) {
  if (!Array.isArray(sections)) return [];
  let layout = await db.get("SELECT * FROM catalog_layouts WHERE status = 'draft'");
  if (!layout) {
    const result = await db.run("INSERT INTO catalog_layouts (status, version) VALUES ('draft', 1) RETURNING id");
    layout = await db.get("SELECT * FROM catalog_layouts WHERE id = ?", [result.returnedId]);
  }
  await db.run("BEGIN");
  try {
    await db.run("DELETE FROM catalog_sections WHERE layout_id = ?", [layout.id]);
    for (const [index, section] of sections.entries()) {
      await db.run(
        `INSERT INTO catalog_sections
          (layout_id, section_key, section_type, title, subtitle, is_active, sort_order, alignment, background,
           spacing, item_limit, display_mode, width_mode, height, columns_count, image_ratio, card_size,
           product_sort, category_filter, media_url, button_text, button_link, body_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          layout.id, section.section_key || `section-${index + 1}`, section.section_type || "custom_content",
          section.title || "", section.subtitle || section.kicker || "", boolNumber(section.is_active ?? section.active ?? 1),
          Number(section.sort_order ?? section.order ?? index + 1), section.alignment || "left", section.background || "",
          Number(section.spacing ?? 24), Number(section.item_limit ?? 8), section.display_mode || "grid",
          section.width_mode || "contained", section.height || null, Number(section.columns_count ?? 4),
          section.image_ratio || "1:1", section.card_size || "medium", section.product_sort || "recent",
          section.category_filter || "", section.media_url || "", section.button_text || "", section.button_link || "",
          section.body_text || section.text || ""
        ]
      );
    }
    await db.run("UPDATE catalog_layouts SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [layout.id]);
    const snapshot = await getCatalogSections(db, "draft");
    await db.run("INSERT INTO catalog_layout_history (version, action, user_id, snapshot) VALUES (?, 'save_draft', ?, ?)", [layout.version, userId, JSON.stringify(snapshot)]);
    await db.run("COMMIT");
    return snapshot;
  } catch (error) {
    await db.run("ROLLBACK");
    throw error;
  }
}

export async function publishCatalogLayout(db, userId = null) {
  const draft = await db.get("SELECT * FROM catalog_layouts WHERE status = 'draft'");
  if (!draft) return [];
  let published = await db.get("SELECT * FROM catalog_layouts WHERE status = 'published'");
  if (!published) {
    const result = await db.run("INSERT INTO catalog_layouts (status, version, published_at) VALUES ('published', 1, CURRENT_TIMESTAMP) RETURNING id");
    published = await db.get("SELECT * FROM catalog_layouts WHERE id = ?", [result.returnedId]);
  }
  const nextVersion = Number(published.version || 0) + 1;
  await db.run("BEGIN");
  try {
    await db.run("DELETE FROM catalog_sections WHERE layout_id = ?", [published.id]);
    await db.run(
      `INSERT INTO catalog_sections
        (layout_id, section_key, section_type, title, subtitle, is_active, sort_order, alignment, background,
         spacing, item_limit, display_mode, width_mode, height, columns_count, image_ratio, card_size,
         product_sort, category_filter, media_url, button_text, button_link, body_text)
       SELECT ?, section_key, section_type, title, subtitle, is_active, sort_order, alignment, background,
         spacing, item_limit, display_mode, width_mode, height, columns_count, image_ratio, card_size,
         product_sort, category_filter, media_url, button_text, button_link, body_text
       FROM catalog_sections WHERE layout_id=?`,
      [published.id, draft.id]
    );
    await db.run("UPDATE catalog_layouts SET version=?, published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?", [nextVersion, published.id]);
    const snapshot = await getCatalogSections(db, "published");
    await db.run("INSERT INTO catalog_layout_history (version, action, user_id, snapshot) VALUES (?, 'publish', ?, ?)", [nextVersion, userId, JSON.stringify(snapshot)]);
    await db.run("COMMIT");
    return snapshot;
  } catch (error) {
    await db.run("ROLLBACK");
    throw error;
  }
}

export async function saveCatalogCustomization(db, body) {
  if (body.settings) {
    const allowed = [
      "title", "subtitle", "hero_title", "hero_subtitle", "hero_image_url", "categories", "whatsapp_phone", "whatsapp_message", "layout_style",
      "company_instagram", "company_legal_name", "company_display_name", "company_short_description", "company_phone", "company_whatsapp",
      "company_email", "company_support_email", "company_address", "company_hours", "company_service_days",
      "company_website", "company_maps_url", "service_policy", "deposit_policy", "cancellation_policy",
      "exchange_policy", "biosafety_text", "materials_text",
      "page_title", "unavailable_message", "low_stock_message", "institutional_text", "footer_text", "seo_title", "seo_description", "share_image_url", "product_share_text", "content_sections",
      "footer_enabled", "footer_display_name", "footer_slogan", "footer_logo_url", "footer_light_logo_url", "footer_dark_logo_url",
      "footer_logo_alignment", "footer_logo_max_width", "footer_logo_max_height", "footer_show_business_name", "footer_show_slogan",
      "footer_background_type", "footer_background_color", "footer_background_image_url", "footer_background_position", "footer_background_size",
      "footer_overlay_color", "footer_overlay_opacity", "footer_gradient_start_color", "footer_gradient_end_color", "footer_gradient_direction",
      "footer_brand_background_color", "footer_text_color", "footer_muted_text_color", "footer_heading_color", "footer_link_color",
      "footer_link_hover_color", "footer_icon_color", "footer_border_color", "footer_accent_color", "footer_border_radius",
      "footer_container_width", "footer_spacing", "footer_copyright_text", "footer_inherit_main_palette", "site_background",
      "section_background", "text_color", "muted_text_color", "heading_color", "link_color", "link_hover_color", "icon_color",
      "border_color", "button_text_color", "logo_transform"
    ];
    for (const [key, value] of Object.entries(body.settings).filter(([key]) => allowed.includes(key))) {
      await db.run(
        "INSERT INTO catalog_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, Array.isArray(value) ? value.join(",") : String(value ?? "")]
      );
    }
  }

  if (body.theme) {
    const theme = { ...defaultCatalogTheme(), ...body.theme };
    await db.run(
      `INSERT INTO catalog_theme
      (id, brand_name, slogan, logo_url, primary_color, secondary_color, background_color, button_color, title_font, body_font, theme,
       show_out_of_stock, show_stock_quantity, stock_display_mode, show_whatsapp_button, show_schedule_button, show_buy_button, show_favorites, footer_text)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        brand_name = excluded.brand_name,
        slogan = excluded.slogan,
        logo_url = excluded.logo_url,
        primary_color = excluded.primary_color,
        secondary_color = excluded.secondary_color,
        background_color = excluded.background_color,
        button_color = excluded.button_color,
        title_font = excluded.title_font,
        body_font = excluded.body_font,
        theme = excluded.theme,
        show_out_of_stock = excluded.show_out_of_stock,
        show_stock_quantity = excluded.show_stock_quantity,
        stock_display_mode = excluded.stock_display_mode,
        show_whatsapp_button = excluded.show_whatsapp_button,
        show_schedule_button = excluded.show_schedule_button,
        show_buy_button = excluded.show_buy_button,
        show_favorites = excluded.show_favorites,
        footer_text = excluded.footer_text`,
      [
        theme.brand_name,
        theme.slogan,
        theme.logo_url,
        theme.primary_color,
        theme.secondary_color,
        theme.background_color,
        theme.button_color,
        theme.title_font,
        theme.body_font,
        theme.theme,
        boolNumber(theme.show_out_of_stock),
        boolNumber(theme.show_stock_quantity),
        theme.stock_display_mode,
        boolNumber(theme.show_whatsapp_button),
        boolNumber(theme.show_schedule_button),
        boolNumber(theme.show_buy_button),
        boolNumber(theme.show_favorites),
        theme.footer_text
      ]
    );
  }

  if (Array.isArray(body.banners)) {
    const normalizedTransforms = body.banners.map((banner) => validateImageTransform(banner.image_transform));
    await db.run("DELETE FROM catalog_banners");
    for (const [index, banner] of body.banners.entries()) {
      const imageTransform = normalizedTransforms[index];
      await db.run(
        `INSERT INTO catalog_banners (title, subtitle, image_url, mobile_image_url, original_image_url, alt_text, image_transform, button_text, button_link, banner_width, banner_height, banner_fit, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          banner.title || "Banner",
          banner.subtitle || "",
          banner.image_url || "",
          banner.mobile_image_url || "",
          banner.original_image_url || banner.image_url || "",
          banner.alt_text || banner.title || "Banner",
          JSON.stringify(imageTransform),
          banner.button_text || "",
          banner.button_link || "",
          Number(banner.banner_width || 0),
          Number(banner.banner_height || 340),
          banner.banner_fit || "contain",
          boolNumber(banner.is_active),
          Number(banner.sort_order || 0)
        ]
      );
    }
  }

  if (Array.isArray(body.featuredCategories)) {
    await db.run("DELETE FROM catalog_featured_categories");
    for (const category of body.featuredCategories) {
      await db.run(
        `INSERT INTO catalog_featured_categories
          (category_id, public_name, icon, image_url, is_active, sort_order, description, display_mode, product_limit, color, banner_url, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          category.category_id || category.public_name || "categoria", category.public_name || category.category_id || "Categoria",
          category.icon || "gem", category.image_url || "", boolNumber(category.is_active), Number(category.sort_order || 0),
          category.description || "", category.display_mode || "grid", Number(category.product_limit || 12),
          category.color || "", category.banner_url || "", boolNumber(category.is_featured)
        ]
      );
    }
  }

  if (Array.isArray(body.featuredProducts)) {
    await db.run("DELETE FROM catalog_featured_products");
    for (const product of body.featuredProducts.filter((item) => item.product_id)) {
      await db.run(
        `INSERT INTO catalog_featured_products (product_id, badge, is_active, sort_order)
         VALUES (?, ?, ?, ?)`,
        [Number(product.product_id), product.badge || "", boolNumber(product.is_active), Number(product.sort_order || 0)]
      );
    }
  }

  if (Array.isArray(body.promotions)) {
    await db.run("DELETE FROM catalog_promotions");
    for (const promotion of body.promotions) {
      await db.run(
        `INSERT INTO catalog_promotions (name, discount_type, discount_value, start_date, end_date, applies_to, product_ids, category_ids, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          promotion.name || "Promoção",
          promotion.discount_type || "percent",
          Number(promotion.discount_value || 0),
          promotion.start_date || "",
          promotion.end_date || "",
          promotion.applies_to || "products",
          Array.isArray(promotion.product_ids) ? promotion.product_ids.join(",") : String(promotion.product_ids || ""),
          Array.isArray(promotion.category_ids) ? promotion.category_ids.join(",") : String(promotion.category_ids || ""),
          boolNumber(promotion.is_active)
        ]
      );
    }
  }
}

export async function resetCatalogCustomization(db) {
  await db.run("DELETE FROM catalog_layout_history");
  await db.run("DELETE FROM catalog_layouts");
  await db.run("DELETE FROM catalog_banners");
  await db.run("DELETE FROM catalog_featured_categories");
  await db.run("DELETE FROM catalog_featured_products");
  await db.run("DELETE FROM catalog_promotions");
  await db.run("DELETE FROM catalog_theme");
  await db.run("DELETE FROM catalog_settings");
  await db.run(
    `INSERT INTO catalog_theme
    (id, brand_name, slogan, logo_url, primary_color, secondary_color, background_color, button_color, title_font, body_font, theme, footer_text)
    VALUES (1, '', '', '', '#C8A96A', '#D8C3A5', '#F8F5F0', '#C8A96A', 'Georgia', 'Inter', 'premium', '')`
  );
  await saveCatalogCustomization(db, {
    settings: await getCatalogSettings(db),
    banners: [{
      title: "Escolha a joia perfeita para você",
      subtitle: "Joias de alta qualidade para realçar sua essência.",
      image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
      button_text: "Ver todas as joias",
      button_link: "#catalog-products",
      banner_width: 0,
      banner_height: 340,
      banner_fit: "contain",
      is_active: 1,
      sort_order: 1
    }],
    featuredCategories: JEWELRY_CATEGORIES.map((name, index) => ({
      category_id: name,
      public_name: name,
      icon: index === 4 ? "shield" : "gem",
      image_url: "",
      is_active: 1,
      sort_order: index + 1
    }))
  });
}

export function validateImageTransform(value) {
  const source = value == null || value === "" ? {} : value;
  if (typeof source !== "object" || Array.isArray(source)) {
    const error = new Error("Configuração de enquadramento inválida.");
    error.statusCode = 400;
    throw error;
  }
  const fitMode = source.fitMode || "contain";
  const numericRules = [
    ["focalPointX", 0, 100, 50],
    ["focalPointY", 0, 100, 50],
    ["zoom", 0.5, 3, 1],
    ["rotation", -360, 360, 0]
  ];
  if (!["contain", "cover", "custom"].includes(fitMode)) {
    const error = new Error("Modo de enquadramento inválido.");
    error.statusCode = 400;
    throw error;
  }
  const normalized = { fitMode };
  for (const [key, min, max, fallback] of numericRules) {
    const number = source[key] == null ? fallback : Number(source[key]);
    if (!Number.isFinite(number) || number < min || number > max) {
      const error = new Error(`Valor inválido para ${key}.`);
      error.statusCode = 400;
      throw error;
    }
    normalized[key] = number;
  }
  normalized.flipHorizontal = Boolean(source.flipHorizontal);
  normalized.aspectRatio = String(source.aspectRatio || "16/5");
  return normalized;
}
