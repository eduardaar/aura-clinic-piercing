// Comissões por profissional: resolução de regra, rateio da base e lançamentos.
//
// Contrato (SPEC 5.1/5.2):
// - o profissional responsável é `appointments.professional_id`;
// - cada item do atendimento gera até duas parcelas: serviço (`procedure_price`)
//   e produto (`jewelry_unit_price × quantity`);
// - o desconto TOTAL e o ajuste líquido do atendimento são rateados entre TODAS
//   as parcelas, proporcionalmente ao bruto de cada uma, em centavos, pelo
//   método do maior resto — as somas batem exatamente com o atendimento;
// - base = max(0, bruto − desconto rateado + ajuste rateado);
// - regra: serviço → `servico` do serviço do item, senão `servico_padrao`;
//   produto → `produto_padrao`; sem regra (ou bruto 0) não há lançamento;
// - lançamentos são imutáveis: recalcular = estornar os ativos e gravar novos.
//
// As funções puras (rateio, arredondamento, cálculo das parcelas) são
// exportadas para teste: o dinheiro é tratado SEMPRE em centavos inteiros, e
// só vira reais na fronteira com o banco (NUMERIC(12,2)).

export const COMMISSION_SCOPES = Object.freeze(["servico_padrao", "servico", "produto_padrao"]);
export const COMMISSION_RATE_TYPES = Object.freeze(["percentual", "valor_fixo"]);

