import { localDate } from "./utils.js";
import { FinancialRuleError } from "./finance.js";
import { validBookingDate } from "./publicBookingAvailability.js";

export function cardMode(method) {
  const value = String(method || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return value.includes("debito") ? "debit" : value.includes("cartao") || value.includes("credito") ? "credit" : null;
}

export function normalizeCardFeeTable(body) {
  const name = String(body.operator_name || "").trim();
  const rates = {};
  const percent = (value) => {
    if (
      value === "" ||
      value == null ||
      !/^\d+(?:\.\d{1,4})?$/.test(String(value)) ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0 ||
      Number(value) > 100
    )
      throw new FinancialRuleError("Preencha cada taxa de 0 a 100%, com até quatro casas decimais.");
    return Number(value);
  };
  if (!name || name.length > 120 || !validBookingDate(body.valid_from))
    throw new FinancialRuleError("Informe a operadora e uma data de vigência válida.");
  for (let count = 1; count <= 12; count += 1) rates[count] = percent(body.credit_rates?.[count]);
  const policy = body.fee_policy || "studio";
  if (!["studio", "customer"].includes(policy)) throw new FinancialRuleError("Política de taxa inválida.");
  return {
    operator_name: name,
    valid_from: body.valid_from,
    debit_percent: percent(body.debit_percent),
    credit_rates: rates,
    fee_policy: policy,
    source_details: body.source_details?.source_url === "https://www.infinitepay.io/taxas" ? {
      source_url: body.source_details.source_url,
      checked_at: "2026-10-30",
      conditions: String(body.source_details.conditions || "").slice(0, 300),
    } : {},
  };
}

export async function applyConfiguredCardFee(db, item, { current = null, date = localDate() } = {}) {
  const mode = cardMode(item.method);
  if (
    item.card_fee_table_id &&
    (!Number.isSafeInteger(Number(item.card_fee_table_id)) || Number(item.card_fee_table_id) <= 0)
  )
    throw new FinancialRuleError("Maquininha inválida.");
  if (!mode) return { ...item, fee_amount: item.card_fee_table_id || current?.card_fee_snapshot ? 0 : Number(item.fee_amount || 0), card_surcharge_amount: 0, card_fee_table_id: null, card_fee_snapshot: null };
  if (item.fee_policy && !["studio", "customer"].includes(item.fee_policy)) throw new FinancialRuleError("Política de taxa inválida.");
  if (
    current?.card_fee_snapshot &&
    Number(current.card_fee_snapshot.gross_amount) === Number(item.amount) &&
    Number(current.amount) === Number(item.amount) &&
    current.method === item.method &&
    Number(current.installments) === Number(item.installments) &&
    (!item.fee_policy || item.fee_policy === (current.card_fee_snapshot.fee_policy || "studio")) &&
    (!item.card_fee_table_id || Number(item.card_fee_table_id) === Number(current.card_fee_table_id))
  ) {
    return {
      ...item,
      fee_amount: Number(current.fee_amount),
      card_fee_table_id: current.card_fee_table_id,
      card_fee_snapshot: current.card_fee_snapshot,
      card_surcharge_amount: Number(current.card_surcharge_amount || 0),
    };
  }
  const table = item.card_fee_table_id
    ? await db.get("SELECT * FROM card_fee_tables WHERE id=? AND valid_from<=?", [item.card_fee_table_id, date])
    : await db.get("SELECT * FROM card_fee_tables WHERE valid_from<=? ORDER BY valid_from DESC,id DESC LIMIT 1", [
        date,
      ]);
  if (!table && item.card_fee_table_id)
    throw new FinancialRuleError("Tabela de taxas inexistente ou ainda fora da vigência.");
  if (!table) {
    if (item.fee_policy === "customer") throw new FinancialRuleError("Configure uma tabela de taxas para calcular o repasse ao cliente.");
    return { ...item, card_surcharge_amount: 0, card_fee_table_id: null, card_fee_snapshot: null };
  }
  const count = mode === "debit" ? 1 : Number(item.installments || 1);
  if (!Number.isInteger(count) || count < 1 || count > 12)
    throw new FinancialRuleError("A tabela de cartão permite de 1 a 12 parcelas.");
  const rates = typeof table.credit_rates === "string" ? JSON.parse(table.credit_rates) : table.credit_rates;
  const rate = Number(mode === "debit" ? table.debit_percent : rates[count]);
  const policy = item.fee_policy || table.fee_policy || "studio";
  const baseCents = Math.round(Number(item.amount) * 100);
  if (policy === "customer" && rate >= 100) throw new FinancialRuleError("A taxa de repasse deve ser menor que 100%.");
  const scale = 1000000n;
  const rateScaled = BigInt(Math.round(rate * 10000));
  const denominator = scale - rateScaled;
  const chargedCents = policy === "customer" ? (baseCents > 0 ? Number(((BigInt(baseCents) - 1n) * scale + scale / 2n) / denominator + 1n) : 0) : baseCents;
  if (!Number.isSafeInteger(chargedCents) || chargedCents > 999999999999) throw new FinancialRuleError("Valor com taxa fora do limite permitido.");
  const fee = Number((BigInt(chargedCents) * rateScaled + scale / 2n) / scale) / 100;
  const surcharge = (chargedCents - baseCents) / 100;
  if (policy === "customer" && (item.quoted_charged_amount === undefined || Math.round(Number(item.quoted_charged_amount) * 100) !== chargedCents))
    throw new FinancialRuleError("Confira o valor final com o repasse antes de confirmar o pagamento.", 409);
  return {
    ...item,
    installments: count,
    fee_amount: fee,
    fee_policy: policy,
    card_surcharge_amount: surcharge,
    card_fee_table_id: table.id,
    card_fee_snapshot: {
      operator_name: table.operator_name,
      valid_from:
        table.valid_from instanceof Date
          ? table.valid_from.toISOString().slice(0, 10)
          : String(table.valid_from).slice(0, 10),
      mode,
      installments: count,
      percent: rate,
      gross_amount: Number(item.amount),
      charged_amount: chargedCents / 100,
      surcharge_amount: surcharge,
      fee_policy: policy,
      source_details: table.source_details || {},
      fee_amount: fee,
      net_amount: Math.round((Number(item.amount) + surcharge - fee) * 100) / 100,
    },
  };
}
