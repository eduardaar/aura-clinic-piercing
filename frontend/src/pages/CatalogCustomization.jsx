import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Plus, Trash2 } from "lucide-react";
import { Loading, ApiError } from "../components/common/Feedback";
import { Input, Select } from "../components/common/Ui";
import { API_ORIGIN, apiFetch, useFetch } from "../lib/api";
import { asArray, asNumber, asObject } from "../lib/utils";
import { JEWELRY_CATEGORY_OPTIONS, defaultCatalogSettings } from "../lib/defaultForms";
import { cleanDisplayText } from "../features/catalog/catalogUtils";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function catalogImageUrl(url) {
  if (!url) return "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80";
  if (String(url).startsWith("/uploads/")) return `${API_ORIGIN}${url}`;
  return url;
}

export function CatalogCustomization() {
  const { data, refresh } = useFetch("/catalog-customization");
  const [form, setForm] = useState(defaultCatalogCustomization());
  const [activeSection, setActiveSection] = useState("aparencia");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data || data.error) return;
    setForm(normalizeCatalogCustomization(data));
  }, [data]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const safeData = asObject(data);
  const products = asArray(safeData.products);
  const customizationOptions = asObject(safeData.inventoryOptions);
  const categoryOptions = [
    ...asArray(customizationOptions.category).map((item) => item.name),
    ...new Set(products.map((item) => item.category).filter(Boolean))
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  async function save(path = "/catalog-customization", success = "Alterações salvas.") {
    setError("");
    setMessage("");
    const payload = serializeCatalogCustomization(form);
    const response = await apiFetch(path, {
      method: "POST" === path.split("/").at(-1) ? "POST" : path.includes("publish") || path.includes("reset") ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: path.includes("reset") ? undefined : JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Não foi possível salvar.");
    if (path.includes("reset")) setForm(normalizeCatalogCustomization(json));
    setMessage(success);
    refresh();
  }

  return (
    <section className="catalog-customization-page">
      <div className="catalog-customization-panel">
        <header className="customization-header">
          <div>
            <span className="eyebrow">Aura Clinic</span>
            <h2>Personalização do Catálogo</h2>
            <p>Edite aparência, banners, categorias, produtos, promoções e textos sem mexer no código.</p>
          </div>
          <div>
            <button className="secondary-button" type="button" onClick={() => save("/catalog-customization/reset", "Padrão restaurado.")}>Restaurar padrão</button>
            <button className="primary-button" type="button" onClick={() => save("/catalog-customization/publish", "Catálogo publicado.")}>Publicar</button>
          </div>
        </header>

        <nav className="customization-tabs">
          {[
            ["aparencia", "Aparência"],
            ["banners", "Banners"],
            ["componentes", "Componentes"],
            ["categorias", "Categorias"],
            ["produtos", "Produtos"],
            ["promocoes", "Promoções"],
            ["exibicao", "Exibição"],
            ["textos", "Textos"],
            ["contato", "Contato"],
            ["seo", "SEO"]
          ].map(([id, label]) => (
            <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)}>{label}</button>
          ))}
        </nav>

        {activeSection === "aparencia" && (
          <CustomizationCard title="Aparência do catálogo">
            <div className="form-grid">
              <ImageUploadField label="Logo" value={form.theme.logo_url} onChange={(value) => setForm(updateTheme(form, { logo_url: value }))} />
              <div className="form-grid compact-fields">
                <Input label="Nome da marca" value={form.theme.brand_name} onChange={(value) => setForm(updateTheme(form, { brand_name: value }))} />
                <Input label="Slogan" value={form.theme.slogan} onChange={(value) => setForm(updateTheme(form, { slogan: value }))} />
                <Input type="color" label="Cor principal" value={form.theme.primary_color} onChange={(value) => setForm(updateTheme(form, { primary_color: value }))} />
                <Input type="color" label="Cor secundária" value={form.theme.secondary_color} onChange={(value) => setForm(updateTheme(form, { secondary_color: value }))} />
                <Input type="color" label="Cor dos botões" value={form.theme.button_color} onChange={(value) => setForm(updateTheme(form, { button_color: value }))} />
                <Input type="color" label="Cor do fundo" value={form.theme.background_color} onChange={(value) => setForm(updateTheme(form, { background_color: value }))} />
                <Select label="Fonte do título" value={form.theme.title_font} onChange={(value) => setForm(updateTheme(form, { title_font: value }))}>
                  <option>Georgia</option><option>Playfair Display</option><option>Inter</option><option>Arial</option>
                </Select>
                <Select label="Fonte dos textos" value={form.theme.body_font} onChange={(value) => setForm(updateTheme(form, { body_font: value }))}>
                  <option>Inter</option><option>Arial</option><option>Georgia</option><option>Verdana</option>
                </Select>
                <Select label="Tema" value={form.theme.theme} onChange={(value) => setForm(updateTheme(form, { theme: value }))}>
                  <option value="claro">claro</option><option value="escuro">escuro</option><option value="premium">premium</option><option value="minimalista">minimalista</option>
                </Select>
              </div>
            </div>
          </CustomizationCard>
        )}

        {activeSection === "banners" && (
          <CustomizationCard title="Banner principal e carrossel" action={<div className="customization-actions"><button type="button" onClick={() => setForm({ ...form, banners: normalizeSortOrder(form.banners, "asc") })}>Ordem 1, 2, 3</button><button type="button" onClick={() => setForm({ ...form, banners: normalizeSortOrder(form.banners, "desc") })}>Inverter ordem</button><button type="button" onClick={() => setForm({ ...form, banners: [...form.banners, defaultCatalogBanner(form.banners.length + 1)] })}>Novo banner</button></div>}>
            <div className="custom-list">
              {form.banners.map((banner, index) => (
                <article key={index}>
                  <div className="custom-item-toolbar">
                    <strong>Banner {Number(banner.sort_order || index + 1)}</strong>
                    <span>
                      <button type="button" onClick={() => setForm({ ...form, banners: moveListItem(form.banners, index, -1) })}>Subir</button>
                      <button type="button" onClick={() => setForm({ ...form, banners: moveListItem(form.banners, index, 1) })}>Descer</button>
                    </span>
                  </div>
                  <ImageUploadField label="Imagem do banner" value={banner.image_url} onChange={(value) => setForm(updateList(form, "banners", index, { image_url: value }))} />
                  <div className="form-grid">
                    <Input label="Título" value={banner.title} onChange={(value) => setForm(updateList(form, "banners", index, { title: value }))} />
                    <Input label="Subtítulo" value={banner.subtitle} onChange={(value) => setForm(updateList(form, "banners", index, { subtitle: value }))} />
                  <Input label="Texto do botão" value={banner.button_text} onChange={(value) => setForm(updateList(form, "banners", index, { button_text: value }))} />
                  <Input label="Link do botão" value={banner.button_link} onChange={(value) => setForm(updateList(form, "banners", index, { button_link: value }))} />
                  <Input type="number" label="Altura do banner (px)" value={banner.banner_height} onChange={(value) => setForm(updateList(form, "banners", index, { banner_height: value }))} />
                  <Input type="number" label="Largura máxima (px)" value={banner.banner_width} onChange={(value) => setForm(updateList(form, "banners", index, { banner_width: value }))} />
                  <Select label="Enquadramento" value={banner.banner_fit || "cover"} onChange={(value) => setForm(updateList(form, "banners", index, { banner_fit: value }))}>
                    <option value="cover">Cobrir área</option>
                    <option value="contain">Mostrar inteira</option>
                    <option value="fill">Preencher</option>
                  </Select>
                  <Input type="number" label="Ordem" value={banner.sort_order} onChange={(value) => setForm(updateList(form, "banners", index, { sort_order: value }))} />
                  <Toggle label="Banner ativo" checked={banner.is_active} onChange={(value) => setForm(updateList(form, "banners", index, { is_active: value }))} />
                </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "banners", index))}>Remover banner</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "componentes" && (
          <CustomizationCard title="Componentes do catálogo" action={<button type="button" onClick={() => setForm({ ...form, contentSections: [...form.contentSections, defaultContentSection(form.contentSections.length + 1)] })}>Novo componente</button>}>
            <div className="custom-list">
              {form.contentSections.map((section, index) => (
                <article key={index}>
                  <div className="custom-item-toolbar">
                    <strong>Componente {Number(section.order || index + 1)}</strong>
                    <span>
                      <button type="button" onClick={() => setForm({ ...form, contentSections: moveListItem(form.contentSections, index, -1) })}>Subir</button>
                      <button type="button" onClick={() => setForm({ ...form, contentSections: moveListItem(form.contentSections, index, 1) })}>Descer</button>
                    </span>
                  </div>
                  <div className="form-grid">
                    <Input label="Etiqueta" value={section.kicker} onChange={(value) => setForm(updateList(form, "contentSections", index, { kicker: value }))} />
                    <Input label="Título" value={section.title} onChange={(value) => setForm(updateList(form, "contentSections", index, { title: value }))} />
                    <Input type="number" label="Ordem" value={section.order} onChange={(value) => setForm(updateList(form, "contentSections", index, { order: value }))} />
                    <Select label="Tipo de mídia" value={section.media_type} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_type: value }))}>
                      <option value="image">foto</option>
                      <option value="video">vídeo</option>
                      <option value="none">sem mídia</option>
                    </Select>
                    <Input label="Texto do botão" value={section.button_text} onChange={(value) => setForm(updateList(form, "contentSections", index, { button_text: value }))} />
                    <Input label="Link do botão" value={section.button_link} onChange={(value) => setForm(updateList(form, "contentSections", index, { button_link: value }))} />
                  </div>
                  {section.media_type === "image" ? <ImageUploadField label="Foto do componente" value={section.media_url} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_url: value }))} /> : <Input label="URL do vídeo incorporado" value={section.media_url} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_url: value }))} />}
                  <label>Texto
                    <textarea value={section.text} onChange={(event) => setForm(updateList(form, "contentSections", index, { text: event.target.value }))} />
                  </label>
                  <Toggle label="Componente ativo" checked={section.active} onChange={(value) => setForm(updateList(form, "contentSections", index, { active: value }))} />
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "contentSections", index))}>Remover componente</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "categorias" && (
          <CustomizationCard title="Categorias em destaque" action={<button type="button" onClick={() => setForm({ ...form, featuredCategories: [...form.featuredCategories, defaultFeaturedCategory(form.featuredCategories.length + 1)] })}>Nova categoria</button>}>
            <div className="custom-list">
              {form.featuredCategories.map((category, index) => (
                <article key={index}>
                  <div className="form-grid">
                    <Select label="Categoria do estoque" value={category.category_id} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { category_id: value }))}>
                      <option value="">Selecione</option>
                      {categoryOptions.map((option) => <option key={option}>{option}</option>)}
                    </Select>
                    <Input label="Nome público" value={category.public_name} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { public_name: value }))} />
                    <Select label="Ícone" value={category.icon} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { icon: value }))}>
                      <option value="gem">diamante</option><option value="heart">coração</option><option value="star">estrela</option><option value="sparkles">brilho</option><option value="shield">escudo</option>
                    </Select>
                    <Input type="number" label="Ordem" value={category.sort_order} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { sort_order: value }))} />
                    <Toggle label="Ativa" checked={category.is_active} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { is_active: value }))} />
                  </div>
                  <ImageUploadField label="Imagem da categoria" value={category.image_url} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { image_url: value }))} />
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "featuredCategories", index))}>Remover categoria</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "produtos" && (
          <CustomizationCard title="Produtos em destaque" action={<button type="button" onClick={() => setForm({ ...form, featuredProducts: [...form.featuredProducts, defaultFeaturedProduct()] })}>Adicionar produto</button>}>
            <div className="custom-list">
              {form.featuredProducts.map((product, index) => (
                <article key={index}>
                  <div className="form-grid">
                    <Select label="Produto" value={product.product_id} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { product_id: value }))}>
                      <option value="">Selecione</option>
                      {products.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </Select>
                    <Select label="Selo" value={product.badge} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { badge: value }))}>
                      <option value="">Sem selo</option><option value="Lançamento">Lançamento</option><option value="Mais vendido">Mais vendido</option><option value="Promoção">Promoção</option>
                    </Select>
                    <Input type="number" label="Ordem" value={product.sort_order} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { sort_order: value }))} />
                    <Toggle label="Ativo no catálogo" checked={product.is_active} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { is_active: value }))} />
                  </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "featuredProducts", index))}>Remover produto</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "promocoes" && (
          <CustomizationCard title="Promoções" action={<button type="button" onClick={() => setForm({ ...form, promotions: [...form.promotions, defaultPromotion()] })}>Nova promoção</button>}>
            <div className="custom-list">
              {form.promotions.map((promotion, index) => (
                <article key={index}>
                  <div className="form-grid">
                    <Input label="Nome da promoção" value={promotion.name} onChange={(value) => setForm(updateList(form, "promotions", index, { name: value }))} />
                    <Select label="Tipo de desconto" value={promotion.discount_type} onChange={(value) => setForm(updateList(form, "promotions", index, { discount_type: value }))}>
                      <option value="percent">porcentagem</option><option value="fixed">valor fixo</option>
                    </Select>
                    <Input type="number" label="Desconto" value={promotion.discount_value} onChange={(value) => setForm(updateList(form, "promotions", index, { discount_value: value }))} />
                    <Input type="date" label="Data inicial" value={promotion.start_date} onChange={(value) => setForm(updateList(form, "promotions", index, { start_date: value }))} />
                    <Input type="date" label="Data final" value={promotion.end_date} onChange={(value) => setForm(updateList(form, "promotions", index, { end_date: value }))} />
                    <Select label="Aplicar em" value={promotion.applies_to} onChange={(value) => setForm(updateList(form, "promotions", index, { applies_to: value }))}>
                      <option value="products">produtos específicos</option><option value="categories">categorias específicas</option><option value="all">todo catálogo</option>
                    </Select>
                    <Input label="IDs de produtos" value={promotion.product_ids} onChange={(value) => setForm(updateList(form, "promotions", index, { product_ids: value }))} />
                    <Input label="Categorias" value={promotion.category_ids} onChange={(value) => setForm(updateList(form, "promotions", index, { category_ids: value }))} />
                    <Toggle label="Promoção ativa" checked={promotion.is_active} onChange={(value) => setForm(updateList(form, "promotions", index, { is_active: value }))} />
                  </div>
                  <button type="button" className="danger-link" onClick={() => setForm(removeListItem(form, "promotions", index))}>Remover promoção</button>
                </article>
              ))}
            </div>
          </CustomizationCard>
        )}

        {activeSection === "exibicao" && (
          <CustomizationCard title="Configurações de exibição">
            <div className="toggle-grid">
              <Toggle label="Mostrar produtos sem estoque" checked={form.theme.show_out_of_stock} onChange={(value) => setForm(updateTheme(form, { show_out_of_stock: value }))} />
              <Toggle label="Mostrar quantidade em estoque" checked={form.theme.show_stock_quantity} onChange={(value) => setForm(updateTheme(form, { show_stock_quantity: value }))} />
              <Toggle label="Mostrar botão WhatsApp" checked={form.theme.show_whatsapp_button} onChange={(value) => setForm(updateTheme(form, { show_whatsapp_button: value }))} />
              <Toggle label="Mostrar botão Agendar" checked={form.theme.show_schedule_button} onChange={(value) => setForm(updateTheme(form, { show_schedule_button: value }))} />
              <Toggle label="Mostrar botão Comprar agora" checked={form.theme.show_buy_button} onChange={(value) => setForm(updateTheme(form, { show_buy_button: value }))} />
              <Toggle label="Mostrar favoritos" checked={form.theme.show_favorites} onChange={(value) => setForm(updateTheme(form, { show_favorites: value }))} />
            </div>
            <Select label="Texto de estoque" value={form.theme.stock_display_mode} onChange={(value) => setForm(updateTheme(form, { stock_display_mode: value }))}>
              <option value="status">Em estoque / Poucas unidades / Indisponível</option>
              <option value="quantity">Mostrar quantidade</option>
              <option value="hidden">Ocultar estoque</option>
            </Select>
          </CustomizationCard>
        )}

        {activeSection === "textos" && (
          <CustomizationCard title="Textos do catálogo">
            <div className="form-grid">
              <Input label="Título da página" value={form.settings.page_title} onChange={(value) => setForm(updateSettings(form, { page_title: value }))} />
              <Input label="Subtítulo" value={form.settings.subtitle} onChange={(value) => setForm(updateSettings(form, { subtitle: value }))} />
              <Input label="Mensagem indisponível" value={form.settings.unavailable_message} onChange={(value) => setForm(updateSettings(form, { unavailable_message: value }))} />
              <Input label="Mensagem poucas unidades" value={form.settings.low_stock_message} onChange={(value) => setForm(updateSettings(form, { low_stock_message: value }))} />
            </div>
            <label>Texto institucional
              <textarea value={form.settings.institutional_text} onChange={(event) => setForm(updateSettings(form, { institutional_text: event.target.value }))} />
            </label>
            <label>Texto do rodapé
              <textarea value={form.theme.footer_text} onChange={(event) => setForm(updateTheme(form, { footer_text: event.target.value }))} />
            </label>
          </CustomizationCard>
        )}

        {activeSection === "contato" && (
          <CustomizationCard title="Contato e Informações da Empresa">
            <p className="customization-help">Estes dados aparecem no rodapé do catálogo e nos botões de atendimento ao cliente.</p>
            <div className="form-grid">
              <Input label="WhatsApp com DDD" value={form.settings.whatsapp_phone} onChange={(value) => setForm(updateSettings(form, { whatsapp_phone: value }))} />
              <Input label="Instagram" value={form.settings.company_instagram} onChange={(value) => setForm(updateSettings(form, { company_instagram: value }))} />
              <Input type="email" label="E-mail" value={form.settings.company_email} onChange={(value) => setForm(updateSettings(form, { company_email: value }))} />
              <Input label="Horário de Atendimento" value={form.settings.company_hours} onChange={(value) => setForm(updateSettings(form, { company_hours: value }))} />
            </div>
            <label>Endereço
              <textarea value={form.settings.company_address} onChange={(event) => setForm(updateSettings(form, { company_address: event.target.value }))} placeholder="Rua, número, bairro, cidade e estado" />
            </label>
            <label>Mensagem Inicial do WhatsApp
              <textarea value={form.settings.whatsapp_message} onChange={(event) => setForm(updateSettings(form, { whatsapp_message: event.target.value }))} />
            </label>
          </CustomizationCard>
        )}

        {activeSection === "seo" && (
          <CustomizationCard title="SEO e compartilhamento">
            <div className="form-grid">
              <Input label="Título para Google" value={form.settings.seo_title} onChange={(value) => setForm(updateSettings(form, { seo_title: value }))} />
              <Input label="Descrição para Google" value={form.settings.seo_description} onChange={(value) => setForm(updateSettings(form, { seo_description: value }))} />
              <Input label="Texto padrão WhatsApp" value={form.settings.product_share_text} onChange={(value) => setForm(updateSettings(form, { product_share_text: value }))} />
              <ImageUploadField label="Imagem de compartilhamento" value={form.settings.share_image_url} onChange={(value) => setForm(updateSettings(form, { share_image_url: value }))} />
            </div>
          </CustomizationCard>
        )}

        {error && <span className="form-error">{error}</span>}
        {message && <span className="form-success">{message}</span>}
        <button className="primary-button customization-save" type="button" onClick={() => save()}>Salvar alterações</button>
      </div>

      <CatalogCustomizationPreview form={form} products={products} />
    </section>
  );
}

