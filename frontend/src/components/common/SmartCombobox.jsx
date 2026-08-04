import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import { smartSearchMatches, useDebouncedValue } from "../../lib/smartSearch";
import { API_ORIGIN } from "../../lib/api";

const PAGE_SIZE = 40;
const MAX_RESULTS = 200;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function optionText(item) {
  return [item.name, item.variation_name, item.category, item.subcategory, item.sku, item.material, item.color,
    item.stone, item.stone_color, item.size, item.top_size_mm, item.thickness, item.stem_length, item.length,
    item.length_mm, item.diameter, item.thread_type, item.sale_value, item.sale_price_cents, item.status,
    ...(Array.isArray(item.variants) ? item.variants.flatMap((variant) => [variant.sku, variant.variation_name,
      variant.material, variant.color, variant.stone_color, variant.size, variant.top_size_mm, variant.thickness,
      variant.length, variant.length_mm, variant.diameter, variant.thread_type, variant.sale_value, variant.status]) : [])]
    .filter((value) => value !== undefined && value !== null && value !== "").join(" ");
}

function imageUrl(item) {
  const value = item.photo_url || item.image_url || item.primary_image_url || "";
  return value.startsWith("/uploads/") ? `${API_ORIGIN}${value}` : value;
}

function stock(item) {
  if (Array.isArray(item.variants) && item.variants.length) {
    return item.variants.reduce((total, variant) => total + Math.max(0, Number(variant.quantity || 0)), 0);
  }
  return Math.max(0, Number(item.quantity ?? item.inventory_quantity ?? 0));
}

function price(item) {
  const value = Number(item.sale_value || 0) || Number(item.sale_price_cents || 0) / 100;
  return money.format(value);
}

