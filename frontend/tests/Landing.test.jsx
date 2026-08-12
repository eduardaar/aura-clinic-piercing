// A landing é a porta de entrada de quem vai assinar o produto. O que este
// arquivo protege é uma propriedade só, mas ela é inegociável:
//
//   com a API fora, a página continua inteira.
//
// Desde que o conteúdo passou a vir do banco (platform.landing_sections), uma
// falha de API poderia virar tela branca — e tela branca aqui é venda perdida
// na hora, sem ninguém ficar sabendo. O teste existe para que essa regressão
// não passe despercebida.
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Landing } from "../src/pages/Landing";
import { LANDING_DEFAULTS } from "../src/pages/landingDefaults";

function mockFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

// Resposta vazia para /plans: os planos vêm de outra rota e não são o assunto
// destes testes.
const semPlanos = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: [] }) });

describe("Landing", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renderiza a página inteira quando a API falha", async () => {
    mockFetch((url) => (String(url).includes("/landing") ? Promise.reject(new Error("rede fora")) : semPlanos()));

    render(<Landing />);

    // Hero, recursos e fechamento — o esqueleto da página de hoje.
    expect(screen.getByText(LANDING_DEFAULTS.hero.title)).toBeInTheDocument();
    for (const item of LANDING_DEFAULTS.features.items) {
      expect(screen.getByText(item.title)).toBeInTheDocument();
    }
    expect(screen.getByText(LANDING_DEFAULTS.closing.title)).toBeInTheDocument();
  });

  it("mantém o conteúdo embutido quando a API devolve lista vazia", async () => {
    mockFetch((url) =>
      String(url).includes("/landing")
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ sections: [] }) })
        : semPlanos()
    );

    render(<Landing />);

    // "Melhor a página de ontem que página nenhuma": lista vazia não pode
    // esvaziar a tela.
    await waitFor(() => {
      expect(screen.getByText(LANDING_DEFAULTS.hero.title)).toBeInTheDocument();
    });
  });

  it("usa o conteúdo da API, na ordem que ela mandar", async () => {
    mockFetch((url) =>
      String(url).includes("/landing")
        ? Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sections: [
                  { section_key: "closing", enabled: true, sort_order: 10, content: { title: "Fim primeiro" } },
                  {
                    section_key: "hero",
                    enabled: true,
                    sort_order: 20,
                    content: { title: "Título vindo do painel" }
                  }
                ]
              })
          })
        : semPlanos()
    );

    render(<Landing />);

    await waitFor(() => {
      expect(screen.getByText("Título vindo do painel")).toBeInTheDocument();
    });
    expect(screen.getByText("Fim primeiro")).toBeInTheDocument();
    // O título antigo do hero saiu de cena.
    expect(screen.queryByText(LANDING_DEFAULTS.hero.title)).not.toBeInTheDocument();
  });

  it("ignora bloco que o front ainda não sabe desenhar", async () => {
    // O backend pode ganhar um bloco novo antes do deploy do frontend; isso não
    // pode derrubar a página.
    mockFetch((url) =>
      String(url).includes("/landing")
        ? Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sections: [
                  { section_key: "bloco_do_futuro", enabled: true, sort_order: 5, content: { title: "?" } },
                  { section_key: "hero", enabled: true, sort_order: 10, content: { title: "Hero atual" } }
                ]
              })
          })
        : semPlanos()
    );

    render(<Landing />);

    await waitFor(() => {
      expect(screen.getByText("Hero atual")).toBeInTheDocument();
    });
  });

  it("cai no default do campo quando ele vem vazio", async () => {
    mockFetch((url) =>
      String(url).includes("/landing")
        ? Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sections: [{ section_key: "hero", enabled: true, sort_order: 10, content: { title: "  " } }]
              })
          })
        : semPlanos()
    );

    render(<Landing />);

    // Campo em branco salvo por engano no painel não pode deixar um buraco na
    // página pública.
    await waitFor(() => {
      expect(screen.getByText(LANDING_DEFAULTS.hero.title)).toBeInTheDocument();
    });
  });
});