// Os valores do banco chegam como Number com no máximo duas casas; o
// arredondamento absorve o ruído do ponto flutuante (0,29 × 100 = 28,999…).
export function toCents(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function fromCents(cents) {
  return Number(cents || 0) / 100;
}

/**
 * Rateia `totalCents` (pode ser negativo) entre as parcelas, proporcionalmente
 * aos pesos, pelo método do maior resto. Desempate pela ordem das parcelas
 * (a primeira leva o centavo), o que torna o resultado determinístico entre
 * recálculos — condição para o recálculo idempotente não "mexer" centavos.
 * A soma devolvida é exatamente `totalCents`; peso 0 nunca recebe nada.
 * @param {number} totalCents
 * @param {number[]} weights pesos inteiros ≥ 0 (bruto em centavos)
 * @returns {number[]}
 */
export function allocateLargestRemainder(totalCents, weights) {
  const safeWeights = (Array.isArray(weights) ? weights : []).map((weight) => Math.max(0, Math.trunc(Number(weight) || 0)));
  const total = Math.trunc(Number(totalCents) || 0);
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (!total || !weightSum) return safeWeights.map(() => 0);
  // BigInt: |total| × peso pode passar de 2^53 com valores altos (10^12 × 10^12).
  const sign = total < 0 ? -1n : 1n;
  const magnitude = BigInt(Math.abs(total));
  const sum = BigInt(weightSum);
  const shares = safeWeights.map((weight, index) => {
    const product = magnitude * BigInt(weight);
    return { index, quotient: product / sum, remainder: product % sum };
  });
  let leftover = magnitude - shares.reduce((acc, share) => acc + share.quotient, 0n);
  const order = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (const share of order) {
    if (leftover <= 0n) break;
    if (safeWeights[share.index] === 0) continue;
    share.quotient += 1n;
    leftover -= 1n;
  }
  return shares.map((share) => Number(share.quotient * sign));
}

/**
 * Percentual sobre a base em centavos, arredondado meio para cima.
 * A taxa (NUMERIC(12,2), ex.: 12,5) vira pontos-base inteiros antes da conta.
 */
export function percentOfCents(baseCents, rate) {
  const base = Math.max(0, Math.trunc(Number(baseCents) || 0));
  const basisPoints = Math.max(0, Math.round(Number(rate || 0) * 100));
  if (!base || !basisPoints) return 0;
  return Number((BigInt(base) * BigInt(basisPoints) + 5000n) / 10000n);
}

/**
 * Valor da comissão de uma parcela.
 * - percentual: round(base × taxa / 100), meio para cima;
 * - valor fixo: taxa por item de serviço; taxa × quantidade para produto;
 *   sempre limitado à base (item 100% descontado não gera comissão maior que ele).
 */
export function commissionAmountCents({ baseCents, rateType, rateValue, itemKind, quantity = 1 }) {
  const base = Math.max(0, Math.trunc(Number(baseCents) || 0));
  if (rateType === "percentual") return percentOfCents(base, rateValue);
  if (rateType === "valor_fixo") {
    const units = itemKind === "produto" ? Math.max(1, Math.trunc(Number(quantity) || 1)) : 1;
    return Math.min(base, toCents(rateValue) * units);
  }
  return 0;
}

/**
 * Regra aplicável à parcela. Só regras ATIVAS do profissional entram aqui.
 * Serviço específico vence o padrão de serviços; produto usa o padrão de produtos.
 */
export function resolveCommissionRule(rules, parcel) {
  const active = (Array.isArray(rules) ? rules : []).filter((rule) => rule && rule.active !== false && rule.active !== 0);
  if (parcel.item_kind === "produto") return active.find((rule) => rule.scope === "produto_padrao") || null;
  const serviceId = parcel.service_id ? Number(parcel.service_id) : null;
  if (serviceId) {
    const specific = active.find((rule) => rule.scope === "servico" && Number(rule.service_id) === serviceId);
    if (specific) return specific;
  }
  return active.find((rule) => rule.scope === "servico_padrao") || null;
}

/**
 * Parcelas do atendimento, na ordem dos itens (serviço antes do produto).
 * Sem itens gravados (atendimentos antigos), um item único sai das colunas
 * `service_value`/`jewelry_value` do próprio atendimento.
 */
export function buildCommissionParcels(appointment, items = []) {
  const list = Array.isArray(items) ? items : [];
  // Mesma regra do bruto oficial (`appointmentFinancialInput` em finance.js):
  // itens só valem quando têm preço; itens todos sem preço (agendamento
  // público/antigo) caem nas colunas do atendimento. Sem isso o desconto
  // gravado sobre o bruto oficial seria rateado sobre outro bruto (ou a
  // comissão sairia zerada com o atendimento cobrado).
  const pricedCents = list.reduce((sum, item) => sum + itemServiceCents(item) + itemProductCents(item), 0);
  const sourceItems = list.length && pricedCents > 0 ? list : [legacyItem(appointment, list[0])];
  const parcels = [];
  for (const item of sourceItems) {
    const quantity = Math.max(1, Math.trunc(Number(item.quantity) || 1));
    const serviceGross = itemServiceCents(item);
    const productGross = itemProductCents(item);
    parcels.push({
      item_kind: "servico",
      appointment_item_id: item.id ? Number(item.id) : null,
      service_id: item.service_id ? Number(item.service_id) : null,
      procedure_id: item.procedure_id ? Number(item.procedure_id) : null,
      product_id: null,
      quantity: 1,
      gross_cents: serviceGross,
      item_description: serviceDescription(item, appointment)
    });
    parcels.push({
      item_kind: "produto",
      appointment_item_id: item.id ? Number(item.id) : null,
      service_id: null,
      procedure_id: null,
      product_id: item.jewelry_id ? Number(item.jewelry_id) : null,
      quantity,
      gross_cents: productGross,
      item_description: productDescription(item)
    });
  }
  return parcels;
}

// Preço negativo não existe no bruto oficial (finance.js zera): aqui também.
function itemServiceCents(item = {}) {
  return Math.max(0, toCents(item.procedure_price));
}

function itemProductCents(item = {}) {
  return Math.max(0, toCents(item.jewelry_unit_price)) * Math.max(1, Math.trunc(Number(item.quantity) || 1));
}

function legacyItem(appointment = {}, firstItem = null) {
  const service = Math.max(0, toCents(appointment.service_value));
  const jewelry = Math.max(0, toCents(appointment.jewelry_value));
  // Linha muito antiga só com total: tudo vira parcela de serviço, e o bruto é
  // reconstruído como no finance.js (subtotal, ou líquido + desconto − ajuste),
  // para o desconto não ser abatido duas vezes.
  const fallbackService = service + jewelry > 0
    ? service
    : Math.max(0, toCents(appointment.subtotal_value)
      || toCents(appointment.total_value) + toCents(appointment.discount_value) - toCents(appointment.adjustment_total));
  return {
    id: null,
    // Itens sem preço ainda dizem qual é o serviço (para a regra específica).
    service_id: appointment.service_id || firstItem?.service_id || null,
    procedure_id: null,
    jewelry_id: appointment.jewelry_id || null,
    quantity: 1,
    procedure_price: fromCents(fallbackService),
    jewelry_unit_price: fromCents(jewelry),
    procedure_name: appointment.procedure || "",
    service_name: appointment.service_name || "",
    jewelry_name: appointment.jewelry_name || ""
  };
}

function serviceDescription(item, appointment = {}) {
  const name = item.procedure_name || item.service_name || appointment.procedure || "Atendimento";
  return item.region ? `${name} (${item.region})` : name;
}

function productDescription(item) {
  const name = item.jewelry_name || "Joia/produto";
  return item.variation_name ? `${name} — ${item.variation_name}` : name;
}

/**
 * Cálculo puro dos lançamentos esperados de um atendimento.
 * @returns {Array<Record<string, any>>} lançamentos em centavos (campos *_cents)
 */
export function computeCommissionEntries({ appointment, items = [], rules = [], serviceExecutionId = null }) {
  const parcels = buildCommissionParcels(appointment, items);
  const grossTotal = parcels.reduce((sum, parcel) => sum + parcel.gross_cents, 0);
  // `discount_value` já é o desconto TOTAL (cupom + manual), limitado ao bruto
  // pela gravação; o clamp aqui só protege contra linha legada inconsistente.
  const discountTotal = Math.min(Math.max(0, toCents(appointment.discount_value)), grossTotal);
  const adjustmentTotal = toCents(appointment.adjustment_total);
  const weights = parcels.map((parcel) => parcel.gross_cents);
  const discounts = allocateLargestRemainder(discountTotal, weights);
  const adjustments = allocateLargestRemainder(adjustmentTotal, weights);
  const entries = [];
  parcels.forEach((parcel, index) => {
    if (parcel.gross_cents <= 0) return;
    const rule = resolveCommissionRule(rules, parcel);
    if (!rule) return;
    const baseCents = Math.max(0, parcel.gross_cents - discounts[index] + adjustments[index]);
    entries.push({
      appointment_id: Number(appointment.id),
      service_execution_id: serviceExecutionId ? Number(serviceExecutionId) : null,
      professional_id: Number(appointment.professional_id),
      item_kind: parcel.item_kind,
      appointment_item_id: parcel.appointment_item_id,
      service_id: parcel.service_id,
      procedure_id: parcel.procedure_id,
      product_id: parcel.product_id,
      item_description: parcel.item_description,
      quantity: parcel.quantity,
      gross_cents: parcel.gross_cents,
      discount_cents: discounts[index],
      adjustment_cents: adjustments[index],
      base_cents: baseCents,
      rule_id: rule.id ? Number(rule.id) : null,
      rule_scope: rule.scope,
      rate_type: rule.rate_type,
      rate_cents: toCents(rule.rate_value),
      commission_cents: commissionAmountCents({
        baseCents,
        rateType: rule.rate_type,
        rateValue: rule.rate_value,
        itemKind: parcel.item_kind,
        quantity: parcel.quantity
      }),
      // Competência estável: a data do atendimento (`completed_at` muda a cada
      // refechamento e mudaria o mês da comissão).
      reference_date: String(appointment.appointment_date || "").slice(0, 10)
    });
  });
  return entries;
}

// Assinatura do lançamento para comparar o esperado com o gravado. Descrição
// fica de fora de propósito: renomear a joia não é motivo para estornar.
function entrySignature(entry) {
  const cents = (key, reais) => (entry[key] !== undefined ? Number(entry[key]) : toCents(entry[reais]));
  return JSON.stringify([
    entry.item_kind,
    entry.appointment_item_id == null ? null : Number(entry.appointment_item_id),
    Number(entry.professional_id),
    entry.service_id == null ? null : Number(entry.service_id),
    entry.procedure_id == null ? null : Number(entry.procedure_id),
    entry.product_id == null ? null : Number(entry.product_id),
    Number(entry.quantity || 1),
    cents("gross_cents", "gross_amount"),
    cents("discount_cents", "discount_amount"),
    cents("adjustment_cents", "adjustment_amount"),
    cents("base_cents", "base_amount"),
    entry.rule_id == null ? null : Number(entry.rule_id),
    entry.rule_scope,
    entry.rate_type,
    cents("rate_cents", "rate_value"),
    cents("commission_cents", "commission_amount"),
    String(entry.reference_date || "").slice(0, 10),
    entry.service_execution_id == null ? null : Number(entry.service_execution_id)
  ]);
}

/** Mesmo conjunto de lançamentos (itens, bases, regras e valores)? */
export function sameCommissionEntries(expected = [], active = []) {
  if (expected.length !== active.length) return false;
  const left = expected.map(entrySignature).sort();
  const right = active.map(entrySignature).sort();
  return left.every((signature, index) => signature === right[index]);
}

function userIdOf(options = {}) {
  const id = Number(options.userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Se o chamador já abriu transação, o helper vira SAVEPOINT; se não abriu
// (uso avulso), o estorno + gravação continuam atômicos.
function inTransaction(db, fn) {
  return typeof db.transaction === "function" ? db.transaction(fn) : fn(db);
}

async function loadAppointmentItems(db, appointmentId) {
  // `appointment_items.service_id/procedure_id` não têm FK (um serviço pode
  // ser apagado sem olhar os itens), mas `commission_entries` tem: os ids
  // saem dos JOINs, e id órfão vira NULL em vez de derrubar a finalização
  // com violação de chave estrangeira.
  return db.all(
    `SELECT ai.id, COALESCE(si.id, sp.id) AS service_id, pr.id AS procedure_id,
            ai.region, ai.jewelry_id, ai.jewelry_variant_id, ai.quantity,
            ai.procedure_price, ai.jewelry_unit_price,
            pr.name AS procedure_name, COALESCE(si.name, sp.name) AS service_name,
            j.name AS jewelry_name, v.variation_name
       FROM appointment_items ai
       LEFT JOIN procedures pr ON pr.id = ai.procedure_id
       LEFT JOIN services si ON si.id = ai.service_id
       -- A regra por serviço também vale quando o item só traz a variação
       -- (procedimento), cujo serviço-pai é o que a regra referencia.
       LEFT JOIN services sp ON sp.id = pr.service_id
       LEFT JOIN jewelry_inventory j ON j.id = ai.jewelry_id
       LEFT JOIN jewelry_variants v ON v.id = ai.jewelry_variant_id
      WHERE ai.appointment_id = ?
      ORDER BY ai.id`,
    [appointmentId]
  );
}

async function insertEntry(db, entry, userId) {
  const result = await db.run(
    `INSERT INTO commission_entries (
       appointment_id, service_execution_id, professional_id, item_kind, appointment_item_id,
       service_id, procedure_id, product_id, item_description, quantity,
       gross_amount, discount_amount, adjustment_amount, base_amount,
       rule_id, rule_scope, rate_type, rate_value, commission_amount,
       reference_date, status, calculated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?) RETURNING id`,
    [
      entry.appointment_id, entry.service_execution_id, entry.professional_id, entry.item_kind, entry.appointment_item_id,
      entry.service_id, entry.procedure_id, entry.product_id, entry.item_description, entry.quantity,
      fromCents(entry.gross_cents), fromCents(entry.discount_cents), fromCents(entry.adjustment_cents), fromCents(entry.base_cents),
      entry.rule_id, entry.rule_scope, entry.rate_type, fromCents(entry.rate_cents), fromCents(entry.commission_cents),
      entry.reference_date, userId
    ]
  );
  return result.returnedId;
}

/**
 * Recalcula os lançamentos de comissão do atendimento dentro da transação
 * recebida. Atendimento fora de "atendido" tem os lançamentos ativos estornados.
 * @param {any} db cliente transacional (db.get/all/run)
 * @param {number|string} appointmentId
 * @param {{ userId?: number|null, reason?: string }} [options]
 * @returns {Promise<{ created: number, reversed: number, unchanged: boolean }>}
 */
export async function refreshAppointmentCommissions(db, appointmentId, options = {}) {
  return inTransaction(db, async (tx) => {
    // Trava o atendimento: duas finalizações/ajustes simultâneos não podem
    // estornar e regravar o mesmo conjunto em paralelo (lançamento duplicado).
    const appointment = await tx.get(
      `SELECT a.id, a.professional_id, a.status, a.appointment_date, a.procedure,
              (SELECT s.id FROM services s WHERE s.id = a.service_id) AS service_id, a.jewelry_id,
              a.service_value, a.jewelry_value, a.subtotal_value, a.discount_value, a.adjustment_total, a.total_value
         FROM appointments a WHERE a.id = ? FOR UPDATE`,
      [appointmentId]
    );
    if (!appointment) return { created: 0, reversed: 0, unchanged: true };
    if (appointment.status !== "atendido") {
      const { reversed } = await reverseAppointmentCommissions(tx, appointmentId, {
        ...options,
        reason: options.reason || "Atendimento deixou de estar atendido."
      });
      return { created: 0, reversed, unchanged: reversed === 0 };
    }

    const [items, rules, execution, active] = [
      await loadAppointmentItems(tx, appointment.id),
      await tx.all(
        "SELECT id, scope, service_id, rate_type, rate_value, active FROM professional_commission_rules WHERE professional_id = ? AND active = true ORDER BY id",
        [appointment.professional_id]
      ),
      await tx.get("SELECT id FROM service_executions WHERE appointment_id = ? AND status <> 'cancelled'", [appointment.id]),
      await tx.all("SELECT * FROM commission_entries WHERE appointment_id = ? AND status = 'ativa' ORDER BY id FOR UPDATE", [appointment.id])
    ];
    const expected = computeCommissionEntries({ appointment, items, rules, serviceExecutionId: execution?.id || null });
    // Idempotência: mesmo resultado → nada a fazer (sem estorno nem lançamento
    // novo). É o que permite chamar o recálculo em todo salvamento financeiro.
    if (sameCommissionEntries(expected, active)) return { created: 0, reversed: 0, unchanged: true };

    const userId = userIdOf(options);
    const { reversed } = await reverseAppointmentCommissions(tx, appointment.id, {
      ...options,
      reason: options.reason || "Recálculo da comissão do atendimento."
    });
    for (const entry of expected) await insertEntry(tx, entry, userId);
    return { created: expected.length, reversed, unchanged: false };
  });
}

/**
 * Estorna todos os lançamentos ativos do atendimento (ex.: reabertura,
 * cancelamento).
 * @param {any} db
 * @param {number|string} appointmentId
 * @param {{ userId?: number|null, reason?: string }} [options]
 * @returns {Promise<{ reversed: number }>}
 */
export async function reverseAppointmentCommissions(db, appointmentId, options = {}) {
  const reason = String(options.reason || "Estorno da comissão do atendimento.").trim().slice(0, 500);
  // Mesma trava do recálculo: sem ela, um cancelamento concorrente estornaria
  // os lançamentos antigos enquanto um recálculo em curso grava os novos, que
  // ficariam ativos num atendimento cancelado. Na mesma transação é reentrante.
  await db.get("SELECT id FROM appointments WHERE id = ? FOR UPDATE", [appointmentId]);
  // Estorno é a ÚNICA mudança permitida num lançamento: status + quem/quando/por quê.
  // Os valores ficam como estavam, para o histórico mostrar o que foi pago/devido.
  const result = await db.run(
    `UPDATE commission_entries
        SET status = 'estornada', reversed_at = now(), reversed_by_user_id = ?, reversal_reason = ?
      WHERE appointment_id = ? AND status = 'ativa'`,
    [userIdOf(options), reason, appointmentId]
  );
  return { reversed: Number(result.changes || 0) };
}

function parseBooleanFlag(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

/**
 * Valida e normaliza o conjunto de regras enviado pelo PUT. Puro (sem banco):
 * a existência dos serviços é conferida pela rota.
 * @returns {{ rules: Array<Record<string, any>> } | { error: string }}
 */
export function normalizeCommissionRulesPayload(rawRules) {
  if (!Array.isArray(rawRules)) return { error: "Envie as regras de comissão como uma lista." };
  if (rawRules.length > 500) return { error: "Quantidade de regras de comissão acima do permitido." };
  const seen = new Set();
  const rules = [];
  for (const raw of rawRules) {
    if (!raw || typeof raw !== "object") return { error: "Regra de comissão inválida." };
    const scope = String(raw.scope || "").trim();
    if (!COMMISSION_SCOPES.includes(scope)) return { error: "Escopo da regra de comissão inválido." };
    const serviceId = raw.service_id === undefined || raw.service_id === null || raw.service_id === "" ? null : Number(raw.service_id);
    if (scope === "servico" && !(Number.isInteger(serviceId) && serviceId > 0)) {
      return { error: "Informe o serviço da regra de comissão específica." };
    }
    if (scope !== "servico" && serviceId !== null) {
      return { error: "Somente a regra por serviço pode indicar um serviço." };
    }
    const rateType = String(raw.rate_type || "").trim();
    if (!COMMISSION_RATE_TYPES.includes(rateType)) return { error: "Tipo da comissão inválido: use percentual ou valor fixo." };
    const rawRate = typeof raw.rate_value === "string" ? raw.rate_value.trim().replace(",", ".") : raw.rate_value;
    const rateValue = rawRate === "" || rawRate === null || rawRate === undefined ? Number.NaN : Number(rawRate);
    if (!Number.isFinite(rateValue) || rateValue < 0) return { error: "O valor da comissão deve ser um número maior ou igual a zero." };
    if (Math.abs(rateValue * 100 - Math.round(rateValue * 100)) > 1e-6) {
      return { error: "O valor da comissão aceita no máximo duas casas decimais." };
    }
    if (rateType === "percentual" && rateValue > 100) return { error: "O percentual de comissão deve ficar entre 0 e 100." };
    if (rateType === "valor_fixo" && rateValue > 9999999999.99) return { error: "Valor fixo de comissão acima do permitido." };
    const active = parseBooleanFlag(raw.active, true);
    if (active === null) return { error: "Indique se a regra de comissão está ativa." };
    const notes = raw.notes === undefined || raw.notes === null ? "" : String(raw.notes).trim();
    if (notes.length > 500) return { error: "As observações da regra de comissão aceitam até 500 caracteres." };
    const key = `${scope}:${serviceId || 0}`;
    if (seen.has(key)) return { error: "Há regras de comissão repetidas para o mesmo escopo e serviço." };
    seen.add(key);
    rules.push({ scope, service_id: serviceId, rate_type: rateType, rate_value: fromCents(toCents(rateValue)), active, notes: notes || null });
  }
  return { rules };
}

/** Lançamentos ativos do atendimento, para o retorno das rotas. */
export async function listAppointmentCommissionEntries(db, appointmentId, { includeReversed = false } = {}) {
  return db.all(
    `SELECT ce.*, p.name AS professional_name
       FROM commission_entries ce
       JOIN professionals p ON p.id = ce.professional_id
      WHERE ce.appointment_id = ?${includeReversed ? "" : " AND ce.status = 'ativa'"}
      ORDER BY ce.id`,
    [appointmentId]
  );
}