function CustomizationCard({ title, action, children }) {
  return (
    <article className="panel customization-card">
      <div className="panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </article>
  );
}

export function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-field">
      <input type="checkbox" checked={Boolean(Number(checked))} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function CatalogCustomizationPreview({ form, products }) {
  const safeForm = asObject(form);
  const theme = { ...defaultCatalogCustomization().theme, ...asObject(safeForm.theme) };
  const activeBanner = [...asArray(safeForm.banners)].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).find((banner) => Boolean(Number(banner.is_active))) || defaultCatalogBanner(1);
  const previewProducts = asArray(products).slice(0, 4);
  const style = {
    "--preview-primary": theme.primary_color,
    "--preview-secondary": theme.secondary_color,
    "--preview-bg": theme.background_color,
    "--preview-button": theme.button_color,
    fontFamily: theme.body_font
  };
  return (
    <aside className={`catalog-live-preview theme-${theme.theme}`} style={style}>
      <div className="preview-browser-bar">
        <span />
        <strong>Pré-visualização em tempo real</strong>
        <a href="/catalogo" target="_blank" rel="noreferrer">Abrir</a>
      </div>
      <div className="preview-storefront">
        <header>
          <div className="preview-brand">
            {theme.logo_url ? <img src={catalogImageUrl(theme.logo_url)} alt={theme.brand_name} /> : <strong>{theme.brand_name?.slice(0, 1) || "A"}</strong>}
            <span><b>{theme.brand_name}</b><small>{theme.slogan}</small></span>
          </div>
          {Boolean(Number(theme.show_favorites)) && <Heart size={18} />}
        </header>
        <section className="preview-banner" style={{ backgroundImage: `linear-gradient(90deg, rgba(255,255,255,.95), rgba(255,255,255,.48)), url(${catalogImageUrl(activeBanner.image_url)})`, minHeight: `${Number(activeBanner.banner_height || 340)}px`, maxWidth: activeBanner.banner_width ? `${Number(activeBanner.banner_width)}px` : "none", backgroundSize: activeBanner.banner_fit || "cover" }}>
          <h3 style={{ fontFamily: theme.title_font }}>{activeBanner.title}</h3>
          <p>{activeBanner.subtitle}</p>
          {activeBanner.button_text && <button>{activeBanner.button_text}</button>}
        </section>
        <div className="preview-categories">
          {form.featuredCategories.filter((item) => Boolean(Number(item.is_active))).slice(0, 6).map((category, index) => (
            <span key={`${category.public_name}-${index}`}>{category.public_name}</span>
          ))}
        </div>
        <section className="preview-products">
          {previewProducts.map((item) => (
            <article key={item.id}>
              <img src={catalogImageUrl(item.photo_url)} alt={item.name} />
              <strong>{item.name}</strong>
              <small>{item.material}</small>
              <span>{currency.format(item.sale_value || 0)}</span>
              {Boolean(Number(theme.show_schedule_button)) && <button>Agendar</button>}
            </article>
          ))}
        </section>
        <footer>{theme.footer_text}</footer>
      </div>
    </aside>
  );
}

