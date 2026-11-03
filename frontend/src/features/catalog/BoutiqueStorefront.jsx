import { useEffect, useRef } from "react";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Clock, Gem, Heart, Instagram, MapPin, MessageCircle, Search, ShieldCheck, ShoppingCart, Star } from "lucide-react";
import { Modal } from "../../components/common/Crud";
import { imageTransformStyle, normalizeImageTransform } from "../../components/common/ImageEditor";
import { CatalogCampaignBand, CatalogCategoryTree, campaignUrl } from "./CatalogCollections";
import { CatalogNativePlugins } from "./CatalogNativePlugins";
import { catalogCategoryTerms, cleanDisplayText } from "./catalogUtils";
import { categoryDescendantIds, itemInCategory } from "../../lib/catalogNavigation";
import { catalogUrl, publicUrl } from "../../lib/publicRoutes";
import { asArray, removeAccents } from "../../lib/utils";
import { boutiqueConfig, boutiqueStyle } from "./boutiqueConfig";

const icons = { gem: Gem, heart: Heart, shield: ShieldCheck, message: MessageCircle, star: Star, clock: Clock, map: MapPin, instagram: Instagram };
const parse = (value) => { try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return {}; } };

function Announcement({ config: c, href }) {
  if (!c.announcement_enabled) return null;
  return <div className="boutique-announcement">{c.announcement_text && <span>{c.announcement_text}</span>}{c.announcement_link_label && href && <a {...href}>{c.announcement_link_label}<ArrowRight size={12} /></a>}</div>;
}

/** @param {Record<string, any>} props */
function Header({ config: c, brand, theme, settings, links, search, setSearch, categories, activeCategory, chooseCategory, favoriteIds, onOpenFavorites, onOpenOrder, orderCount, navigation, resolveLink }) {
  const headerRef = useRef(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === "undefined") return undefined;
    const updateOffset = () => header.closest(".theme-boutique")?.style.setProperty("--boutique-anchor-offset", c.header_sticky ? `${header.getBoundingClientRect().height + 16}px` : "16px");
    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    updateOffset();
    return () => observer.disconnect();
  }, [c.header_sticky]);
  return <header ref={headerRef} className={`boutique-header${c.header_sticky ? " is-sticky" : ""}`}>
    <div className={`boutique-header-inner${c.header_show_search ? " has-search" : ""}`}>
      {(c.header_show_logo || c.header_show_name || c.header_show_slogan) && <a className="boutique-brand" href={catalogUrl()} aria-label={brand}>
        {c.header_show_logo && theme.logo_url && <img src={links.image(theme.logo_url)} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
        <span>{c.header_show_name && <strong>{brand}</strong>}{c.header_show_slogan && (theme.slogan || c.header_signature) && <small>{theme.slogan || c.header_signature}</small>}</span>
      </a>}
      {c.header_show_search && <label className="boutique-search"><Search size={18} /><input aria-label="Buscar no catálogo" placeholder={c.search_placeholder} value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}>×</button>}</label>}
      <div className="boutique-header-actions">
        {c.header_show_contact && settings.whatsapp_phone && <a className="boutique-contact" {...resolveLink("@whatsapp")}><MessageCircle size={19} />{c.contact_label && <span>{c.contact_label}</span>}</a>}
        {Number(theme.show_favorites ?? 1) !== 0 && <button type="button" aria-label="Favoritos" className="boutique-header-action" onClick={onOpenFavorites}><Heart size={20} />{favoriteIds.length > 0 && <span>{favoriteIds.length}</span>}</button>}
        {Number(theme.show_buy_button ?? 1) !== 0 && <button type="button" aria-label="Carrinho" className="boutique-header-action boutique-bag" onClick={onOpenOrder}><ShoppingCart size={20} /><span>{orderCount}</span></button>}
      </div>
    </div>
    {c.navigation_enabled && <nav className="boutique-navigation" aria-label="Categorias de joias"><div>
      {c.navigation_show_categories && categories.map((category) => { const value = category.value || category.name; return <button key={value} type="button" className={activeCategory === value ? "active" : ""} aria-pressed={activeCategory === value} onClick={() => chooseCategory(value)}>{cleanDisplayText(category.name)}</button>; })}
      {c.navigation_show_tree && navigation.enabled && <button type="button" onClick={navigation.openTree}>{c.navigation_tree_label}<ChevronDown size={13} /></button>}
      {c.navigation_show_campaigns && asArray(navigation.navCampaigns).map((campaign) => <a key={campaign.id} href={campaignUrl(campaign.slug)}>{campaign.title}</a>)}
      {c.navigation_links.filter((link) => link.label && resolveLink(link.url)).map((link) => <a key={link.id} {...resolveLink(link.url)}>{link.label}</a>)}
    </div></nav>}
  </header>;
}

