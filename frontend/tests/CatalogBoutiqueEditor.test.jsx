import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogBoutiqueEditor } from "../src/features/catalog/CatalogBoutiqueEditor";
import { defaultBoutiqueConfig } from "../src/features/catalog/boutiqueConfig";
vi.mock("../src/lib/api", () => ({ API_ORIGIN: "", apiFetch: vi.fn(), useFetch: () => ({ data: [{ name: "Argolas", slug: "argolas", path: "Argolas" }] }) }));
afterEach(cleanup);
function Editor({ saved }) { const [value, setValue] = useState(defaultBoutiqueConfig); return <CatalogBoutiqueEditor value={value} onChange={(next) => { setValue(next); saved(next); }} />; }

it("editor altera conteúdo e sequência dos componentes que serão salvos no rascunho", async () => {
  const user = userEvent.setup(); const saved = vi.fn(); render(<Editor saved={saved} />);
  const products = screen.getByRole("checkbox", { name: "Grade de produtos" }).closest("article");
  await user.click(within(products).getByRole("button", { name: "Subir" }));
  expect(saved.mock.lastCall[0].sections[3].type).toBe("products");
  await user.click(screen.getByRole("button", { name: "Cabeçalho e navegação" }));
  fireEvent.change(screen.getByLabelText("Texto da faixa"), { target: { value: "Aviso da loja" } });
  expect(saved.mock.lastCall[0].announcement_text).toBe("Aviso da loja");
  await user.click(screen.getByRole("checkbox", { name: "Mostrar faixa superior" }));
  expect(saved.mock.lastCall[0].announcement_enabled).toBe(false);
});

it("editor permite remover todos os benefícios e definir colunas do celular", async () => {
  const user = userEvent.setup(); const saved = vi.fn(); render(<Editor saved={saved} />);
  await user.click(screen.getByRole("button", { name: "Benefícios", exact: true }));
  for (let index = 0; index < 4; index += 1) {
    const row = screen.getAllByRole("checkbox", { name: "Exibir benefício" })[0].closest("article");
    await user.click(within(row).getByRole("button", { name: "Remover" }));
  }
  expect(saved.mock.lastCall[0].benefits).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Grade e cartões", exact: true }));
  fireEvent.change(screen.getByLabelText("Colunas de produtos no celular"), { target: { value: "1" } });
  expect(saved.mock.lastCall[0].products_mobile_columns).toBe(1);
});
