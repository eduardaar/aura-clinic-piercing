// Serviços de configuração e personalização do catálogo online.
import { JEWELRY_CATEGORIES } from "../config/index.js";
import { boolNumber, defaultCatalogTheme } from "./utils.js";

export async function getCatalogSettings(db) {
  const rows = await db.all("SELECT key, value FROM catalog_settings");
  const defaults = {
    brand_name: "Aura Clinic",
    slogan: "Piercing premium e joalherias selecionadas",
    logo_url: "",
    title: "Escolha a joia perfeita para você",
    subtitle: "Curadoria premium da Aura Clinic Piercing",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realçar sua essência",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: `Todos,${JEWELRY_CATEGORIES.join(",")}`,
    whatsapp_phone: "",
    whatsapp_message: "Olá! Vim pelo catálogo online da Aura Clinic e quero ajuda para escolher uma joia.",
    company_instagram: "",
    company_email: "",
    company_address: "",
    company_hours: "",
    layout_style: "premium",
    page_title: "Catálogo Online",
    unavailable_message: "Produto indisponível no momento.",
    low_stock_message: "Poucas unidades",
    institutional_text: "Joias selecionadas com cuidado, segurança e estética premium.",
    footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.",
    seo_title: "Aura Clinic Piercing | Catálogo Online",
    seo_description: "Escolha joias premium para piercing na Aura Clinic.",
    share_image_url: "",
    product_share_text: "Olha essa joia da Aura Clinic:",
    content_sections: JSON.stringify([{
      kicker: "Guia Aura",
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

export async function getCatalogCustomization(db) {
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
    promotions
  };
}

export async function saveCatalogCustomization(db, body) {
  if (body.settings) {
    const allowed = [
      "title", "subtitle", "hero_title", "hero_subtitle", "hero_image_url", "categories", "whatsapp_phone", "whatsapp_message", "layout_style",
      "company_instagram", "company_email", "company_address", "company_hours",
      "page_title", "unavailable_message", "low_stock_message", "institutional_text", "footer_text", "seo_title", "seo_description", "share_image_url", "product_share_text", "content_sections"
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
    await db.run("DELETE FROM catalog_banners");
    for (const banner of body.banners) {
      await db.run(
        `INSERT INTO catalog_banners (title, subtitle, image_url, button_text, button_link, banner_width, banner_height, banner_fit, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          banner.title || "Banner",
          banner.subtitle || "",
          banner.image_url || "",
          banner.button_text || "",
          banner.button_link || "",
          Number(banner.banner_width || 0),
          Number(banner.banner_height || 340),
          banner.banner_fit || "cover",
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
        `INSERT INTO catalog_featured_categories (category_id, public_name, icon, image_url, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [category.category_id || category.public_name || "categoria", category.public_name || category.category_id || "Categoria", category.icon || "gem", category.image_url || "", boolNumber(category.is_active), Number(category.sort_order || 0)]
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
  await db.run("DELETE FROM catalog_banners");
  await db.run("DELETE FROM catalog_featured_categories");
  await db.run("DELETE FROM catalog_featured_products");
  await db.run("DELETE FROM catalog_promotions");
  await db.run("DELETE FROM catalog_theme");
  await db.run("DELETE FROM catalog_settings");
  await db.run(
    `INSERT INTO catalog_theme
    (id, brand_name, slogan, logo_url, primary_color, secondary_color, background_color, button_color, title_font, body_font, theme, footer_text)
    VALUES (1, 'Aura Clinic', 'Piercing premium e joalherias selecionadas', '', '#C8A96A', '#D8C3A5', '#F8F5F0', '#C8A96A', 'Georgia', 'Inter', 'premium', 'Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.')`
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
      banner_fit: "cover",
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