/** @param {Record<string, any>} props */
function Hero({ config: c, settings, banners, activeBanner, activeBannerIndex, onBannerChange, links, resolveLink, sectionId }) {
  const image = activeBanner.image_url || settings.hero_image_url;
  const title = activeBanner.title || settings.hero_title || "";
  const subtitle = activeBanner.subtitle || settings.hero_subtitle || settings.subtitle || "";
  const transform = normalizeImageTransform(parse(activeBanner.image_transform));
  return <section id={sectionId} data-layout={c.hero_layout} data-mobile-layout={c.hero_mobile_layout} className="boutique-hero" aria-label="Destaques do catálogo" aria-roledescription={banners.length > 1 ? "carrossel" : undefined}><div className="boutique-hero-inner">
    <div className="boutique-hero-copy">{c.hero_kicker && <span>{c.hero_kicker}</span>}{c.hero_show_title && title && <h1>{title}</h1>}{c.hero_show_subtitle && subtitle && <p>{subtitle}</p>}{c.hero_show_button && (activeBanner.button_text || c.hero_button_fallback) && resolveLink(activeBanner.button_link || c.hero_button_url) && <a {...resolveLink(activeBanner.button_link || c.hero_button_url)} className="boutique-primary-link">{activeBanner.button_text || c.hero_button_fallback}<ArrowRight size={16} /></a>}{c.hero_note && <small>{c.hero_note}</small>}</div>
    {image && <div className="boutique-hero-media"><picture>{activeBanner.mobile_image_url && <source media="(max-width: 767px)" srcSet={links.image(activeBanner.mobile_image_url)} />}<img src={links.image(image)} alt={activeBanner.alt_text || title} width="900" height="900" fetchPriority="high" style={imageTransformStyle(transform)} onError={links.fallback} /></picture></div>}
    {banners.length > 1 && <div className="boutique-hero-controls"><button type="button" aria-label="Banner anterior" onClick={() => onBannerChange((activeBannerIndex - 1 + banners.length) % banners.length)}><ChevronLeft size={18} /></button><span>{activeBannerIndex + 1} / {banners.length}</span><button type="button" aria-label="Próximo banner" onClick={() => onBannerChange((activeBannerIndex + 1) % banners.length)}><ChevronRight size={18} /></button></div>}
  </div></section>;
}

function Benefits({ config: c, resolveLink, sectionId }) {
  const items = c.benefits.filter((item) => item.enabled && (item.title || item.text) && (item.url !== "@whatsapp" || resolveLink(item.url)));
  if (!items.length) return null;
  return <div id={sectionId} className="boutique-benefits">{items.map((item) => { const Icon = icons[item.icon] || Gem; const content = <><Icon /><span>{item.title && <strong>{item.title}</strong>}{item.text && <small>{item.text}</small>}</span></>; const href = resolveLink(item.url); return href ? <a key={item.id} {...href}>{content}</a> : <div key={item.id}>{content}</div>; })}</div>;
}

/** @param {Record<string, any>} props */
function Categories({ config: c, categories, chooseCategory, links, resolveLink, sectionId }) {
  if (!categories.length) return null;
  return <section id={sectionId} className="boutique-categories boutique-section-contained"><div className="boutique-section-heading"><div>{c.categories_kicker && <span className="eyebrow">{c.categories_kicker}</span>}{c.categories_title && <h2>{c.categories_title}</h2>}{c.categories_description && <p>{c.categories_description}</p>}</div>{c.categories_link_label && resolveLink(c.categories_link_url) && <a {...resolveLink(c.categories_link_url)}>{c.categories_link_label}<ArrowRight size={15} /></a>}</div><div className="boutique-category-grid">{categories.map((category) => <button key={category.value || category.name} type="button" onClick={() => chooseCategory(category.value || category.name)}><img src={links.image(category.image_url || category.product?.photo_url || category.product?.image_url)} alt="" loading="lazy" width="240" height="240" onError={links.fallback} /><span>{cleanDisplayText(category.name)}<ArrowRight size={16} /></span></button>)}</div></section>;
}

