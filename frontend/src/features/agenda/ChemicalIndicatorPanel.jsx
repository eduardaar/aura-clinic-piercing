// Indicador químico de esterilização registrado por procedimento realizado.
//
// As props dos dois componentes exportados são o contrato usado por Agenda.jsx
// ("Detalhes do Agendamento" e "Atendimento realizado") e por ClientsMedical.jsx
// (perfil do cliente); não as altere.
//
// As leituras usam `apiFetch` + estado local, e não `useFetch`: o painel é
// montado dentro do modal da agenda, que também é renderizado em testes sem
// QueryClientProvider. Um painel que exigisse o provider derrubaria o modal
// inteiro por causa de um bloco opcional.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, FlaskConical } from "lucide-react";
import { Button, Input, SecureImage, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { Modal } from "../../components/common/Crud";
import { apiFetch } from "../../lib/api";
import { asArray, asObject, localDateValue } from "../../lib/utils";
import "./chemical-indicators.css";

/** Sugestões de tipo (SPEC 3.3). "Outro" abre um campo de texto livre. */
export const INDICATOR_TYPE_SUGGESTIONS = [
  "Classe 1 — indicador de processo",
  "Classe 4 — multiparâmetro",
  "Classe 5 — integrador",
  "Classe 6 — emulador",
];
const OTHER_TYPE = "__outro__";

export const INDICATOR_RESULT_LABELS = {
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  nao_informado: "Não informado",
};
const RESULT_TONES = { aprovado: "ok", reprovado: "danger", nao_informado: "neutral" };

// O backend recusa o que não for JPEG, PNG ou WebP (`parseUpload` com
// `imagesOnly`) e corta em 6 MB. Avisar aqui evita perder o envio por causa de
// uma foto HEIC do iPhone ou de uma imagem enorme, com mensagem clara.
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

// Mesmos status que o backend recusa com 409 (BLOCKED_APPOINTMENT_STATUSES em
// services/chemicalIndicators.js): atendimento que não aconteceu não tem
// procedimento a rastrear. Oferecer o botão só levaria a um erro no envio.
const READ_ONLY_STATUSES = {
  cancelado: "Atendimento cancelado",
  nao_compareceu: "Cliente não compareceu",
  recusado: "Atendimento recusado",
  remarcado: "Atendimento remarcado (registre no novo agendamento)",
};

function text(value) {
  return String(value ?? "").trim();
}

function isVoided(indicator) {
  return indicator?.status === "anulado" || indicator?.is_voided === true || indicator?.voided === true || Boolean(indicator?.voided_at);
}

/** "AAAA-MM-DD" (ou ISO) → "dd/mm/aaaa". */
function fullDate(value) {
  const raw = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const [year, month, day] = raw.split("-");
  return `${day}/${month}/${year}`;
}

/** Data e hora locais do registro ("dd/mm/aaaa às hh:mm"). */
function dateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fullDate(value);
  const date = parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}

function photoUrl(indicator) {
  if (indicator?.photo_url) return String(indicator.photo_url);
  return indicator?.photo_filename ? `/api/private-files/${indicator.photo_filename}` : "";
}

// A API só manda a URL da foto para quem vê arquivo clínico; os demais recebem
// `has_photo`. Dizer "sem foto" nesse caso afirmaria algo falso sobre a etiqueta.
function hasRestrictedPhoto(indicator) {
  return !photoUrl(indicator) && indicator?.has_photo === true;
}
const RESTRICTED_PHOTO_TEXT = "Foto registrada (visível para quem acessa arquivos clínicos).";

function procedureLabel(procedure) {
  const name = text(procedure?.procedure_name || procedure?.service_name || procedure?.procedure || procedure?.name) || "Procedimento";
  const region = text(procedure?.body_region || procedure?.piercing_region || procedure?.region);
  return region ? `${name} · ${region}` : name;
}

function jewelryLabel(item) {
  const name = text(item?.jewelry_name || item?.jewelry);
  const variant = text(item?.jewelry_variation_name || item?.jewelry_variant_name || item?.variant_name);
  if (!name) return "";
  return variant ? `${name} (${variant})` : name;
}

async function readJson(response) {
  if (!response || typeof response.json !== "function") return {};
  return response.json().catch(() => ({}));
}

