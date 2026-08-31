import { Button } from "./Ui";
import "./transaction-fields.css";

function cellValue(item, column, index) {
  if (column.render) return column.render(item, index);
  const value = column.value ? column.value(item) : item?.[column.key];
  return value === null || value === undefined || value === "" ? "—" : value;
}

/** Lista transacional: tabela no desktop e cartões sem rolagem horizontal no mobile. */
export function ResponsiveEditableList({
  items = [],
  columns = [],
  getKey = (item, index) => item?.id ?? index,
  empty = "Nenhum item adicionado.",
  ariaLabel = "Itens",
  onEdit = null,
  onRemove = null,
  editLabel = "Editar",
  removeLabel = "Remover",
  getError = null,
}) {
  if (!items.length) return <p className="empty-state">{empty}</p>;
  const gridStyle = { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))${onEdit || onRemove ? " auto" : ""}` };
  return (
    <div className="transaction-list" aria-label={ariaLabel}>
      <div className="transaction-list__header" style={gridStyle} aria-hidden="true">
        {columns.map((column) => <span key={column.key}>{column.label}</span>)}
        {(onEdit || onRemove) && <span>Ações</span>}
      </div>
      <div className="transaction-list__rows">
        {items.map((item, index) => <article key={getKey(item, index)} style={gridStyle} className={getError?.(item, index) ? "is-invalid" : ""}>
          {columns.map((column) => <div className="transaction-list__cell" key={column.key} data-align={column.align}>
            <span>{column.label}</span><div>{cellValue(item, column, index)}</div>
          </div>)}
          {(onEdit || onRemove) && <div className="transaction-list__actions">
            {onEdit && <Button type="button" variant="secondary" onClick={() => onEdit(item, index)}>{editLabel}</Button>}
            {onRemove && <Button type="button" variant="ghost" onClick={() => onRemove(item, index)}>{removeLabel}</Button>}
          </div>}
          {getError?.(item, index) && <p className="form-error">{getError(item, index)}</p>}
        </article>)}
      </div>
    </div>
  );
}

/** Totais compactos compartilhados por compras, vendas e atendimentos. */
export function TransactionTotals({ rows = [], ariaLabel = "Totais da operação" }) {
  return <dl className="transaction-totals" aria-label={ariaLabel}>
    {rows.map((row) => <div key={row.id || row.label} className={row.emphasis ? "is-emphasis" : ""}>
      <dt>{row.label}</dt><dd>{row.value}</dd>
    </div>)}
  </dl>;
}
