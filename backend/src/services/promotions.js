import { calculateDiscount } from "./discounts.js";

const csv = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
const normalizedCsv = (value) => csv(value).map((entry) => entry.toLocaleLowerCase("pt-BR"));

function isPromotionActive(promotion, now = new Date()) {
  if (!promotion || promotion.deleted_at || promotion.status !== "active" || !Number(promotion.is_active ?? 1)) return false;
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  if (promotion.start_date && promotion.start_date > date) return false;
  if (promotion.end_date && promotion.end_date < date) return false;
  if (promotion.start_time && promotion.start_time > time) return false;
  if (promotion.end_time && promotion.end_time < time) return false;
  return true;
}

function itemMatches(promotion, item) {
  const productId = String(item.product_id || item.id || "");
  const variationId = String(item.variation_id || item.selected_variant_id || "");
  const category = String(item.category || "").toLocaleLowerCase("pt-BR");
  const color = String(item.color || item.selected_color || "").toLocaleLowerCase("pt-BR");
  const material = String(item.material || "").toLocaleLowerCase("pt-BR");
  const stone = String(item.stone || "").toLocaleLowerCase("pt-BR");
  const productIds = csv(promotion.product_ids);
  const variationIds = csv(promotion.variation_ids);
  const categories = normalizedCsv(promotion.category_ids);
  const excludedProducts = csv(promotion.excluded_product_ids);
  const excludedVariations = csv(promotion.excluded_variation_ids);
  const excludedCategories = normalizedCsv(promotion.excluded_category_ids);
  if (excludedProducts.includes(productId) || excludedVariations.includes(variationId) || excludedCategories.includes(category)) return false;
  if (productIds.length && !productIds.includes(productId)) return false;
  if (variationIds.length && !variationIds.includes(variationId)) return false;
  if (categories.length && !categories.includes(category)) return false;
  if (normalizedCsv(promotion.colors).length && !normalizedCsv(promotion.colors).includes(color)) return false;
  if (normalizedCsv(promotion.materials).length && !normalizedCsv(promotion.materials).includes(material)) return false;
  if (normalizedCsv(promotion.stones).length && !normalizedCsv(promotion.stones).includes(stone)) return false;
  const unitPrice = Number(item.unit_price ?? item.sale_value ?? item.price ?? 0);
  if (promotion.minimum_amount && unitPrice < Number(promotion.minimum_amount)) return false;
  if (promotion.maximum_amount && unitPrice > Number(promotion.maximum_amount)) return false;
  return true;
}

function specificity(promotion) {
  if (csv(promotion.variation_ids).length) return 4;
  if (csv(promotion.product_ids).length) return 3;
  if (csv(promotion.category_ids).length || csv(promotion.colors).length || csv(promotion.materials).length || csv(promotion.stones).length) return 2;
  return 1;
}

export function calculatePromotionDiscount(promotion, amount, quantity = 1) {
  const safeAmount = Math.max(Number(amount || 0), 0);
  const safeQuantity = Math.max(Number(quantity || 1), 1);
  if (safeQuantity < Number(promotion.minimum_quantity || 1)) return calculateDiscount({ amount: safeAmount, discountType: "fixed", discountValue: 0 });
  if (promotion.discount_type === "fixed_price") {
    return calculateDiscount({ amount: safeAmount, discountType: "fixed", discountValue: Math.max(safeAmount - Number(promotion.fixed_promotional_price ?? promotion.discount_value ?? 0), 0) });
  }
  if (promotion.discount_type === "buy_x_pay_y") {
    const buy = Math.max(Number(promotion.buy_quantity || 1), 1);
    const pay = Math.min(Math.max(Number(promotion.pay_quantity || buy), 0), buy);
    const groups = Math.floor(safeQuantity / buy);
    const unitPrice = safeAmount / safeQuantity;
    return calculateDiscount({ amount: safeAmount, discountType: "fixed", discountValue: groups * (buy - pay) * unitPrice });
  }
  return calculateDiscount({
    amount: safeAmount,
    discountType: promotion.discount_type === "fixed" ? "fixed" : "percent",
    discountValue: promotion.discount_value,
    maximumDiscount: promotion.maximum_discount
  });
}

export async function quotePromotions(db, context = {}) {
  const items = Array.isArray(context.items) ? context.items : [];
  const promotions = await db.all("SELECT * FROM catalog_promotions WHERE deleted_at IS NULL AND is_active = 1 AND status = 'active'");
  const usageCounts = new Map();
  const applicable = [];
  for (const promotion of promotions) {
    if (!isPromotionActive(promotion)) continue;
    if (promotion.usage_limit !== null && promotion.usage_limit !== undefined) {
      let count = usageCounts.get(promotion.id);
      if (count === undefined) {
        count = Number((await db.get("SELECT COUNT(*) AS count FROM promotion_usages WHERE promotion_id = ?", [promotion.id]))?.count || 0);
        usageCounts.set(promotion.id, count);
      }
      if (count >= Number(promotion.usage_limit)) continue;
    }
    const matchingItems = items.filter((item) => itemMatches(promotion, item));
    if (!matchingItems.length) continue;
    const amount = matchingItems.reduce((sum, item) => sum + Number(item.unit_price ?? item.sale_value ?? item.price ?? 0) * Math.max(Number(item.quantity || item.qty || 1), 1), 0);
    const quantity = matchingItems.reduce((sum, item) => sum + Math.max(Number(item.quantity || item.qty || 1), 1), 0);
    const quote = calculatePromotionDiscount(promotion, amount, quantity);
    if (quote.discount_amount <= 0) continue;
    applicable.push({ promotion, quote, specificity: specificity(promotion) });
  }
  applicable.sort((a, b) => Number(b.promotion.priority || 0) - Number(a.promotion.priority || 0) || b.specificity - a.specificity || b.quote.discount_amount - a.quote.discount_amount);
  const selected = [];
  for (const candidate of applicable) {
    if (!selected.length) selected.push(candidate);
    else if (selected.every((entry) => Number(entry.promotion.is_stackable) && Number(candidate.promotion.is_stackable))) selected.push(candidate);
  }
  const originalAmount = items.reduce((sum, item) => sum + Number(item.unit_price ?? item.sale_value ?? item.price ?? 0) * Math.max(Number(item.quantity || item.qty || 1), 1), 0);
  const discountAmount = Math.min(selected.reduce((sum, entry) => sum + entry.quote.discount_amount, 0), originalAmount);
  return {
    original_amount: Number(originalAmount.toFixed(2)),
    discount_amount: Number(discountAmount.toFixed(2)),
    final_amount: Number((originalAmount - discountAmount).toFixed(2)),
    promotions: selected.map(({ promotion, quote }) => ({
      id: promotion.id,
      name: promotion.name,
      badge: promotion.badge,
      legal_text: promotion.legal_text,
      discount_amount: quote.discount_amount,
      stackable_with_coupon: Boolean(Number(promotion.stackable_with_coupon))
    }))
  };
}
