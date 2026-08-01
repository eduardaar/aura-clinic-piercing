// Tradução dos eventos do Asaas para as ações do nosso domínio, e o registro
// idempotente de cada webhook recebido.
//
// Duas nomenclaturas convivem no Asaas e é fácil confundi-las:
//   - NOME DE EVENTO, no webhook: "PAYMENT_CONFIRMED"
//   - STATUS DO RECURSO, em GET /payments/{id}: "CONFIRMED"
// As duas funções abaixo aceitam ambas, porque a conciliação por polling lê o
// status e o webhook lê o evento — e um bug clássico é tratar só uma delas.
import { query } from "../../database/connection.js";

// CONFIRMED = o Asaas reconheceu o pagamento (cartão aprovado, PIX caiu).
// RECEIVED  = o dinheiro entrou na conta.
// Para liberar o serviço, ambos valem — e AMBOS chegam para a mesma cobrança,
// em sequência. É por isso que idempotência aqui não é refinamento: é o
// caminho normal de execução.
const PAID_EVENTS = new Set([
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_RECEIVED_IN_CASH",
  "PAYMENT_APPROVED_BY_RISK_ANALYSIS"
]);

const OVERDUE_EVENTS = new Set(["PAYMENT_OVERDUE"]);

// Estorno e chargeback entram aqui junto de exclusão: em todos, o dinheiro
// deixou de ser nosso e o acesso precisa voltar atrás.
const CANCELED_EVENTS = new Set([
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS"
]);

const CREATED_EVENTS = new Set(["PAYMENT_CREATED"]);

/** @returns {"paid"|"overdue"|"canceled"|"created"|"ignored"} */
export function resolveAction(event) {
  const name = String(event || "").toUpperCase();
  if (PAID_EVENTS.has(name)) return "paid";
  if (OVERDUE_EVENTS.has(name)) return "overdue";
  if (CANCELED_EVENTS.has(name)) return "canceled";
  if (CREATED_EVENTS.has(name)) return "created";
  // PAYMENT_UPDATED, PAYMENT_ANTICIPATED, eventos de transferência etc.
  // Ignorar explicitamente é melhor que tratar: cada evento novo que o Asaas
  // inventar chega aqui e vira no-op, sem quebrar nada.
  return "ignored";
}

// Mesma decisão a partir do STATUS do recurso (usado na conciliação por
// polling). Aceita também os nomes de evento, como defesa contra a confusão
// entre as duas nomenclaturas.
export function isPaidStatus(status) {
  const name = String(status || "").toUpperCase();
  return PAID_EVENTS.has(name) || ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(name);
}

export function isCanceledStatus(status) {
  const name = String(status || "").toUpperCase();
  return (
    CANCELED_EVENTS.has(name) ||
    ["REFUNDED", "CHARGEBACK_REQUESTED", "DELETED", "REFUND_REQUESTED"].includes(name)
  );
}

// Registra o evento e responde se ele JÁ tinha sido registrado antes.
//
// A garantia não vem do SELECT-antes-de-inserir (que perderia a corrida entre
// duas entregas simultâneas), e sim do índice único
// ux_webhook_events_provider_event: quem perde a corrida recebe zero linhas do
// ON CONFLICT DO NOTHING e sabe que é duplicata.
//
// Evento sem `id` no corpo (raro, mas o Asaas não garante) é sempre gravado
// como novo — a idempotência real desses fica por conta do estado da fatura,
// que os handlers checam de qualquer forma.
export async function registerEvent({
  scope,
  tenantId = null,
  eventId,
  eventType,
  paymentId = null,
  payload
}) {
  const result = await query(
    `INSERT INTO platform.webhook_events
       (provider, scope, tenant_id, provider_event_id, event_type, asaas_payment_id, payload, status)
     VALUES ('asaas', $1, $2, $3, $4, $5, $6, 'received')
     ON CONFLICT (provider, scope, provider_event_id)
       WHERE provider_event_id IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [scope, tenantId, eventId || null, eventType || null, paymentId, JSON.stringify(payload ?? {})]
  );
  const row = result.rows[0];
  return row ? { id: row.id, duplicate: false } : { id: null, duplicate: true };
}

// Fecha o registro do evento com o desfecho. Best-effort: falhar em ATUALIZAR
// a auditoria não pode transformar um webhook processado com sucesso em erro
// 500 — o Asaas reentregaria um evento que já surtiu efeito.
export async function finishEvent(id, status, detail = null) {
  if (!id) return;
  try {
    await query(
      `UPDATE platform.webhook_events
          SET status=$1, detail=$2, processed_at=now()
        WHERE id=$3`,
      [status, detail ? String(detail).slice(0, 500) : null, id]
    );
  } catch (error) {
    console.error("[Asaas] falha ao registrar desfecho do webhook:", error.message);
  }
}

// Libera a "reserva" do evento quando o processamento falhou no meio.
//
// Sem isto haveria uma perda silenciosa de dinheiro: o INSERT acima reivindica
// o evento ANTES de processá-lo (é o que impede duas entregas simultâneas de
// rodarem juntas), então uma falha depois da reivindicação deixaria a
// reentrega do Asaas ser descartada como duplicata — e o pagamento nunca
// baixaria.
//
// A saída é anular `provider_event_id`: a linha continua no banco para
// auditoria (com o id preservado em `detail`), mas some do índice único
// parcial, e a reentrega volta a ser tratada como evento novo.
export async function releaseEvent(id, eventId, detail) {
  if (!id) return;
  try {
    await query(
      `UPDATE platform.webhook_events
          SET status='failed',
              provider_event_id=NULL,
              detail=$1,
              processed_at=now()
        WHERE id=$2`,
      [`event=${eventId || "?"} | ${String(detail).slice(0, 400)}`, id]
    );
  } catch (error) {
    console.error("[Asaas] falha ao liberar evento para reentrega:", error.message);
  }
}

// Auditoria de tentativa rejeitada (token errado/ausente). Vale gravar: é o
// rastro de quem tentou forjar confirmação de pagamento.
export async function recordRejectedEvent({ scope, tenantId = null, reason, payload }) {
  try {
    await query(
      `INSERT INTO platform.webhook_events
         (provider, scope, tenant_id, event_type, status, detail, payload)
       VALUES ('asaas', $1, $2, $3, 'rejected', $4, $5)`,
      [
        scope,
        tenantId,
        String(payload?.event || "unknown"),
        String(reason).slice(0, 500),
        JSON.stringify(payload ?? {})
      ]
    );
  } catch (error) {
    console.error("[Asaas] falha ao registrar webhook rejeitado:", error.message);
  }
}