function normalizeCatalogCustomization(data) {
  const safeData = asObject(data);
  const defaults = defaultCatalogCustomization();
  const settings = { ...defaults.settings, ...asObject(safeData.settings) };
  return {
    settings,
    theme: { ...defaults.theme, ...asObject(safeData.theme) },
    banners: (asArray(safeData.banners).length ? asArray(safeData.banners) : [defaultCatalogBanner(1)]).map((banner, index) => ({
      ...defaultCatalogBanner(index + 1),
      ...normalizeBooleanRecord(banner)
    })).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    contentSections: catalogContentSections(settings.content_sections),
    featuredCategories: (asArray(safeData.featuredCategories).length ? asArray(safeData.featuredCategories) : defaults.featuredCategories).map(normalizeBooleanRecord),
    featuredProducts: asArray(safeData.featuredProducts).map(normalizeBooleanRecord),
    promotions: asArray(safeData.promotions).map(normalizeBooleanRecord)
  };
}

function serializeCatalogCustomization(form) {
  return {
    ...form,
    settings: {
      ...form.settings,
      content_sections: JSON.stringify(asArray(form.contentSections).map((section, index) => ({
        ...section,
        order: Number(section.order || index + 1),
        active: Boolean(section.active)
      })))
    }
  };
}

function normalizeBooleanRecord(item) {
  return { ...item, is_active: Boolean(Number(item.is_active)) };
}

