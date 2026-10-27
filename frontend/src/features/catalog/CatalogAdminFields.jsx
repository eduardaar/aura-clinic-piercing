// Campos compartilhados das telas de categorias e campanhas da vitrine.
import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button, Checkbox, Input, StatusBadge } from "../../components/common/Ui";
import { apiFetch, useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { useDebouncedValue } from "../../lib/smartSearch";
import { collectionImageUrl } from "./CatalogCollections";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** @param {{ label: string, value: string, hint?: string, onChange: (url: string) => any }} props */
export function CatalogImageField({ label, value, hint, onChange }) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setMessage("Use uma imagem JPEG, PNG ou WebP.");
    if (file.size > 6 * 1024 * 1024) return setMessage("A imagem deve ter no máximo 6 MB.");
    setMessage("");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch("/uploads", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) return setMessage(payload.error || "Não foi possível enviar a imagem.");
      onChange(payload.url);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="catalog-admin-image-field">
      <span className="catalog-admin-image-field__label">{label}</span>
      <div className="catalog-admin-image-field__body">
        <span className="catalog-admin-image-field__preview">{value ? <img src={collectionImageUrl(value)} alt="" /> : <ImagePlus size={22} aria-hidden="true" />}</span>
        <div className="stack">
          <div className="toolbar">
            <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={upload} aria-label={label} />
            <Button type="button" variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? "Enviando..." : value ? "Substituir" : "Enviar imagem"}</Button>
            {value && <Button type="button" variant="ghost" onClick={() => onChange("")}>Remover</Button>}
          </div>
          {hint && <small className="field-hint">{hint}</small>}
          {message && <small className="field-hint is-error" role="alert">{message}</small>}
        </div>
      </div>
    </div>
  );
}

/**
 * Seleção de vários produtos de uma vez, por nome ou SKU. Produtos já
 * vinculados aparecem marcados e não são enviados de novo.
 * @param {{ linkedIds?: any[], onAdd: (ids: number[]) => Promise<any>, extra?: React.ReactNode }} props
 */
export function CatalogProductPicker({ linkedIds = [], onAdd, extra = null }) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search);
  const { data, error } = useFetch(`/catalog-products?limit=80&search=${encodeURIComponent(debounced)}`);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const linked = new Set(asArray(linkedIds).map(Number));
  const products = asArray(data);
  const selectable = products.filter((product) => !linked.has(Number(product.id)));
  const allSelected = selectable.length > 0 && selectable.every((product) => selected.includes(product.id));

  const toggle = (id, checked) => setSelected((current) => (checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)));

  async function add() {
    if (!selected.length) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await onAdd(selected);
      setSelected([]);
      setMessage(result?.added !== undefined ? `${result.added} produto(s) adicionado(s).${result.already_linked ? ` ${result.already_linked} já estava(m) vinculado(s).` : ""}` : "");
    } catch (failure) {
      setMessage(failure?.message || "Não foi possível adicionar os produtos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="catalog-product-picker stack">
      <div className="catalog-product-picker__toolbar">
        <Input label="Buscar produto por nome ou SKU" value={search} onChange={setSearch} placeholder="Ex.: labret, TIT-LAB-005" />
        {extra}
      </div>
      {error && <p className="form-error">Não foi possível carregar os produtos.</p>}
      <div className="catalog-product-picker__head">
        <Checkbox label={allSelected ? "Desmarcar todos" : `Marcar todos os ${selectable.length} resultados`} checked={allSelected} disabled={!selectable.length} onChange={(checked) => setSelected(checked ? selectable.map((product) => product.id) : [])} />
        <Button type="button" disabled={busy || !selected.length} onClick={add}>{busy ? "Adicionando..." : `Adicionar ${selected.length || ""} selecionado(s)`}</Button>
      </div>
      {message && <small className="field-hint" role="status">{message}</small>}
      <ul className="catalog-product-picker__list" aria-label="Produtos encontrados">
        {products.map((product) => {
          const isLinked = linked.has(Number(product.id));
          return (
            <li key={product.id} className={isLinked ? "is-linked" : ""}>
              <Checkbox
                label={<span className="catalog-product-picker__item">
                  <strong>{product.name}</strong>
                  <small>{[product.sku && `SKU ${product.sku}`, money.format(product.sale_value || 0), `${product.available_quantity} em estoque`].filter(Boolean).join(" · ")}</small>
                </span>}
                checked={isLinked || selected.includes(product.id)}
                disabled={isLinked}
                onChange={(checked) => toggle(product.id, checked)}
              />
              {isLinked ? <StatusBadge status="Vinculado" tone="info" /> : !product.published ? <StatusBadge status="Fora do catálogo" tone="warn" /> : null}
            </li>
          );
        })}
        {data && !products.length && <li className="empty-state">Nenhum produto encontrado.</li>}
      </ul>
    </div>
  );
}
