// Campanhas e coleções temporárias da vitrine (Halloween, Natal, Black Friday…).
// A campanha entra e sai do ar sozinha pelo período; os produtos continuam
// nas categorias permanentes, com o mesmo cadastro e estoque.
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Input, Select, StatusBadge, Switch, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { FormSection } from "../../components/common/FormWorkflow";
import { Loading, ApiError } from "../../components/common/Feedback";
import { apiFetch, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { asArray, asObject } from "../../lib/utils";
import { publicLinkForTenant } from "../../lib/publicRoutes";
import { CatalogImageField, CatalogProductPicker } from "./CatalogAdminFields";
import { CampaignShowcase, collectionImageUrl } from "./CatalogCollections";
import "../../styles/catalog-collections.css";
// Largura do modal `size="workspace"` (produtos e prévia da coleção).
import "../../styles/appointment-workspace.css";

export const CAMPAIGN_STATE_LABELS = { draft: "Rascunho", scheduled: "Agendada", active: "Ativa", paused: "Pausada", ended: "Encerrada" };
const STATE_TONES = { draft: "neutral", scheduled: "info", active: "ok", paused: "warn", ended: "neutral" };
const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha", "Europe/Lisbon", "UTC"];
const EMPTY_FORM = {
  name: "", title: "", slug: "", summary: "", banner_desktop_url: "", banner_mobile_url: "", cover_url: "", image_alt: "",
  starts_local: "", ends_local: "", highlight_until_local: "", display_position: "top", priority: "0",
  show_on_home: true, show_in_nav: false, promotion_id: ""
};
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

async function requestJson(path, options = {}) {
  const response = await apiFetch(path, { ...options, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

function localText(value) {
  if (!value) return "";
  const [date, time] = String(value).split("T");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${time}`;
}

function periodText(row) {
  if (!row.starts_local && !row.ends_local) return "Sem período definido";
  if (!row.starts_local) return `Até ${localText(row.ends_local)}`;
  if (!row.ends_local) return `A partir de ${localText(row.starts_local)}`;
  return `${localText(row.starts_local)} → ${localText(row.ends_local)}`;
}

// Ações disponíveis em cada estado. "Reativar" é para encerrada manualmente;
// a que terminou pelo horário volta editando o período.
function statusActions(row) {
  return {
    draft: [["publish", "Publicar"]],
    scheduled: [["pause", "Pausar"], ["end", "Encerrar agora"]],
    active: [["pause", "Pausar"], ["end", "Encerrar agora"]],
    paused: [["resume", "Retomar"], ["end", "Encerrar agora"]],
    ended: row.status === "ended" ? [["reactivate", "Reativar"]] : []
  }[row.state] || [];
}

/** @param {{ onNavigate?: (page: string) => any }} props */
export function CatalogCampaignsAdmin({ onNavigate }) {
  const { data } = useFetch("/catalog-campaigns");
  const { data: promotionsData } = useFetch("/promotions?limit=100");
  const invalidate = useApiInvalidate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [productsFor, setProductsFor] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [message, setMessage] = useState("");

  if (data == null) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const safeData = asObject(data);
  const campaigns = asArray(safeData.campaigns);
  const timezone = safeData.timezone || "America/Sao_Paulo";
  const promotions = asArray(asObject(promotionsData).items || promotionsData);
  const refresh = () => invalidate("/catalog-campaigns", "/catalog");

  function openForm(campaign = null) {
    setEditing(campaign);
    setForm(campaign
      ? /** @type {typeof EMPTY_FORM} */ (Object.fromEntries(Object.keys(EMPTY_FORM).map((key) => [key, campaign[key] == null ? EMPTY_FORM[key] : typeof EMPTY_FORM[key] === "boolean" ? Boolean(campaign[key]) : String(campaign[key])])))
      : EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setFormError("");
    const body = { ...form, priority: Number(form.priority || 0), promotion_id: form.promotion_id ? Number(form.promotion_id) : null, slug: form.slug.trim() };
    try {
      const saved = await requestJson(editing ? `/catalog-campaigns/${editing.id}` : "/catalog-campaigns", { method: editing ? "PATCH" : "POST", body });
      setFormOpen(false);
      setMessage(editing ? "Campanha atualizada." : "Campanha criada como rascunho. Adicione os produtos e publique quando estiver pronta.");
      refresh();
      if (!editing) setProductsFor(saved);
    } catch (failure) {
      setFormError(failure.message);
    }
  }

  async function run(action, success) {
    setMessage("");
    try {
      await action();
      if (success) setMessage(success);
      refresh();
    } catch (failure) {
      setMessage(failure.message);
    }
  }

  function publicLink(row) {
    try {
      return publicLinkForTenant(`/catalogo/colecao/${row.slug}`, tenantSlug());
    } catch {
      return "";
    }
  }

  return (
    <section className="stack catalog-collections-admin">
      <div className="panel">
        <CrudHeader
          title="Campanhas e coleções"
          subtitle={`Coleções temporárias com período próprio. Entram e saem do ar sozinhas no horário da loja (${timezone}). Encerrar não apaga produtos nem altera estoque.`}
          actionLabel="Nova campanha"
          onAction={() => openForm()}
          actions={[
            { label: "Fuso horário da loja", onClick: () => setTimezoneOpen(true) },
            onNavigate ? { label: "Voltar ao catálogo", icon: ArrowLeft, onClick: () => onNavigate("catalog") } : null
          ].filter(Boolean)}
        />
        {message && <p className="form-success" role="status">{message}</p>}
        <DataView
          rows={campaigns}
          rowKey={(row) => row.id}
          searchPlaceholder="Buscar campanha"
          filters={[{ key: "state", label: "Situação", type: "select", options: Object.entries(CAMPAIGN_STATE_LABELS).map(([value, label]) => ({ value, label })) }]}
          columns={[
            { key: "title", label: "Campanha", value: (row) => `${row.title} ${row.name} ${row.slug}`, render: (row) => (
              <><strong>{row.title}</strong><br /><small>{row.name !== row.title ? `${row.name} · ` : ""}/colecao/{row.slug}</small></>
            ) },
            { key: "state", label: "Situação", value: (row) => CAMPAIGN_STATE_LABELS[row.state], render: (row) => <StatusBadge status={CAMPAIGN_STATE_LABELS[row.state]} tone={STATE_TONES[row.state]} /> },
            { key: "starts_at", label: "Período", value: (row) => row.starts_local || "", render: (row) => periodText(row) },
            { key: "product_count", label: "Produtos", align: "right", render: (row) => (
              <>{row.product_count}{row.warnings?.length > 0 && <><br /><small className="field-hint is-error">{row.warnings.join(" ")}</small></>}</>
            ) },
            { key: "show_on_home", label: "Exibição", sortable: false, render: (row) => [row.show_on_home && "Página inicial", row.show_in_nav && "Navegação", row.highlighted && "Em destaque", row.promotion_name && `Promoção: ${row.promotion_name}`].filter(Boolean).join(" · ") || "Só pelo link" }
          ]}
          actions={(row) => (
            <RowActions actions={[
              { label: "Editar", onClick: () => openForm(row) },
              { label: "Produtos e subcategorias", onClick: () => setProductsFor(row) },
              { label: "Prévia", onClick: () => setPreviewId(row.id) },
              ...statusActions(row).map(([action, label]) => ({ label, onClick: () => run(() => requestJson(`/catalog-campaigns/${row.id}/status`, { method: "POST", body: { action } }), "Situação atualizada.") })),
              publicLink(row) && row.state === "active" ? { label: "Abrir no catálogo", href: publicLink(row), target: "_blank", rel: "noreferrer" } : null,
              row.status === "draft" ? { label: "Excluir rascunho", danger: true, onClick: () => setDeleting(row) } : null
            ]} />
          )}
          empty="Nenhuma campanha ainda. Crie a primeira, como Halloween ou Black Friday."
        />
      </div>

      <Modal open={formOpen} title={editing ? "Editar campanha" : "Nova campanha"} subtitle={`Datas no horário da loja (${timezone})`} onClose={() => setFormOpen(false)} footer={<><Button variant="secondary" onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" form="catalog-campaign-form">Salvar</Button></>}>
        <form id="catalog-campaign-form" className="stack" onSubmit={save}>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <FormSection title="Identificação">
            <div className="form-grid">
              <Input label="Nome interno" value={form.name} onChange={(name) => setForm({ ...form, name })} required maxLength={120} />
              <Input label="Título de exibição" value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="igual ao nome" maxLength={120} />
            </div>
            <Input label="Endereço (opcional)" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} placeholder="gerado a partir do título" maxLength={90} />
            <Textarea label="Descrição resumida" value={form.summary} onChange={(summary) => setForm({ ...form, summary })} rows={2} maxLength={400} />
          </FormSection>
          <FormSection title="Imagens">
            <CatalogImageField label="Banner para computador" value={form.banner_desktop_url} onChange={(banner_desktop_url) => setForm({ ...form, banner_desktop_url })} hint="Horizontal, de preferência 1600 × 600." />
            <CatalogImageField label="Imagem para celular" value={form.banner_mobile_url} onChange={(banner_mobile_url) => setForm({ ...form, banner_mobile_url })} hint="Vertical ou quadrada, de preferência 900 × 1100." />
            <CatalogImageField label="Capa ou miniatura" value={form.cover_url} onChange={(cover_url) => setForm({ ...form, cover_url })} hint="Usada quando falta algum banner." />
            <Input label="Texto alternativo das imagens" value={form.image_alt} onChange={(image_alt) => setForm({ ...form, image_alt })} maxLength={200} />
          </FormSection>
          <FormSection title="Período">
            <div className="form-grid">
              <Input type="datetime-local" label="Início" value={form.starts_local} onChange={(starts_local) => setForm({ ...form, starts_local })} />
              <Input type="datetime-local" label="Encerramento" value={form.ends_local} onChange={(ends_local) => setForm({ ...form, ends_local })} />
              <Input type="datetime-local" label="Destacar até (opcional)" value={form.highlight_until_local} onChange={(highlight_until_local) => setForm({ ...form, highlight_until_local })} />
            </div>
            <small className="field-hint">Sem início, vale a partir da publicação. Sem encerramento, fica no ar até ser encerrada. O destaque coloca a campanha em primeiro na faixa de coleções.</small>
          </FormSection>
          <FormSection title="Exibição">
            <div className="form-grid">
              <Select label="Posição na vitrine" value={form.display_position} onChange={(display_position) => setForm({ ...form, display_position })}>
                <option value="top">Topo do catálogo</option>
                <option value="before_products">Antes da lista de produtos</option>
              </Select>
              <Input type="number" label="Prioridade" value={form.priority} onChange={(priority) => setForm({ ...form, priority })} min="-1000" max="1000" step="1" />
            </div>
            <div className="chip-toggle-grid">
              <Switch id="campaign-home" label="Exibir na página inicial" description="" checked={form.show_on_home} onChange={(show_on_home) => setForm({ ...form, show_on_home })} />
              <Switch id="campaign-nav" label="Exibir na navegação" description="" checked={form.show_in_nav} onChange={(show_in_nav) => setForm({ ...form, show_in_nav })} />
            </div>
          </FormSection>
          <FormSection title="Desconto (opcional)">
            <Select label="Promoção" value={form.promotion_id} onChange={(promotion_id) => setForm({ ...form, promotion_id })}>
              <option value="">Sem desconto</option>
              {promotions.map((promotion) => <option key={promotion.id} value={String(promotion.id)}>{promotion.name}</option>)}
            </Select>
            <small className="field-hint">O desconto segue as regras da promoção escolhida (produtos, período e limites), cadastrada em Promoções. A campanha não cria desconto próprio.</small>
          </FormSection>
        </form>
      </Modal>

      {productsFor && <CampaignProductsModal campaignId={productsFor.id} onClose={() => { setProductsFor(null); refresh(); }} />}
      {previewId && <CampaignPreviewModal campaignId={previewId} onClose={() => setPreviewId(null)} />}
      {timezoneOpen && <StoreTimezoneModal current={timezone} onClose={(changed) => { setTimezoneOpen(false); if (changed) refresh(); }} />}

      <ConfirmDeleteModal
        open={Boolean(deleting)}
        message={deleting ? `Excluir o rascunho "${deleting.title}"? Os produtos não são afetados.` : ""}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting;
          setDeleting(null);
          await run(() => requestJson(`/catalog-campaigns/${target.id}`, { method: "DELETE" }), "Rascunho excluído.");
        }}
      />
    </section>
  );
}

/** @param {{ campaignId: any, onClose: () => any }} props */
function CampaignProductsModal({ campaignId, onClose }) {
  const path = `/catalog-campaigns/${campaignId}`;
  const { data, refresh } = useFetch(path);
  const [sectionName, setSectionName] = useState("");
  const [addSection, setAddSection] = useState("");
  const [error, setError] = useState("");
  const campaign = asObject(data);
  const sections = asArray(campaign.sections);
  const products = asArray(campaign.products);

  async function act(action) {
    setError("");
    try {
      const result = await action();
      refresh();
      return result;
    } catch (failure) {
      setError(failure.message);
      throw failure;
    }
  }

  return (
    <Modal open size="workspace" title={`Produtos de ${campaign.title || "campanha"}`} subtitle="Vincular não copia o produto: estoque, SKU e variações continuam no mesmo cadastro." dismissible confirmClose={false} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      {data == null ? <Loading /> : (
        <div className="stack">
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="soft-card stack">
            <strong>Subcategorias da campanha</strong>
            <small className="field-hint">Opcional: separam a coleção em grupos, como "Topos temáticos" ou "Argolas".</small>
            <div className="catalog-subcategories">
              {sections.map((section) => (
                <span key={section.id} className="catalog-admin-chip">
                  {section.name}
                  <Button type="button" variant="ghost" aria-label={`Remover ${section.name}`} onClick={() => act(() => requestJson(`${path}/sections/${section.id}`, { method: "DELETE" })).catch(() => {})}>×</Button>
                </span>
              ))}
            </div>
            <div className="toolbar">
              <Input label="Nova subcategoria" value={sectionName} onChange={setSectionName} maxLength={80} />
              <Button type="button" variant="secondary" disabled={!sectionName.trim()} onClick={() => act(() => requestJson(`${path}/sections`, { method: "POST", body: { name: sectionName } })).then(() => setSectionName("")).catch(() => {})}>Adicionar</Button>
            </div>
          </div>
          <div className="catalog-admin-products">
            <div className="stack">
              <h3>Na campanha ({products.length})</h3>
              <DataView
                rows={products}
                rowKey={(row) => row.id}
                searchPlaceholder="Buscar na campanha"
                columns={[
                  { key: "name", label: "Produto", render: (row) => <><strong>{row.name}</strong><br /><small>{row.sku ? `SKU ${row.sku}` : "Sem SKU"}</small></> },
                  { key: "available_quantity", label: "Estoque", align: "right", render: (row) => row.available_quantity > 0 && row.published ? row.available_quantity : <StatusBadge status={row.published ? "Sem estoque" : "Fora do catálogo"} tone="warn" /> },
                  ...(sections.length ? [{ key: "section_id", label: "Subcategoria", sortable: false, render: (row) => (
                    <Select label={null} ariaLabel={`Subcategoria de ${row.name}`} value={row.section_id ? String(row.section_id) : ""} onChange={(value) => act(() => requestJson(`${path}/products/${row.id}`, { method: "PATCH", body: { section_id: value ? Number(value) : null } })).catch(() => {})}>
                      <option value="">Sem subcategoria</option>
                      {sections.map((section) => <option key={section.id} value={String(section.id)}>{section.name}</option>)}
                    </Select>
                  ) }] : [])
                ]}
                actions={(row) => <RowActions actions={[{ label: "Remover da campanha", danger: true, onClick: () => act(() => requestJson(`${path}/products/${row.id}`, { method: "DELETE" })).catch(() => {}) }]} />}
                empty="Nenhum produto ainda. Busque e adicione ao lado."
              />
            </div>
            <div className="stack">
              <h3>Adicionar produtos</h3>
              <CatalogProductPicker
                linkedIds={products.map((product) => product.id)}
                extra={sections.length > 0 && (
                  <Select label="Adicionar na subcategoria" value={addSection} onChange={setAddSection}>
                    <option value="">Sem subcategoria</option>
                    {sections.map((section) => <option key={section.id} value={String(section.id)}>{section.name}</option>)}
                  </Select>
                )}
                onAdd={(ids) => act(() => requestJson(`${path}/products`, { method: "POST", body: { product_ids: ids, section_id: addSection ? Number(addSection) : null } }))}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Prévia com o mesmo layout da página pública da coleção. @param {{ campaignId: any, onClose: () => any }} props */
function CampaignPreviewModal({ campaignId, onClose }) {
  const { data } = useFetch(`/catalog-campaigns/${campaignId}`);
  const [section, setSection] = useState("");
  const campaign = asObject(data);
  const sections = asArray(campaign.sections);
  const selected = sections.find((entry) => entry.slug === section);
  const products = asArray(campaign.products).filter((product) => product.published && (!selected || Number(product.section_id) === Number(selected.id)));
  const hidden = asArray(campaign.products).filter((product) => !product.published).length;
  return (
    <Modal open size="workspace" title="Prévia da coleção" subtitle={`Situação: ${CAMPAIGN_STATE_LABELS[campaign.state] || "—"}. Produtos fora do catálogo público não aparecem para o cliente.`} dismissible confirmClose={false} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      {data == null ? <Loading /> : (
        <div className="catalog-page catalog-campaign-preview">
          {hidden > 0 && <p className="field-hint is-error">{hidden} produto(s) vinculado(s) estão fora do catálogo público e não aparecem.</p>}
          <CampaignShowcase campaign={campaign} sectionSlug={section} onSectionChange={setSection} count={products.length}>
            <div className="catalog-admin-preview-grid">
              {products.map((product) => (
                <article key={product.id} className="catalog-admin-preview-card">
                  {product.photo_url ? <img src={collectionImageUrl(product.photo_url)} alt="" /> : <span aria-hidden="true" />}
                  <strong>{product.name}</strong>
                  {product.sku && <small>SKU {product.sku}</small>}
                  <span>{money.format(product.sale_value || 0)}</span>
                  {product.available_quantity <= 0 && <small className="field-hint is-error">Esgotado</small>}
                </article>
              ))}
            </div>
          </CampaignShowcase>
        </div>
      )}
    </Modal>
  );
}

/** @param {{ current: string, onClose: (changed: boolean) => any }} props */
function StoreTimezoneModal({ current, onClose }) {
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");
  const options = TIMEZONES.includes(current) ? TIMEZONES : [current, ...TIMEZONES];
  return (
    <Modal open title="Fuso horário da loja" subtitle="As datas das campanhas são digitadas e exibidas neste horário." onClose={() => onClose(false)} footer={<><Button variant="secondary" onClick={() => onClose(false)}>Cancelar</Button><Button onClick={async () => {
      setError("");
      try {
        await requestJson("/catalog-campaigns/settings", { method: "PUT", body: { timezone: value } });
        onClose(true);
      } catch (failure) {
        setError(failure.message);
      }
    }}>Salvar</Button></>}>
      <div className="stack">
        {error && <p className="form-error" role="alert">{error}</p>}
        <Select label="Fuso horário" value={value} onChange={setValue}>
          {options.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
        </Select>
        <small className="field-hint">Mudar o fuso não altera o instante das campanhas já agendadas; só a forma como os horários aparecem e como novas datas são interpretadas.</small>
      </div>
    </Modal>
  );
}
