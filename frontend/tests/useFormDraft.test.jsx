import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFormDraftKey, useFormDraft } from "../src/lib/useFormDraft";

const identity = {
  tenantId: "clinic-10",
  userId: "user-5",
  formId: "new-client",
};

describe("useFormDraft", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("isola a chave por tenant, usuário e formulário", () => {
    expect(buildFormDraftKey(identity)).toBe("aura:form-draft:clinic-10:user-5:new-client");
    expect(buildFormDraftKey({ ...identity, userId: "" })).toBe("");
  });

  it("ignora o valor inicial e salva alterações com debounce", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useFormDraft({ ...identity, schemaKey: "client-v1", debounceMs: 300, value }),
      { initialProps: { value: { name: "" } } },
    );

    expect(localStorage.getItem(result.current.storageKey)).toBeNull();
    rerender({ value: { name: "Maria" } });
    expect(result.current.isSaving).toBe(true);

    act(() => vi.advanceTimersByTime(300));

    const saved = JSON.parse(localStorage.getItem(result.current.storageKey));
    expect(saved).toMatchObject({ schemaKey: "client-v1", data: { name: "Maria" } });
    expect(result.current.status).toBe("saved");
    expect(result.current.savedAt).toEqual(expect.any(String));
  });

  it("pausa a gravação até restaurar um rascunho compatível", () => {
    vi.useFakeTimers();
    const storageKey = buildFormDraftKey(identity);
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        schemaKey: "client-v1",
        savedAt: "2026-08-30T12:00:00.000Z",
        data: { name: "Rascunho" },
      }),
    );
    const onRestore = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useFormDraft({ ...identity, schemaKey: "client-v1", debounceMs: 100, value, onRestore }),
      { initialProps: { value: { name: "" } } },
    );

    expect(result.current.hasDraft).toBe(true);
    rerender({ value: { name: "Não deve substituir" } });
    act(() => vi.advanceTimersByTime(200));
    expect(JSON.parse(localStorage.getItem(storageKey)).data.name).toBe("Rascunho");

    let restored;
    act(() => {
      restored = result.current.restoreDraft();
    });
    expect(restored).toEqual({ name: "Rascunho" });
    expect(onRestore).toHaveBeenCalledWith({ name: "Rascunho" });
    expect(result.current.hasDraft).toBe(false);
  });

  it("descarta rascunho e invalida automaticamente schema antigo", () => {
    const storageKey = buildFormDraftKey(identity);
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        schemaKey: "old-schema",
        savedAt: "2026-08-30T12:00:00.000Z",
        data: { name: "Antigo" },
      }),
    );
    const { result, unmount } = renderHook(() =>
      useFormDraft({ ...identity, schemaKey: "client-v2", value: { name: "" } }),
    );

    expect(result.current.hasDraft).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
    unmount();

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        schemaKey: "client-v2",
        savedAt: "2026-08-30T12:00:00.000Z",
        data: { name: "Atual" },
      }),
    );
    const compatible = renderHook(() => useFormDraft({ ...identity, schemaKey: "client-v2", value: { name: "" } }));
    expect(compatible.result.current.hasDraft).toBe(true);

    act(() => compatible.result.current.discardDraft());
    expect(compatible.result.current.hasDraft).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
