// Cobrança do CLIENTE FINAL na conta Asaas da própria clínica.
//
// É o outro lado do espelho do faturamento da plataforma: aqui a credencial sai
// do cofre da clínica (`tenantClient`) e o dinheiro cai na conta dela. A
// Monitence não entra no fluxo do dinheiro — sem subconta, sem split, sem a
// obrigação de a conta raiz ser CNPJ.
//
// O que este arquivo NÃO faz de propósito:
//   - não reimplementa a máquina de estados do pagamento (é `payments.js`);
//   - não fala HTTP com o gateway (é `asaas/client.js`);
//   - não decide se um evento é pagamento ou estorno (é `asaas/events.js`).
//
// A regra que organiza tudo abaixo: gateway indisponível NÃO pode derrubar o
// agendamento nem a venda. A clínica continua vendendo e recebendo presencial;
// o pagamento online é uma comodidade, não um pré-requisito.
import { createPaymentIntent, transitionPaymentIntent } from "./payments.js";
import { tenantClient } from "./asaas/credentials.js";
import { AsaasError, onlyDigits, toAsaasValue, minimumDueDate } from "./asaas/client.js";
import { isPaidStatus, isCanceledStatus } from "./asaas/events.js";
import { deductSoldProductStock } from "./sales.js";
import { localTimestamp } from "./utils.js";

// Janela de vida do intent. O default de `createPaymentIntent` são 30 minutos,
// herdados do PIX manual; com `billingType: UNDEFINED` o pagador pode escolher
// boleto e pagar amanhã, e um intent expirado em 30 minutos transformaria todo
// pagamento por boleto em "pagou depois de expirar".
const CHARGE_EXPIRES_MINUTES = 60 * 24 * 2;

// ---------------------------------------------------------------------------
// Helpers de credencial e de dados do pagador
// ---------------------------------------------------------------------------

// `tenantClient` devolve null quando a clínica não configurou (ou desligou) o
// Asaas — estado NORMAL, não defeito. Traduzimos para um AsaasError tipado
// porque quem chama precisa distinguir "não tem pagamento online" de "o gateway
// caiu", e porque `userMessage` é o único texto que pode chegar à tela pública.
async function requireTenantClient(db) {
  const client = await tenantClient(db);
  if (!client) {
    throw new AsaasError("Clínica sem integração Asaas ativa.", {
      status: 503,
      code: "not_configured",
      userMessage: "Esta clínica não tem pagamento online configurado. Combine o pagamento direto com ela."
    });
  }
  return client;
}

// Carrega o cliente final já validado para virar pagador no Asaas. Roda ANTES
// de qualquer escrita ou chamada de rede: CPF ausente é erro de cadastro, e
// descobri-lo só depois de criar o intent deixaria lixo no banco.
async function loadChargeableClient(db, clientId) {
  const client = await db.get(
    "SELECT id, full_name, whatsapp, email, tax_id, asaas_customer_id FROM clients WHERE id=?",
    [clientId]
  );
  if (!client) {
    throw new AsaasError(`Cliente ${clientId} não encontrado para cobrança.`, {
      status: 404,
      code: "client_not_found",
      userMessage: "Cadastro do cliente não encontrado."
    });
  }
  const taxId = onlyDigits(client.tax_id);
  // O Asaas exige cpfCnpj no cadastro do pagador — sem ele a cobrança nem chega
  // a ser criada. Falhar aqui, com mensagem de formulário, é muito melhor que
  // devolver "invalid_cpfCnpj" do gateway na cara de quem está comprando.
  if (!taxId || (taxId.length !== 11 && taxId.length !== 14)) {
    throw new AsaasError(`Cliente ${clientId} sem CPF válido (tax_id).`, {
      status: 422,
      code: "missing_tax_id",
      userMessage: "Informe o CPF do cliente para gerar a cobrança online."
    });
  }
  return { ...client, taxId };
}

