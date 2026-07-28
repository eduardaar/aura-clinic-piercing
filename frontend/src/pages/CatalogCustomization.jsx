import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, ImageIcon, Plus, Trash2 } from "lucide-react";
import { Loading, ApiError } from "../components/common/Feedback";
import { Input, Select, StatusBadge } from "../components/common/Ui";
import { ConfirmDeleteModal, Modal } from "../components/common/Crud";
import { DataView } from "../components/common/DataView";
import { API_ORIGIN, apiFetch, tenantSlug, useFetch } from "../lib/api";
import { asArray, asNumber, asObject } from "../lib/utils";
import { JEWELRY_CATEGORY_OPTIONS, defaultCatalogSettings } from "../lib/defaultForms";
import { catalogContentSections, cleanDisplayText, defaultContentSection } from "../features/catalog/catalogUtils";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// `formatDate` de lib/utils devolve dd/MM sem ano: cupons e promoções de anos
// diferentes ficariam com a mesma data na coluna de validade.
function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

// Intervalo início–fim tolerante a pontas vazias (o backend aceita as duas nulas).
function periodLabel(start, end, emptyLabel = "Sem prazo definido") {
  const from = formatDateWithYear(start);
  const to = formatDateWithYear(end);
  if (from && to) return `${from} até ${to}`;
  if (from) return `A partir de ${from}`;
  if (to) return `Até ${to}`;
  return emptyLabel;
}

const DISCOUNT_TYPE_LABELS = {
  percent: "Percentual",
  fixed: "Valor fixo",
  fixed_price: "Preço promocional",
  buy_x_pay_y: "Compre X, pague Y",
  quantity: "Por quantidade",
  progressive: "Progressivo"
};

const COUPON_STATUS_LABELS = { active: "Ativo", paused: "Pausado", inactive: "Inativo" };
const PROMOTION_STATUS_LABELS = { active: "Ativa", paused: "Pausada", ended: "Encerrada", inactive: "Inativa" };

const statusTone = (status) => (status === "active" ? "ok" : status === "paused" ? "warn" : "danger");

// Opções vindas dos próprios registros: nenhum filtro oferecido devolve lista
// vazia e valores legados (ex.: promoção com status "inactive") não somem.
const distinctOptions = (rows, pick, labels = {}) =>
  [...new Set(rows.map(pick).filter(Boolean))].sort().map((value) => ({ value, label: labels[value] || value }));

const discountLabel = (type, value) =>
  type === "percent" ? `${Number(value || 0)}%` : currency.format(Number(value || 0));

// O backend devolve null nos campos opcionais; `value={null}` transforma o
// <input> em não-controlado e o React reclama no console ao abrir a edição.
const withoutNulls = (record) =>
  Object.fromEntries(Object.entries(asObject(record)).map(([key, value]) => [key, value === null ? "" : value]));

function catalogImageUrl(url) {
  if (!url) return "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80";
  if (String(url).startsWith("/uploads/")) return `${API_ORIGIN}${url}`;
  return url;
}