function updateTheme(form, patch) {
  return { ...form, theme: { ...form.theme, ...patch } };
}

function updateSettings(form, patch) {
  return { ...form, settings: { ...form.settings, ...patch } };
}

function updateList(form, key, index, patch) {
  return { ...form, [key]: asArray(form?.[key]).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) };
}

function removeListItem(form, key, index) {
  return { ...form, [key]: asArray(form?.[key]).filter((_, itemIndex) => itemIndex !== index) };
}

function moveListItem(list, index, direction) {
  const safeList = asArray(list);
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= safeList.length) return safeList;
  const copy = [...safeList];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item);
  return copy.map((entry, itemIndex) => ({ ...entry, sort_order: itemIndex + 1, order: itemIndex + 1 }));
}

function normalizeSortOrder(list, mode = "asc") {
  const sorted = [...asArray(list)].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const arranged = mode === "desc" ? sorted.reverse() : sorted;
  return arranged.map((entry, index) => ({ ...entry, sort_order: index + 1 }));
}

function defaultCatalogBanner(order) {
  return {
    title: "Escolha a joia perfeita para você",
    subtitle: "Joias de alta qualidade para realçar sua essência.",
    image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    button_text: "Ver todas as joias",
    button_link: "#catalog-products",
    banner_width: 0,
    banner_height: 340,
    banner_fit: "cover",
    is_active: true,
    sort_order: order
  };
}

