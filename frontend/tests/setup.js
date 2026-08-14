// Setup do Vitest para os testes de componente.
//
// Traz os matchers do jest-dom (`toBeDisabled`, `toHaveAttribute`…) e garante
// que cada teste comece com o DOM limpo — nenhum teste depende de ordem.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node pode expor um `localStorage` experimental sem implementação quando não
// recebe --localstorage-file. Isso sombreia o Storage do jsdom. Instalamos uma
// implementação central compatível apenas quando a API completa não existe.
if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== "function") {
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); }
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}

afterEach(() => {
  cleanup();
});