/** @param {Record<string, any>} props */
function Footer({ config: c, settings, theme, brand, categories, chooseCategory, footerLogo, footerDisplayName, links, resolveLink, sectionId }) {
  if (settings.footer_enabled === "0") return null;
  const columns = c.footer_columns.filter((column) => column.enabled);
  return <footer id={sectionId} className="boutique-footer"><div className="boutique-footer-grid" style={/** @type {React.CSSProperties} */ ({ "--boutique-footer-columns": Math.max(columns.length, 1) })}>
    {columns.map((column) => <div key={column.id} className={column.type === "brand" ? "boutique-footer-brand" : ""}>
      {column.type === "brand" ? settings.footer_show_business_name !== "0" && <strong>{column.title || footerDisplayName || brand}</strong> : column.title && <h2>{column.title}</h2>}
      {(column.text || (column.type === "brand" ? settings.institutional_text : "")) && <p>{column.text || settings.institutional_text}</p>}{column.type === "location" && settings.company_address && <p>{settings.company_address}</p>}
      {column.type === "brand" && settings.footer_show_slogan !== "0" && (settings.footer_slogan || theme.slogan) && <p>{settings.footer_slogan || theme.slogan}</p>}
      {column.type === "categories" && categories.filter((category) => category.name !== "Todos").slice(0, c.categories_limit).map((category) => <button type="button" key={category.value || category.name} onClick={() => chooseCategory(category.value || category.name)}>{cleanDisplayText(category.name)}</button>)}
      {column.type === "contact" && <>{c.footer_show_whatsapp && c.footer_whatsapp_label && settings.whatsapp_phone && <a {...resolveLink("@whatsapp")}>{c.footer_whatsapp_label}<ArrowRight size={13} /></a>}{c.footer_show_email && links.mail(settings.company_email) && <a href={links.mail(settings.company_email)}>{settings.company_email}</a>}{c.footer_show_schedule && c.footer_schedule_label && Number(theme.show_schedule_button ?? 1) !== 0 && <a href={publicUrl("/agendar")}>{c.footer_schedule_label}</a>}{c.footer_show_hours && settings.company_hours && <p>{settings.company_hours}</p>}</>}
      {column.type === "location" && c.footer_show_maps && c.footer_maps_label && settings.company_address && <a {...links.props(settings.company_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.company_address)}`)}>{c.footer_maps_label}<ArrowRight size={13} /></a>}
      {column.show_instagram && c.footer_instagram_label && settings.company_instagram && <a href={links.instagram(settings.company_instagram)} target="_blank" rel="noreferrer"><Instagram size={18} />{c.footer_instagram_label}</a>}
      {column.links.filter((link) => link.label && resolveLink(link.url)).map((link) => <a key={link.id} {...resolveLink(link.url)}>{link.label}</a>)}
      {column.show_logo && footerLogo && <img className="boutique-footer-logo" src={links.image(footerLogo)} alt="" loading="lazy" />}
    </div>)}
  </div>{(c.footer_bottom_text || c.footer_bottom_note) && <div className="boutique-footer-bottom">{c.footer_bottom_text && <span>{c.footer_bottom_text.replaceAll("{brand}", brand)}</span>}{c.footer_bottom_note && <span>{c.footer_bottom_note}</span>}</div>}</footer>;
}

/** @param {Record<string, any>} props */
function CustomContent({ section, links, resolveLink }) {
  if (!section.title && !section.text && !section.image_url && !section.link_label) return null;
  return <section id={section.id} className="boutique-custom-content boutique-section-contained">{section.image_url && <img src={links.image(section.image_url)} alt="" loading="lazy" onError={links.fallback} />}<div>{section.title && <h2>{section.title}</h2>}{section.text && <p>{section.text}</p>}{section.link_label && resolveLink(section.link_url) && <a className="boutique-primary-link" {...resolveLink(section.link_url)}>{section.link_label}<ArrowRight size={16} /></a>}</div></section>;
}

/** @param {Record<string, any>} props */
export function CatalogBoutiqueHome(props) {
  const { data, theme, settings, catalogStyle, categories, publishedItems, activeCategory, setActiveCategory, productsRef, commercialNavigation: navigation, campaigns, categoryTreeOpen, onCloseTree, drawerContent, links, renderProducts } = props;
  const c = boutiqueConfig(settings.boutique_config);
  const brand = theme.brand_name || settings.company_display_name || data.brand_name || "Estúdio";
  const chooseCategory = (value) => { setActiveCategory(value); requestAnimationFrame(() => productsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const resolveLink = (url) => !url ? null : url === "@whatsapp" ? settings.whatsapp_phone ? { href: links.whatsapp(settings.whatsapp_message, settings.whatsapp_phone), target: "_blank", rel: "noreferrer" } : null : /^(mailto:|tel:)/.test(url) ? { href: url } : links.props(url);
  const categoryProduct = (category) => publishedItems.find((item) => { const definition = asArray(data.catalogCategories).find((node) => node.slug === category.value); return definition ? itemInCategory(item, categoryDescendantIds(data.catalogCategories, definition.id)) : catalogCategoryTerms(category.match || category.name).some((term) => removeAccents(`${item.category} ${item.subcategory}`.toLowerCase()).includes(term)); });
  const orderedCategories = c.category_keys.length ? c.category_keys.map((key) => categories.find((category) => (category.value || category.name) === key) || asArray(data.catalogCategories).filter((node) => node.slug === key).map((node) => ({ ...node, value: node.slug }))[0]).filter(Boolean) : categories;
  const quickCategories = orderedCategories.filter((category) => category.name !== "Todos").map((category) => ({ ...category, product: c.categories_use_product_image ? categoryProduct(category) : null })).filter((category) => c.category_keys.length || !c.categories_use_product_image || category.image_url || category.product).slice(0, c.categories_limit);
  const filtered = c.hide_presentation_when_filtered && navigation.activeFilterCount > 0;
  const shared = { ...props, config: c, brand, chooseCategory, resolveLink, navigation };
  const presentation = new Set(["hero", "benefits", "categories", "campaigns"]);
  return <main className="catalog-page theme-boutique" style={{ ...catalogStyle, ...boutiqueStyle(c, settings, theme) }}>
    <Announcement config={c} href={c.announcement_link_url === "/agendar" && Number(theme.show_schedule_button ?? 1) === 0 ? null : resolveLink(c.announcement_link_url)} />
    <Header {...shared} />
    <div className="boutique-page-sections">{c.sections.filter((section) => section.enabled && !(filtered && presentation.has(section.type))).map((section) => {
      const block = { ...shared, sectionId: section.id };
      switch (section.type) {
        case "hero": return <Hero {...block} key={section.id} />;
        case "benefits": return <Benefits {...block} key={section.id} />;
        case "categories": return <Categories {...block} categories={quickCategories} key={section.id} />;
        case "campaigns": return campaigns.length ? <div id={section.id} className="boutique-section-contained" key={section.id}><CatalogCampaignBand campaigns={campaigns} /></div> : null;
        case "products": return <section id={section.id} className="boutique-products-section boutique-section-contained" key={section.id}>{asArray(navigation.children).length > 0 && <div className="boutique-subcategories" aria-label="Subcategorias">{navigation.children.map((category) => <button type="button" key={category.id} onClick={() => chooseCategory(category.slug)}>{category.name}<ChevronRight size={13} /></button>)}</div>}{renderProducts(c)}</section>;
        case "plugins": return asArray(data.plugins).some((plugin) => plugin.enabled !== false) ? <div id={section.id} className="boutique-section-contained" key={section.id}><CatalogNativePlugins plugins={data.plugins} settings={settings} theme={theme} /></div> : null;
        case "footer": return <Footer {...block} key={section.id} />;
        case "custom": return <CustomContent {...block} section={section} key={section.id} />;
        default: return null;
      }
    })}</div>
    {navigation.enabled && <Modal open={categoryTreeOpen} title="Categorias" subtitle="Escolha uma categoria ou subcategoria" dismissible confirmClose={false} onClose={onCloseTree}><CatalogCategoryTree tree={navigation.tree} activeSlug={activeCategory} onSelect={(slug) => { chooseCategory(slug); onCloseTree(); }} /></Modal>}
    {Number(theme.show_whatsapp_button ?? 1) !== 0 && settings.whatsapp_phone && <a className="floating-whatsapp" {...resolveLink("@whatsapp")} aria-label="Fale com a equipe pelo WhatsApp"><MessageCircle size={23} />{c.floating_contact_label && <span>{c.floating_contact_label}</span>}</a>}
    {drawerContent}
  </main>;
}
