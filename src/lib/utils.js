export const asArray = (value) => Array.isArray(value) ? value : [];
export const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function removeAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function firstName(name = "") {
  return String(name).trim().split(" ")[0] || "Aura";
}

export function initials(name = "") {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
}

export function formatDate(date) {
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatLongDate(date) {
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

export function localDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseCurrency(value) {
  return asNumber(value, 0);
}
