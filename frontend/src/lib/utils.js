// Leitores tolerantes. Existem porque o payload da API pode chegar em mais de
// uma forma legítima — a listagem devolve array puro OU o envelope
// `{ items, total, limit, offset }` (ver backend/src/services/pagination.js) —
// e porque uma tela nunca deve quebrar por causa de um campo ausente.
//
// O par para ler listagem dos dois jeitos é:
//   const items = asArray(payload).length ? asArray(payload) : asArray(asObject(payload).items);

/** @type {(value: unknown) => any[]} */
export const asArray = (value) => Array.isArray(value) ? value : [];
/** @type {(value: unknown, fallback?: number) => number} */
export const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
/** @type {(value: unknown) => Record<string, any>} */
export const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function removeAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Data curta pt-BR ("dd/mm"). Aceita "YYYY-MM-DD" ou ISO completo; devolve ""
 * para entrada vazia ou inválida.
 * @param {string | null | undefined} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!date) return "";
  const value = String(date).slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Data por extenso pt-BR ("dd de mês"). Mesmas tolerâncias de `formatDate`.
 * @param {string | null | undefined} date
 * @returns {string}
 */
export function formatLongDate(date) {
  if (!date) return "";
  const value = String(date).slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

/**
 * Valor para `<input type="date">`: "YYYY-MM-DD" ou "" quando não bate o formato.
 * @param {string | null | undefined} date
 * @returns {string}
 */
export function dateInputValue(date) {
  if (!date) return "";
  const value = String(date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/**
 * "YYYY-MM-DD" no fuso LOCAL. Use no lugar de `toISOString().slice(0,10)`, que
 * converte para UTC e joga a data para o dia anterior à noite.
 * @param {Date} date
 * @returns {string}
 */
export function localDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseCurrency(value) {
  return asNumber(value, 0);
}
