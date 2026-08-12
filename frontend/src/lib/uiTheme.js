export const UI_THEMES = [
  {
    id: "aura",
    name: "Aura",
    description: "A paleta oficial em dourado e tons naturais.",
    swatches: ["#C9A86A", "#A87A34", "#FCFBF8"]
  },
  {
    id: "blue",
    name: "Azul leve",
    description: "Azul sereno para uma leitura mais técnica e limpa.",
    swatches: ["#6D9BC3", "#3C719D", "#F5F9FC"]
  },
  {
    id: "green",
    name: "Verde leve",
    description: "Verde suave para uma rotina visualmente tranquila.",
    swatches: ["#78A98B", "#4D7F61", "#F5FAF6"]
  }
];

export function themeStorageKey(userId) {
  return `aura-ui-theme:${userId || "anonymous"}`;
}

export function readUiTheme(userId) {
  try {
    const theme = localStorage.getItem(themeStorageKey(userId));
    return UI_THEMES.some((item) => item.id === theme) ? theme : "aura";
  } catch {
    return "aura";
  }
}

export function applyUiTheme(theme) {
  const selected = UI_THEMES.some((item) => item.id === theme) ? theme : "aura";
  document.documentElement.dataset.auraTheme = selected;
  return selected;
}

export function saveUiTheme(userId, theme) {
  const selected = applyUiTheme(theme);
  try { localStorage.setItem(themeStorageKey(userId), selected); } catch { /* preferência só não persiste */ }
  return selected;
}