function defaultFeaturedCategory(order) {
  return { category_id: "", public_name: "Nova categoria", icon: "gem", image_url: "", is_active: true, sort_order: order };
}

function defaultFeaturedProduct() {
  return { product_id: "", badge: "", is_active: true, sort_order: 1 };
}

function defaultPromotion() {
  return {
    name: "Campanha Aura",
    discount_type: "percent",
    discount_value: 10,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    applies_to: "products",
    product_ids: "",
    category_ids: "",
    is_active: true
  };
}

function defaultContentSection(order) {
  return {
    kicker: "Guia Aura",
    title: "Escolha sua joia com orientação profissional",
    text: "Use este espaço para explicar materiais, cuidados, medidas, anodização, curadoria ou diferenciais da Aura Clinic.",
    media_type: "image",
    media_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    button_text: "Agendar atendimento",
    button_link: "/agendar",
    active: true,
    order
  };
}

function defaultCatalogCustomization() {
  return {
    settings: {
      page_title: "Catálogo Online",
      title: "Escolha a joia perfeita para você",
      subtitle: "Curadoria premium da Aura Clinic Piercing",
      institutional_text: "Joias selecionadas com cuidado, segurança e estética premium.",
      unavailable_message: "Produto indisponível no momento.",
      low_stock_message: "Poucas unidades",
      footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.",
      seo_title: "Aura Clinic Piercing | Catálogo Online",
      seo_description: "Escolha joias premium para piercing na Aura Clinic.",
      share_image_url: "",
      product_share_text: "Olha essa joia da Aura Clinic:",
      content_sections: JSON.stringify([defaultContentSection(1)]),
      categories: `Todos,${JEWELRY_CATEGORY_OPTIONS.join(",")}`,
      whatsapp_phone: "",
      whatsapp_message: "Olá! Vim pelo catálogo online da Aura Clinic e quero ajuda para escolher uma joia.",
      company_instagram: "",
      company_email: "",
      company_address: "",
      company_hours: ""
    },
    theme: {
      brand_name: "Aura Clinic",
      slogan: "Piercing premium e joalherias selecionadas",
      logo_url: "",
      primary_color: "#C8A96A",
      secondary_color: "#D8C3A5",
      background_color: "#F8F5F0",
      button_color: "#C8A96A",
      title_font: "Georgia",
      body_font: "Inter",
      theme: "premium",
      show_out_of_stock: false,
      show_stock_quantity: false,
      stock_display_mode: "status",
      show_whatsapp_button: true,
      show_schedule_button: true,
      show_buy_button: false,
      show_favorites: true,
      footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado."
    },
    banners: [defaultCatalogBanner(1)],
    contentSections: [defaultContentSection(1)],
    featuredCategories: JEWELRY_CATEGORY_OPTIONS.map((name, index) => ({ category_id: name, public_name: name, icon: "gem", image_url: "", is_active: true, sort_order: index + 1 })),
    featuredProducts: [],
    promotions: []
  };
}

export function ImageUploadField({ label, value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function uploadImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setUploading(true);
  setError("");

  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiFetch("/uploads", {
      method: "POST",
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Upload invalido.");
    onChange(data.url);
  } catch (err) {
    console.error(err);
    setError("Não foi possível enviar a imagem.");
  } finally {
    setUploading(false);
    event.target.value = "";
  }
}
  return (
    <label className="image-upload-field">{label}
      <div className="image-upload-preview">
        <img src={catalogImageUrl(value)} alt={label} />
        <span><ImageIcon size={18} /> Prévia da imagem</span>
      </div>
      <input value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder="Cole a URL da imagem ou envie um arquivo" />
      <input type="file" accept="image/*" onChange={uploadImage} />
      {uploading && <small>Enviando imagem...</small>}
      {error && <span className="form-error">{error}</span>}
    </label>
  );
}
