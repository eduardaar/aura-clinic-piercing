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
    await waitFor(() => {
      expect(screen.getByText(LANDING_DEFAULTS.hero.title)).toBeInTheDocument();
      for (const item of LANDING_DEFAULTS.features.items) {
        expect(screen.getAllByText(item.title).length).toBeGreaterThan(0);
      }
      expect(screen.getByText(LANDING_DEFAULTS.closing.title)).toBeInTheDocument();
    });
  });

  it("alterna os quatro recursos em faixas de imagem e texto", async () => {
    mockFetch((url) => (String(url).includes("/landing") ? Promise.reject(new Error("rede fora")) : semPlanos()));

    render(<Landing />);

    await waitFor(() => {
      expect(screen.getByText(LANDING_DEFAULTS.features.title)).toBeInTheDocument();
    });

    const cards = LANDING_DEFAULTS.features.items.map((item) => screen.getByRole("heading", { name: item.title }).closest("article"));
    expect(cards).toHaveLength(4);
    expect(cards[0]).not.toHaveClass("is-reversed");
    expect(cards[1]).toHaveClass("is-reversed");
    expect(cards[2]).not.toHaveClass("is-reversed");
    expect(cards[3]).toHaveClass("is-reversed");
  });

  it("apresenta a introdução, recursos, planos e perguntas frequentes nessa ordem", async () => {
    mockFetch((url) => (String(url).includes("/landing") ? Promise.reject(new Error("rede fora")) : semPlanos()));

    const { container } = render(<Landing />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: LANDING_DEFAULTS.hero.title })).toBeInTheDocument();
    });

    const intro = screen.getByRole("heading", { name: LANDING_DEFAULTS.hero.title });
    const features = screen.getByRole("heading", { name: LANDING_DEFAULTS.features.title });
    const plans = screen.getByRole("heading", { name: LANDING_DEFAULTS.plans.title });
    const closing = screen.getByRole("heading", { name: LANDING_DEFAULTS.closing.title });
    const faq = screen.getByRole("heading", { name: "Perguntas frequentes" });
    const markup = container.innerHTML;

    expect(markup.indexOf(intro.textContent)).toBeLessThan(markup.indexOf(features.textContent));
    expect(markup.indexOf(features.textContent)).toBeLessThan(markup.indexOf(plans.textContent));
    expect(markup.indexOf(plans.textContent)).toBeLessThan(markup.indexOf(closing.textContent));
    expect(markup.indexOf(closing.textContent)).toBeLessThan(markup.indexOf(faq.textContent));
    expect(screen.queryByText("Agenda sem atrito")).not.toBeInTheDocument();
    expect(screen.getByText("Como funciona o teste grátis?")).toBeInTheDocument();
  });

  it("mantém as ações e a nota logo após o subtítulo inicial", async () => {
    mockFetch((url) => (String(url).includes("/landing") ? Promise.reject(new Error("rede fora")) : semPlanos()));

    const { container } = render(<Landing />);
    await waitFor(() => expect(screen.getByText(LANDING_DEFAULTS.hero.subtitle)).toBeInTheDocument());

    const markup = container.innerHTML;
    expect(markup.indexOf(LANDING_DEFAULTS.hero.subtitle)).toBeLessThan(markup.indexOf("Criar minha clínica"));
    expect(markup.indexOf("Criar minha clínica")).toBeLessThan(markup.indexOf(LANDING_DEFAULTS.features.title));
    expect(markup.indexOf(LANDING_DEFAULTS.hero.note)).toBeLessThan(markup.indexOf(LANDING_DEFAULTS.features.title));
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