// Links públicos ÚNICOS desta clínica (multi-tenant por ?t=<slug>). Cada
// catálogo/agendamento tem seu próprio endereço compartilhável.
function CatalogPublicLinks() {
  const slug = tenantSlug();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const links = [
    { label: "Catálogo online", url: `${origin}/catalogo?t=${slug}` },
    { label: "Agendamento online", url: `${origin}/agendar?t=${slug}` }
  ];
  const [copied, setCopied] = useState("");

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(""), 1800);
    } catch { /* clipboard indisponível: o usuário copia manualmente */ }
  }

  return (
    <section className="catalog-links">
      <div className="catalog-links-title">
        <strong>Seus links exclusivos</strong>
        <span>Código da clínica: <b>{slug}</b> — compartilhe estes endereços com seus clientes.</span>
      </div>
      <div className="catalog-links-grid">
        {links.map((item) => (
          <div key={item.url} className="catalog-link-row">
            <div>
              <span className="catalog-link-label">{item.label}</span>
              <code>{item.url}</code>
            </div>
            <div className="catalog-link-actions">
              <button type="button" className="secondary-button" onClick={() => copy(item.url)}>{copied === item.url ? "Copiado!" : "Copiar"}</button>
              <a className="primary-button" href={item.url} target="_blank" rel="noreferrer">Abrir</a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CatalogCustomization() {
  const { data, refresh } = useFetch("/catalog-customization");
  const [form, setForm] = useState(defaultCatalogCustomization());
  const [activeSection, setActiveSection] = useState("aparencia");
  const [previewDevice, setPreviewDevice] = useState("desktop");
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
            <span className="eyebrow">Catálogo</span>
            <h2>Personalização do Catálogo</h2>
            <p>Edite aparência, banners, categorias, produtos, promoções e textos sem mexer no código.</p>
          </div>
          <div>
            <button className="secondary-button" type="button" onClick={() => save("/catalog-customization/reset", "Padrão restaurado.")}>Restaurar padrão</button>
            <button className="primary-button" type="button" onClick={() => save("/catalog-customization/publish", "Catálogo publicado.")}>Publicar</button>
          </div>
        </header>

        <CatalogPublicLinks />

        <nav className="customization-tabs">
          {[
            ["aparencia", "Aparência"],
            ["layout", "Construtor"],
            ["banners", "Banners"],
            ["componentes", "Componentes"],
            ["categorias", "Categorias"],
            ["produtos", "Produtos"],
            ["promocoes", "Promoções"],
            ["cupons", "Cupons"],
            ["exibicao", "Exibição"],
            ["textos", "Textos"],
            ["contato", "Contato"],
            ["seo", "SEO"]
          ].map(([id, label]) => (
            <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)}>{label}</button>
          ))}
        </nav>

        {activeSection === "layout" && <CatalogLayoutBuilder form={form} setForm={setForm} />}

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
                  <div className="customization-actions">
                    <button type="button" disabled={!index} onClick={() => setForm({ ...form, featuredCategories: moveListItem(form.featuredCategories, index, -1) })}>Subir</button>
                    <button type="button" disabled={index === form.featuredCategories.length - 1} onClick={() => setForm({ ...form, featuredCategories: moveListItem(form.featuredCategories, index, 1) })}>Descer</button>
                  </div>
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
                    <Input type="number" label="Quantidade de produtos" value={category.product_limit || 12} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { product_limit: value }))} />
                    <Select label="Exibição" value={category.display_mode || "grid"} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { display_mode: value }))}><option value="grid">Grade</option><option value="carousel">Carrossel</option><option value="list">Lista</option></Select>
                    <Input type="color" label="Cor" value={category.color || "#C8A96A"} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { color: value }))} />
                    <Toggle label="Ativa" checked={category.is_active} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { is_active: value }))} />
                    <Toggle label="Destaque" checked={category.is_featured} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { is_featured: value }))} />
                  </div>
                  <label>Descrição<textarea value={category.description || ""} onChange={(event) => setForm(updateList(form, "featuredCategories", index, { description: event.target.value }))} /></label>
                  <ImageUploadField label="Imagem da categoria" value={category.image_url} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { image_url: value }))} />
                  <ImageUploadField label="Banner da categoria" value={category.banner_url} onChange={(value) => setForm(updateList(form, "featuredCategories", index, { banner_url: value }))} />
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

        {activeSection === "promocoes-legado" && (
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

        {activeSection === "promocoes" && <PromotionManager />}

        {activeSection === "cupons" && <CouponManager />}

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
              <Input label="Razão social" value={form.settings.company_legal_name} onChange={(value) => setForm(updateSettings(form, { company_legal_name: value }))} />
              <Input label="Nome de exibição" value={form.settings.company_display_name} onChange={(value) => setForm(updateSettings(form, { company_display_name: value }))} />
              <Input label="Telefone" value={form.settings.company_phone} onChange={(value) => setForm(updateSettings(form, { company_phone: value }))} />
              <Input label="WhatsApp com DDD" value={form.settings.whatsapp_phone} onChange={(value) => setForm(updateSettings(form, { whatsapp_phone: value }))} />
              <Input label="Instagram" value={form.settings.company_instagram} onChange={(value) => setForm(updateSettings(form, { company_instagram: value }))} />
              <Input type="email" label="E-mail" value={form.settings.company_email} onChange={(value) => setForm(updateSettings(form, { company_email: value }))} />
              <Input type="email" label="E-mail de suporte" value={form.settings.company_support_email} onChange={(value) => setForm(updateSettings(form, { company_support_email: value }))} />
              <Input label="Horário de Atendimento" value={form.settings.company_hours} onChange={(value) => setForm(updateSettings(form, { company_hours: value }))} />
              <Input label="Dias de atendimento" value={form.settings.company_service_days} onChange={(value) => setForm(updateSettings(form, { company_service_days: value }))} />
              <Input label="Site" value={form.settings.company_website} onChange={(value) => setForm(updateSettings(form, { company_website: value }))} />
              <Input label="Google Maps" value={form.settings.company_maps_url} onChange={(value) => setForm(updateSettings(form, { company_maps_url: value }))} />
            </div>
            <label>Descrição curta
              <textarea value={form.settings.company_short_description} onChange={(event) => setForm(updateSettings(form, { company_short_description: event.target.value }))} />
            </label>
            <label>Endereço
              <textarea value={form.settings.company_address} onChange={(event) => setForm(updateSettings(form, { company_address: event.target.value }))} placeholder="Rua, número, bairro, cidade e estado" />
            </label>
            <label>Mensagem Inicial do WhatsApp
              <textarea value={form.settings.whatsapp_message} onChange={(event) => setForm(updateSettings(form, { whatsapp_message: event.target.value }))} />
            </label>
            <div className="form-grid">
              <label>Política de atendimento<textarea value={form.settings.service_policy} onChange={(event) => setForm(updateSettings(form, { service_policy: event.target.value }))} /></label>
              <label>Política de sinal<textarea value={form.settings.deposit_policy} onChange={(event) => setForm(updateSettings(form, { deposit_policy: event.target.value }))} /></label>
              <label>Política de cancelamento<textarea value={form.settings.cancellation_policy} onChange={(event) => setForm(updateSettings(form, { cancellation_policy: event.target.value }))} /></label>
              <label>Política de troca<textarea value={form.settings.exchange_policy} onChange={(event) => setForm(updateSettings(form, { exchange_policy: event.target.value }))} /></label>
              <label>Biossegurança<textarea value={form.settings.biosafety_text} onChange={(event) => setForm(updateSettings(form, { biosafety_text: event.target.value }))} /></label>
              <label>Materiais<textarea value={form.settings.materials_text} onChange={(event) => setForm(updateSettings(form, { materials_text: event.target.value }))} /></label>
            </div>
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

      <CatalogCustomizationPreview form={form} products={products} device={previewDevice} onDeviceChange={setPreviewDevice} />
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

// A coluna esquerda desta tela divide espaço com a pré-visualização fixa. Sem
// `min-width: 0` o item de grid cresce até a largura mínima da tabela e passa
// por baixo do preview; com ele, a rolagem horizontal fica dentro da lista.
function ListWrap({ children }) {
  return <div style={{ minWidth: 0, maxWidth: "100%" }}>{children}</div>;
}

function CatalogLayoutBuilder({ form, setForm }) {
  const sections = asArray(form.catalogSections);
  function update(index, patch) {
    setForm({ ...form, catalogSections: sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...patch } : section) });
  }
  function add(type = "custom_content") {
    setForm({ ...form, catalogSections: [...sections, defaultCatalogSection(type, sections.length + 1)] });
  }
  function duplicate(index) {
    const copy = { ...sections[index], id: undefined, section_key: `${sections[index].section_type}-${Date.now()}`, title: `${sections[index].title || "Seção"} (cópia)` };
    const next = [...sections];
    next.splice(index + 1, 0, copy);
    setForm({ ...form, catalogSections: next.map((item, itemIndex) => ({ ...item, sort_order: itemIndex + 1 })) });
  }
  return (
    <CustomizationCard title="Construtor visual" action={
      <Select value="" onChange={(value) => value && add(value)}>
        <option value="">Adicionar seção</option>
        {CATALOG_SECTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
    }>
      <p className="customization-help">A ordem abaixo é a ordem da página pública. Salvar mantém rascunho; Publicar atualiza a vitrine.</p>
      <div className="custom-list">
        {sections.map((section, index) => (
          <article key={section.section_key}>
            <div className="panel-heading">
              <div><strong>{CATALOG_SECTION_TYPES.find(([value]) => value === section.section_type)?.[1] || section.section_type}</strong><small>Posição {index + 1}</small></div>
              <div className="customization-actions">
                <button type="button" disabled={!index} onClick={() => setForm({ ...form, catalogSections: moveListItem(sections, index, -1) })}>Subir</button>
                <button type="button" disabled={index === sections.length - 1} onClick={() => setForm({ ...form, catalogSections: moveListItem(sections, index, 1) })}>Descer</button>
                <button type="button" onClick={() => duplicate(index)}>Duplicar</button>
                <button type="button" className="danger-link" onClick={() => setForm({ ...form, catalogSections: sections.filter((_, itemIndex) => itemIndex !== index) })}>Excluir</button>
              </div>
            </div>
            <div className="form-grid">
              <Input label="Título" value={section.title} onChange={(value) => update(index, { title: value })} />
              <Input label="Subtítulo" value={section.subtitle} onChange={(value) => update(index, { subtitle: value })} />
              <Select label="Exibição" value={section.display_mode} onChange={(value) => update(index, { display_mode: value })}><option value="grid">Grade</option><option value="carousel">Carrossel</option><option value="list">Lista</option></Select>
              <Select label="Largura" value={section.width_mode} onChange={(value) => update(index, { width_mode: value })}><option value="contained">Limitada</option><option value="full">Total</option></Select>
              <Select label="Alinhamento" value={section.alignment} onChange={(value) => update(index, { alignment: value })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></Select>
              <Input type="number" label="Colunas" value={section.columns_count} onChange={(value) => update(index, { columns_count: value })} />
              <Input type="number" label="Quantidade de itens" value={section.item_limit} onChange={(value) => update(index, { item_limit: value })} />
              <Input type="number" label="Espaçamento" value={section.spacing} onChange={(value) => update(index, { spacing: value })} />
              <Input label="Fundo" value={section.background} onChange={(value) => update(index, { background: value })} />
              <Select label="Ordenação" value={section.product_sort} onChange={(value) => update(index, { product_sort: value })}><option value="recent">Recentes</option><option value="best_sellers">Mais vendidos</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="stock">Estoque</option><option value="manual">Manual</option></Select>
              <Input label="Filtro de categoria" value={section.category_filter} onChange={(value) => update(index, { category_filter: value })} />
              <Toggle label="Seção ativa" checked={section.is_active} onChange={(value) => update(index, { is_active: value })} />
            </div>
          </article>
        ))}
      </div>
    </CustomizationCard>
  );
}

function CouponManager() {
  const { data, refresh } = useFetch("/coupons");
  const [draft, setDraft] = useState(defaultCoupon());
  const [editingId, setEditingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const coupons = asArray(data);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const response = await apiFetch(editingId ? `/coupons/${editingId}` : "/coupons", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Não foi possível salvar o cupom.");
    setMessage(editingId ? "Cupom atualizado." : "Cupom criado.");
    setDraft(defaultCoupon());
    setEditingId(null);
    setModalOpen(false);
    refresh();
  }

  async function remove(coupon) {
    setError("");
    setMessage("");
    const response = await apiFetch(`/coupons/${coupon.id}`, { method: "DELETE" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Não foi possível excluir o cupom.");
    if (editingId === coupon.id) {
      setEditingId(null);
      setDraft(defaultCoupon());
      setModalOpen(false);
    }
    setMessage("Cupom removido.");
    refresh();
  }

  function openNew() {
    setEditingId(null);
    setDraft(defaultCoupon());
    setError("");
    setMessage("");
    setModalOpen(true);
  }

  function edit(coupon) {
    setEditingId(coupon.id);
    setDraft({
      ...defaultCoupon(),
      ...withoutNulls(coupon),
      starts_at: String(coupon.starts_at || "").slice(0, 16),
      ends_at: String(coupon.ends_at || "").slice(0, 16),
      first_purchase_only: Boolean(Number(coupon.first_purchase_only)),
      is_stackable: Boolean(Number(coupon.is_stackable))
    });
    setError("");
    setMessage("");
    setModalOpen(true);
  }

  return (
    <CustomizationCard
      title="Cupons de desconto"
      action={<button type="button" className="primary-button" onClick={openNew}><Plus size={16} /> Novo cupom</button>}
    >
      {data?.error && <ApiError message={data.error} />}
      {!modalOpen && error && <span className="form-error">{error}</span>}
      {message && <span className="form-success">{message}</span>}

      <ListWrap>
      <DataView
        rows={coupons}
        loading={!data}
        searchPlaceholder="Buscar por código, nome interno ou status"
        filters={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: distinctOptions(coupons, (coupon) => coupon.status, COUPON_STATUS_LABELS)
          },
          {
            key: "discount_type",
            label: "Tipo de desconto",
            type: "select",
            options: distinctOptions(coupons, (coupon) => coupon.discount_type, DISCOUNT_TYPE_LABELS)
          }
        ]}
        // Sem `defaultSort`: GET /coupons já devolve por criação desc
        // (ORDER BY created_at DESC), que é a ordenação padrão desejada.
        columns={[
          { key: "code", label: "Código", render: (coupon) => <strong>{coupon.code}</strong> },
          { key: "internal_name", label: "Nome interno", render: (coupon) => coupon.internal_name || "—" },
          {
            key: "discount_type",
            label: "Tipo de desconto",
            value: (coupon) => DISCOUNT_TYPE_LABELS[coupon.discount_type] || coupon.discount_type || "",
            render: (coupon) => DISCOUNT_TYPE_LABELS[coupon.discount_type] || coupon.discount_type || "—"
          },
          {
            key: "discount_value",
            label: "Valor",
            align: "right",
            value: (coupon) => Number(coupon.discount_value || 0),
            render: (coupon) => discountLabel(coupon.discount_type, coupon.discount_value)
          },
          {
            key: "usage_count",
            label: "Usos",
            align: "right",
            value: (coupon) => Number(coupon.usage_count || 0),
            render: (coupon) => `${Number(coupon.usage_count || 0)}${coupon.usage_limit ? ` de ${coupon.usage_limit}` : ""}`
          },
          {
            key: "status",
            label: "Status",
            value: (coupon) => COUPON_STATUS_LABELS[coupon.status] || coupon.status || "",
            render: (coupon) => (
              <StatusBadge tone={statusTone(coupon.status)}>{COUPON_STATUS_LABELS[coupon.status] || coupon.status}</StatusBadge>
            )
          },
          {
            key: "ends_at",
            label: "Validade",
            value: (coupon) => String(coupon.ends_at || ""),
            render: (coupon) => periodLabel(coupon.starts_at, coupon.ends_at, "Sem validade")
          }
        ]}
        actions={(coupon) => (
          <>
            <button type="button" onClick={() => edit(coupon)}>Editar</button>
            <button
              type="button"
              className="danger-link"
              onClick={() => setDeleting({ message: `Excluir o cupom ${coupon.code}?`, run: () => remove(coupon) })}
            >
              Excluir
            </button>
          </>
        )}
        empty="Nenhum cupom cadastrado ainda."
        emptyFiltered="Nenhum cupom corresponde à busca ou aos filtros."
      />
      </ListWrap>

      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />

      <Modal
        open={modalOpen}
        title={editingId ? "Editar cupom" : "Novo cupom"}
        subtitle="Regras de desconto aplicadas no catálogo"
        size="lg"
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" form="coupon-form" className="primary-button">{editingId ? "Salvar cupom" : "Criar cupom"}</button>
          </>
        )}
      >
      <form id="coupon-form" className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Input label="Código" value={draft.code} onChange={(value) => setDraft({ ...draft, code: value.toUpperCase() })} />
          <Input label="Nome interno" value={draft.internal_name} onChange={(value) => setDraft({ ...draft, internal_name: value })} />
          <Select label="Tipo" value={draft.discount_type} onChange={(value) => setDraft({ ...draft, discount_type: value })}>
            <option value="percent">Percentual</option>
            <option value="fixed">Valor fixo</option>
          </Select>
          <Input type="number" label="Desconto" value={draft.discount_value} onChange={(value) => setDraft({ ...draft, discount_value: value })} />
          <Input type="datetime-local" label="Início" value={draft.starts_at} onChange={(value) => setDraft({ ...draft, starts_at: value })} />
          <Input type="datetime-local" label="Fim" value={draft.ends_at} onChange={(value) => setDraft({ ...draft, ends_at: value })} />
          <Input type="number" label="Limite total" value={draft.usage_limit} onChange={(value) => setDraft({ ...draft, usage_limit: value })} />
          <Input type="number" label="Limite por cliente" value={draft.usage_limit_per_client} onChange={(value) => setDraft({ ...draft, usage_limit_per_client: value })} />
          <Input type="number" label="Compra mínima" value={draft.minimum_amount} onChange={(value) => setDraft({ ...draft, minimum_amount: value })} />
          <Input type="number" label="Desconto máximo" value={draft.maximum_discount} onChange={(value) => setDraft({ ...draft, maximum_discount: value })} />
          <Input label="IDs de produtos" value={draft.product_ids} onChange={(value) => setDraft({ ...draft, product_ids: value })} />
          <Input label="Categorias" value={draft.category_ids} onChange={(value) => setDraft({ ...draft, category_ids: value })} />
          <Input label="Produtos excluídos" value={draft.excluded_product_ids} onChange={(value) => setDraft({ ...draft, excluded_product_ids: value })} />
          <Input label="Categorias excluídas" value={draft.excluded_category_ids} onChange={(value) => setDraft({ ...draft, excluded_category_ids: value })} />
          <Select label="Status" value={draft.status} onChange={(value) => setDraft({ ...draft, status: value })}>
            <option value="active">Ativo</option>
            <option value="paused">Pausado</option>
            <option value="inactive">Inativo</option>
          </Select>
        </div>
        <label>Descrição
          <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <div className="form-grid">
          <Toggle label="Somente primeira compra" checked={draft.first_purchase_only} onChange={(value) => setDraft({ ...draft, first_purchase_only: value })} />
          <Toggle label="Permitir acumular" checked={draft.is_stackable} onChange={(value) => setDraft({ ...draft, is_stackable: value })} />
        </div>
        {error && <span className="form-error">{error}</span>}
      </form>
      </Modal>
    </CustomizationCard>
  );
}

function PromotionManager() {
  const { data, refresh } = useFetch("/promotions");
  const [draft, setDraft] = useState(defaultAdvancedPromotion());
  const [editingId, setEditingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [ending, setEnding] = useState(null);
  const [feedback, setFeedback] = useState({ error: "", success: "" });
  const promotions = asArray(data);

  async function request(path, options, success) {
    setFeedback({ error: "", success: "" });
    const response = await apiFetch(path, options);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setFeedback({ error: json.error || "Não foi possível concluir a operação.", success: "" });
      return null;
    }
    setFeedback({ error: "", success });
    refresh();
    return json;
  }

  async function submit(event) {
    event.preventDefault();
    const saved = await request(editingId ? `/promotions/${editingId}` : "/promotions", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    }, editingId ? "Promoção atualizada." : "Promoção criada.");
    if (saved) {
      setEditingId(null);
      setDraft(defaultAdvancedPromotion());
      setModalOpen(false);
    }
  }

  function openNew() {
    setEditingId(null);
    setDraft(defaultAdvancedPromotion());
    setFeedback({ error: "", success: "" });
    setModalOpen(true);
  }

  function edit(item) {
    setEditingId(item.id);
    setDraft({ ...defaultAdvancedPromotion(), ...withoutNulls(item), is_stackable: Boolean(Number(item.is_stackable)), stackable_with_coupon: Boolean(Number(item.stackable_with_coupon)), visible_in_catalog: Boolean(Number(item.visible_in_catalog)), is_active: Boolean(Number(item.is_active)) });
    setFeedback({ error: "", success: "" });
    setModalOpen(true);
  }

  return (
    <CustomizationCard
      title="Promoções avançadas"
      action={<button type="button" className="primary-button" onClick={openNew}><Plus size={16} /> Nova promoção</button>}
    >
      {data?.error && <ApiError message={data.error} />}
      {!modalOpen && feedback.error && <span className="form-error">{feedback.error}</span>}
      {feedback.success && <span className="form-success">{feedback.success}</span>}

      <ListWrap>
      <DataView
        rows={promotions}
        loading={!data}
        searchPlaceholder="Buscar por nome, tipo ou status"
        filters={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: distinctOptions(promotions, (promotion) => promotion.status, PROMOTION_STATUS_LABELS)
          },
          {
            key: "discount_type",
            label: "Tipo de desconto",
            type: "select",
            options: distinctOptions(promotions, (promotion) => promotion.discount_type, DISCOUNT_TYPE_LABELS)
          }
        ]}
        // Sem `defaultSort`: GET /promotions já devolve por prioridade desc e
        // criação desc, que é a ordem de aplicação real das campanhas.
        columns={[
          { key: "name", label: "Nome", render: (promotion) => <strong>{promotion.name}</strong> },
          {
            key: "discount_type",
            label: "Tipo",
            value: (promotion) => DISCOUNT_TYPE_LABELS[promotion.discount_type] || promotion.discount_type || "",
            render: (promotion) => DISCOUNT_TYPE_LABELS[promotion.discount_type] || promotion.discount_type || "—"
          },
          {
            key: "discount_value",
            label: "Valor",
            align: "right",
            value: (promotion) => Number(promotion.discount_value || 0),
            render: (promotion) => promotionValueLabel(promotion)
          },
          {
            key: "priority",
            label: "Prioridade",
            align: "right",
            value: (promotion) => Number(promotion.priority || 0),
            render: (promotion) => Number(promotion.priority || 0)
          },
          {
            key: "usage_count",
            label: "Usos",
            align: "right",
            value: (promotion) => Number(promotion.usage_count || 0),
            render: (promotion) => Number(promotion.usage_count || 0)
          },
          {
            key: "status",
            label: "Status",
            value: (promotion) => PROMOTION_STATUS_LABELS[promotion.status] || promotion.status || "",
            render: (promotion) => (
              <StatusBadge tone={statusTone(promotion.status)}>{PROMOTION_STATUS_LABELS[promotion.status] || promotion.status}</StatusBadge>
            )
          },
          {
            key: "end_date",
            label: "Período",
            value: (promotion) => String(promotion.end_date || ""),
            render: (promotion) => periodLabel(promotion.start_date, promotion.end_date, "Sem período definido")
          }
        ]}
        actions={(promotion) => (
          <>
            <button type="button" onClick={() => edit(promotion)}>Editar</button>
            <button type="button" onClick={() => request(`/promotions/${promotion.id}/duplicate`, { method: "POST" }, "Promoção duplicada.")}>Duplicar</button>
            <button
              type="button"
              className="danger-link"
              onClick={() => setEnding({
                message: `Excluir a promoção ${promotion.name}? Ela será encerrada e sai da lista de campanhas.`,
                run: () => request(`/promotions/${promotion.id}`, { method: "DELETE" }, "Promoção encerrada.")
              })}
            >
              Excluir
            </button>
          </>
        )}
        empty="Nenhuma promoção cadastrada ainda."
        emptyFiltered="Nenhuma promoção corresponde à busca ou aos filtros."
      />
      </ListWrap>

      <ConfirmDeleteModal
        open={!!ending}
        message={ending?.message}
        onClose={() => setEnding(null)}
        onConfirm={async () => { await ending.run(); setEnding(null); }}
      />

      <Modal
        open={modalOpen}
        title={editingId ? "Editar promoção" : "Nova promoção"}
        subtitle="Campanhas aplicadas automaticamente no catálogo"
        size="lg"
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" form="promotion-form" className="primary-button">{editingId ? "Salvar promoção" : "Criar promoção"}</button>
          </>
        )}
      >
      <form id="promotion-form" className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Input label="Nome" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <Select label="Tipo" value={draft.discount_type} onChange={(value) => setDraft({ ...draft, discount_type: value })}>
            <option value="percent">Percentual</option><option value="fixed">Valor fixo</option>
            <option value="fixed_price">Preço promocional</option><option value="buy_x_pay_y">Compre X, pague Y</option>
            <option value="quantity">Por quantidade</option><option value="progressive">Progressivo</option>
          </Select>
          <Input type="number" label="Valor/percentual" value={draft.discount_value} onChange={(value) => setDraft({ ...draft, discount_value: value })} />
          <Input type="number" label="Preço promocional" value={draft.fixed_promotional_price} onChange={(value) => setDraft({ ...draft, fixed_promotional_price: value })} />
          <Input type="number" label="Prioridade" value={draft.priority} onChange={(value) => setDraft({ ...draft, priority: value })} />
          <Select label="Status" value={draft.status} onChange={(value) => setDraft({ ...draft, status: value, is_active: value === "active" })}>
            <option value="active">Ativa</option><option value="paused">Pausada</option><option value="ended">Encerrada</option>
          </Select>
          <Input type="date" label="Início" value={draft.start_date || ""} onChange={(value) => setDraft({ ...draft, start_date: value })} />
          <Input type="date" label="Fim" value={draft.end_date || ""} onChange={(value) => setDraft({ ...draft, end_date: value })} />
          <Input type="time" label="Hora inicial" value={draft.start_time || ""} onChange={(value) => setDraft({ ...draft, start_time: value })} />
          <Input type="time" label="Hora final" value={draft.end_time || ""} onChange={(value) => setDraft({ ...draft, end_time: value })} />
          <Input type="number" label="Quantidade mínima" value={draft.minimum_quantity} onChange={(value) => setDraft({ ...draft, minimum_quantity: value })} />
          <Input type="number" label="Compra mínima" value={draft.minimum_amount} onChange={(value) => setDraft({ ...draft, minimum_amount: value })} />
          <Input type="number" label="Desconto máximo" value={draft.maximum_discount} onChange={(value) => setDraft({ ...draft, maximum_discount: value })} />
          <Input type="number" label="Compre X" value={draft.buy_quantity} onChange={(value) => setDraft({ ...draft, buy_quantity: value })} />
          <Input type="number" label="Pague Y" value={draft.pay_quantity} onChange={(value) => setDraft({ ...draft, pay_quantity: value })} />
          <Input label="Produtos incluídos" value={draft.product_ids} onChange={(value) => setDraft({ ...draft, product_ids: value })} />
          <Input label="Variações incluídas" value={draft.variation_ids} onChange={(value) => setDraft({ ...draft, variation_ids: value })} />
          <Input label="Categorias incluídas" value={draft.category_ids} onChange={(value) => setDraft({ ...draft, category_ids: value })} />
          <Input label="Produtos excluídos" value={draft.excluded_product_ids} onChange={(value) => setDraft({ ...draft, excluded_product_ids: value })} />
          <Input label="Categorias excluídas" value={draft.excluded_category_ids} onChange={(value) => setDraft({ ...draft, excluded_category_ids: value })} />
          <Input label="Cores" value={draft.colors} onChange={(value) => setDraft({ ...draft, colors: value })} />
          <Input label="Materiais" value={draft.materials} onChange={(value) => setDraft({ ...draft, materials: value })} />
          <Input label="Pedras" value={draft.stones} onChange={(value) => setDraft({ ...draft, stones: value })} />
          <Input label="Serviços" value={draft.service_ids} onChange={(value) => setDraft({ ...draft, service_ids: value })} />
          <Input label="Selo" value={draft.badge} onChange={(value) => setDraft({ ...draft, badge: value })} />
        </div>
        <label>Descrição<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>Texto legal<textarea value={draft.legal_text} onChange={(event) => setDraft({ ...draft, legal_text: event.target.value })} /></label>
        <div className="form-grid">
          <Toggle label="Pode acumular" checked={draft.is_stackable} onChange={(value) => setDraft({ ...draft, is_stackable: value })} />
          <Toggle label="Acumula com cupom" checked={draft.stackable_with_coupon} onChange={(value) => setDraft({ ...draft, stackable_with_coupon: value })} />
          <Toggle label="Visível no catálogo" checked={draft.visible_in_catalog} onChange={(value) => setDraft({ ...draft, visible_in_catalog: value })} />
        </div>
        {feedback.error && <span className="form-error">{feedback.error}</span>}
      </form>
      </Modal>
    </CustomizationCard>
  );
}

