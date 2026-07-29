// Setup do Vitest para os testes de componente.
//
// Traz os matchers do jest-dom (`toBeDisabled`, `toHaveAttribute`…) e garante
// que cada teste comece com o DOM limpo — nenhum teste depende de ordem.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