// Carimbo de pagamento no formato TEXT do banco ('YYYY-MM-DD HH:MM:SS'), o
// mesmo do resto do sistema. O Asaas manda `paymentDate` só com a data
// ("2026-07-31"); gravar o ISO com "T...Z" funcionaria nas queries (que fazem
// SUBSTRING(paid_at,1,10)) mas deixaria dois formatos convivendo na coluna.
function toPaidAtTimestamp(value) {
  if (!value) return localTimestamp();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? localTimestamp() : localTimestamp(date);
}

// ---------------------------------------------------------------------------
// Pagador (customer) na conta da clínica
// ---------------------------------------------------------------------------

/**
 * Garante um customer do Asaas para o cliente final, na conta DA CLÍNICA.
 * Devolve o id do customer (`cus_...`).
 */
export async function ensureAsaasCustomer(db, clientId) {
  const client = await loadChargeableClient(db, clientId);
  if (client.asaas_customer_id) return client.asaas_customer_id;

  const asaas = await requireTenantClient(db);
  const customer = await asaas.createCustomer({
    name: client.full_name,
    taxId: client.taxId,
    email: client.email || undefined,
    phone: client.whatsapp,
    // Rastro de volta: pelo painel do Asaas dá para saber de quem é o cadastro
    // sem consultar o banco da clínica.
    externalReference: `client:${client.id}`
  });
  if (!customer?.id) {
    throw new AsaasError("O gateway não devolveu o id do pagador.", { status: 502 });
  }

  // `AND asaas_customer_id IS NULL` resolve a corrida entre dois checkouts
  // simultâneos do mesmo cliente: o segundo grava zero linhas e passa a usar o
  // customer do primeiro. Sobra um customer órfão na conta do Asaas — inócuo, e
  // bem melhor que violar o índice único ou cobrar em dois cadastros.
  await db.run("UPDATE clients SET asaas_customer_id=? WHERE id=? AND asaas_customer_id IS NULL", [
    customer.id,
    client.id
  ]);
  const saved = await db.get("SELECT asaas_customer_id FROM clients WHERE id=?", [client.id]);
  return saved?.asaas_customer_id || customer.id;
}

// ---------------------------------------------------------------------------
// Criação de cobrança
// ---------------------------------------------------------------------------

// Núcleo comum do sinal e da venda. A ordem das etapas é a parte importante:
//
//   1. validações determinísticas (valor, CPF, credencial) — sem rede, sem
//      escrita: um erro aqui não deixa intent órfão;
//   2. intent local (`createPaymentIntent`), que é a nossa verdade;
//   3. gateway (customer + cobrança), o único passo que pode falhar por motivo
//      alheio a nós — e cuja falha é degradação, não exceção;
//   4. persistência do `external_id`/`invoice_url`.
async function createTenantCharge(
  db,
  {
    appointmentId = null,
    salesOrderId = null,
    clientId,
    amount,
    description,
    paymentType = "deposit",
    idempotencyKey,
    dueDate,
    billingType = "UNDEFINED",
    expiresMinutes = CHARGE_EXPIRES_MINUTES
  }
) {
  // Valida o valor ANTES de gravar: o Asaas cobra em REAIS decimais (149.90),
  // não em centavos, e um valor inválido precisa morrer antes do INSERT.
  const value = toAsaasValue(amount);
  const asaas = await requireTenantClient(db);
  await loadChargeableClient(db, clientId);

  const intent = await createPaymentIntent(db, {
    appointmentId,
    clientId,
    amount: value,
    provider: "asaas",
    idempotencyKey,
    expiresMinutes
  });

  // Colunas que `createPaymentIntent` não conhece (ele nasceu antes da venda de
  // catálogo e do gateway).
  await db.run(
    "UPDATE payment_intents SET sales_order_id=?, payment_type=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [salesOrderId, paymentType, description || null, intent.id]
  );

  // Chamada repetida com a mesma chave de idempotência e cobrança já criada:
  // emitir outra faria o cliente receber duas faturas do mesmo pedido.
  if (intent.external_id) {
    const current = await db.get("SELECT * FROM payment_intents WHERE id=?", [intent.id]);
    return { ...current, online_payment_available: true, gateway_error: null, reused: true };
  }

  let payment = null;
  try {
    const customerId = await ensureAsaasCustomer(db, clientId);
    payment = await asaasCreatePayment(asaas, {
      customerId,
      value,
      dueDate,
      description,
      intentId: intent.id,
      billingType
    });
  } catch (error) {
    // Degradação deliberada: o intent continua vivo em `awaiting_payment`, sem
    // `external_id`. A clínica segue com o agendamento/venda e cobra presencial
    // (ou a tela oferece "gerar link de novo" depois). Derrubar o fluxo inteiro
    // porque o Asaas caiu seria trocar um problema deles por um prejuízo nosso.
    console.error(
      `[Asaas] falha ao criar cobrança do intent ${intent.id}: ${error.message}`
    );
    const current = await db.get("SELECT * FROM payment_intents WHERE id=?", [intent.id]);
    return {
      ...current,
      invoice_url: null,
      online_payment_available: false,
      gateway_error: error instanceof AsaasError ? error.userMessage : "Não foi possível gerar a cobrança online agora."
    };
  }

  // Daqui para baixo a cobrança JÁ EXISTE no Asaas. Se este UPDATE falhar, a
  // exceção sobe (é banco fora, falha transitória de verdade) — e mesmo assim o
  // dinheiro não se perde: o webhook acha o intent pelo `externalReference`.
  await db.run(
    `UPDATE payment_intents
        SET external_id=?, invoice_url=?, billing_type=?, due_date=?,
            metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb,
            updated_at=CURRENT_TIMESTAMP
      WHERE id=?`,
    [
      payment.id,
      payment.invoiceUrl || null,
      payment.billingType || null,
      payment.dueDate || null,
      JSON.stringify({ integration: "asaas", asaas_customer: payment.customer || null }),
      intent.id
    ]
  );

  const saved = await db.get("SELECT * FROM payment_intents WHERE id=?", [intent.id]);
  return { ...saved, online_payment_available: true, gateway_error: null };
}

