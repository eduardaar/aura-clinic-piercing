// Classificação e auto-recuperação do log central de erros.
//
// A central acumulava ruído de navegador e tratava falha de chunk (aba aberta
// antes de um deploy) como erro de aplicação. Estes testes fixam as três
// decisões: ruído não é enviado, falha recuperável entra como aviso, e o
// reload de recuperação não pode virar laço.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStaleChunkError, reloadOnceForStaleChunk, reportError } from "../src/lib/errorReporter";

function lastSentBody() {
  const call = globalThis.fetch.mock.calls.at(-1);
  return call ? JSON.parse(call[1].body) : null;
}

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  sessionStorage.clear();
});

describe("isStaleChunkError", () => {
  it("reconhece as mensagens reais de import dinâmico falho", () => {
    // Exatamente o texto registrado em produção pelo Safari/WebKit.
    expect(isStaleChunkError("Importing a module script failed.")).toBe(true);
    expect(isStaleChunkError("Failed to fetch dynamically imported module: /assets/Inventory-BqIK6pkV.js")).toBe(true);
    expect(isStaleChunkError("ChunkLoadError: Loading chunk 42 failed.")).toBe(true);
  });

  it("não confunde erro comum de aplicação com chunk defasado", () => {
    expect(isStaleChunkError("Cannot read properties of undefined")).toBe(false);
    expect(isStaleChunkError("")).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe("reportError", () => {
  it("descarta ruído benigno do navegador sem gastar requisição", () => {
    reportError({ message: "ResizeObserver loop completed with undelivered notifications." });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("registra chunk defasado como aviso, não como erro", () => {
    reportError({ message: "Importing a module script failed.", url: "https://aura.test/login" });
    expect(lastSentBody().level).toBe("warn");
  });

  it("registra falha de rede do visitante como aviso", () => {
    reportError({ message: "Load failed", url: "https://aura.test/catalogo" });
    expect(lastSentBody().level).toBe("warn");
  });

  it("mantém erro de aplicação como erro", () => {
    reportError({
      message: "Cannot read properties of undefined (reading 'id')",
      url: "https://aura.test/app/estoque",
    });
    expect(lastSentBody().level).toBe("error");
  });

  it("respeita o level informado por quem chama", () => {
    reportError({ message: "Importing a module script failed.", url: "https://aura.test/outra", level: "error" });
    expect(lastSentBody().level).toBe("error");
  });
});

describe("reloadOnceForStaleChunk", () => {
  // `location` do jsdom é um getter: trocar só o método `reload` é rejeitado,
  // então substituímos o objeto inteiro enquanto o bloco roda.
  beforeEach(() => {
    vi.stubGlobal("location", { href: "https://aura.test/login", reload: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recarrega na primeira falha e bloqueia a segunda seguida", () => {
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(location.reload).toHaveBeenCalledTimes(1);

    // Chunk continuou ausente (deploy quebrado): não pode recarregar de novo,
    // senão a aba entra em laço e o usuário nunca vê a falha.
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("volta a permitir recuperação depois da janela de espera", () => {
    expect(reloadOnceForStaleChunk()).toBe(true);
    // Um deploy posterior na mesma aba merece nova tentativa.
    sessionStorage.setItem("aura:stale-chunk-reload", String(Date.now() - 61000));
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(location.reload).toHaveBeenCalledTimes(2);
  });
});
