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

// Primitivos do Radix usam APIs de ponteiro presentes nos navegadores, mas não
// implementadas pelo jsdom. Estes no-ops mantêm os testes de interação fiéis à
// semântica do componente sem simular comportamento visual do navegador.
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
}
if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});
