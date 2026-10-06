// Busca literal e sem acentos, sem depender de extensões do PostgreSQL.
export function foldSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function textSearch(columns, value, labels = {}) {
  const term = foldSearch(value);
  if (!term || !columns.length) return { sql: "", params: [] };
  const terms = [...new Set([term, ...Object.entries(labels).filter(([, label]) => foldSearch(label).includes(term)).map(([key]) => foldSearch(key))])];
  const params = [];
  const sql = columns.map((column) => {
    const expression = `lower(translate(COALESCE(CAST(${column} AS TEXT),''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))`;
    return `(${terms.map((candidate) => {
      params.push(`%${candidate.replace(/[\\%_]/g, "\\$&")}%`);
      return `${expression} ILIKE ?`;
    }).join(" OR ")})`;
  }).join(" OR ");
  return { sql: `(${sql})`, params };
}
