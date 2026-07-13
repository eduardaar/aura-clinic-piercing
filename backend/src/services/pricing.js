export const PRICE_ROUNDING_MODES = ["exact", "end_90", "end_99", "next_5"];
export const PRICE_MULTIPLIERS = [3, 4];

export function moneyToCents(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Math.max(0, Math.round(value * 100));
  const text = String(value).trim().replace(/[^\d,.-]/g, "");
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number * 100));
}

export function centsInputToCents(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function centsToMoney(cents) {
  const value = Number(cents || 0);
  return Math.round(value) / 100;
}

export function normalizeMultiplier(value, fallback = 3) {
  const number = Number(value || fallback);
  return PRICE_MULTIPLIERS.includes(number) ? number : fallback;
}

export function normalizeRoundingMode(value, fallback = "exact") {
  return PRICE_ROUNDING_MODES.includes(value) ? value : fallback;
}

export function normalizeLengthValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { length: "", length_mm: null };
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (["nao se aplica", "não se aplica", "n/a", "na", "sem comprimento"].includes(normalized)) {
    return { length: "", length_mm: null };
  }
  const match = normalized.match(/\d+(?:[,.]\d+)?/);
  if (!match) return { length: raw, length_mm: null };
  const numeric = Number(match[0].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return { length: "", length_mm: null };
  const lengthMm = Math.round(numeric * 10) / 10;
  const display = Number.isInteger(lengthMm) ? `${lengthMm}mm` : `${String(lengthMm).replace(".", ",")}mm`;
  return { length: display, length_mm: lengthMm };
}

export function applyPriceRounding(cents, mode = "exact") {
  const value = Math.max(0, Math.round(Number(cents || 0)));
  if (mode === "end_90") {
    const reais = Math.floor(value / 100);
    const candidate = reais * 100 + 90;
    return candidate >= value ? candidate : (reais + 1) * 100 + 90;
  }
  if (mode === "end_99") {
    const reais = Math.floor(value / 100);
    const candidate = reais * 100 + 99;
    return candidate >= value ? candidate : (reais + 1) * 100 + 99;
  }
  if (mode === "next_5") {
    return Math.ceil(value / 500) * 500;
  }
  return value;
}

export async function getPricingSettings(db) {
  await db.run(`
    INSERT INTO clinic_settings (id, default_price_multiplier, price_rounding_mode)
    VALUES (1, 3, 'exact')
    ON CONFLICT (id) DO NOTHING
  `);
  const settings = await db.get("SELECT * FROM clinic_settings WHERE id = 1");
  return {
    default_price_multiplier: normalizeMultiplier(settings?.default_price_multiplier, 3),
    price_rounding_mode: normalizeRoundingMode(settings?.price_rounding_mode, "exact")
  };
}

export async function savePricingSettings(db, body = {}) {
  const multiplier = normalizeMultiplier(body.default_price_multiplier, 3);
  const roundingMode = normalizeRoundingMode(body.price_rounding_mode, "exact");
  await db.run(`
    INSERT INTO clinic_settings (id, default_price_multiplier, price_rounding_mode)
    VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      default_price_multiplier = excluded.default_price_multiplier,
      price_rounding_mode = excluded.price_rounding_mode,
      updated_at = CURRENT_TIMESTAMP
  `, [multiplier, roundingMode]);
  return getPricingSettings(db);
}

export function calculatePricing(body = {}, settings = {}) {
  const fallbackMultiplier = normalizeMultiplier(settings.default_price_multiplier, 3);
  const roundingMode = normalizeRoundingMode(body.price_rounding_mode || settings.price_rounding_mode, "exact");
  const purchaseCostCents = body.purchase_cost_cents !== undefined ? centsInputToCents(body.purchase_cost_cents) : moneyToCents(body.purchase_cost ?? body.cost_value);
  const allocatedFreightCents = body.allocated_freight_cents !== undefined ? centsInputToCents(body.allocated_freight_cents) : moneyToCents(body.allocated_freight ?? body.freight_value);
  const additionalCostCents = body.additional_cost_cents !== undefined ? centsInputToCents(body.additional_cost_cents) : moneyToCents(body.additional_cost);
  const totalCostCents = purchaseCostCents + allocatedFreightCents + additionalCostCents;
  const multiplier = normalizeMultiplier(body.price_multiplier, fallbackMultiplier);
  const suggestedPriceCents = applyPriceRounding(Math.round(totalCostCents * multiplier), roundingMode);
  const saleWasProvided = body.sale_price_cents !== undefined || body.sale_value !== undefined;
  const explicitSaleCents = body.sale_price_cents !== undefined
    ? centsInputToCents(body.sale_price_cents)
    : body.sale_value !== undefined
      ? moneyToCents(body.sale_value)
      : 0;
  const explicitManualFlag = body.price_manually_overridden === true ||
    body.price_manually_overridden === 1 ||
    body.price_manually_overridden === "1" ||
    body.price_manually_overridden === "true";
  const manuallyOverridden = explicitManualFlag || (saleWasProvided && explicitSaleCents > 0 && explicitSaleCents !== suggestedPriceCents);
  const salePriceCents = manuallyOverridden ? explicitSaleCents : (suggestedPriceCents || explicitSaleCents);

  return {
    purchase_cost_cents: purchaseCostCents,
    allocated_freight_cents: allocatedFreightCents,
    additional_cost_cents: additionalCostCents,
    total_cost_cents: totalCostCents,
    price_multiplier: multiplier,
    price_rounding_mode: roundingMode,
    suggested_price_cents: suggestedPriceCents,
    sale_price_cents: salePriceCents,
    price_manually_overridden: manuallyOverridden ? 1 : 0,
    cost_value: centsToMoney(purchaseCostCents),
    sale_value: centsToMoney(salePriceCents)
  };
}