// `billingType: "UNDEFINED"` é a decisão que economiza mais código no projeto:
// o Asaas hospeda a fatura (`invoiceUrl`) e o pagador escolhe PIX, boleto ou
// cartão lá. Sem isso teríamos que gerar QR code, copia-e-cola, tela de cartão
// e conciliação de PIX por conta própria.
//
// A exceção é a cobrança que RESERVA ESTOQUE FÍSICO — ver `PIX_ONLY_MINUTES`.
async function asaasCreatePayment(
  asaas,
  { customerId, value, dueDate, description, intentId, billingType = "UNDEFINED" }
) {
  const payment = await asaas.createPayment({
    customer: customerId,
    value,
    // Vencimento no passado é REJEITADO pelo gateway; o piso é amanhã.
    dueDate: dueDate || minimumDueDate(),
    description,
    // Rastro que torna o webhook resolvível mesmo se o UPDATE do `external_id`
    // não tiver acontecido (rede caiu entre o POST e o commit).
    externalReference: `intent:${intentId}`,
    billingType
  });
  if (!payment?.id) throw new AsaasError("O gateway não devolveu o id da cobrança.", { status: 502 });
  return payment;
}

// Cobrança que segura joia no estoque: PIX, e com janela curta.
//
// É a resolução de um conflito real. Com `UNDEFINED` o pagador pode escolher
// BOLETO e pagar dois dias depois — mas a joia é uma peça só, reservada agora.
// As duas saídas eram segurar o estoque por 48h (e perder venda de balcão em
// cima de um pedido que talvez nunca seja pago) ou liberar a reserva antes do
// boleto vencer (e receber o dinheiro de uma peça que já foi vendida a outra
// pessoa). Nenhuma é aceitável, então o boleto simplesmente não é oferecido
// quando há estoque em jogo: PIX liquida em segundos e cabe na janela da
// reserva.
//
// Sinal de agendamento SEM joia reservada continua com `UNDEFINED` — ali não há
// peça física presa e a flexibilidade de pagamento vale mais.
export const PIX_ONLY_MINUTES = 30;

/** Configuração de cobrança conforme o pedido prenda ou não estoque físico. */
export function chargeModeForStock(reservesStock) {
  return reservesStock
    ? { billingType: "PIX", expiresMinutes: PIX_ONLY_MINUTES }
    : { billingType: "UNDEFINED", expiresMinutes: CHARGE_EXPIRES_MINUTES };
}

