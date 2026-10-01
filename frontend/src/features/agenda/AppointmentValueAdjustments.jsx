// Ajustes de valor do atendimento (acréscimo/abatimento com motivo).
//
// Contrato usado por Agenda.jsx ("Conferência financeira" do "Detalhes do
// Agendamento"); as props não mudam. Cada ajuste é gravado na hora pela API
// (`/appointments/:id/value-adjustments`), é imutável e só pode ser anulado com
// motivo — a lista mostra também os anulados, para o histórico ficar completo.
// Depois de incluir ou anular, `onChanged({ adjustments, financial })` entrega
// ao pai o snapshot financeiro recalculado pelo backend (Ajustes, Líquido,
// Restante), que é a fonte da verdade.
//
// Leitura com `apiFetch` + estado local (e não `useFetch`): o bloco vive dentro
// do modal da agenda, que também é montado em testes sem QueryClientProvider.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowUpDown, Ban, Plus } from "lucide-react";
import { Button, Input, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { Modal } from "../../components/common/Crud";
import { apiFetch } from "../../lib/api";
import { fromCents, sumActiveAdjustments, toCents } from "../../lib/operationTotals";
import { asArray, asObject } from "../../lib/utils";
import { currency } from "../shared/helpers";
import "./appointment-value-adjustments.css";

export const ADJUSTMENT_TYPE_LABELS = {
  acrescimo: "Acréscimo (+)",
  abatimento: "Abatimento (−)",
};
const REASON_MAX = 500;
// Mesmo bloqueio do backend (409): ausência e cancelamento encerram o valor.
const BLOCKED_STATUSES = ["cancelado", "nao_compareceu"];

const emptyForm = () => ({ adjustment_type: "acrescimo", amount: "", reason: "" });

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `adjustment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Data e hora locais ("30/09/2026 14:05"). */
function dateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function signedMoney(type, amount) {
  const value = currency.format(Math.abs(Number(amount || 0)));
  return type === "abatimento" ? `− ${value}` : `+ ${value}`;
}

function isVoided(adjustment) {
  return String(adjustment?.status || "").toLowerCase() === "anulado";
}

/** Valida o valor digitado: positivo e com no máximo duas casas. */
function amountError(text) {
  const raw = String(text ?? "").trim().replace(",", ".");
  const number = Number(raw);
  if (!raw || !Number.isFinite(number) || number <= 0) return "Informe um valor maior que zero.";
  if (Math.abs(number * 100 - Math.round(number * 100)) > 1e-6) return "Use no máximo duas casas decimais.";
  return "";
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

/**
 * @param {{
 *   appointment: Record<string, any> | null,
 *   canEdit?: boolean,
 *   requireReason?: boolean,
 *   lockedReason?: string,
 *   onChanged?: (payload: { adjustments: any[], financial: Record<string, any> }) => void
 * }} props
 *
 * `canEdit`: quem pode incluir/anular (o pai resolve `appointments.edit_final_value`
 * e, se o atendimento já está `atendido`, também `finance.edit`). Sem ela, a
 * lista fica somente leitura com a explicação.
 * `lockedReason`: explicação do pai quando o bloqueio não é de permissão (ex.:
 * atendimento finalizado num plano sem o Financeiro básico); substitui o texto
 * padrão de "Somente leitura".
 * `requireReason`: mantida no contrato. O motivo é SEMPRE obrigatório (SPEC
 * 4.1, o backend recusa sem ele), com ou sem esta prop; ela só reforça no
 * rótulo que o motivo fica na auditoria. O aviso de "atendimento finalizado"
 * vem do status do próprio atendimento — a Agenda passa `requireReason` em
 * qualquer status, e o aviso não pode aparecer num agendamento em aberto.
 */
export function AppointmentValueAdjustments({ appointment, canEdit = false, requireReason = false, lockedReason = "", onChanged }) {
  const appointmentId = appointment?.id;
  const status = String(appointment?.status || "").toLowerCase();
  const blocked = BLOCKED_STATUSES.includes(status);
  const attended = status === "atendido";
  const editable = Boolean(canEdit && appointmentId && !blocked);
  const amountErrorId = useId();
  // Muda quando o pai recarrega o agendamento gravado (outro salvamento mexeu
  // em itens, desconto ou status): o snapshot daqui fica velho e a
  // pré-checagem do abatimento usaria um líquido que não existe mais.
  const persistedKey = appointment
    ? [appointment.status, appointment.total_value, appointment.discount_value, appointment.adjustment_total, appointment.remaining_value, appointment.updated_at].map((value) => String(value ?? "")).join("|")
    : "";

  const [adjustments, setAdjustments] = useState(/** @type {any[]} */ ([]));
  const [financial, setFinancial] = useState(/** @type {Record<string, any>} */ ({}));
  const [loading, setLoading] = useState(Boolean(appointmentId));
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [voiding, setVoiding] = useState(/** @type {null | { adjustment: any, reason: string, error: string, busy: boolean }} */ (null));
  // Uma chave por intenção de inclusão: o duplo clique e a repetição após
  // falha de rede reaproveitam a mesma chave (o backend devolve o mesmo
  // ajuste); qualquer mudança no formulário ou um sucesso geram outra.
  const idempotencyKey = useRef("");
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  // Só a resposta da leitura mais recente vale: trocar de agendamento (ou
  // recarregar) com uma leitura em voo não pode pintar a lista de outro.
  const loadSeq = useRef(0);
  const loadedOnce = useRef(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++loadSeq.current;
    if (!appointmentId) return;
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const response = await apiFetch(`/appointments/${appointmentId}/value-adjustments`);
      const payload = await readJson(response);
      if (seq !== loadSeq.current) return;
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os ajustes.");
      setAdjustments(asArray(payload.adjustments));
      setFinancial(asObject(payload.financial));
      loadedOnce.current = true;
    } catch (error) {
      if (seq !== loadSeq.current) return;
      setLoadError(error?.message === "Failed to fetch" ? "Não foi possível conectar com a API." : error?.message || "Não foi possível carregar os ajustes.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [appointmentId]);

  // Troca de agendamento: lista limpa e leitura com "Carregando".
  useEffect(() => {
    loadedOnce.current = false;
    setAdjustments([]);
    setFinancial({});
    void load();
  }, [load]);

  // Mesmo agendamento regravado pelo pai: relê em silêncio (sem piscar a lista).
  // biome-ignore lint/correctness/useExhaustiveDependencies: só a mudança do registro gravado dispara a releitura.
  useEffect(() => {
    if (loadedOnce.current) void load({ silent: true });
  }, [persistedKey]);

  const applyResult = (payload) => {
    loadSeq.current += 1; // descarta leitura em voo, que traria o estado anterior
    setLoading(false);
    const nextAdjustments = asArray(payload.adjustments);
    const nextFinancial = asObject(payload.financial);
    setAdjustments(nextAdjustments);
    setFinancial(nextFinancial);
    onChangedRef.current?.({ adjustments: nextAdjustments, financial: nextFinancial });
  };

  const updateForm = (patch) => {
    idempotencyKey.current = "";
    setFormError("");
    setSuccess("");
    setForm((current) => ({ ...current, ...patch }));
  };

  async function addAdjustment() {
    if (!editable || saving) return;
    const reason = form.reason.trim();
    const invalidAmount = amountError(form.amount);
    if (invalidAmount) { setFormError(invalidAmount); return; }
    if (!reason) { setFormError("Informe o motivo do ajuste."); return; }
    const amountCents = toCents(String(form.amount).replace(",", "."));
    // Pré-checagem do mesmo 400 do backend, com o líquido já ajustado que a
    // API devolveu; sem snapshot, quem decide é o servidor.
    const currentNet = financial.netTotal ?? financial.net_total;
    if (form.adjustment_type === "abatimento" && currentNet !== undefined && amountCents > toCents(currentNet)) {
      setFormError("O abatimento deixaria o valor líquido negativo.");
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = newIdempotencyKey();
    setSaving(true);
    setFormError("");
    setSuccess("");
    try {
      const response = await apiFetch(`/appointments/${appointmentId}/value-adjustments`, {
        method: "POST",
        body: JSON.stringify({
          adjustment_type: form.adjustment_type,
          amount: fromCents(amountCents),
          reason,
          idempotency_key: idempotencyKey.current,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setFormError(payload.error || "Não foi possível registrar o ajuste.");
        return;
      }
      idempotencyKey.current = "";
      setForm(emptyForm());
      setSuccess("Ajuste registrado.");
      applyResult(payload);
    } catch {
      setFormError("Não foi possível conectar com a API. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmVoid() {
    if (!voiding || voiding.busy) return;
    const reason = voiding.reason.trim();
    if (!reason) { setVoiding({ ...voiding, error: "Informe o motivo da anulação." }); return; }
    setVoiding({ ...voiding, busy: true, error: "" });
    try {
      const response = await apiFetch(`/appointments/${appointmentId}/value-adjustments/${voiding.adjustment.id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setVoiding((current) => current && { ...current, busy: false, error: payload.error || "Não foi possível anular o ajuste." });
        return;
      }
      setVoiding(null);
      setSuccess("Ajuste anulado.");
      applyResult(payload);
    } catch {
      setVoiding((current) => current && { ...current, busy: false, error: "Não foi possível conectar com a API. Tente novamente." });
    }
  }

  if (!appointmentId) {
    return (
      <section className="value-adjustments" aria-label="Ajustes de valor">
        <header className="value-adjustments__header"><strong><ArrowUpDown size={18} aria-hidden="true" />Ajustes de valor</strong></header>
        <p className="value-adjustments__note">Salve o agendamento para registrar acréscimos ou abatimentos.</p>
      </section>
    );
  }

  const activeTotal = sumActiveAdjustments(adjustments);
  const activeCount = adjustments.filter((item) => !isVoided(item)).length;
  const amountInvalid = Boolean(formError) && formError === amountError(form.amount);
  const totalLabel = activeTotal === 0 ? currency.format(0) : activeTotal < 0 ? `− ${currency.format(Math.abs(activeTotal))}` : `+ ${currency.format(activeTotal)}`;

  // `data-modal-ignore-dirty`: o ajuste é gravado na hora, então digitar aqui
  // não é "alteração não salva" do modal de detalhes (ver integration request
  // para o Modal de Crud.jsx respeitar o atributo).
  return (
    <section className="value-adjustments" aria-label="Ajustes de valor" data-modal-ignore-dirty="">
      <header className="value-adjustments__header">
        <strong><ArrowUpDown size={18} aria-hidden="true" />Ajustes de valor</strong>
        <span className="value-adjustments__total">
          {activeCount === 1 ? "1 ajuste ativo" : `${activeCount} ajustes ativos`}: <b>{totalLabel}</b>
        </span>
      </header>
      <p className="value-adjustments__hint">Acréscimo ou abatimento sobre o valor líquido, separado do desconto. Para corrigir, anule o ajuste com motivo e lance outro.</p>

      {loading && <p className="value-adjustments__note" role="status">Carregando ajustes…</p>}
      {!loading && loadError && (
        <div className="value-adjustments__load-error" role="alert">
          <span>{loadError}</span>
          <Button variant="secondary" onClick={() => void load()}>Tentar novamente</Button>
        </div>
      )}
      {!loading && !loadError && adjustments.length === 0 && <p className="value-adjustments__empty">Nenhum ajuste registrado neste atendimento.</p>}
      {!loading && !loadError && adjustments.length > 0 && (
        <ul className="value-adjustments__list" aria-label="Ajustes registrados">
          {adjustments.map((adjustment) => {
            const voided = isVoided(adjustment);
            const type = String(adjustment.adjustment_type || "").toLowerCase();
            return (
              <li key={adjustment.id} className={`value-adjustments__item${voided ? " is-voided" : ""}`}>
                <div className="value-adjustments__item-main">
                  <span className={`value-adjustments__type is-${type === "abatimento" ? "decrease" : "increase"}`}>{ADJUSTMENT_TYPE_LABELS[type] || type}</span>
                  <strong className="value-adjustments__amount">{signedMoney(type, adjustment.amount)}</strong>
                  <StatusBadge tone={voided ? "danger" : "ok"}>{voided ? "Anulado" : "Ativo"}</StatusBadge>
                </div>
                <p className="value-adjustments__reason"><span>Motivo:</span> {adjustment.reason}</p>
                <p className="value-adjustments__meta">
                  Registrado em {dateTime(adjustment.created_at) || "—"} por {adjustment.created_by_name || "usuário não identificado"}
                </p>
                {voided && (
                  <p className="value-adjustments__meta is-void">
                    Anulado em {dateTime(adjustment.voided_at) || "—"} por {adjustment.voided_by_name || "usuário não identificado"} — {adjustment.void_reason}
                  </p>
                )}
                {editable && !voided && (
                  <div className="value-adjustments__item-actions">
                    <Button
                      variant="secondary"
                      className="danger"
                      aria-label={`Anular ${ADJUSTMENT_TYPE_LABELS[type] || "ajuste"} de ${currency.format(Number(adjustment.amount || 0))}`}
                      onClick={() => setVoiding({ adjustment, reason: "", error: "", busy: false })}
                    >
                      <Ban size={16} aria-hidden="true" />Anular
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sem role="note": o modal da agenda já tem uma nota de plano, e duas
          notas no mesmo diálogo confundem leitor de tela (e os testes). */}
      {blocked && <p className="value-adjustments__note">Atendimento {status === "cancelado" ? "cancelado" : "sem comparecimento"}: o valor está encerrado e não aceita novos ajustes.</p>}
      {!blocked && !canEdit && <p className="value-adjustments__note">{lockedReason || <>Somente leitura. Incluir ou anular ajustes exige a permissão “Alterar valor final” da Agenda{attended ? " e, com o atendimento finalizado, também “Editar” do Financeiro" : ""}.</>}</p>}

      {editable && (
        <div className="value-adjustments__form" role="group" aria-label="Novo ajuste de valor">
          {attended && <p className="value-adjustments__note is-warning">Atendimento já finalizado: o ajuste recalcula o saldo a receber e a comissão, e fica registrado na auditoria.</p>}
          <div className="value-adjustments__fields">
            <Select label="Tipo" value={form.adjustment_type} onChange={(adjustment_type) => updateForm({ adjustment_type })}>
              <option value="acrescimo">{ADJUSTMENT_TYPE_LABELS.acrescimo}</option>
              <option value="abatimento">{ADJUSTMENT_TYPE_LABELS.abatimento}</option>
            </Select>
            <Input
              label="Valor (R$)"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0,00"
              value={form.amount}
              onChange={(amount) => updateForm({ amount })}
              required
              aria-invalid={amountInvalid ? "true" : undefined}
              aria-describedby={amountInvalid ? amountErrorId : undefined}
            />
            <Input
              label={requireReason || attended ? "Motivo (obrigatório, fica na auditoria)" : "Motivo (obrigatório)"}
              value={form.reason}
              onChange={(reason) => updateForm({ reason })}
              maxLength={REASON_MAX}
              placeholder="Ex.: Atraso do cliente, Material adicional"
              required
              fieldClassName="value-adjustments__reason-field"
            />
          </div>
          <div className="value-adjustments__actions">
            {formError && <small id={amountInvalid ? amountErrorId : undefined} className="form-error" role="alert">{formError}</small>}
            {success && !formError && <small className="form-success" role="status">{success}</small>}
            <Button onClick={() => void addAdjustment()} disabled={saving}>
              <Plus size={16} aria-hidden="true" />{saving ? "Registrando…" : "Adicionar ajuste"}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(voiding)}
        title="Anular ajuste de valor"
        subtitle="O ajuste continua no histórico como anulado; o valor do atendimento é recalculado."
        confirmClose={false}
        onClose={() => !voiding?.busy && setVoiding(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setVoiding(null)} disabled={voiding?.busy}>Voltar</Button>
            <Button variant="danger" onClick={() => void confirmVoid()} disabled={!voiding?.reason?.trim() || voiding?.busy}>{voiding?.busy ? "Anulando…" : "Anular ajuste"}</Button>
          </>
        )}
      >
        {voiding && (
          <div className="stack">
            <div className="soft-card value-adjustments__void-summary">
              <strong>{ADJUSTMENT_TYPE_LABELS[voiding.adjustment.adjustment_type] || "Ajuste"}: {signedMoney(voiding.adjustment.adjustment_type, voiding.adjustment.amount)}</strong>
              <span>Motivo original: {voiding.adjustment.reason}</span>
            </div>
            <Textarea
              label="Motivo da anulação (obrigatório)"
              value={voiding.reason}
              maxLength={REASON_MAX}
              onChange={(reason) => setVoiding({ ...voiding, reason, error: "" })}
              placeholder="Ex.: Valor lançado em duplicidade"
            />
            {voiding.error && <small className="form-error" role="alert">{voiding.error}</small>}
          </div>
        )}
      </Modal>
    </section>
  );
}
