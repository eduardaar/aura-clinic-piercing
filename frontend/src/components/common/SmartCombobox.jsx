import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { smartSearchMatches, useDebouncedValue } from "../../lib/smartSearch";

function optionText(item) {
  return [item.name, item.variation_name, item.category, item.subcategory, item.sku, item.material, item.color,
    item.size, item.thickness, item.length, item.diameter,
    ...(Array.isArray(item.variants) ? item.variants.flatMap((variant) => [variant.sku, variant.variation_name, variant.material, variant.color, variant.size, variant.thickness, variant.length, variant.diameter]) : [])]
    .filter(Boolean).join(" ");
}

export function SmartCombobox({ label, value, onChange, options = [], placeholder = "Buscar por nome, SKU, material, cor ou medida", emptyLabel = "Nenhum resultado", required = false, getLabel = (item) => item.name, getMeta, isDisabled = (item) => Number(item.quantity ?? item.inventory_quantity ?? 1) <= 0 }) {
  const id = useId();
  const root = useRef(null);
  const selected = options.find((item) => String(item.id) === String(value));
  const selectedLabel = selected ? getLabel(selected) : "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query, 180);
  useEffect(() => { if (!open) setQuery(selectedLabel); }, [open, selectedLabel]);
  useEffect(() => {
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const filtered = useMemo(() => options.filter((item) => smartSearchMatches(optionText(item), debounced)).slice(0, 80), [options, debounced]);
  function select(item) {
    if (isDisabled(item)) return;
    onChange(String(item.id));
    setQuery(getLabel(item));
    setOpen(false);
  }
  function keyDown(event) {
    if (event.key === "Escape") return setOpen(false);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      setActive((current) => Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
    }
    if (event.key === "Enter" && open && filtered[active]) { event.preventDefault(); select(filtered[active]); }
  }
  return (
    <label className="smart-combobox" ref={root}>
      {label}<span className="smart-combobox-input"><Search size={16} /><input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" required={required} value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }} onKeyDown={keyDown} />
      {(value || query) && <button type="button" aria-label="Limpar seleção" onClick={() => { onChange(""); setQuery(""); setOpen(true); }}><X size={15} /></button>}</span>
      {open && <div className="smart-combobox-list" id={`${id}-list`} role="listbox">
        {filtered.length ? filtered.map((item, index) => {
          const disabled = isDisabled(item); const meta = getMeta?.(item);
          return <button type="button" role="option" aria-selected={String(item.id) === String(value)} aria-disabled={disabled} disabled={disabled} className={index === active ? "active" : ""} key={item.id} onMouseEnter={() => setActive(index)} onClick={() => select(item)}><strong>{getLabel(item)}</strong>{meta && <small>{meta}</small>}<span className={disabled ? "stock-out" : "stock-ok"}>{disabled ? "Esgotado" : "Disponível"}</span></button>;
        }) : <p className="smart-combobox-empty">{emptyLabel}</p>}
      </div>}
    </label>
  );
}