/** Sinal do agendamento. */
export async function createAppointmentDepositCharge(
  db,
  { appointmentId, clientId, amount, description, idempotencyKey, dueDate, reservesStock = false } = {}
) {
  return createTenantCharge(db, {
    appointmentId,
    clientId,
    amount,
    description: description || `Sinal do agendamento #${appointmentId}`,
    paymentType: "deposit",
    idempotencyKey,
    dueDate,
    ...chargeModeForStock(reservesStock)
  });
}

/** Venda de joias pelo catálogo público. */
export async function createSalesOrderCharge(
  db,
  { salesOrderId, clientId, amount, description, idempotencyKey, dueDate, reservesStock = true } = {}
) {
  return createTenantCharge(db, {
    salesOrderId,
    clientId,
    amount,
    description: description || `Pedido #${salesOrderId}`,
    paymentType: "sale",
    idempotencyKey,
    dueDate,
    // Venda de joia default para PIX: o caso comum do catálogo é peça física.
    // Quem vender só serviço passa `reservesStock: false` explicitamente.
    ...chargeModeForStock(reservesStock)
  });
}

// ---------------------------------------------------------------------------
// PIX inline
// ---------------------------------------------------------------------------

/**
 * QR code + copia-e-cola de uma cobrança já criada, para a tela exibir o PIX
 * sem mandar o cliente para a página do Asaas.
 *
 * Devolve `null` (em vez de lançar) em TODO caminho de insucesso: é um recurso
 * opcional de tela pública, e a fatura hospedada (`invoice_url`) continua sendo
 * o caminho garantido. Nada aqui é gravado em `pix_copy_paste`: o payload do
 * PIX tem validade própria e um cache sem a data de expiração acabaria
 * mostrando um QR vencido.
 */