// O "valor" da promoção muda de significado conforme o tipo de desconto.
function promotionValueLabel(promotion) {
  if (promotion.discount_type === "fixed_price") return currency.format(Number(promotion.fixed_promotional_price || 0));
  if (promotion.discount_type === "buy_x_pay_y") return `Compre ${promotion.buy_quantity || 0}, pague ${promotion.pay_quantity || 0}`;
  return discountLabel(promotion.discount_type, promotion.discount_value);
}

export function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-field">
      <input type="checkbox" checked={Boolean(Number(checked))} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function CatalogCustomizationPreview({ form, products, device = "desktop", onDeviceChange }) {
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
    <aside className={`catalog-live-preview theme-${theme.theme} preview-${device}`} style={style}>
      <div className="preview-browser-bar">
        <span />
        <strong>Pré-visualização em tempo real</strong>
        <div className="preview-device-switcher">
          {["desktop", "tablet", "mobile"].map((item) => <button type="button" className={device === item ? "active" : ""} onClick={() => onDeviceChange(item)} key={item}>{item}</button>)}
        </div>
        <a href={`/catalogo?t=${tenantSlug()}`} target="_blank" rel="noreferrer">Abrir</a>
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
    ,
    catalogSections: (asArray(safeData.catalogSections).length ? asArray(safeData.catalogSections) : defaultCatalogSections()).map(normalizeBooleanRecord)
  };
}