/**
 * Busca JSON com mensagem de erro amigável. Nunca lança: devolve `{ error }`.
 * @param {string} path
 */
async function loadJson(path) {
  try {
    const response = await apiFetch(path);
    const payload = await readJson(response);
    if (!response?.ok) return { error: payload.error || "Não foi possível carregar os indicadores químicos." };
    return { payload };
  } catch {
    return { error: "Não foi possível conectar com a API." };
  }
}

/**
 * Agrupa os indicadores por procedimento do atendimento. Indicadores cujo item
 * deixou de existir (agendamento editado) ou registrados sem item continuam
 * aparecendo, agrupados pelo retrato do procedimento gravado no registro.
 * @param {any[]} procedures
 * @param {any[]} indicators
 * @param {Record<string, any>} appointment
 */
export function groupIndicatorsByProcedure(procedures, indicators, appointment = {}) {
  const groups = asArray(procedures).map((procedure) => {
    const itemId = procedure?.appointment_item_id ?? procedure?.id ?? null;
    // Procedimento sem item (agendamento legado: a API devolve
    // `appointment_item_id: null`) usa a MESMA chave do retrato gravado no
    // indicador; senão os indicadores dele cairiam num grupo "órfão" duplicado.
    const key = itemId != null ? `item-${itemId}` : `snapshot-${procedureLabel(procedure)}`;
    return { key, itemId, procedure, indicators: [], orphan: false };
  });
  // Agendamento sem itens (legado): um único procedimento, o do próprio
  // agendamento; o registro vai com `procedure_name` em vez de item.
  if (!groups.length) {
    const procedure = {
      procedure_name: text(appointment?.service_name || appointment?.procedure) || "Atendimento",
      body_region: appointment?.piercing_region,
      jewelry_name: appointment?.jewelry_name,
    };
    groups.push({ key: `snapshot-${procedureLabel(procedure)}`, itemId: null, procedure, indicators: [], orphan: false });
  }
  const byItem = new Map(groups.filter((group) => group.itemId != null).map((group) => [String(group.itemId), group]));
  for (const indicator of asArray(indicators)) {
    const linked = indicator?.appointment_item_id != null ? byItem.get(String(indicator.appointment_item_id)) : null;
    if (linked) {
      linked.indicators.push(indicator);
      continue;
    }
    const key = `snapshot-${procedureLabel(indicator)}`;
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      group = { key, itemId: null, procedure: indicator, indicators: [], orphan: true };
      groups.push(group);
    }
    group.indicators.push(indicator);
  }
  return groups;
}

function emptyForm() {
  return {
    type_choice: "",
    type_other: "",
    indicator_brand: "",
    indicator_lot: "",
    indicator_date: localDateValue(new Date()),
    identification: "",
    result: "nao_informado",
    notes: "",
  };
}

function resolvedType(form) {
  return form.type_choice === OTHER_TYPE ? text(form.type_other) : text(form.type_choice);
}

/**
 * Dados de um indicador já registrado, na ordem em que aparecem na etiqueta.
 * @param {{ indicator: Record<string, any>, onOpenPhoto: (indicator: any) => void }} props
 */
function IndicatorFacts({ indicator, onOpenPhoto }) {
  const src = photoUrl(indicator);
  const result = indicator?.result || "nao_informado";
  return (
    <>
      <dl className="chem-facts">
        <div><dt>Tipo</dt><dd>{indicator?.indicator_type || "Não informado"}</dd></div>
        <div><dt>Marca</dt><dd>{indicator?.indicator_brand || "Não informada"}</dd></div>
        <div><dt>Lote</dt><dd>{indicator?.indicator_lot || "Não informado"}</dd></div>
        <div><dt>Data</dt><dd>{fullDate(indicator?.indicator_date) || "Não informada"}</dd></div>
        <div><dt>Identificação/ciclo</dt><dd>{indicator?.identification || "Não informada"}</dd></div>
        <div><dt>Resultado</dt><dd><StatusBadge tone={RESULT_TONES[result] || "neutral"}>{INDICATOR_RESULT_LABELS[result] || result}</StatusBadge></dd></div>
      </dl>
      {indicator?.notes && <p className="chem-notes">{indicator.notes}</p>}
      {src ? (
        <button type="button" className="chem-photo-button" onClick={() => onOpenPhoto(indicator)} aria-label="Ampliar foto da etiqueta do indicador">
          <SecureImage src={src} alt="Etiqueta do indicador químico" className="chem-photo-thumb" />
          <span><Camera size={15} aria-hidden="true" /> Ver foto</span>
        </button>
      ) : (
        <small className="chem-muted">{hasRestrictedPhoto(indicator) ? RESTRICTED_PHOTO_TEXT : "Sem foto da etiqueta."}</small>
      )}
    </>
  );
}

