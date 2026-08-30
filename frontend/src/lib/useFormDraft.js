import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DRAFT_PREFIX = "aura:form-draft";
const ENVELOPE_VERSION = 1;

function encodeKeyPart(value) {
  return encodeURIComponent(String(value ?? "").trim());
}

/**
 * Mantém cada rascunho isolado por clínica, usuário e formulário.
 */
export function buildFormDraftKey({ tenantId, userId, formId }) {
  if (!tenantId || !userId || !formId) return "";
  return `${DRAFT_PREFIX}:${[tenantId, userId, formId].map(encodeKeyPart).join(":")}`;
}

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function serialize(value) {
  return JSON.stringify(value);
}

function readDraft(storage, storageKey, schemaKey) {
  if (!storage || !storageKey) return { draft: null, error: null };

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return { draft: null, error: null };

    const envelope = JSON.parse(raw);
    const isCompatible =
      envelope?.version === ENVELOPE_VERSION &&
      envelope?.schemaKey === schemaKey &&
      typeof envelope?.savedAt === "string" &&
      Object.hasOwn(envelope, "data");

    if (!isCompatible) {
      storage.removeItem(storageKey);
      return { draft: null, error: null };
    }

    return {
      draft: { value: envelope.data, savedAt: envelope.savedAt },
      error: null,
    };
  } catch (error) {
    return { draft: null, error };
  }
}

/**
 * Salva alterações locais sem criar registros incompletos no backend.
 *
 * Quando há um rascunho anterior, a gravação fica pausada até o consumidor
 * chamar `restoreDraft` ou `discardDraft`, evitando sobrescrever dados antes de
 * a pessoa escolher o que fazer.
 */
export function useFormDraft({
  tenantId,
  userId,
  formId,
  value,
  onRestore,
  schemaKey,
  version,
  debounceMs = 600,
  enabled = true,
  storage,
}) {
  const resolvedSchemaKey = String(schemaKey ?? version ?? "1");
  const activeStorage = storage === undefined ? defaultStorage() : storage;
  const storageKey = useMemo(() => buildFormDraftKey({ tenantId, userId, formId }), [formId, tenantId, userId]);
  const initialRead = useMemo(
    () => readDraft(activeStorage, storageKey, resolvedSchemaKey),
    [activeStorage, resolvedSchemaKey, storageKey],
  );
  const [pendingDraft, setPendingDraft] = useState(initialRead.draft);
  const [savedAt, setSavedAt] = useState(initialRead.draft?.savedAt ?? null);
  const [status, setStatus] = useState(initialRead.error ? "error" : "idle");
  const [error, setError] = useState(initialRead.error);
  const timerRef = useRef(null);
  const currentValueRef = useRef(value);
  const lastWrittenRef = useRef(serialize(value));
  const suspendedRestoreRef = useRef(null);

  currentValueRef.current = value;

  const cancelPendingSave = useCallback(() => {
    if (timerRef.current) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const writeDraft = useCallback(
    (nextValue) => {
      if (!enabled || !activeStorage || !storageKey || pendingDraft) return false;

      try {
        const serializedValue = serialize(nextValue);
        if (serializedValue === undefined) return false;
        const nextSavedAt = new Date().toISOString();
        activeStorage.setItem(
          storageKey,
          JSON.stringify({
            version: ENVELOPE_VERSION,
            schemaKey: resolvedSchemaKey,
            savedAt: nextSavedAt,
            data: nextValue,
          }),
        );
        lastWrittenRef.current = serializedValue;
        setSavedAt(nextSavedAt);
        setStatus("saved");
        setError(null);
        return true;
      } catch (nextError) {
        setStatus("error");
        setError(nextError);
        return false;
      }
    },
    [activeStorage, enabled, pendingDraft, resolvedSchemaKey, storageKey],
  );

  useEffect(() => {
    cancelPendingSave();
    setPendingDraft(initialRead.draft);
    setSavedAt(initialRead.draft?.savedAt ?? null);
    setStatus(initialRead.error ? "error" : "idle");
    setError(initialRead.error);
    lastWrittenRef.current = serialize(currentValueRef.current);
    suspendedRestoreRef.current = null;
  }, [cancelPendingSave, initialRead]);

  useEffect(() => {
    if (!enabled || !activeStorage || !storageKey || pendingDraft) return undefined;

    let serializedValue;
    try {
      serializedValue = serialize(value);
    } catch (nextError) {
      setStatus("error");
      setError(nextError);
      return undefined;
    }

    if (suspendedRestoreRef.current) {
      if (serializedValue === suspendedRestoreRef.current) suspendedRestoreRef.current = null;
      return undefined;
    }
    if (serializedValue === undefined || serializedValue === lastWrittenRef.current) return undefined;

    setStatus("pending");
    timerRef.current = globalThis.setTimeout(
      () => {
        timerRef.current = null;
        writeDraft(value);
      },
      Math.max(0, debounceMs),
    );

    return cancelPendingSave;
  }, [activeStorage, cancelPendingSave, debounceMs, enabled, pendingDraft, storageKey, value, writeDraft]);

  useEffect(() => cancelPendingSave, [cancelPendingSave]);

  const restoreDraft = useCallback(() => {
    if (!pendingDraft) return null;
    const restoredValue = pendingDraft.value;
    cancelPendingSave();
    suspendedRestoreRef.current = serialize(restoredValue);
    lastWrittenRef.current = suspendedRestoreRef.current;
    setPendingDraft(null);
    setSavedAt(pendingDraft.savedAt);
    setStatus("restored");
    setError(null);
    onRestore?.(restoredValue);
    return restoredValue;
  }, [cancelPendingSave, onRestore, pendingDraft]);

  const discardDraft = useCallback(() => {
    cancelPendingSave();
    try {
      activeStorage?.removeItem(storageKey);
      setError(null);
      setStatus("idle");
    } catch (nextError) {
      setError(nextError);
      setStatus("error");
    }
    setPendingDraft(null);
    setSavedAt(null);
    lastWrittenRef.current = serialize(currentValueRef.current);
    suspendedRestoreRef.current = null;
  }, [activeStorage, cancelPendingSave, storageKey]);

  const flushDraft = useCallback(() => {
    cancelPendingSave();
    return writeDraft(currentValueRef.current);
  }, [cancelPendingSave, writeDraft]);

  return {
    storageKey,
    hasDraft: Boolean(pendingDraft),
    draftValue: pendingDraft?.value ?? null,
    draftSavedAt: pendingDraft?.savedAt ?? null,
    savedAt,
    status,
    isSaving: status === "pending",
    error,
    restoreDraft,
    discardDraft,
    clearDraft: discardDraft,
    flushDraft,
  };
}
