// Categorias e subcategorias do catálogo público (vitrine comercial). São
// independentes das categorias internas do estoque e das financeiras.
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Input, Select, StatusBadge, Switch, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading, ApiError } from "../../components/common/Feedback";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { categoryDescendantIds } from "../../lib/catalogNavigation";
import { CatalogImageField, CatalogProductPicker } from "./CatalogAdminFields";
import "../../styles/catalog-collections.css";
// Largura do modal `size="workspace"` (o vínculo de produtos usa duas colunas).
import "../../styles/appointment-workspace.css";

const EMPTY_FORM = { name: "", parent_id: "", slug: "", description: "", image_url: "", image_alt: "", is_active: true };

async function requestJson(path, options = {}) {
  const response = await apiFetch(path, { ...options, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

/** @param {{ onNavigate?: (page: string) => any }} props */
export function CatalogCategoriesAdmin({ onNavigate }) {
  const { data } = useFetch("/catalog-categories");
  const invalidate = useApiInvalidate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [productsFor, setProductsFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [message, setMessage] = useState("");

  if (data == null) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const categories = asArray(data);
  const refresh = () => invalidate("/catalog-categories", "/catalog");

  function openForm(category = null, parentId = "") {
    setEditing(category);
    setForm(category
      ? { name: category.name, parent_id: category.parent_id ? String(category.parent_id) : "", slug: category.slug, description: category.description || "", image_url: category.image_url || "", image_alt: category.image_alt || "", is_active: Boolean(category.is_active) }
      : { ...EMPTY_FORM, parent_id: parentId ? String(parentId) : "" });
    setFormError("");
    setFormOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setFormError("");
    const body = { ...form, parent_id: form.parent_id ? Number(form.parent_id) : null, slug: form.slug.trim() };
    try {
      await requestJson(editing ? `/catalog-categories/${editing.id}` : "/catalog-categories", { method: editing ? "PATCH" : "POST", body });
      setFormOpen(false);
      setMessage(editing ? "Categoria atualizada." : "Categoria criada.");
      refresh();
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

  // Sobe ou desce entre as irmãs do mesmo nível.
  function move(category, direction) {
    const siblings = categories.filter((row) => String(row.parent_id || "") === String(category.parent_id || ""));
    const index = siblings.findIndex((row) => row.id === category.id);
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const ids = siblings.map((row) => row.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => requestJson("/catalog-categories/order", { method: "PATCH", body: { parent_id: category.parent_id || null, ids } }));
  }

  // A categoria não pode ir para dentro de si mesma nem de uma descendente.
  const blockedParents = editing ? categoryDescendantIds(categories, editing.id) : new Set();
  const parentOptions = categories.filter((row) => !blockedParents.has(Number(row.id)));

  return (
    <section className="stack catalog-collections-admin">
      <div className="panel">
        <CrudHeader
          title="Categorias da vitrine"
          subtitle="Organize categorias e subcategorias do catálogo público. Um produto pode estar em várias, sem duplicar cadastro nem estoque. As categorias internas do estoque não mudam."
          actionLabel="Nova categoria"
          onAction={() => openForm()}
          actions={[
            { label: "Criar estrutura sugerida", onClick: () => run(async () => { const result = await requestJson("/catalog-categories/suggested", { method: "POST" }); setMessage(`${result.created} categoria(s) criada(s). As existentes foram mantidas.`); }) },
            onNavigate ? { label: "Voltar ao catálogo", icon: ArrowLeft, onClick: () => onNavigate("catalog") } : null
          ].filter(Boolean)}
        />
        {message && <p className="form-success" role="status">{message}</p>}
        <DataView
          rows={categories}
          rowKey={(row) => row.id}
          defaultPageSize={100}
          searchPlaceholder="Buscar categoria"
          filters={[{ key: "is_active", label: "Situação", type: "select", options: [{ value: "1", label: "Visíveis" }, { value: "0", label: "Ocultas" }], match: (row, value) => String(Number(Boolean(row.is_active))) === value }]}
          columns={[
            { key: "path", label: "Categoria", sortable: false, value: (row) => row.path, render: (row) => (
              <span className="catalog-admin-tree-cell" style={/** @type {React.CSSProperties} */ ({ "--depth": row.depth })}>
                <strong>{row.name}</strong>
                {row.depth > 0 && <small>{row.path}</small>}
              </span>
            ) },
            { key: "product_count", label: "Produtos", align: "right", sortable: false },
            { key: "child_count", label: "Subcategorias", align: "right", sortable: false },
            { key: "slug", label: "Endereço", sortable: false, render: (row) => <code>{row.slug}</code> },
            { key: "is_active", label: "Situação", sortable: false, render: (row) => <StatusBadge status={row.is_active ? "Visível" : "Oculta"} tone={row.is_active ? "ok" : "neutral"} /> }
          ]}
          actions={(row) => (
            <RowActions actions={[
              { label: "Editar", onClick: () => openForm(row) },
              { label: "Adicionar subcategoria", onClick: () => openForm(null, row.id) },
              { label: "Produtos", onClick: () => setProductsFor(row) },
              { label: "Subir", onClick: () => move(row, -1) },
              { label: "Descer", onClick: () => move(row, 1) },
              { label: row.is_active ? "Ocultar do catálogo" : "Exibir no catálogo", onClick: () => run(() => requestJson(`/catalog-categories/${row.id}`, { method: "PATCH", body: { is_active: !row.is_active } }), row.is_active ? "Categoria oculta." : "Categoria visível.") },
              { label: "Excluir", danger: true, onClick: () => setDeleting(row) }
            ]} />
          )}
          empty="Nenhuma categoria ainda. Crie a primeira ou use a estrutura sugerida em Mais opções."
        />
      </div>

      <Modal open={formOpen} title={editing ? "Editar categoria" : "Nova categoria"} subtitle="Categoria do catálogo público" onClose={() => setFormOpen(false)} footer={<><Button variant="secondary" onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" form="catalog-category-form">Salvar</Button></>}>
        <form id="catalog-category-form" className="stack" onSubmit={save}>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="form-grid">
            <Input label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} required maxLength={80} />
            <Select label="Categoria principal" value={form.parent_id} onChange={(parent_id) => setForm({ ...form, parent_id })}>
              <option value="">Nenhuma (categoria principal)</option>
              {parentOptions.map((row) => <option key={row.id} value={String(row.id)}>{row.path}</option>)}
            </Select>
          </div>
          <Input label="Endereço (opcional)" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} placeholder="gerado a partir do nome" maxLength={90} />
          <small className="field-hint">Usado no link da categoria. Letras minúsculas, números e hífens; precisa ser único.</small>
          <Textarea label="Descrição" value={form.description} onChange={(description) => setForm({ ...form, description })} rows={3} maxLength={600} />
          <CatalogImageField label="Imagem da categoria" value={form.image_url} onChange={(image_url) => setForm({ ...form, image_url })} hint="Aparece nos blocos de categoria. Sem imagem, a vitrine usa um ícone." />
          {form.image_url && <Input label="Texto alternativo da imagem" value={form.image_alt} onChange={(image_alt) => setForm({ ...form, image_alt })} maxLength={200} />}
          <Switch id="catalog-category-active" label="Visível no catálogo público" description="Oculta, a categoria e as subcategorias saem da vitrine; os produtos continuam publicados." checked={form.is_active} onChange={(is_active) => setForm({ ...form, is_active })} />
        </form>
      </Modal>

      {productsFor && <CategoryProductsModal category={productsFor} onClose={() => { setProductsFor(null); refresh(); }} />}

      <ConfirmDeleteModal
        open={Boolean(deleting)}
        message={deleting ? `Excluir a categoria "${deleting.name}"? Categorias com subcategorias ou produtos não são excluídas; nesse caso, oculte a categoria.` : ""}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting;
          setDeleting(null);
          await run(() => requestJson(`/catalog-categories/${target.id}`, { method: "DELETE" }), "Categoria excluída.");
        }}
      />
    </section>
  );
}

/** @param {{ category: any, onClose: () => any }} props */
function CategoryProductsModal({ category, onClose }) {
  const path = `/catalog-categories/${category.id}/products`;
  const { data, refresh } = useFetch(path);
  const [error, setError] = useState("");
  const products = asArray(data?.products);

  async function remove(product) {
    setError("");
    try {
      await requestJson(`${path}/${product.id}`, { method: "DELETE" });
      refresh();
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <Modal open size="workspace" title={`Produtos em ${category.path || category.name}`} subtitle="Vincular não copia o produto: estoque, SKU e variações continuam no mesmo cadastro." dismissible confirmClose={false} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="catalog-admin-products">
        <div className="stack">
          <h3>Vinculados ({products.length})</h3>
          {error && <p className="form-error" role="alert">{error}</p>}
          <DataView
            rows={products}
            rowKey={(row) => row.id}
            searchPlaceholder="Buscar nos vinculados"
            columns={[
              { key: "name", label: "Produto", render: (row) => <><strong>{row.name}</strong><br /><small>{row.sku ? `SKU ${row.sku}` : "Sem SKU"}</small></> },
              { key: "available_quantity", label: "Estoque", align: "right" },
              { key: "published", label: "Catálogo", render: (row) => <StatusBadge status={row.published ? "Publicado" : "Fora do catálogo"} tone={row.published ? "ok" : "warn"} /> }
            ]}
            actions={(row) => <RowActions actions={[{ label: "Remover da categoria", danger: true, onClick: () => remove(row) }]} />}
            empty="Nenhum produto vinculado."
          />
        </div>
        <div className="stack">
          <h3>Adicionar produtos</h3>
          <CatalogProductPicker
            linkedIds={products.map((product) => product.id)}
            onAdd={async (ids) => {
              const result = await requestJson(path, { method: "POST", body: { product_ids: ids } });
              refresh();
              return result;
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
