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
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Filter, Search, X } from "lucide-react";

const PAGE_SIZES = [10, 25, 50, 100];

// --- Contrato das props ------------------------------------------------------
//
// ~20 telas dependem deste componente, então a forma das `columns` e dos
// `filters` é um contrato de verdade. Os typedefs abaixo existem para o editor
// reclamar ANTES de a tela ir para produção — em especial nos dois erros que já
// custaram tempo aqui:
//
//   1. coluna cujo `render` devolve JSX e NÃO declara `value(row)`: busca e
//      ordenação passam a comparar "[object Object]". Ver `ColumnDef.value`.
//   2. filtro `select` com lista fixa de `options` que não cobre os valores
//      reais do banco: a opção some da lista e o registro fica inalcançável.
//      Ver `FilterDef.options`.

/**
 * Uma linha da tabela. Vem crua da API, então é um saco de campos.
 * @typedef {Record<string, any>} Row
 */

/**
 * Definição de uma coluna.
 * @typedef {object} ColumnDef
 * @property {string} key Chave do campo em `row` e identidade da coluna na ordenação.
 * @property {string} label Cabeçalho da coluna (também vira `data-label` no mobile).
 * @property {(row: Row) => React.ReactNode} [render] Como EXIBIR a célula. Sem ele, exibe `row[key]`.
 * @property {(row: Row) => string | number | null | undefined} [value] Como BUSCAR e ORDENAR a célula.
 *   OBRIGATÓRIO na prática sempre que `render` devolve JSX ou o dado exibido não
 *   é `row[key]` cru: sem ele a busca e a ordenação recebem o objeto JSX e
 *   comparam "[object Object]" — a coluna vira inerte sem nenhum aviso.
 * @property {"left" | "center" | "right"} [align] Alinhamento do texto.
 * @property {boolean} [sortable] `false` desliga a ordenação por esta coluna. Padrão: ordenável.
 * @property {boolean} [searchable] `false` tira a coluna da busca textual. Padrão: incluída.
 */

/**
 * Opção de um filtro `select`. String simples equivale a `{ value: s, label: s }`.
 * @typedef {string | { value: string, label: string }} FilterOption
 */

/**
 * Definição de um filtro avançado.
 * @typedef {object} FilterDef
 * @property {string} key Chave em `filterValues`. No filtro padrão, também é a chave lida em `row`.
 * @property {string} label Rótulo exibido.
 * @property {"select" | "date" | "text"} [type] Padrão: campo de texto.
 * @property {FilterOption[]} [options] Só para `type: "select"`.
 *   Prefira derivar as opções DOS DADOS (ex.: `[...new Set(rows.map(r => r.status))]`)
 *   em vez de escrever uma lista fixa: lista fixa que não cobre os valores reais
 *   do banco esconde registros sem nenhum erro visível.
 * @property {string} [placeholder] Só para `type: "text"`/`"date"`.
 * @property {(row: Row, value: string) => boolean} [match] Comparação sob medida.
 *   Sem ele, o padrão é igualdade tolerante a acento/caixa entre `row[key]` e o valor.
 *   Use para intervalo de data, campo aninhado ou valor derivado.
 */

/**
 * Estado de ordenação. `null` = ordem natural das linhas.
 * @typedef {{ key: string, dir: "asc" | "desc" } | null} SortState
 */

/**
 * Valores dos filtros ativos, indexados pela `key` do filtro. "" = sem filtro.
 * @typedef {Record<string, string>} FilterValues
 */