function PhotoModal({ indicator, onClose }) {
  return (
    <Modal
      open={Boolean(indicator)}
      title="Foto da etiqueta"
      subtitle={indicator ? procedureLabel(indicator) : ""}
      onClose={onClose}
      dismissible
      confirmClose={false}
      footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}
    >
      {indicator && (
        <div className="chem-photo-full">
          <SecureImage src={photoUrl(indicator)} alt="Etiqueta do indicador químico ampliada" />
        </div>
      )}
    </Modal>
  );
}

/**
 * Painel do atendimento: lista os procedimentos do agendamento e permite
 * registrar/anular indicadores (com foto da etiqueta) por procedimento.
 * @param {{ appointment: Record<string, any> | null, canEdit?: boolean }} props
 */
export function ChemicalIndicatorPanel({ appointment, canEdit = false }) {
  const appointmentId = appointment?.id;
  const [state, setState] = useState(/** @type {{ appointmentId: any, loading: boolean, error: string, procedures: any[], indicators: any[] }} */ ({ appointmentId, loading: true, error: "", procedures: [], indicators: [] }));
  const [registering, setRegistering] = useState(/** @type {any} */ (null));
  const [voiding, setVoiding] = useState(/** @type {any} */ (null));
  const [viewingPhoto, setViewingPhoto] = useState(/** @type {any} */ (null));
  const [notice, setNotice] = useState("");
  // Resposta atrasada de um atendimento anterior não pode sobrescrever a atual.
  const currentId = useRef(appointmentId);
  currentId.current = appointmentId;
  // Duas recargas do MESMO atendimento (salvou e o `updated_at` mudou logo
  // depois de um registro) também podem voltar fora de ordem: vale a última.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!appointmentId) return;
    // Mantém a lista na tela durante a recarga do MESMO atendimento; ao trocar
    // de atendimento, limpa para não mostrar indicadores de outro cliente.
    setState((current) => current.appointmentId === appointmentId
      ? { ...current, loading: true, error: "" }
      : { appointmentId, loading: true, error: "", procedures: [], indicators: [] });
    const seq = ++requestSeq.current;
    const { payload, error } = await loadJson(`/appointments/${appointmentId}/chemical-indicators`);
    if (currentId.current !== appointmentId || seq !== requestSeq.current) return;
    if (error) {
      setState({ appointmentId, loading: false, error, procedures: [], indicators: [] });
      return;
    }
    const body = asObject(payload);
    setState({ appointmentId, loading: false, error: "", procedures: asArray(body.procedures), indicators: asArray(body.indicators) });
  }, [appointmentId]);

  // `updated_at` muda quando o agendamento é salvo: os itens podem ter mudado.
  const reloadKey = appointment?.updated_at || "";
  useEffect(() => {
    void reloadKey;
    load();
  }, [load, reloadKey]);

  if (!appointment) return null;

  const readOnlyStatus = READ_ONLY_STATUSES[appointment.status] || "";
  const editable = canEdit && !readOnlyStatus;
  const groups = groupIndicatorsByProcedure(state.procedures, state.indicators, appointment);

  return (
    // `data-modal-ignore-dirty`: o indicador é gravado na hora (modais próprios
    // de registro e anulação); nada daqui fica pendente no modal do agendamento.
    <section className="soft-card stack chem-panel" aria-labelledby={`chem-panel-${appointmentId || "novo"}`} data-modal-ignore-dirty="">
      <div className="section-inline-header">
        <strong id={`chem-panel-${appointmentId || "novo"}`}><FlaskConical size={17} aria-hidden="true" /> Indicador químico por procedimento</strong>
        <small>Etiqueta da esterilização de cada procedimento</small>
      </div>
      {!appointmentId ? (
        <p className="empty-state">Salve o agendamento para registrar os indicadores químicos.</p>
      ) : state.loading && !state.procedures.length && !state.indicators.length ? (
        <p className="loading" role="status">Carregando indicadores…</p>
      ) : state.error ? (
        <div className="chem-error" role="alert">
          <span className="form-error">{state.error}</span>
          <Button variant="secondary" onClick={load}>Tentar novamente</Button>
        </div>
      ) : (
        <>
          {!canEdit && (
            <p className="chem-muted">Somente leitura: registrar ou anular indicadores exige a permissão de editar arquivos clínicos.</p>
          )}
          {canEdit && readOnlyStatus && (
            <p className="chem-muted">{readOnlyStatus}: os indicadores ficam disponíveis apenas para consulta.</p>
          )}
          {notice && <p className="chem-notice" role="status">{notice}</p>}
          <div className="chem-procedures">
            {groups.map((group) => (
              <article className="chem-procedure" key={group.key} aria-label={`Procedimento ${procedureLabel(group.procedure)}`}>
                <header>
                  <div>
                    <strong>{procedureLabel(group.procedure)}</strong>
                    <span>{jewelryLabel(group.procedure) ? `Joia: ${jewelryLabel(group.procedure)}` : "Sem joia vinculada"}</span>
                    {group.orphan && <small className="chem-muted">Procedimento registrado antes de uma alteração do agendamento.</small>}
                  </div>
                  {editable && !group.orphan && (
                    <Button variant="secondary" onClick={() => { setNotice(""); setRegistering(group); }}>
                      Registrar indicador
                    </Button>
                  )}
                </header>
                {group.indicators.length ? (
                  <ul className="chem-indicator-list">
                    {group.indicators.map((indicator) => {
                      const voided = isVoided(indicator);
                      return (
                        <li key={indicator.id} className={`chem-indicator${voided ? " is-voided" : ""}`}>
                          <div className="chem-indicator-head">
                            <StatusBadge tone={voided ? "danger" : "ok"}>{voided ? "Anulado" : "Válido"}</StatusBadge>
                            <small>
                              Registrado por {indicator.created_by_name || "usuário não identificado"}
                              {indicator.created_at ? ` em ${dateTime(indicator.created_at)}` : ""}
                            </small>
                            {editable && !voided && (
                              <Button variant="ghost" className="danger" onClick={() => setVoiding(indicator)} aria-label={`Anular indicador ${indicator.indicator_lot || indicator.identification || indicator.id}`}>
                                Anular
                              </Button>
                            )}
                          </div>
                          <IndicatorFacts indicator={indicator} onOpenPhoto={setViewingPhoto} />
                          {voided && (
                            <p className="chem-void-info">
                              Anulado{indicator.voided_by_name ? ` por ${indicator.voided_by_name}` : ""}
                              {indicator.voided_at ? ` em ${dateTime(indicator.voided_at)}` : ""}
                              {indicator.void_reason ? ` · Motivo: ${indicator.void_reason}` : ""}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="empty-state">Nenhum indicador registrado para este procedimento.</p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      <RegisterIndicatorModal
        appointmentId={appointmentId}
        group={registering}
        onClose={() => setRegistering(null)}
        onSaved={async () => {
          setRegistering(null);
          setNotice("Indicador químico registrado.");
          await load();
        }}
      />
      <VoidIndicatorModal
        appointmentId={appointmentId}
        indicator={voiding}
        onClose={() => setVoiding(null)}
        onVoided={async () => {
          setVoiding(null);
          setNotice("Indicador anulado. O registro continua no histórico.");
          await load();
        }}
      />
      <PhotoModal indicator={viewingPhoto} onClose={() => setViewingPhoto(null)} />
    </section>
  );
}

function RegisterIndicatorModal({ appointmentId, group, onClose, onSaved }) {
  const formId = `chem-register-${useId().replace(/:/g, "")}`;
  const [form, setForm] = useState(emptyForm);
  const [photo, setPhoto] = useState(/** @type {File | null} */ (null));
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const open = Boolean(group);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm());
    setPhoto(null);
    setError("");
    setSaving(false);
    setFileInputKey((key) => key + 1);
  }, [open]);

  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== "function") {
      setPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function choosePhoto(file) {
    setError("");
    if (!file) return setPhoto(null);
    if (file.type && !PHOTO_TYPES.includes(file.type)) {
      setPhoto(null);
      setFileInputKey((key) => key + 1);
      return setError("Use uma foto em JPG, PNG ou WebP. No iPhone, ajuste a câmera para \"Mais compatível\".");
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhoto(null);
      setFileInputKey((key) => key + 1);
      return setError("A foto passa de 6 MB. Tire uma nova foto com resolução menor.");
    }
    setPhoto(file);
  }

  async function submit(event) {
    event.preventDefault();
    // O modal é um portal dentro do modal do agendamento: sem isto o submit
    // sobe pela árvore do React até formulários do modal de fora.
    event.stopPropagation();
    if (saving) return;
    const type = resolvedType(form);
    if (form.type_choice === OTHER_TYPE && !type) {
      setError("Descreva o tipo do indicador ou escolha uma das sugestões.");
      return;
    }
    if (!type && !text(form.indicator_lot) && !text(form.identification) && !photo) {
      setError("Informe ao menos o tipo, o lote, a identificação/ciclo ou a foto da etiqueta.");
      return;
    }
    // O backend recusa data futura (o indicador registra uma esterilização que
    // já aconteceu); comparar AAAA-MM-DD como texto é exato.
    if (text(form.indicator_date) && text(form.indicator_date) > localDateValue(new Date())) {
      setError("A data do indicador não pode ser futura.");
      return;
    }
    const body = new FormData();
    if (group?.itemId != null) body.append("appointment_item_id", String(group.itemId));
    else body.append("procedure_name", text(group?.procedure?.procedure_name || group?.procedure?.service_name || group?.procedure?.procedure) || "Atendimento");
    const fields = {
      indicator_type: type,
      indicator_brand: text(form.indicator_brand),
      indicator_lot: text(form.indicator_lot),
      indicator_date: text(form.indicator_date),
      identification: text(form.identification),
      result: form.result || "nao_informado",
      notes: text(form.notes),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value) body.append(key, value);
    }
    if (photo) body.append("photo", photo);
    setError("");
    setSaving(true);
    try {
      const response = await apiFetch(`/appointments/${appointmentId}/chemical-indicators`, { method: "POST", body });
      const payload = await readJson(response);
      if (!response?.ok) {
        setError(payload.error || "Não foi possível registrar o indicador químico.");
        return;
      }
      await onSaved?.(payload);
    } catch {
      setError("Não foi possível conectar com a API.");
    } finally {
      setSaving(false);
    }
  }

  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      open={open}
      title="Registrar indicador químico"
      subtitle={group ? procedureLabel(group.procedure) : ""}
      onClose={onClose}
      formId={formId}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={saving}>{saving ? "Registrando…" : "Registrar indicador"}</Button>
        </>
      )}
    >
      {open && (
        <form id={formId} className="stack chem-form" onSubmit={submit} noValidate>
          <p className="chem-muted">Preencha o que estiver na etiqueta. Basta um dado: tipo, lote, identificação/ciclo ou foto.</p>
          <div className="form-grid">
            <Select label="Tipo do indicador" value={form.type_choice} onChange={set("type_choice")}>
              <option value="">Não informado</option>
              {INDICATOR_TYPE_SUGGESTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              <option value={OTHER_TYPE}>Outro</option>
            </Select>
            {form.type_choice === OTHER_TYPE && (
              <Input label="Qual tipo?" value={form.type_other} onChange={set("type_other")} maxLength={120} placeholder="Ex.: Classe 2 — Bowie-Dick" />
            )}
            <Input label="Marca" value={form.indicator_brand} onChange={set("indicator_brand")} maxLength={120} />
            <Input label="Lote" value={form.indicator_lot} onChange={set("indicator_lot")} maxLength={120} />
            <Input type="date" label="Data" value={form.indicator_date} onChange={set("indicator_date")} max={localDateValue(new Date())} />
            <Input label="Identificação/ciclo" value={form.identification} onChange={set("identification")} maxLength={160} placeholder="Ex.: Ciclo 0142 · Autoclave 1" />
            <Select label="Resultado" value={form.result} onChange={set("result")}>
              <option value="nao_informado">Não informado</option>
              <option value="aprovado">Aprovado</option>
              <option value="reprovado">Reprovado</option>
            </Select>
          </div>
          <label className="chem-file-field">
            <span>Foto da etiqueta</span>
            <input
              key={fileInputKey}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => choosePhoto(event.target.files?.[0] || null)}
            />
            <small className="chem-muted">JPG, PNG ou WebP, até 6 MB. No celular, abre a câmera.</small>
          </label>
          {photo && (
            <div className="chem-photo-preview">
              {preview && <img src={preview} alt="Pré-visualização da etiqueta" />}
              <span>{photo.name}</span>
              <Button variant="ghost" onClick={() => { setPhoto(null); setFileInputKey((key) => key + 1); }}>Remover foto</Button>
            </div>
          )}
          <Textarea label="Observações" value={form.notes} onChange={set("notes")} maxLength={2000} />
          {error && <span className="form-error" role="alert">{error}</span>}
        </form>
      )}
    </Modal>
  );
}

function VoidIndicatorModal({ appointmentId, indicator, onClose, onVoided }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const open = Boolean(indicator);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError("");
    setSaving(false);
  }, [open]);

  async function confirm() {
    if (saving) return;
    if (!text(reason)) {
      setError("Informe o motivo da anulação.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const response = await apiFetch(`/appointments/${appointmentId}/chemical-indicators/${indicator.id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: text(reason) }),
      });
      const payload = await readJson(response);
      if (!response?.ok) {
        setError(payload.error || "Não foi possível anular o indicador.");
        return;
      }
      await onVoided?.(payload);
    } catch {
      setError("Não foi possível conectar com a API.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Anular indicador químico"
      subtitle="O registro não é apagado: fica no histórico como anulado, com o motivo."
      onClose={onClose}
      confirmClose={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="danger" onClick={confirm} disabled={saving || !text(reason)}>{saving ? "Anulando…" : "Anular indicador"}</Button>
        </>
      )}
    >
      {indicator && (
        <div className="stack">
          <p className="chem-muted">
            {procedureLabel(indicator)}
            {indicator.indicator_lot ? ` · Lote ${indicator.indicator_lot}` : ""}
            {indicator.identification ? ` · ${indicator.identification}` : ""}
          </p>
          <Textarea label="Motivo da anulação" value={reason} onChange={setReason} required maxLength={500} placeholder="Ex.: Lote digitado errado" />
          {error && <span className="form-error" role="alert">{error}</span>}
        </div>
      )}
    </Modal>
  );
}

/**
 * Normaliza a resposta do histórico (lista pura, `{ indicators }`, `{ items }`
 * ou `{ history }`) em linhas planas.
 * @param {any} payload
 */
function historyRows(payload) {
  if (Array.isArray(payload)) return payload;
  const body = asObject(payload);
  for (const key of ["indicators", "items", "history", "rows"]) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

function historyDate(row, fallbackDate = "") {
  return text(row?.appointment_date || row?.performed_at || row?.completed_at || fallbackDate || row?.indicator_date || row?.created_at).slice(0, 10);
}

/**
 * Cliente → Data → Procedimento (com joia) → indicadores. Mais recente primeiro.
 * @param {any[]} rows
 */
export function groupIndicatorHistory(rows, fallbackDate = "") {
  const dates = new Map();
  for (const row of asArray(rows)) {
    const date = historyDate(row, fallbackDate);
    if (!dates.has(date)) dates.set(date, new Map());
    const procedures = dates.get(date);
    const procedureKey = `${row?.appointment_id ?? ""}|${row?.appointment_item_id ?? procedureLabel(row)}|${jewelryLabel(row)}`;
    if (!procedures.has(procedureKey)) procedures.set(procedureKey, { key: procedureKey, procedure: row, indicators: [] });
    procedures.get(procedureKey).indicators.push(row);
  }
  return [...dates.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, procedures]) => ({ date, procedures: [...procedures.values()] }));
}

/**
 * Histórico somente leitura (cliente ou atendimento).
 * @param {{ clientId?: number|string, appointmentId?: number|string, compact?: boolean }} props
 */
export function ChemicalIndicatorHistory({ clientId, appointmentId, compact = false }) {
  const path = clientId
    ? `/clients/${clientId}/chemical-indicators`
    : appointmentId ? `/appointments/${appointmentId}/chemical-indicators` : "";
  const [state, setState] = useState(/** @type {{ loading: boolean, error: string, payload: any }} */ ({ loading: Boolean(path), error: "", payload: null }));
  const [viewingPhoto, setViewingPhoto] = useState(/** @type {any} */ (null));

  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    setState({ loading: true, error: "", payload: null });
    loadJson(path).then(({ payload, error }) => {
      if (active) setState({ loading: false, error: error || "", payload: payload ?? null });
    });
    return () => { active = false; };
  }, [path]);

  if (!path) return null;
  if (state.loading) return <p className="loading" role="status">Carregando indicadores químicos…</p>;
  if (state.error) return <p className="form-error" role="alert">{state.error}</p>;

  const rows = historyRows(state.payload);
  const body = asObject(state.payload);
  const clientName = text(body.client?.social_name || body.client?.full_name || body.client?.name || rows[0]?.client_social_name || rows[0]?.client_name || rows[0]?.full_name);
  // Pela rota do atendimento as linhas não trazem a data do agendamento: ela
  // vem uma vez só, em `appointment.appointment_date`.
  const groups = groupIndicatorHistory(rows, text(body.appointment?.appointment_date));

  return (
    <div className={`chem-history${compact ? " is-compact" : ""}`}>
      {clientName && (
        <p className="chem-history-client"><span>Cliente</span><strong>{clientName}</strong></p>
      )}
      {!groups.length ? (
        <p className="empty-state">Nenhum indicador químico registrado.</p>
      ) : (
        <ol className="chem-history-dates">
          {groups.map((day) => (
            <li key={day.date || "sem-data"} className="chem-history-day">
              <h4 className="chem-history-date">{fullDate(day.date) || "Data não informada"}</h4>
              <ul className="chem-history-procedures">
                {day.procedures.map((entry) => (
                  <li key={entry.key} className="chem-history-procedure">
                    <dl className="chem-history-chain">
                      <div><dt>Procedimento</dt><dd>{procedureLabel(entry.procedure)}</dd></div>
                      <div><dt>Joia</dt><dd>{jewelryLabel(entry.procedure) || "Sem joia vinculada"}</dd></div>
                    </dl>
                    <ul className="chem-history-indicators">
                      {entry.indicators.map((indicator, index) => {
                        const voided = isVoided(indicator);
                        const src = photoUrl(indicator);
                        const result = indicator?.result || "nao_informado";
                        return (
                          <li key={indicator?.id ?? index} className={`chem-history-indicator${voided ? " is-voided" : ""}`}>
                            <dl className="chem-history-chain">
                              <div>
                                <dt>Indicador</dt>
                                <dd>
                                  {[indicator?.indicator_type, indicator?.indicator_brand].filter(Boolean).join(" · ") || "Tipo não informado"}
                                  {" "}
                                  <StatusBadge tone={RESULT_TONES[result] || "neutral"}>{INDICATOR_RESULT_LABELS[result] || result}</StatusBadge>
                                  {voided && <> <StatusBadge tone="danger">Anulado</StatusBadge></>}
                                </dd>
                              </div>
                              <div>
                                <dt>Foto</dt>
                                <dd>
                                  {src ? (
                                    <button type="button" className="chem-photo-button" onClick={() => setViewingPhoto(indicator)} aria-label="Ampliar foto da etiqueta do indicador">
                                      <SecureImage src={src} alt="Etiqueta do indicador químico" className="chem-photo-thumb" />
                                      <span><Camera size={15} aria-hidden="true" /> Ver foto</span>
                                    </button>
                                  ) : hasRestrictedPhoto(indicator) ? RESTRICTED_PHOTO_TEXT : "Sem foto"}
                                </dd>
                              </div>
                              <div>
                                <dt>Lote/identificação</dt>
                                <dd>
                                  {[indicator?.indicator_lot ? `Lote ${indicator.indicator_lot}` : "", indicator?.identification].filter(Boolean).join(" · ") || "Não informados"}
                                  {indicator?.indicator_date ? ` · ${fullDate(indicator.indicator_date)}` : ""}
                                </dd>
                              </div>
                            </dl>
                            {voided && indicator?.void_reason && <small className="chem-muted">Motivo da anulação: {indicator.void_reason}</small>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <PhotoModal indicator={viewingPhoto} onClose={() => setViewingPhoto(null)} />
    </div>
  );
}