export async function getPixData(db, intentId) {
  const intent = await db.get(
    "SELECT id, provider, external_id FROM payment_intents WHERE id=?",
    [intentId]
  );
  if (!intent || intent.provider !== "asaas" || !intent.external_id) return null;

  try {
    const asaas = await requireTenantClient(db);
    const pix = await asaas.getPixQrCode(intent.external_id);
    if (!pix?.encodedImage && !pix?.payload) return null;
    return {
      encodedImage: pix.encodedImage || null,
      payload: pix.payload || null,
      expirationDate: pix.expirationDate || null
    };
  } catch (error) {
    console.error(`[Asaas] falha ao obter PIX do intent ${intentId}: ${error.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

// Localiza o intent por dois caminhos, nesta ordem:
//   1. `external_id` — o normal, protegido pelo índice único (provider, external_id);
//   2. `externalReference = "intent:<id>"` — a rede de segurança para quando a
//      cobrança foi criada no Asaas mas o UPDATE do external_id não completou.
async function findIntentByPayment(db, payment) {
  if (payment?.id) {
    const byExternal = await db.get(
      "SELECT * FROM payment_intents WHERE provider='asaas' AND external_id=?",
      [payment.id]
    );
    if (byExternal) return byExternal;
  }

  const match = /^intent:(\d+)$/.exec(String(payment?.externalReference || "").trim());
  if (!match) return null;
  const intent = await db.get("SELECT * FROM payment_intents WHERE id=? AND provider='asaas'", [
    Number(match[1])
  ]);
  if (!intent) return null;

  // Achou pelo fallback: aproveita para fechar o buraco, senão todo evento
  // futuro desta cobrança pagaria o mesmo pedágio. Best-effort — o índice único
  // pode recusar (external_id já usado por outro intent) e isso não pode
  // impedir o processamento do pagamento em si.
  if (!intent.external_id && payment?.id) {
    try {
      await db.run("UPDATE payment_intents SET external_id=? WHERE id=? AND external_id IS NULL", [
        payment.id,
        intent.id
      ]);
      intent.external_id = payment.id;
    } catch (error) {
      console.error(`[Asaas] não foi possível vincular ${payment.id} ao intent ${intent.id}: ${error.message}`);
    }
  }
  return intent;
}

// Grava um evento sem mexer no status do intent. Devolve `false` quando o
// evento já tinha sido registrado — a duplicidade é detectada pelo índice
// único UNIQUE(payment_intent_id, provider_event_id), não por SELECT prévio.
async function recordIntentEvent(db, { intentId, providerEventId, eventType, payload }) {
  const result = await db.run(
    `INSERT INTO payment_events (payment_intent_id, provider_event_id, event_type, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (payment_intent_id, provider_event_id) DO NOTHING
     RETURNING id`,
    [intentId, providerEventId, eventType, JSON.stringify(payload ?? {})]
  );
  return Boolean(result.returnedId);
}

// Estorno/chargeback x cancelamento simples. O Asaas usa nomenclaturas
// diferentes no evento (PAYMENT_REFUNDED) e no status (REFUNDED); olhamos os
// dois porque a conciliação por polling só enxerga o status.
function isRefundLike(...values) {
  return values.some((value) => /REFUND|CHARGEBACK/i.test(String(value || "")));
}

// -- Caminho separado da VENDA -----------------------------------------------
//
// `transitionPaymentIntent` foi escrito para o sinal do agendamento: ele chama
// `confirmAppointmentReservations(tx, intent.appointment_id)` e faz
// `UPDATE appointments ... WHERE id=?`. Numa venda de catálogo o
// `appointment_id` é NULL, e em SQL `WHERE appointment_id = NULL` nunca casa —
// ou seja, aquelas escritas viram no-op silencioso, sem corromper nada.
//
// O problema não é dano, é OMISSÃO: as reservas da venda ficam penduradas em
// `inventory_reservations.sales_order_id` (veja `sales.js`), que nenhuma
// daquelas queries alcança. Confirmar a venda pelo caminho do agendamento
// deixaria a joia reservada até expirar — e o pedido pago preso em "pendente".
//
// Por isso a venda tem transição própria aqui, replicando só o que faz sentido
// para ela (intent + evento idempotente + paid_at + reservas + status do
// pedido). `payments.js` fica intocado de propósito: ele é o caminho do
// agendamento e não deve aprender sobre venda por um efeito colateral.
async function transitionSaleIntent(db, { intent, status, providerEventId, payload, paidAt }) {
  return db.transaction(async (tx) => {
    // Mesmo cadeado do serviço original: sem o FOR UPDATE dois webhooks do
    // mesmo intent passariam juntos pela checagem de duplicidade abaixo.
    const locked = await tx.get("SELECT * FROM payment_intents WHERE id=? FOR UPDATE", [intent.id]);
    if (!locked) throw new Error("Intenção de pagamento não encontrada.");

    if (providerEventId) {
      const duplicate = await tx.get(
        "SELECT id FROM payment_events WHERE payment_intent_id=? AND provider_event_id=?",
        [intent.id, providerEventId]
      );
      if (duplicate) return { ...locked, idempotent: true };
    }

    await tx.run("UPDATE payment_intents SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [
      status,
      intent.id
    ]);
    await tx.run(
      "INSERT INTO payment_events (payment_intent_id, provider_event_id, event_type, payload) VALUES (?, ?, ?, ?)",
      [intent.id, providerEventId, status, JSON.stringify(payload ?? {})]
    );

    const orderId = locked.sales_order_id;
    if (status === "confirmed") {
      await tx.run("UPDATE payment_intents SET paid_at=COALESCE(paid_at, ?) WHERE id=?", [
        paidAt,
        intent.id
      ]);
      await tx.run(
        "UPDATE inventory_reservations SET status='confirmed', confirmed_at=CURRENT_TIMESTAMP WHERE sales_order_id=? AND status='active'",
        [orderId]
      );
      // 'pago' é o mesmo valor que a tela de vendas grava no PATCH manual, então
      // o pedido pago pelo gateway aparece igual ao pago no balcão.
      const marcou = await tx.run(
        "UPDATE sales_orders SET status='pago' WHERE id=? AND status IN ('pendente', 'aberta')",
        [orderId]
      );

      // Baixa de estoque na CONFIRMAÇÃO, não na criação do pedido.
      //
      // O pedido do catálogo nasce `pendente` e só vira `pago` aqui, quando o
      // dinheiro entra. `createSalesOrder` só dá baixa quando o pedido já nasce
      // pago (venda de balcão) — sem isto, a joia vendida online sairia do
      // estoque apenas quando alguém mexesse na mão.
      //
      // A guarda em `marcou.changes` é o que impede baixa dupla: um segundo
      // evento confirmando o mesmo pedido não encontra mais status
      // 'pendente'/'aberta' e não decrementa nada.
      // Estoque que não cobre o item NÃO derruba a confirmação. A baixa passou a
      // lançar em vez de zerar o saldo (venda de balcão precisa ser recusada),
      // mas aqui o dinheiro já entrou: propagar a exceção desfaria a transação
      // inteira, o pagamento nunca seria registrado e o Asaas reentregaria o
      // evento para sempre — o mesmo raciocínio já escrito no bloco de `paid`
      // logo abaixo. O pedido fica pago e o aviso pede a conferência humana.
      if (marcou.changes) {
        const itens = await tx.all("SELECT * FROM sales_order_items WHERE sales_order_id=?", [orderId]);
        for (const item of itens) {
          try {
            await deductSoldProductStock(tx, item, orderId);
          } catch (error) {
            console.warn(
              `[Asaas] pedido ${orderId} foi pago, mas a baixa de "${item.item_name}" falhou: ${error.message} ` +
                "Confira o estoque — a peça pode ter sido vendida entre a reserva e a confirmação."
            );
          }
        }
      }
    }

    if (["cancelled", "failed", "expired", "refunded"].includes(status)) {
      await tx.run(
        "UPDATE inventory_reservations SET status=?, released_at=CURRENT_TIMESTAMP WHERE sales_order_id=? AND status='active'",
        [status === "expired" ? "expired" : "released", orderId]
      );
    }

    return tx.get("SELECT * FROM payment_intents WHERE id=?", [intent.id]);
  });
}

// Despacha para o caminho certo. O discriminador é o `appointment_id`: uma
// venda amarrada a um agendamento (ordem de serviço) TEM agendamento e deve
// seguir o fluxo dele, com as reservas e a confirmação da agenda.
async function applyTransition(db, { intent, status, providerEventId, payload, paidAt }) {
  if (!intent.appointment_id && intent.sales_order_id) {
    return transitionSaleIntent(db, { intent, status, providerEventId, payload, paidAt });
  }
  // Aninhar em `db.transaction` é seguro: a camada `db` transforma o nível
  // interno em SAVEPOINT. Serve para o `paid_at` (coluna que `payments.js` não
  // conhece) cair junto com a confirmação, e não numa escrita solta depois.
  return db.transaction(async (tx) => {
    const updated = await transitionPaymentIntent(tx, {
      intentId: intent.id,
      status,
      providerEventId,
      payload,
      paidAt
    });
    if (status === "confirmed" && !updated?.idempotent) {
      await tx.run("UPDATE payment_intents SET paid_at=COALESCE(paid_at, ?) WHERE id=?", [
        paidAt,
        intent.id
      ]);
    }
    return updated;
  });
}

/**
 * Handler do webhook da clínica. Contrato com `routes/webhooks.js`:
 * devolve `{ applied, detail }` e só LANÇA em falha transitória de verdade
 * (banco fora) — porque o Asaas reentrega tudo que não for 2xx e, depois de
 * algumas falhas seguidas, PAUSA a fila de webhooks da conta da clínica.
 * Cobrança que não é nossa, portanto, é `{applied:false}`, nunca exceção.
 */
export async function applyTenantPaymentEvent(db, { action, payment, eventType, tenant } = {}) {
  const intent = await findIntentByPayment(db, payment);
  if (!intent) {
    // Caminho legítimo: a clínica pode emitir cobranças pelo painel do Asaas,
    // fora do sistema. Não é erro nosso e repetir não vai fazer aparecer.
    return { applied: false, detail: "cobranca-desconhecida" };
  }

  // Chave de idempotência do evento. Inclui o tipo porque PAYMENT_CONFIRMED e
  // PAYMENT_RECEIVED chegam para a MESMA cobrança e ambos devem ser
  // registrados; a proteção contra reentrega do mesmo evento vem de as duas
  // partes serem iguais.
  const providerEventId = `asaas:${payment?.id}:${eventType || action}`;
  const payload = {
    event: eventType || null,
    action,
    tenant: tenant?.slug || null,
    payment_id: payment?.id || null,
    status: payment?.status || null,
    value: payment?.value ?? null,
    net_value: payment?.netValue ?? null,
    billing_type: payment?.billingType || null,
    payment_date: payment?.paymentDate || null,
    due_date: payment?.dueDate || null
  };

  if (action === "paid") {
    const paidAt = toPaidAtTimestamp(payment?.paymentDate);
    // Dinheiro que entra sempre confirma, mesmo que o intent já tenha sido
    // expirado/cancelado do nosso lado. Nesse caso as reservas já foram
    // liberadas e o estoque pode ter ido para outro cliente — a clínica precisa
    // olhar. Avisar em log é o mínimo; virar exceção seria pior (reentrega
    // infinita para um problema que só um humano resolve).
    if (["expired", "cancelled", "refunded"].includes(intent.status)) {
      console.warn(
        `[Asaas] pagamento de ${payment?.id} chegou com o intent ${intent.id} em "${intent.status}". ` +
          "As reservas de estoque já haviam sido liberadas — confira a disponibilidade."
      );
    }
    const updated = await applyTransition(db, {
      intent,
      status: "confirmed",
      providerEventId,
      payload,
      paidAt
    });
    if (updated?.idempotent) return { applied: false, detail: "evento-ja-processado" };
    return { applied: true, detail: intent.sales_order_id && !intent.appointment_id ? "venda-confirmada" : "sinal-confirmado" };
  }

  if (action === "overdue") {
    // DECISÃO: "atrasado" não vira status novo nem falha imediata.
    //
    // PAYMENT_OVERDUE no Asaas quer dizer só "passou do vencimento" — boleto e
    // PIX vencidos CONTINUAM pagáveis, e o PAYMENT_RECEIVED costuma chegar dias
    // depois. Marcar o intent como falho na hora liberaria a reserva de um
    // cliente que ainda vai pagar hoje à tarde.
    //
    // O prazo que importa para o estoque é o NOSSO (`expires_at`), não o do
    // boleto. Então: dentro do prazo, só registra o evento (rastro, sem efeito);
    // passado o prazo, `expired` — status que já existe no CHECK do schema e
    // que faz `transitionPaymentIntent` liberar as reservas.
    const stillValid = !intent.expires_at || new Date(intent.expires_at).getTime() > Date.now();
    if (stillValid) {
      const recorded = await recordIntentEvent(db, {
        intentId: intent.id,
        providerEventId,
        eventType: "overdue",
        payload
      });
      return {
        applied: recorded,
        detail: recorded ? "vencimento-registrado-sem-mudar-status" : "evento-ja-processado"
      };
    }
    if (intent.status === "expired") return { applied: false, detail: "intent-ja-expirado" };
    const updated = await applyTransition(db, {
      intent,
      status: "expired",
      providerEventId,
      payload,
      paidAt: null
    });
    return updated?.idempotent
      ? { applied: false, detail: "evento-ja-processado" }
      : { applied: true, detail: "intent-expirado" };
  }

  if (action === "canceled") {
    // Estorno e chargeback são diferentes de exclusão: o dinheiro chegou a
    // entrar e voltou. `refunded` preserva isso no histórico financeiro.
    const status = isRefundLike(payment?.status, eventType) ? "refunded" : "cancelled";
    if (intent.status === status) return { applied: false, detail: `intent-ja-${status}` };
    const updated = await applyTransition(db, {
      intent,
      status,
      providerEventId,
      payload,
      paidAt: null
    });
    return updated?.idempotent
      ? { applied: false, detail: "evento-ja-processado" }
      : { applied: true, detail: status === "refunded" ? "pagamento-estornado" : "cobranca-cancelada" };
  }

  if (action === "created") {
    // Quase sempre é a nossa própria criação voltando pelo webhook. Serve só
    // para completar o que ficou faltando quando a resposta do POST se perdeu
    // (o caso "best-effort" de `createTenantCharge`). Nunca sobrescreve valor
    // já gravado: o que está no banco é o que a tela mostrou ao cliente.
    const fields = [];
    const values = [];
    if (!intent.invoice_url && payment?.invoiceUrl) {
      fields.push("invoice_url=?");
      values.push(payment.invoiceUrl);
    }
    if (!intent.due_date && payment?.dueDate) {
      fields.push("due_date=?");
      values.push(payment.dueDate);
    }
    if (!intent.billing_type && payment?.billingType) {
      fields.push("billing_type=?");
      values.push(payment.billingType);
    }
    if (!fields.length) return { applied: false, detail: "nada-a-completar" };
    values.push(intent.id);
    await db.run(
      `UPDATE payment_intents SET ${fields.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      values
    );
    return { applied: true, detail: "dados-da-cobranca-completados" };
  }

  return { applied: false, detail: `acao-nao-tratada:${action}` };
}

// ---------------------------------------------------------------------------
// Conciliação por polling
// ---------------------------------------------------------------------------

/**
 * Rede de segurança para webhook perdido: consulta o estado real da cobrança no
 * Asaas e aplica o mesmo efeito que o webhook aplicaria.
 *
 * Nunca lança por causa do gateway — quem chama é uma tela de acompanhamento ou
 * um job, e nenhum dos dois deve quebrar porque o Asaas está fora do ar.
 */
export async function syncIntent(db, intentId) {
  const intent = await db.get("SELECT * FROM payment_intents WHERE id=?", [intentId]);
  if (!intent) return { applied: false, detail: "intent-desconhecido" };
  if (intent.provider !== "asaas" || !intent.external_id) {
    return { applied: false, detail: "sem-cobranca-no-gateway" };
  }
  // Já em estado terminal de dinheiro: consultar de novo só geraria um evento
  // duplicado (o `provider_event_id` do sync é diferente do webhook, então ele
  // não seria barrado pelo índice único).
  if (["confirmed", "refunded"].includes(intent.status)) {
    return { applied: false, detail: "ja-conciliado" };
  }

  let payment;
  try {
    const asaas = await requireTenantClient(db);
    payment = await asaas.getPayment(intent.external_id);
  } catch (error) {
    console.error(`[Asaas] falha ao conciliar o intent ${intentId}: ${error.message}`);
    return { applied: false, detail: `gateway-indisponivel:${error.code || error.status || "?"}` };
  }
  if (!payment?.id) return { applied: false, detail: "cobranca-nao-encontrada" };

  // `isPaidStatus`/`isCanceledStatus` aceitam tanto o STATUS do recurso
  // ("RECEIVED") quanto o NOME do evento ("PAYMENT_RECEIVED") — aqui chega o
  // primeiro, e confundir os dois é o bug clássico desta integração.
  const action = isPaidStatus(payment.status)
    ? "paid"
    : isCanceledStatus(payment.status)
      ? "canceled"
      : null;
  if (!action) return { applied: false, detail: `status-sem-acao:${payment.status || "?"}` };

  return applyTenantPaymentEvent(db, {
    action,
    payment: {
      id: String(payment.id),
      status: payment.status || null,
      subscription: payment.subscription || null,
      customer: payment.customer || null,
      externalReference: payment.externalReference || null,
      value: Number.isFinite(Number(payment.value)) ? Number(payment.value) : null,
      netValue: Number.isFinite(Number(payment.netValue)) ? Number(payment.netValue) : null,
      dueDate: payment.dueDate || null,
      paymentDate: payment.paymentDate || payment.clientPaymentDate || null,
      billingType: payment.billingType || null,
      invoiceUrl: payment.invoiceUrl || null,
      description: payment.description || null
    },
    // Prefixo próprio para o evento do polling não se passar por webhook na
    // auditoria de `payment_events`.
    eventType: `SYNC_${String(payment.status || "UNKNOWN").toUpperCase()}`,
    tenant: null
  });
}