function compactMeasure(item) {
  const parts = [
    item.length || item.length_mm,
    item.thickness,
    item.diameter,
    item.size,
    item.stem_length,
    item.top_size_mm ? `Topo ${item.top_size_mm} mm` : "",
    item.thread_type
  ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
  return parts.join(" • ");
}

function defaultMeta(item) {
  return [item.category, item.material, item.color].filter(Boolean).join(" • ");
}

function stockStatus(item) {
  const quantity = stock(item);
  const threshold = Number(item.low_stock_threshold || item.low_stock_limit || 3);
  if (quantity <= 0) return { label: "Esgotado", tone: "stock-out", text: "Esgotado · 0 unidades" };
  if (quantity <= threshold) return { label: "Baixo estoque", tone: "stock-low", text: `Baixo estoque · ${quantity} ${quantity === 1 ? "unidade" : "unidades"}` };
  return { label: "Disponível", tone: "stock-ok", text: `Disponível · ${quantity} ${quantity === 1 ? "unidade" : "unidades"}` };
}

export function SmartCombobox({ label, value, onChange, onSelect, options = [], placeholder = "Buscar joia, SKU ou medida", emptyLabel = "Nenhuma joia encontrada", required = false, loading = false, getLabel = (item) => item.name, getMeta, isDisabled = (item) => stock(item) <= 0 }) {
  const id = useId();
  const root = useRef(null);
  const selected = options.find((item) => String(item.id) === String(value));
  const selectedLabel = selected ? getLabel(selected) : "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [popupStyle, setPopupStyle] = useState({});
  const debounced = useDebouncedValue(query, 180);

  useEffect(() => { if (!open) setQuery(selectedLabel); }, [open, selectedLabel]);
  useEffect(() => { setVisible(PAGE_SIZE); setActive(0); }, [debounced]);
  useEffect(() => {
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (!open || !root.current) return undefined;
    const updatePosition = () => {
      const rect = root.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const minWidth = Math.max(420, Math.min(rect.width, 520));
      const width = Math.min(minWidth, Math.max(420, viewportWidth - 16));
      const maxHeight = Math.min(520, Math.max(420, viewportHeight - 96));
      const top = Math.min(rect.bottom + 8, viewportHeight - maxHeight - 8);
      const left = Math.min(Math.max(rect.left, 8), Math.max(8, viewportWidth - width - 8));
      setPopupStyle({ top: `${Math.max(8, top)}px`, left: `${left}px`, width: `${width}px`, maxWidth: `${Math.max(420, Math.min(viewportWidth - 16, 520))}px`, maxHeight: `${maxHeight}px` });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const matches = useMemo(() => options.filter((item) => smartSearchMatches(optionText(item), debounced)).slice(0, MAX_RESULTS), [options, debounced]);
  const filtered = matches.slice(0, visible);

  function select(item) {
    if (isDisabled(item)) return;
    onChange(String(item.id));
    onSelect?.(item);
    setQuery(getLabel(item));
    setOpen(false);
  }

  function selectOnPress(event, item) {
    event.preventDefault();
    event.stopPropagation();
    select(item);
  }

  function selectOnClick(event, item) {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 0) select(item);
  }

  function keyDown(event) {
    if (event.key === "Escape") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      setActive((current) => Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
    }
    if (event.key === "Enter" && open && filtered[active]) { event.preventDefault(); select(filtered[active]); }
  }

  return (
    <label className="smart-combobox" ref={root}>
      <span className="smart-combobox-label">{label}</span>
      <span className="smart-combobox-input" aria-busy={loading}>
        <Search size={16} className="smart-combobox-search-icon" />
        <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && filtered[active] ? `${id}-option-${filtered[active].id}` : undefined} required={required} value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={keyDown} />
        {loading ? <LoaderCircle className="smart-combobox-spinner" size={16} aria-label="Carregando" /> : (value || query) ? <button type="button" aria-label="Limpar seleção" onClick={() => { onChange(""); setQuery(""); setOpen(true); }}><X size={15} /></button> : <button type="button" aria-label="Abrir lista" tabIndex={-1} className="smart-combobox-chevron-button"><ChevronDown size={15} /></button>}
      </span>
      {open && createPortal(
        <div className="smart-combobox-list" id={`${id}-list`} role="listbox" style={popupStyle}>
          <div className="smart-combobox-mobile-head"><strong>{label}</strong><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}><X size={20} /></button></div>
          <p className="smart-combobox-status" aria-live="polite">{loading ? "Buscando joias…" : `${matches.length} resultado${matches.length === 1 ? "" : "s"} disponível${matches.length === 1 ? "" : "is"}`}</p>
          {loading ? <p className="smart-combobox-empty"><LoaderCircle className="smart-combobox-spinner" size={18} /> Buscando joias…</p> : filtered.length ? filtered.map((item, index) => {
            const disabled = isDisabled(item);
            const meta = getMeta?.(item) || defaultMeta(item);
            const quantity = stock(item);
            const status = stockStatus(item);
            const displayMeta = [meta, compactMeasure(item)].filter(Boolean).join(" • ");
            const labelText = getLabel(item) || "Joia sem nome";
            const picture = imageUrl(item);
            return <button id={`${id}-option-${item.id}`} type="button" role="option" aria-selected={String(item.id) === String(value)} aria-disabled={disabled} disabled={disabled} className={index === active ? "active" : ""} key={item.id} onMouseEnter={() => setActive(index)} onPointerDown={(event) => selectOnPress(event, item)} onClick={(event) => selectOnClick(event, item)}>
              <span className="smart-combobox-thumb">{picture ? <img src={picture} alt={labelText} /> : <span aria-hidden="true">◇</span>}</span>
              <span className="smart-combobox-copy">
                <strong>{labelText}</strong>
                {displayMeta && <small>{displayMeta}</small>}
                <small className="smart-combobox-sku">SKU: {item.sku || "não informado"}</small>
              </span>
              <span className="smart-combobox-values">
                <strong>{price(item)}</strong>
                <small className="smart-combobox-stock-meta">Estoque: {quantity} {quantity === 1 ? "unidade" : "unidades"}</small>
                <span className={`smart-combobox-stock ${status.tone}`}>{status.text}</span>
              </span>
            </button>;
          }) : <p className="smart-combobox-empty">{emptyLabel}</p>}
          {visible < matches.length && <button type="button" className="smart-combobox-more" onClick={() => setVisible((count) => Math.min(count + PAGE_SIZE, MAX_RESULTS))}>Mostrar mais resultados</button>}
          {matches.length === MAX_RESULTS && visible >= MAX_RESULTS && <p className="smart-combobox-hint">Refine a busca para ver outros resultados.</p>}
        </div>,
        document.body
      )}
    </label>
  );
}