/**
 * @typedef {object} DataViewProps
 * @property {ColumnDef[]} columns
 * @property {Row[]} [rows] Modo `client`: a lista INTEIRA. Modo `server`: só a página atual.
 * @property {(row: Row) => React.Key} [rowKey] Padrão: `row.id`.
 * @property {(row: Row) => React.ReactNode} [actions] Botões da última coluna.
 * @property {"client" | "server"} [mode] Ver o cabeçalho do arquivo. Padrão: `"client"`.
 *
 * @property {boolean} [loading]
 * @property {string} [error] Mensagem já pronta para exibição ("" = sem erro).
 *
 * @property {boolean} [searchable] Liga/desliga o campo de busca. Padrão: ligado.
 * @property {string} [searchPlaceholder]
 * @property {string} [search] Controla a busca por fora (obrigatório no modo `server`).
 * @property {(value: string) => void} [onSearchChange]
 *
 * @property {FilterDef[]} [filters]
 * @property {FilterValues} [filterValues] Controla os filtros por fora.
 * @property {(values: FilterValues) => void} [onFilterChange]
 *
 * @property {SortState} [sort] Controla a ordenação por fora.
 * @property {(sort: SortState) => void} [onSortChange]
 * @property {SortState} [defaultSort] Ordenação inicial quando `sort` não é controlado.
 *
 * @property {boolean} [paginated] Padrão: ligado.
 * @property {number} [page] 1-based.
 * @property {number} [pageSize]
 * @property {number} [defaultPageSize] Padrão: 25.
 * @property {number} [total] OBRIGATÓRIO no modo `server` — é o `total` do envelope
 *   `{ items, total, limit, offset }` do backend. Sem ele o rodapé conta só as
 *   linhas da página atual e a paginação para na página 1.
 * @property {(page: number) => void} [onPageChange]
 * @property {(size: number) => void} [onPageSizeChange]
 *
 * @property {React.ReactNode} [toolbar] Conteúdo extra na barra de ferramentas.
 * @property {string} [empty] Vazio sem busca/filtro aplicado.
 * @property {string} [emptyFiltered] Vazio COM busca/filtro aplicado.
 * @property {string} [caption] `<caption>` da tabela (acessibilidade).
 */

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
/** @type {(value: unknown) => string} */
const fold = (value) =>
  String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** @type {(value: unknown) => boolean} */
const isEmpty = (value) => value === null || value === undefined || value === "";
/** @type {(value: unknown) => boolean} */
const isNumeric = (value) => !isEmpty(value) && String(value).trim() !== "" && !Number.isNaN(Number(value));

// O modo de comparação é decidido para a COLUNA INTEIRA, não par a par. Decidir
// par a par produz uma ordem não-transitiva quando a coluna mistura número e
// texto: com 9, 10 e "1a" resultava em 9<10, 10<"1a" e 9>"1a" ao mesmo tempo, e
// aí o resultado passa a depender do algoritmo de sort do motor JS.
/**
 * @param {unknown[]} values Todos os valores da coluna, para decidir o modo.
 * @returns {(a: unknown, b: unknown) => number}
 */
function comparatorFor(values) {
  const numerica = values.filter((v) => !isEmpty(v)).every(isNumeric);
  return (a, b) => {
    if (a === b) return 0;
    if (isEmpty(a)) return 1;   // vazios sempre no fim, nos dois modos
    if (isEmpty(b)) return -1;
    if (numerica) return Number(a) - Number(b);
    return fold(a).localeCompare(fold(b), "pt-BR");
  };
}

// Valor usado para buscar e ordenar. `render` pode devolver JSX, então a coluna
// declara `value(row)` quando o dado exibido não é `row[key]` cru.
/**
 * @param {ColumnDef} col
 * @param {Row} row
 * @returns {string | number | null | undefined}
 */
function cellValue(col, row) {
  if (col.value) return col.value(row);
  return row[col.key];
}

/**
 * @param {DataViewProps} props
 */
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

  // Só conta como filtro ativo o que está declarado em `filters`. Sem esse
  // cruzamento, uma chave extra guardada em filterValues (ou um filtro montado
  // condicionalmente, tipo "só admin") acendia o contador e fazia o estado
  // vazio dizer "nenhum resultado para o filtro" sem filtro nenhum aplicado.
  const activeFilters = Object.entries(filterValues).filter(
    ([key, v]) => v !== "" && v !== undefined && v !== null && filters.some((f) => f.key === key)
  );
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
        const compare = comparatorFor(result.map((row) => cellValue(col, row)));
        result = [...result].sort((a, b) => {
          const diff = compare(cellValue(col, a), cellValue(col, b));
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

      {paginated && !error && !loading && total > 0 && visible.length > 0 && (
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