function serializeCatalogCustomization(form) {
  const { promotions: _promotions, ...safeForm } = form;
  return {
    ...safeForm,
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
  return { category_id: "", public_name: "Nova categoria", icon: "gem", image_url: "", banner_url: "", description: "", display_mode: "grid", product_limit: 12, color: "#C8A96A", is_featured: false, is_active: true, sort_order: order };
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

function defaultCoupon() {
  return {
    code: "",
    internal_name: "",
    description: "",
    discount_type: "percent",
    discount_value: 10,
    starts_at: "",
    ends_at: "",
    usage_limit: "",
    usage_limit_per_client: 1,
    minimum_amount: 0,
    maximum_discount: "",
    product_ids: "",
    category_ids: "",
    excluded_product_ids: "",
    excluded_category_ids: "",
    first_purchase_only: false,
    is_stackable: false,
    status: "active"
  };
}

function defaultAdvancedPromotion() {
  return {
    name: "", description: "", status: "active", discount_type: "percent", discount_value: 10,
    priority: 0, start_date: "", end_date: "", start_time: "", end_time: "", minimum_amount: 0,
    maximum_discount: "", minimum_quantity: 1, product_ids: "", category_ids: "", variation_ids: "",
    excluded_product_ids: "", excluded_category_ids: "", excluded_variation_ids: "", colors: "", materials: "",
    stones: "", service_ids: "", buy_quantity: "", pay_quantity: "", fixed_promotional_price: "",
    is_stackable: false, stackable_with_coupon: false, badge: "", legal_text: "", visible_in_catalog: true,
    is_active: true
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
      materials_text: ""
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
    ,
    catalogSections: defaultCatalogSections()
  };
}

const CATALOG_SECTION_TYPES = [
  ["hero", "Banner principal"], ["secondary_banners", "Banners secundários"], ["categories", "Categorias"],
  ["featured_products", "Produtos em destaque"], ["best_sellers", "Mais vendidos"], ["new_products", "Novidades"],
  ["promotions", "Promoções"], ["premium_products", "Joias premium"], ["in_stock", "Em estoque"],
  ["out_of_stock", "Esgotados"], ["category_products", "Produtos por categoria"], ["services", "Serviços"],
  ["professionals", "Profissionais"], ["location", "Localização"], ["contact", "Contato"], ["policies", "Políticas"],
  ["biosafety", "Biossegurança"], ["materials", "Materiais"], ["testimonials", "Depoimentos"],
  ["instagram", "Instagram"], ["booking_cta", "Chamada para agendamento"], ["footer", "Rodapé"],
  ["custom_content", "Conteúdo personalizado"]
];

function defaultCatalogSection(sectionType, order) {
  const label = CATALOG_SECTION_TYPES.find(([value]) => value === sectionType)?.[1] || "Seção";
  return {
    section_key: `${sectionType}-${order}`, section_type: sectionType, title: label, subtitle: "", is_active: true,
    sort_order: order, alignment: "left", background: "", spacing: 24, item_limit: 8, display_mode: "grid",
    width_mode: "contained", height: "", columns_count: 4, image_ratio: "1:1", card_size: "medium",
    product_sort: sectionType === "best_sellers" ? "best_sellers" : "recent", category_filter: ""
  };
}

function defaultCatalogSections() {
  return ["hero", "categories", "featured_products", "best_sellers", "new_products", "promotions", "booking_cta", "location", "footer"]
    .map((type, index) => defaultCatalogSection(type, index + 1));
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
