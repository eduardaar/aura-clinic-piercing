// Componente padrão de listagem: busca, filtros avançados, ordenação por coluna
// e paginação — com estados de carregando, erro e vazio no mesmo lugar.
//
// Substitui o DataTable nu, que não tinha nada disso e obrigava cada tela a
// reinventar a barra de ferramentas (o inventário achou 4 marcações diferentes
// de busca e 7 tratamentos diferentes de estado vazio).
//
// Dois modos:
//
//   mode="client" (padrão) — recebe a lista inteira e cuida de tudo em memória.
//       É o caminho de migração: a tela ganha paginação e ordenação sem
//       depender de mudança no backend.
//
//   mode="server" — a tela controla `page`, `sort`, `search` e `filters` e
//       repassa `total`. Use quando o endpoint já pagina, para não trazer a
//       base inteira só para exibir 20 linhas.
import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Filter, Search, X } from "lucide-react";

const PAGE_SIZES = [10, 25, 50, 100];

// Meses para filtros de data (aniversário, competência…). Fica aqui para as
// telas não reescreverem a mesma lista com nomes ligeiramente diferentes.
export const MONTH_OPTIONS = [
  { value: "01", label: "Janeiro" }, { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" }, { value: "04", label: "Abril" },
  { value: "05", label: "Maio" }, { value: "06", label: "Junho" },
  { value: "07", label: "Julho" }, { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" }, { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

// Comparação tolerante a acento e caixa, para busca e ordenação de texto.
const fold = (value) =>
  String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;   // vazios sempre no fim
  if (b === null || b === undefined || b === "") return -1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== "" && String(b).trim() !== "") {
    return na - nb;
  }
  return fold(a).localeCompare(fold(b), "pt-BR");
}

// Valor usado para buscar e ordenar. `render` pode devolver JSX, então a coluna
// declara `value(row)` quando o dado exibido não é `row[key]` cru.
function cellValue(col, row) {
  if (col.value) return col.value(row);
  return row[col.key];
}

export function DataView({
  columns,
  rows = [],
  rowKey = (row) => row.id,
  actions,
  mode = "client",

  loading = false,
  error = "",

  // Busca
  searchable = true,
  searchPlaceholder = "Buscar…",
  search: searchProp,
  onSearchChange,

  // Filtros avançados: [{ key, label, type: "select"|"date"|"text", options }]
  filters = [],
  filterValues: filterValuesProp,
  onFilterChange,

  // Ordenação: { key, dir: "asc"|"desc" }
  sort: sortProp,
  onSortChange,
  defaultSort = null,

  // Paginação
  paginated = true,
  page: pageProp,
  pageSize: pageSizeProp,
  defaultPageSize = 25,
  total: totalProp,
  onPageChange,
  onPageSizeChange,

  toolbar,
  empty = "Nenhum registro encontrado.",
  emptyFiltered = "Nenhum registro corresponde aos filtros aplicados.",
  caption,
}) {
  const isServer = mode === "server";

  const [searchState, setSearchState] = useState("");
  const [filterState, setFilterState] = useState({});
  const [sortState, setSortState] = useState(defaultSort);
  const [pageState, setPageState] = useState(1);
  const [pageSizeState, setPageSizeState] = useState(defaultPageSize);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const search = searchProp !== undefined ? searchProp : searchState;
  const filterValues = filterValuesProp !== undefined ? filterValuesProp : filterState;
  const sort = sortProp !== undefined ? sortProp : sortState;
  const page = pageProp !== undefined ? pageProp : pageState;
  const pageSize = pageSizeProp !== undefined ? pageSizeProp : pageSizeState;

  const setSearch = (value) => (onSearchChange ? onSearchChange(value) : setSearchState(value));
  const setFilters = (value) => (onFilterChange ? onFilterChange(value) : setFilterState(value));
  const setSort = (value) => (onSortChange ? onSortChange(value) : setSortState(value));
  const setPage = (value) => (onPageChange ? onPageChange(value) : setPageState(value));
  const setPageSize = (value) => (onPageSizeChange ? onPageSizeChange(value) : setPageSizeState(value));

  const activeFilters = Object.entries(filterValues).filter(([, v]) => v !== "" && v !== undefined && v !== null);
  const hasQuery = Boolean(search) || activeFilters.length > 0;

  // Mudar busca ou filtro invalida a página atual — senão o usuário fica numa
  // página que não existe mais no conjunto filtrado e vê uma lista vazia.
  useEffect(() => {
    if (pageProp === undefined) setPageState(1);
  }, [search, JSON.stringify(filterValues), pageSize]);

  const searchableColumns = useMemo(
    () => columns.filter((col) => col.searchable !== false),
    [columns]
  );

  const processed = useMemo(() => {
    if (isServer) return rows;
    let result = rows;

    if (search) {
      const term = fold(search);
      result = result.filter((row) =>
        searchableColumns.some((col) => fold(cellValue(col, row)).includes(term))
      );
    }

    for (const [key, value] of activeFilters) {
      const filter = filters.find((f) => f.key === key);
      if (!filter) continue;
      result = result.filter((row) =>
        filter.match ? filter.match(row, value) : fold(row[key]) === fold(value)
      );
    }

    if (sort?.key) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        result = [...result].sort((a, b) => {
          const diff = compareValues(cellValue(col, a), cellValue(col, b));
          return sort.dir === "desc" ? -diff : diff;
        });
      }
    }
    return result;
  }, [isServer, rows, search, JSON.stringify(filterValues), sort, columns, searchableColumns, filters]);

  const total = totalProp !== undefined ? Number(totalProp) : processed.length;
  const pageCount = paginated ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount);

  const visible = useMemo(() => {
    if (isServer || !paginated) return processed;
    const start = (currentPage - 1) * pageSize;
    return processed.slice(start, start + pageSize);
  }, [isServer, paginated, processed, currentPage, pageSize]);

  function toggleSort(col) {
    if (col.sortable === false) return;
    if (sort?.key !== col.key) return setSort({ key: col.key, dir: "asc" });
    if (sort.dir === "asc") return setSort({ key: col.key, dir: "desc" });
    setSort(null);
  }

  function clearAll() {
    setSearch("");
    setFilters({});
  }

  const showToolbar = searchable || filters.length > 0 || toolbar;
  const firstRow = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRow = Math.min(currentPage * pageSize, total);

  return (
    <div className="dataview">
      {showToolbar && (
        <div className="dataview-toolbar">
          {searchable && (
            <label className="dataview-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder={searchPlaceholder}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={searchPlaceholder}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Limpar busca">
                  <X size={14} />
                </button>
              )}
            </label>
          )}

          {filters.length > 0 && (
            <button
              type="button"
              className={`dataview-filter-toggle ${filtersOpen ? "open" : ""} ${activeFilters.length ? "has-filters" : ""}`}
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
            >
              <Filter size={15} />
              Filtros
              {activeFilters.length > 0 && <span className="dataview-filter-count">{activeFilters.length}</span>}
            </button>
          )}

          {toolbar && <div className="dataview-toolbar-extra">{toolbar}</div>}
        </div>
      )}

      {filters.length > 0 && filtersOpen && (
        <div className="dataview-filters">
          {filters.map((filter) => (
            <label key={filter.key} className="dataview-filter">
              <span>{filter.label}</span>
              {filter.type === "select" ? (
                <select
                  value={filterValues[filter.key] ?? ""}
                  onChange={(event) => setFilters({ ...filterValues, [filter.key]: event.target.value })}
                >
                  <option value="">Todos</option>
                  {(filter.options || []).map((option) => {
                    const value = typeof option === "string" ? option : option.value;
                    const label = typeof option === "string" ? option : option.label;
                    return <option key={value} value={value}>{label}</option>;
                  })}
                </select>
              ) : (
                <input
                  type={filter.type === "date" ? "date" : "text"}
                  value={filterValues[filter.key] ?? ""}
                  placeholder={filter.placeholder || ""}
                  onChange={(event) => setFilters({ ...filterValues, [filter.key]: event.target.value })}
                />
              )}
            </label>
          ))}
          {hasQuery && (
            <button type="button" className="dataview-clear" onClick={clearAll}>
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {error ? (
        <div className="dataview-state dataview-error" role="alert">{error}</div>
      ) : loading ? (
        <div className="dataview-state" aria-live="polite">Carregando…</div>
      ) : visible.length === 0 ? (
        <div className="dataview-state">{hasQuery ? emptyFiltered : empty}</div>
      ) : (
        <div className="table-wrap data-table-wrap">
          <table className="data-table dataview-table">
            {caption && <caption>{caption}</caption>}
            <thead>
              <tr>
                {columns.map((col) => {
                  const sorted = sort?.key === col.key;
                  const sortable = col.sortable !== false;
                  return (
                    <th
                      key={col.key}
                      style={col.align ? { textAlign: col.align } : undefined}
                      aria-sort={sorted ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {sortable ? (
                        <button type="button" className="dataview-sort" onClick={() => toggleSort(col)}>
                          {col.label}
                          {sorted
                            ? (sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
                            : <span className="dataview-sort-idle" aria-hidden="true" />}
                        </button>
                      ) : col.label}
                    </th>
                  );
                })}
                {actions && <th className="data-table-actions-head" aria-label="Ações" />}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      data-label={col.label}
                      style={col.align ? { textAlign: col.align } : undefined}
                    >
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                  {actions && <td className="table-actions" data-label="Ações">{actions(row)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginated && !error && !loading && total > 0 && (
        <div className="dataview-pagination">
          <span className="dataview-range">
            {firstRow}–{lastRow} de {total}
          </span>

          <label className="dataview-pagesize">
            Por página
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>

          <div className="dataview-pager">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Página anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span>{currentPage} / {pageCount}</span>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              aria-label="Próxima página"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
