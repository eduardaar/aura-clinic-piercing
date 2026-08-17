import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, ImageIcon, Plus, Redo2, Undo2 } from "lucide-react";
import { Loading, ApiError } from "../components/common/Feedback";
import { Checkbox, Input, Select, StatusBadge } from "../components/common/Ui";
import { ConfirmDeleteModal, Modal, RowActions } from "../components/common/Crud";
import { DataView } from "../components/common/DataView";
import { API_ORIGIN, apiFetch, tenantSlug, useFetch } from "../lib/api";
import { asArray, asObject } from "../lib/utils";
import { JEWELRY_CATEGORY_OPTIONS } from "../lib/defaultForms";
import { catalogContentSections, defaultContentSection } from "../features/catalog/catalogUtils";
import { CatalogPluginEditor } from "../features/catalog/CatalogPluginEditor";
import { DEFAULT_IMAGE_TRANSFORM, ImageEditor, imageTransformStyle, normalizeImageTransform } from "../components/common/ImageEditor";
import { SmartCombobox } from "../components/common/SmartCombobox";
import { publicLinkForTenant } from "../lib/publicRoutes";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Histórico só vive no navegador: rascunhos continuam sendo a fonte de
// verdade no servidor, mas desfazer uma edição cotidiana não deve exigir uma
// viagem de ida e volta. Mantemos cópias sem referências compartilhadas, pois
// vários campos do construtor são objetos aninhados.
function cloneCatalogDraft(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameCatalogDraft(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

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
  const links = slug ? [
    { label: "Catálogo online", url: publicLinkForTenant("/catalogo", slug, origin) },
    { label: "Agendamento online", url: publicLinkForTenant("/agendar", slug, origin) }
  ] : [];
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
        {!links.length && <span className="form-error">Cadastre um slug público para compartilhar catálogo e agendamento.</span>}
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
  const { data: historyData, refresh: refreshHistory } = useFetch("/catalog-customization/history");
  const [form, setFormState] = useState(defaultCatalogCustomization());
  const [activeSection, setActiveSection] = useState("aparencia");
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [templateToApply, setTemplateToApply] = useState("");
  const [version, setVersion] = useState({});
  const [resetOpen, setResetOpen] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState(null);
  const [publishChecklist, setPublishChecklist] = useState(null);
  const [checkingPublication, setCheckingPublication] = useState(false);
  const formRef = useRef(form);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const loadedDraftVersionRef = useRef(null);
  const [localHistory, setLocalHistory] = useState({ undo: 0, redo: 0, announcement: "" });

  const syncLocalHistory = useCallback((announcement = "") => {
    setLocalHistory({ undo: undoRef.current.length, redo: redoRef.current.length, announcement });
  }, []);

  const replaceForm = useCallback((nextForm, { clearHistory = true } = {}) => {
    const next = cloneCatalogDraft(nextForm);
    formRef.current = next;
    setFormState(next);
    if (clearHistory) {
      undoRef.current = [];
      redoRef.current = [];
      syncLocalHistory("");
    }
  }, [syncLocalHistory]);

  const setForm = useCallback((nextValue) => {
    const current = formRef.current;
    const next = typeof nextValue === "function" ? nextValue(current) : nextValue;
    if (!next || sameCatalogDraft(current, next)) return;
    undoRef.current = [...undoRef.current, cloneCatalogDraft(current)].slice(-80);
    redoRef.current = [];
    const snapshot = cloneCatalogDraft(next);
    formRef.current = snapshot;
    setFormState(snapshot);
    syncLocalHistory("Alteração adicionada ao histórico local.");
  }, [syncLocalHistory]);

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current = [...redoRef.current, cloneCatalogDraft(formRef.current)].slice(-80);
    formRef.current = previous;
    setFormState(previous);
    syncLocalHistory("Alteração desfeita. Salve o rascunho para manter esta versão.");
  }, [syncLocalHistory]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current = [...undoRef.current, cloneCatalogDraft(formRef.current)].slice(-80);
    formRef.current = next;
    setFormState(next);
    syncLocalHistory("Alteração refeita. Salve o rascunho para manter esta versão.");
  }, [syncLocalHistory]);

  useEffect(() => {
    if (!data || data.error) return;
    const remoteVersion = asObject(data).version;
    // `refresh()` após salvar devolve o mesmo rascunho. Não limpamos o
    // histórico local nessa situação; uma edição chegada de outra sessão sim.
    if (loadedDraftVersionRef.current === null || loadedDraftVersionRef.current !== remoteVersion.draft) {
      replaceForm(normalizeCatalogCustomization(data));
      loadedDraftVersionRef.current = remoteVersion.draft;
    }
    setVersion(remoteVersion);
  }, [data, replaceForm]);

  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || String(event.key).toLowerCase() !== "z") return;
      // Inputs mantêm seu próprio histórico de digitação; o histórico do
      // construtor entra quando o foco está na página/controle, sem quebrar a
      // expectativa usual de Ctrl/Cmd+Z dentro de um campo textual.
      const tag = event.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const safeData = asObject(data);
  const products = asArray(safeData.products);
  const pluginAccess = asObject(safeData.pluginAccess);
  const customizationOptions = asObject(safeData.inventoryOptions);
  const categoryOptions = [
    ...asArray(customizationOptions.category).map((item) => item.name),
    ...new Set(products.map((item) => item.category).filter(Boolean))
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  async function save(path = "/catalog-customization", success = "Alterações salvas.") {
    setError("");
    setMessage("");
    const payload = path.includes("reset")
      ? { expected_draft_version: version.draft }
      : { ...serializeCatalogCustomization(form), expected_draft_version: version.draft };
    const response = await apiFetch(path, {
      method: "POST" === path.split("/").at(-1) ? "POST" : path.includes("publish") || path.includes("reset") ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (json.checklist) setPublishChecklist(json.checklist);
    if (!response.ok) return setError(json.error || "Não foi possível salvar.");
    if (path.includes("reset")) replaceForm(normalizeCatalogCustomization(json));
    else setForm(normalizeCatalogCustomization(json));
    setVersion(asObject(json).version);
    loadedDraftVersionRef.current = asObject(json).version?.draft ?? loadedDraftVersionRef.current;
    setMessage(success);
    refresh();
    refreshHistory();
  }

  async function reviewPublication() {
    setError("");
    setMessage("");
    setCheckingPublication(true);
    try {
      const response = await apiFetch("/catalog-customization/checklist");
      const json = await response.json().catch(() => ({}));
      if (!response.ok) return setError(json.error || "Não foi possível revisar a publicação.");
      setPublishChecklist(asObject(json).checklist || asObject(json));
      setMessage("Checklist atualizado com o rascunho salvo mais recente.");
    } finally {
      setCheckingPublication(false);
    }
  }

  async function rollback(targetVersion) {
    setError("");
    setMessage("");
    const response = await apiFetch(`/catalog-customization/rollback/${targetVersion}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_draft_version: version.draft, expected_published_version: version.published })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.error || "Não foi possível restaurar a revisão.");
    replaceForm(normalizeCatalogCustomization(json));
    setVersion(asObject(json).version);
    loadedDraftVersionRef.current = asObject(json).version?.draft ?? loadedDraftVersionRef.current;
    setRollbackVersion(null);
    setMessage(`Versão ${targetVersion} restaurada e publicada como uma nova versão.`);
    refresh();
    refreshHistory();
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
            <button className="secondary-button" type="button" onClick={() => setPreviewOpen(true)}>Abrir prévia</button>
            <button className="secondary-button" type="button" onClick={() => setResetOpen(true)}>Restaurar padrão</button>
            <button className="secondary-button" type="button" onClick={reviewPublication} disabled={checkingPublication}>{checkingPublication ? "Revisando…" : "Revisar publicação"}</button>
            <button className="primary-button" type="button" onClick={() => save("/catalog-customization/publish", "Catálogo publicado.")}>Publicar</button>
          </div>
        </header>

        <div className="catalog-editor-history" aria-label="Histórico local de edição">
          <div>
            <strong>Histórico local</strong>
            <small>Até 80 alterações nesta sessão. Use salvar para enviar o rascunho.</small>
          </div>
          <div>
            <button type="button" className="secondary-button" disabled={!localHistory.undo} onClick={undo} title="Desfazer (Ctrl/Cmd + Z)"><Undo2 size={16} /> Desfazer{localHistory.undo ? ` (${localHistory.undo})` : ""}</button>
            <button type="button" className="secondary-button" disabled={!localHistory.redo} onClick={redo} title="Refazer (Ctrl/Cmd + Shift + Z)"><Redo2 size={16} /> Refazer{localHistory.redo ? ` (${localHistory.redo})` : ""}</button>
          </div>
          <span className="sr-only" aria-live="polite">{localHistory.announcement}</span>
        </div>

        <CatalogBuilderStatus version={version} history={historyData} onRollback={setRollbackVersion} />
        <CatalogPublishChecklist checklist={publishChecklist} />
        <CatalogPublicLinks />

        <nav className="customization-tabs">
          {[
            ["aparencia", "Aparência"],
            ["layout", "Construtor"],
            ["banners", "Banners"],
            ["componentes", "Componentes"],
            ["integracoes", "Integrações"],
            ["categorias", "Categorias"],
            ["produtos", "Produtos"],
            ["promocoes", "Promoções"],
            ["cupons", "Cupons"],
            ["exibicao", "Exibição"],
            ["textos", "Textos"],
            ["contato", "Contato"],
            ["rodape", "Rodapé e identidade"],
            ["seo", "SEO"]
          ].map(([id, label]) => (
            <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)}>{label}</button>
          ))}
        </nav>

        {activeSection === "layout" && <CatalogLayoutBuilder form={form} setForm={setForm} />}
        {activeSection === "integracoes" && <CatalogPluginEditor plugins={form.plugins} onChange={(plugins) => setForm({ ...form, plugins })} enabledFeatures={pluginAccess.enabledFeatures} pluginLimit={pluginAccess.pluginLimit} />}

        {activeSection === "aparencia" && (
          <CustomizationCard title="Aparência do catálogo">
            <CatalogTemplatePicker activeTemplate={form.theme.theme} onSelect={setTemplateToApply} />
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
                  <ImageUploadField
                    label="Imagem do banner"
                    value={banner.image_url}
                    aspectRatio="16/5"
                    contextLabel="banner desktop"
                    transform={banner.image_transform}
                    onChange={(value, asset) => setForm(updateList(form, "banners", index, { image_url: value, alt_text: banner.alt_text || asset?.alt_text || "" }))}
                    onTransformChange={(image_transform, original_image_url) => setForm(updateList(form, "banners", index, { image_transform, original_image_url }))}
                  />
                  <ImageUploadField label="Imagem mobile opcional" value={banner.mobile_image_url} aspectRatio="4/5" contextLabel="banner mobile" onChange={(value) => setForm(updateList(form, "banners", index, { mobile_image_url: value }))} />
                  <div className="form-grid">
                    <Input label="Título" value={banner.title} onChange={(value) => setForm(updateList(form, "banners", index, { title: value }))} />
                    <Input label="Subtítulo" value={banner.subtitle} onChange={(value) => setForm(updateList(form, "banners", index, { subtitle: value }))} />
                  <Input label="Texto alternativo" value={banner.alt_text} onChange={(value) => setForm(updateList(form, "banners", index, { alt_text: value }))} />
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
                  {section.media_type === "image" ? <div className="catalog-content-media-fields"><ImageUploadField label="Foto do componente" value={section.media_url} onChange={(value, asset) => setForm(updateList(form, "contentSections", index, { media_url: value, media_alt: section.media_alt || asset?.alt_text || "" }))} /><Input label="Texto alternativo da imagem" value={section.media_alt || ""} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_alt: value }))} /><small className="field-help">Descreva a imagem para leitores de tela. Não repita o título do bloco se ele já aparece ao lado.</small></div> : section.media_type === "video" ? <div>
                    <Input label="URL do vídeo (YouTube ou Vimeo)" value={section.media_url} onChange={(value) => setForm(updateList(form, "contentSections", index, { media_url: value }))} />
                    <small className="field-help">Cole um link de compartilhamento ou incorporado. Outros sites não são aceitos por segurança.</small>
                  </div> : null}
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
                    <SmartCombobox label="Produto" value={product.product_id} options={products} onChange={(value) => setForm(updateList(form, "featuredProducts", index, { product_id: value }))} getMeta={(item) => [item.category, item.material, item.sku].filter(Boolean).join(" · ")} isDisabled={() => false} />
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

        {activeSection === "rodape" && <FooterIdentityEditor form={form} setForm={setForm} />}

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
        <button className="primary-button customization-save" type="button" onClick={() => save()}>Salvar rascunho</button>
      </div>

      <Modal
        open={previewOpen}
        title="Prévia do catálogo"
        subtitle="Visualização fiel do rascunho atual. As alterações aparecem automaticamente."
        size="lg"
        onClose={() => setPreviewOpen(false)}
      >
        <CatalogCustomizationPreview form={form} products={products} device={previewDevice} onDeviceChange={setPreviewDevice} modal />
      </Modal>
      <Modal
        open={Boolean(templateToApply)}
        title="Aplicar template"
        subtitle="A alteração fica apenas no rascunho até você publicar."
        size="sm"
        onClose={() => setTemplateToApply("")}
        footer={<>
          <button type="button" className="secondary-button" onClick={() => setTemplateToApply("")}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => {
            setForm(applyCatalogTemplate(form, templateToApply));
            setTemplateToApply("");
            setMessage("Template aplicado ao rascunho. Revise a prévia e salve quando terminar.");
          }}>Aplicar template</button>
        </>}
      >
        <p>O template troca a paleta, tipografia e composição dos blocos. Sua marca, imagens, produtos e textos fora desses blocos permanecem preservados.</p>
      </Modal>
      <Modal
        open={resetOpen}
        title="Restaurar rascunho padrão"
        subtitle="A vitrine publicada não será alterada."
        size="sm"
        onClose={() => setResetOpen(false)}
        footer={<>
          <button type="button" className="secondary-button" onClick={() => setResetOpen(false)}>Cancelar</button>
          <button type="button" className="danger-button" onClick={() => { setResetOpen(false); save("/catalog-customization/reset", "Rascunho padrão restaurado. Revise e publique quando quiser."); }}>Restaurar rascunho</button>
        </>}
      >
        <p>As alterações não publicadas deste rascunho serão substituídas pela composição padrão. As versões publicadas continuam disponíveis no histórico.</p>
      </Modal>
      <Modal
        open={rollbackVersion !== null}
        title="Restaurar versão publicada"
        subtitle="O histórico é preservado; nenhuma versão antiga será apagada."
        size="sm"
        onClose={() => setRollbackVersion(null)}
        footer={<>
          <button type="button" className="secondary-button" onClick={() => setRollbackVersion(null)}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => rollback(rollbackVersion)}>Restaurar e publicar</button>
        </>}
      >
        <p>A versão {rollbackVersion} será clonada em uma nova revisão publicada. A vitrine voltará a esse conteúdo sem reescrever o passado.</p>
      </Modal>
    </section>
  );
}

function CatalogBuilderStatus({ version, history, onRollback }) {
  const safeVersion = asObject(version);
  const revisions = asArray(asObject(history).revisions);
  const draft = Number(safeVersion.draft || 0);
  const published = Number(safeVersion.published || 0);
  return (
    <section className="catalog-builder-status" aria-label="Estado de publicação do catálogo">
      <div className="catalog-builder-status__summary">
        <span className="eyebrow">Builder versionado</span>
        <strong>Rascunho v{draft} · Vitrine v{published || "—"}</strong>
        <small>{safeVersion.updated_at ? `Rascunho atualizado em ${formatCatalogRevisionDate(safeVersion.updated_at)}.` : "Salve o rascunho antes de publicar."}</small>
      </div>
      <details>
        <summary>Histórico de publicações ({revisions.length})</summary>
        <div className="catalog-revision-list">
          {!revisions.length && <span>Nenhuma versão publicada ainda.</span>}
          {revisions.map((revision) => (
            <div key={revision.id || revision.version}>
              <span><strong>v{revision.version}</strong><small>{revision.action === "rollback" ? "restauração" : "publicação"} · {formatCatalogRevisionDate(revision.published_at || revision.created_at)}</small></span>
              {Number(revision.version) !== published && <button type="button" className="secondary-button" onClick={() => onRollback(Number(revision.version))}>Restaurar</button>}
              {Number(revision.version) === published && <em>Atual</em>}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function CatalogPublishChecklist({ checklist }) {
  const safeChecklist = asObject(checklist);
  const errors = asArray(safeChecklist.errors);
  const warnings = asArray(safeChecklist.warnings);
  if (!checklist) return null;
  const items = [
    ...errors.map((item) => ({ ...asObject(item), tone: "danger" })),
    ...warnings.map((item) => ({ ...asObject(item), tone: "warn" }))
  ];
  return (
    <section className={`catalog-publish-checklist ${errors.length ? "has-errors" : ""}`} aria-live="polite">
      <div>
        <span className="eyebrow">Revisão de publicação</span>
        <strong>{errors.length ? "Há itens que impedem a publicação" : warnings.length ? "A publicação é possível, mas há pontos a revisar" : "Pronto para publicar"}</strong>
        <small>{errors.length ? "Corrija os itens abaixo e revise novamente." : warnings.length ? "Os avisos não bloqueiam a vitrine, mas ajudam a manter qualidade e acessibilidade." : "O rascunho salvo passou pelas validações essenciais."}</small>
      </div>
      {!!items.length && <ul>
        {items.map((item, index) => <li className={item.tone} key={`${item.code || item.message}-${index}`}><strong>{item.tone === "danger" ? "Corrigir" : "Revisar"}</strong><span>{item.message || "Item sem descrição."}</span></li>)}
      </ul>}
    </section>
  );
}

function formatCatalogRevisionDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "data indisponível";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function FooterIdentityEditor({ form, setForm }) {
  const settings = form.settings;
  const inherit = settings.footer_inherit_main_palette === "1";
  const footerBackground = inherit ? form.theme.background_color : settings.footer_background_color;
  const footerText = inherit ? (settings.text_color || "#1c1c1c") : settings.footer_text_color;
  const contrast = contrastRatio(footerBackground, footerText);
  const update = (patch) => setForm(updateSettings(form, patch));
  const colorFields = [
    ["footer_background_color", "Fundo do rodapé"], ["footer_brand_background_color", "Fundo da marca"],
    ["footer_text_color", "Texto"], ["footer_muted_text_color", "Texto secundário"], ["footer_heading_color", "Títulos"],
    ["footer_link_color", "Links"], ["footer_link_hover_color", "Hover dos links"], ["footer_icon_color", "Ícones"],
    ["footer_border_color", "Bordas"], ["footer_accent_color", "Destaque"]
  ];
  return (
    <CustomizationCard title="Rodapé e identidade inferior">
      <div className="toggle-grid">
        <Toggle label="Exibir rodapé" checked={settings.footer_enabled !== "0"} onChange={(value) => update({ footer_enabled: value ? "1" : "0" })} />
        <Toggle label="Herdar cores da identidade visual principal" checked={inherit} onChange={(value) => update({ footer_inherit_main_palette: value ? "1" : "0" })} />
        <Toggle label="Exibir nome comercial" checked={settings.footer_show_business_name !== "0"} onChange={(value) => update({ footer_show_business_name: value ? "1" : "0" })} />
        <Toggle label="Exibir slogan" checked={settings.footer_show_slogan !== "0"} onChange={(value) => update({ footer_show_slogan: value ? "1" : "0" })} />
      </div>
      <div className="footer-theme-presets">
        {["claro", "escuro", "neutro", "elegante", "minimalista", "paleta principal"].map((name) => <button type="button" key={name} onClick={() => update(footerPreset(name, form.theme))}>{name}</button>)}
      </div>
      <div className="form-grid">
        <Input label="Nome exibido" value={settings.footer_display_name} onChange={(value) => update({ footer_display_name: value })} />
        <Input label="Slogan" value={settings.footer_slogan} onChange={(value) => update({ footer_slogan: value })} />
        <ImageUploadField label="Logo principal do rodapé" value={settings.footer_logo_url} contextLabel="logo do rodapé" aspectRatio="3/1" onChange={(value) => update({ footer_logo_url: value })} />
        <ImageUploadField label="Logo clara" value={settings.footer_light_logo_url} contextLabel="logo clara" aspectRatio="3/1" onChange={(value) => update({ footer_light_logo_url: value })} />
        <ImageUploadField label="Logo escura" value={settings.footer_dark_logo_url} contextLabel="logo escura" aspectRatio="3/1" onChange={(value) => update({ footer_dark_logo_url: value })} />
        <Select label="Alinhamento da logo" value={settings.footer_logo_alignment} onChange={(value) => update({ footer_logo_alignment: value })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></Select>
        <Input type="number" label="Largura máxima da logo" value={settings.footer_logo_max_width} onChange={(value) => update({ footer_logo_max_width: value })} />
        <Input type="number" label="Altura máxima da logo" value={settings.footer_logo_max_height} onChange={(value) => update({ footer_logo_max_height: value })} />
        <Select label="Tipo de fundo" value={settings.footer_background_type} onChange={(value) => update({ footer_background_type: value })}><option value="solid">Cor sólida</option><option value="gradient">Degradê</option><option value="image">Imagem</option></Select>
        <ImageUploadField label="Imagem de fundo" value={settings.footer_background_image_url} contextLabel="fundo do rodapé" aspectRatio="16/5" onChange={(value) => update({ footer_background_image_url: value })} />
        <Input label="Posição do fundo" value={settings.footer_background_position} onChange={(value) => update({ footer_background_position: value })} />
        <Select label="Tamanho do fundo" value={settings.footer_background_size} onChange={(value) => update({ footer_background_size: value })}><option value="cover">Cobrir</option><option value="contain">Mostrar inteiro</option><option value="auto">Original</option></Select>
        <Input type="color" label="Cor do overlay" value={settings.footer_overlay_color} onChange={(value) => update({ footer_overlay_color: value })} />
        <Input type="number" label="Opacidade do overlay (0–1)" value={settings.footer_overlay_opacity} onChange={(value) => update({ footer_overlay_opacity: value })} />
        <Input type="color" label="Início do degradê" value={settings.footer_gradient_start_color} onChange={(value) => update({ footer_gradient_start_color: value })} />
        <Input type="color" label="Fim do degradê" value={settings.footer_gradient_end_color} onChange={(value) => update({ footer_gradient_end_color: value })} />
        <Input label="Direção do degradê" value={settings.footer_gradient_direction} onChange={(value) => update({ footer_gradient_direction: value })} />
        <Input type="number" label="Raio das bordas" value={settings.footer_border_radius} onChange={(value) => update({ footer_border_radius: value })} />
        <Input type="number" label="Largura do conteúdo" value={settings.footer_container_width} onChange={(value) => update({ footer_container_width: value })} />
        <Input type="number" label="Espaçamento interno" value={settings.footer_spacing} onChange={(value) => update({ footer_spacing: value })} />
      </div>
      <fieldset className={inherit ? "footer-colors inherited" : "footer-colors"} disabled={inherit}>
        <legend>Cores específicas do rodapé</legend>
        <div className="form-grid">{colorFields.map(([key, label]) => <Input key={key} type="color" label={label} value={settings[key]} onChange={(value) => update({ [key]: value })} />)}</div>
      </fieldset>
      <label>Copyright<textarea value={settings.footer_copyright_text} onChange={(event) => update({ footer_copyright_text: event.target.value })} /></label>
      <div className={`contrast-warning ${contrast >= 4.5 ? "ok" : "risk"}`} role="status">
        Contraste texto/fundo: {contrast.toFixed(2)}:1 — {contrast >= 4.5 ? "adequado para texto normal." : `leitura prejudicada; considere texto ${bestTextColor(footerBackground) === "#ffffff" ? "claro" : "escuro"}.`}
      </div>
    </CustomizationCard>
  );
}

function footerPreset(name, theme) {
  const presets = {
    claro: { footer_inherit_main_palette: "0", footer_background_type: "solid", footer_background_color: "#fafafa", footer_text_color: "#242424", footer_muted_text_color: "#666666", footer_heading_color: "#111111", footer_link_color: "#5f421d", footer_icon_color: "#8b642f", footer_border_color: "#dddddd" },
    escuro: { footer_inherit_main_palette: "0", footer_background_type: "solid", footer_background_color: "#151515", footer_text_color: "#f5f5f5", footer_muted_text_color: "#b8b8b8", footer_heading_color: "#ffffff", footer_link_color: "#f0cf91", footer_icon_color: "#f0cf91", footer_border_color: "#454545" },
    neutro: { footer_inherit_main_palette: "0", footer_background_type: "solid", footer_background_color: "#ece9e4", footer_text_color: "#35322e", footer_muted_text_color: "#716b63", footer_heading_color: "#25221f", footer_link_color: "#59524a", footer_icon_color: "#59524a", footer_border_color: "#cbc5bc" },
    elegante: { footer_inherit_main_palette: "0", footer_background_type: "gradient", footer_gradient_start_color: "#161616", footer_gradient_end_color: "#332a23", footer_text_color: "#f8f1e5", footer_muted_text_color: "#c7b9a6", footer_heading_color: "#ffffff", footer_link_color: "#d9b873", footer_icon_color: "#d9b873", footer_border_color: "#5b4b3d" },
    minimalista: { footer_inherit_main_palette: "0", footer_background_type: "solid", footer_background_color: "#ffffff", footer_text_color: "#222222", footer_muted_text_color: "#777777", footer_heading_color: "#111111", footer_link_color: "#222222", footer_icon_color: "#222222", footer_border_color: "#eeeeee" },
    "paleta principal": { footer_inherit_main_palette: "1", footer_background_color: theme.background_color, footer_accent_color: theme.primary_color }
  };
  return presets[name];
}

function contrastRatio(a, b) {
  const luminance = (hex) => {
    const value = String(hex || "#000000").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
    const rgb = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255).map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

function bestTextColor(background) {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#111111") ? "#ffffff" : "#111111";
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
  const [draggedKey, setDraggedKey] = useState("");
  const [dropTargetKey, setDropTargetKey] = useState("");
  const [dragAnnouncement, setDragAnnouncement] = useState("");
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
  function move(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const next = [...sections];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    setForm({ ...form, catalogSections: next.map((section, index) => ({ ...section, sort_order: index + 1 })) });
    setDragAnnouncement(`Bloco movido para a posição ${toIndex + 1}.`);
  }
  function dropOn(targetKey) {
    const fromIndex = sections.findIndex((section) => section.section_key === draggedKey);
    const toIndex = sections.findIndex((section) => section.section_key === targetKey);
    move(fromIndex, toIndex);
    setDraggedKey("");
    setDropTargetKey("");
  }
  return (
    <CustomizationCard title="Construtor visual" action={
      <Select value="" onChange={(value) => value && add(value)}>
        <option value="">Adicionar seção</option>
        {CATALOG_SECTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
    }>
      <div className="catalog-builder-toolbar">
        <p className="customization-help">A ordem abaixo é a ordem da página pública. Arraste um bloco pela alça no desktop; para teclado e celular, use Subir e Descer. Salvar mantém rascunho; Publicar atualiza a vitrine.</p>
        <small>{sections.length} {sections.length === 1 ? "bloco" : "blocos"} no layout</small>
      </div>
      <span className="sr-only" aria-live="polite">{dragAnnouncement}</span>
      <div className="custom-list catalog-layout-list" aria-label="Blocos do catálogo em ordem">
        {sections.map((section, index) => (
          <article
            key={section.section_key}
            className={`catalog-layout-card${draggedKey === section.section_key ? " is-dragging" : ""}${dropTargetKey === section.section_key && draggedKey !== section.section_key ? " is-drop-target" : ""}`}
            draggable
            onDragStart={(event) => {
              // O cartão inteiro recebe o evento para manter o drop simples,
              // mas só a alça inicia arraste — editar um campo não deve mover
              // o bloco por acidente.
              if (!event.target.closest?.(".catalog-drag-handle")) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", section.section_key);
              setDraggedKey(section.section_key);
            }}
            onDragEnd={() => { setDraggedKey(""); setDropTargetKey(""); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTargetKey(section.section_key); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTargetKey(""); }}
            onDrop={(event) => { event.preventDefault(); dropOn(section.section_key); }}
          >
            <div className="panel-heading">
              <div className="catalog-layout-heading">
                <button type="button" className="catalog-drag-handle" tabIndex={-1} aria-hidden="true" title="Arraste o bloco para mudar a posição"><GripVertical size={18} /></button>
                <div><strong>{CATALOG_SECTION_TYPES.find(([value]) => value === section.section_type)?.[1] || section.section_type}</strong><small>Posição {index + 1}</small></div>
              </div>
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
          <RowActions actions={[
            { label: "Editar", onClick: () => edit(coupon), primary: true },
            { label: "Excluir", onClick: () => setDeleting({ message: `Excluir o cupom ${coupon.code}?`, run: () => remove(coupon) }), danger: true }
          ]} />
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
          <RowActions actions={[
            { label: "Editar", onClick: () => edit(promotion), primary: true },
            { label: "Duplicar", onClick: () => request(`/promotions/${promotion.id}/duplicate`, { method: "POST" }, "Promoção duplicada.") },
            {
              label: "Excluir",
              danger: true,
              onClick: () => setEnding({
                message: `Excluir a promoção ${promotion.name}? Ela será encerrada e sai da lista de campanhas.`,
                run: () => request(`/promotions/${promotion.id}`, { method: "DELETE" }, "Promoção encerrada.")
              })
            }
          ]} />
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
    <Checkbox className="toggle-field" label={label} checked={Boolean(Number(checked))} onChange={onChange} />
  );
}

function CatalogCustomizationPreview({ form, products, device = "desktop", onDeviceChange, modal = false }) {
  const frameRef = useRef(null);
  const theme = { ...defaultCatalogCustomization().theme, ...asObject(form).theme };
  const previewUrl = catalogPreviewUrl();
  const sendPreview = useCallback(() => frameRef.current?.contentWindow?.postMessage({
    type: "aura-catalog-preview",
    catalog: catalogPreviewPayload(form, products)
  }, window.location.origin), [form, products]);

  // Atualizações pequenas esperam um instante para não serializar a lista de
  // produtos em cada tecla digitada. O iframe é a própria vitrine pública.
  useEffect(() => {
    const timer = window.setTimeout(sendPreview, 120);
    return () => window.clearTimeout(timer);
  }, [sendPreview]);

  useEffect(() => {
    const receiveReady = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (asObject(event.data).type === "aura-catalog-preview-ready") sendPreview();
    };
    window.addEventListener("message", receiveReady);
    return () => window.removeEventListener("message", receiveReady);
  }, [sendPreview]);

  return (
    <section className={`catalog-live-preview preview-${device}${modal ? " preview-modal" : ""}`} style={{ "--preview-primary": theme.primary_color }}>
      <div className="preview-browser-bar">
        <span />
        <strong>Prévia fiel do rascunho</strong>
        <div className="preview-device-switcher">
          {["desktop", "tablet", "mobile"].map((item) => <button type="button" className={device === item ? "active" : ""} onClick={() => onDeviceChange(item)} key={item}>{item}</button>)}
        </div>
        <a href={`/catalogo?t=${tenantSlug()}`} target="_blank" rel="noreferrer">Vitrine publicada</a>
      </div>
      <div className="preview-storefront">
        <iframe
          ref={frameRef}
          title="Prévia do catálogo"
          src={previewUrl}
          onLoad={sendPreview}
        />
      </div>
    </section>
  );
}

function catalogPreviewUrl() {
  const url = new URL("/catalogo", window.location.origin);
  url.searchParams.set("t", tenantSlug());
  url.searchParams.set("preview", "1");
  return url.toString();
}

function catalogPreviewPayload(form, products) {
  const safeForm = asObject(form);
  const settings = asObject(safeForm.settings);
  const featured = new Map(asArray(safeForm.featuredProducts).map((item) => [Number(item.product_id), item]));
  return {
    ...settings,
    content_sections: JSON.stringify(asArray(safeForm.contentSections)),
    categories: String(settings.categories || "").split(",").map((item) => item.trim()).filter(Boolean),
    theme: asObject(safeForm.theme),
    banners: asArray(safeForm.banners),
    featuredCategories: asArray(safeForm.featuredCategories),
    featuredProducts: asArray(safeForm.featuredProducts),
    promotions: asArray(safeForm.promotions),
    catalogSections: asArray(safeForm.catalogSections),
    plugins: asArray(safeForm.plugins),
    items: asArray(products).map((product) => ({
      ...product,
      badge: featured.get(Number(product.id))?.badge || product.badge || ""
    }))
  };
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
      ...normalizeBooleanRecord(banner),
      image_transform: normalizeImageTransform(safeJsonObject(banner.image_transform), "16/5")
    })).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    contentSections: catalogContentSections(settings.content_sections),
    featuredCategories: (asArray(safeData.featuredCategories).length ? asArray(safeData.featuredCategories) : defaults.featuredCategories).map(normalizeBooleanRecord),
    featuredProducts: asArray(safeData.featuredProducts).map(normalizeBooleanRecord),
    promotions: asArray(safeData.promotions).map(normalizeBooleanRecord)
    ,
    catalogSections: (asArray(safeData.catalogSections).length ? asArray(safeData.catalogSections) : defaultCatalogSections()).map(normalizeBooleanRecord),
    plugins: asArray(safeData.plugins)
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
    mobile_image_url: "",
    original_image_url: "",
    alt_text: "",
    image_transform: { ...DEFAULT_IMAGE_TRANSFORM, aspectRatio: "16/5" },
    button_text: "Ver todas as joias",
    button_link: "#catalog-products",
    banner_width: 0,
    banner_height: 340,
    banner_fit: "contain",
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
      subtitle: "Curadoria premium de joias selecionadas",
      institutional_text: "Joias selecionadas com cuidado, segurança e estética premium.",
      unavailable_message: "Produto indisponível no momento.",
      low_stock_message: "Poucas unidades",
      footer_text: "",
      seo_title: "Catálogo Online",
      seo_description: "Escolha joias premium para piercing.",
      share_image_url: "",
      product_share_text: "Olha esta joia:",
      content_sections: JSON.stringify([defaultContentSection(1)]),
      categories: `Todos,${JEWELRY_CATEGORY_OPTIONS.join(",")}`,
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
      footer_enabled: "1",
      footer_display_name: "",
      footer_slogan: "",
      footer_logo_url: "",
      footer_light_logo_url: "",
      footer_dark_logo_url: "",
      footer_logo_alignment: "left",
      footer_logo_max_width: "220",
      footer_logo_max_height: "90",
      footer_show_business_name: "1",
      footer_show_slogan: "1",
      footer_background_type: "solid",
      footer_background_color: "#171512",
      footer_background_image_url: "",
      footer_background_position: "center",
      footer_background_size: "cover",
      footer_overlay_color: "#000000",
      footer_overlay_opacity: "0",
      footer_gradient_start_color: "#171512",
      footer_gradient_end_color: "#30291f",
      footer_gradient_direction: "135deg",
      footer_brand_background_color: "transparent",
      footer_text_color: "#ffffff",
      footer_muted_text_color: "#d1cbc2",
      footer_heading_color: "#ffffff",
      footer_link_color: "#ffffff",
      footer_link_hover_color: "#c8a96a",
      footer_icon_color: "#c8a96a",
      footer_border_color: "#454038",
      footer_accent_color: "#c8a96a",
      footer_border_radius: "24",
      footer_container_width: "1240",
      footer_spacing: "40",
      footer_copyright_text: "",
      footer_inherit_main_palette: "0",
      site_background: "#f8f5f0",
      section_background: "#ffffff",
      text_color: "#24211d",
      muted_text_color: "#716b62",
      heading_color: "#171512",
      link_color: "#8a6b2d",
      link_hover_color: "#5e471e",
      icon_color: "#8a6b2d",
      border_color: "#ded8ce",
      button_text_color: "#ffffff"
    },
    theme: {
      brand_name: "",
      slogan: "",
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
      footer_text: ""
    },
    banners: [defaultCatalogBanner(1)],
    contentSections: [defaultContentSection(1)],
    featuredCategories: JEWELRY_CATEGORY_OPTIONS.map((name, index) => ({ category_id: name, public_name: name, icon: "gem", image_url: "", is_active: true, sort_order: index + 1 })),
    featuredProducts: [],
    promotions: []
    ,
    catalogSections: defaultCatalogSections(),
    plugins: []
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

const CATALOG_TEMPLATES = [
  {
    key: "minimalista",
    name: "Minimal clean",
    description: "Catálogo direto, claro e fácil de navegar.",
    colors: ["#171512", "#F7F5F1"],
    theme: { primary_color: "#24211d", secondary_color: "#ded8ce", background_color: "#f7f5f1", button_color: "#24211d", title_font: "Inter", body_font: "Inter" },
    settings: { site_background: "#f7f5f1", section_background: "#ffffff", text_color: "#24211d", heading_color: "#171512", muted_text_color: "#716b62", border_color: "#ded8ce", footer_inherit_main_palette: "1" },
    sections: ["hero", "categories", "featured_products", "new_products", "booking_cta", "footer"]
  },
  {
    key: "premium",
    name: "Luxe editorial",
    description: "Imagem marcante e curadoria premium de joias.",
    colors: ["#C8A96A", "#171512"],
    theme: { primary_color: "#c8a96a", secondary_color: "#d8c3a5", background_color: "#f8f5f0", button_color: "#8b642f", title_font: "Playfair Display", body_font: "Inter" },
    settings: { site_background: "#f8f5f0", section_background: "#ffffff", text_color: "#24211d", heading_color: "#171512", muted_text_color: "#716b62", border_color: "#d8c3a5", footer_inherit_main_palette: "0", footer_background_type: "gradient", footer_gradient_start_color: "#171512", footer_gradient_end_color: "#332a23" },
    sections: ["hero", "categories", "featured_products", "best_sellers", "new_products", "custom_content", "booking_cta", "footer"]
  },
  {
    key: "claro",
    name: "Studio booking",
    description: "Foco em atendimento, confiança e agendamento.",
    colors: ["#7a5a45", "#fffaf6"],
    theme: { primary_color: "#7a5a45", secondary_color: "#eadbd0", background_color: "#fffaf6", button_color: "#7a5a45", title_font: "Georgia", body_font: "Inter" },
    settings: { site_background: "#fffaf6", section_background: "#ffffff", text_color: "#332b27", heading_color: "#332017", muted_text_color: "#786961", border_color: "#eadbd0", footer_inherit_main_palette: "1" },
    sections: ["hero", "booking_cta", "categories", "featured_products", "custom_content", "location", "footer"]
  },
  {
    key: "escuro",
    name: "Campaign / lançamento",
    description: "Contraste alto para campanhas, coleções e promoções.",
    colors: ["#f0cf91", "#171512"],
    theme: { primary_color: "#f0cf91", secondary_color: "#564737", background_color: "#171512", button_color: "#f0cf91", title_font: "Playfair Display", body_font: "Inter" },
    settings: { site_background: "#171512", section_background: "#24201c", text_color: "#f8f1e5", heading_color: "#ffffff", muted_text_color: "#c7b9a6", border_color: "#564737", button_text_color: "#171512", footer_inherit_main_palette: "1" },
    sections: ["hero", "promotions", "new_products", "featured_products", "in_stock", "booking_cta", "footer"]
  }
];

function CatalogTemplatePicker({ activeTemplate, onSelect }) {
  return (
    <section className="catalog-template-picker" aria-label="Templates de catálogo">
      <div><strong>Comece por um template</strong><span>Você poderá ajustar todos os blocos e cores depois.</span></div>
      <div className="catalog-template-grid">
        {CATALOG_TEMPLATES.map((template) => (
          <button type="button" key={template.key} className={activeTemplate === template.key ? "active" : ""} onClick={() => onSelect(template.key)}>
            <span className="catalog-template-swatch" style={{ "--template-primary": template.colors[0], "--template-surface": template.colors[1] }} aria-hidden="true"><i /><i /><i /></span>
            <strong>{template.name}</strong>
            <small>{template.description}</small>
            <em>{activeTemplate === template.key ? "Em uso" : "Aplicar"}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function applyCatalogTemplate(form, templateKey) {
  const template = CATALOG_TEMPLATES.find((item) => item.key === templateKey);
  if (!template) return form;
  return {
    ...form,
    theme: { ...form.theme, ...template.theme, theme: template.key },
    settings: { ...form.settings, ...template.settings },
    catalogSections: template.sections.map((sectionType, index) => defaultCatalogSection(sectionType, index + 1))
  };
}

function CatalogMediaPicker({ onClose, onSelect }) {
  const [altDrafts, setAltDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const { data: mediaData, refresh: refreshMedia } = useFetch("/catalog-media");
  const assets = asArray(asObject(mediaData).items || mediaData);
  const loading = !mediaData;

  useEffect(() => {
    setAltDrafts(Object.fromEntries(asArray(assets).map((asset) => [asset.id, asset.alt_text || ""])));
    setError("");
  }, [assets]);

  async function saveAlt(asset) {
    setSavingId(asset.id);
    setError("");
    try {
      const response = await apiFetch(`/catalog-media/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt_text: altDrafts[asset.id] || "" })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível atualizar o texto alternativo.");
      refreshMedia();
    } catch (saveError) {
      setError(saveError.message || "Não foi possível atualizar o texto alternativo.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Modal
      open
      title="Biblioteca de mídia"
      subtitle="Selecione uma imagem já enviada. O texto alternativo fica salvo para reutilização acessível."
      size="lg"
      onClose={onClose}
    >
      {loading && <Loading />}
      {(error || mediaData?.error) && <span className="form-error">{error || mediaData.error}</span>}
      {!loading && !asArray(assets).length && <p className="empty-state">Ainda não há imagens nesta biblioteca. Envie um arquivo em qualquer campo de imagem para começar.</p>}
      <div className="catalog-media-grid">
        {asArray(assets).map((asset) => (
          <article key={asset.id} className="catalog-media-card">
            <img src={catalogImageUrl(asset.url)} alt={asset.alt_text || "Prévia da biblioteca de mídia"} />
            <label>Texto alternativo
              <input value={altDrafts[asset.id] ?? asset.alt_text ?? ""} maxLength={180} onChange={(event) => setAltDrafts((current) => ({ ...current, [asset.id]: event.target.value }))} placeholder="Descreva esta imagem" />
            </label>
            <div>
              <button type="button" className="secondary-button" disabled={savingId === asset.id} onClick={() => saveAlt(asset)}>{savingId === asset.id ? "Salvando…" : "Salvar descrição"}</button>
              <button type="button" className="primary-button" onClick={() => { onSelect({ ...asset, alt_text: altDrafts[asset.id] ?? asset.alt_text ?? "" }); onClose(); }}>Usar imagem</button>
            </div>
          </article>
        ))}
      </div>
    </Modal>
  );
}

export function ImageUploadField({ label, value, onChange, onTransformChange, transform, aspectRatio = "1/1", contextLabel = label }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [editor, setEditor] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  async function selectImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("Use uma imagem JPEG, PNG, WebP ou GIF.");
      return;
    }
    setError("");
    setWarning(file.type === "image/gif" ? "GIFs animados são preservados, mas o enquadramento não altera os quadros do arquivo." : "");
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth < 800 || image.naturalHeight < 300) setWarning((current) => current || "A resolução é baixa e pode perder nitidez em telas grandes.");
      URL.revokeObjectURL(source);
    };
    image.src = source;
    setEditor({ file, src: "" });
  }

  async function confirmEdit(imageTransform) {
    try {
      let imageUrl = value;
      if (editor?.file) {
        setUploading(true);
        const formData = new FormData();
        formData.append("file", editor.file);
        // A rota específica registra a imagem no acervo da clínica; o fallback
        // mantém uploads possíveis durante uma atualização gradual de API.
        let response = await apiFetch("/catalog-media", { method: "POST", body: formData });
        if (response.status === 404) response = await apiFetch("/uploads", { method: "POST", body: formData });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Upload inválido.");
        const asset = data.asset || data.item || null;
        imageUrl = data.url || asset?.url || "";
        if (!imageUrl) throw new Error("O servidor não retornou a URL da imagem.");
        onChange(imageUrl, asset || { url: imageUrl, alt_text: "" });
      }
      onTransformChange?.(imageTransform, imageUrl);
      setEditor(null);
    } catch (err) {
      console.error(err);
      setError("Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
    }
  }

  function updateExternalUrl(nextValue) {
    onChange(nextValue);
    if (!nextValue) onTransformChange?.(normalizeImageTransform({}, aspectRatio), "");
  }

  // Duas formas de "arquivo nosso", uma por modo de armazenamento: caminho
  // relativo (disco) e URL absoluta do CDN (R2). No R2 a chave sempre começa por
  // `tenant_<id>/` ou `plataforma/` — é a convenção de `services/storage/keys.js`.
  // Sem reconhecer a segunda, uma imagem enviada pelo próprio painel voltaria a
  // aparecer como "URL externa", num campo de texto editável.
  const internalUpload = /^\/uploads\//.test(String(value || "")) || /\/(?:tenant_\d+|plataforma)\//.test(String(value || ""));
  return (
    <div className="image-upload-field">
      <span className="image-upload-label">{label}</span>
      {value ? (
        <div className="image-upload-preview">
          <img src={catalogImageUrl(value)} alt={label} style={imageTransformStyle(transform)} />
          <span><ImageIcon size={18} /> Prévia da imagem</span>
        </div>
      ) : <div className="image-upload-empty"><ImageIcon size={22} /><span>Nenhuma imagem selecionada</span></div>}
      {!internalUpload && <input value={value || ""} onChange={(event) => updateExternalUrl(event.target.value)} placeholder="Cole uma URL externa ou envie um arquivo" />}
      {internalUpload && <small>Arquivo enviado e armazenado com segurança.</small>}
      <div className="image-upload-actions">
        <label className="secondary-button">Escolher arquivo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={selectImage} /></label>
        <button type="button" className="secondary-button" onClick={() => setLibraryOpen(true)}>Biblioteca</button>
        {value && <button type="button" className="secondary-button" onClick={() => setEditor({ file: null, src: catalogImageUrl(value) })}>Editar enquadramento</button>}
        {value && <button type="button" className="danger-link" onClick={() => updateExternalUrl("")}>Remover</button>}
      </div>
      {uploading && <small>Enviando imagem...</small>}
      {warning && <small className="form-warning">{warning}</small>}
      {error && <span className="form-error">{error}</span>}
      {editor && <ImageEditor file={editor.file} src={editor.src} initialTransform={transform} aspectRatio={aspectRatio} contextLabel={contextLabel} onCancel={() => setEditor(null)} onConfirm={confirmEdit} />}
      {libraryOpen && <CatalogMediaPicker
        onClose={() => setLibraryOpen(false)}
        onSelect={(asset) => {
          onChange(asset.url, asset);
          onTransformChange?.(normalizeImageTransform({}, aspectRatio), asset.url);
        }}
      />}
    </div>
  );
}

function safeJsonObject(value) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
