const csvValues = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);

export function calculateDiscount({ amount, discountType, discountValue, maximumDiscount = null }) {
  const safeAmount = Math.max(Number(amount || 0), 0);
  const safeValue = Math.max(Number(discountValue || 0), 0);
  let discount = discountType === "fixed"
    ? safeValue
    : safeAmount * Math.min(safeValue, 100) / 100;
  if (maximumDiscount !== null && maximumDiscount !== undefined && maximumDiscount !== "") {
    discount = Math.min(discount, Math.max(Number(maximumDiscount || 0), 0));
  }
  discount = Math.min(discount, safeAmount);
  return {
    original_amount: safeAmount,
    discount_amount: Number(discount.toFixed(2)),
    final_amount: Number((safeAmount - discount).toFixed(2))
  };
}

export async function validateCoupon(db, code, context = {}) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) return { valid: false, error: "Informe um cupom." };
  const coupon = await db.get(
    "SELECT * FROM coupons WHERE UPPER(code) = ? AND deleted_at IS NULL",
    [normalizedCode]
  );
  if (!coupon) return { valid: false, error: "Cupom inválido." };
  if (coupon.status !== "active") return { valid: false, error: "Cupom inativo ou pausado." };

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return { valid: false, error: "Cupom ainda não iniciado." };
  if (coupon.ends_at && new Date(coupon.ends_at) < now) return { valid: false, error: "Cupom expirado." };

  const amount = Math.max(Number(context.amount || 0), 0);
  if (amount < Number(coupon.minimum_amount || 0)) return { valid: false, error: "Valor mínimo não atingido." };

  const totalUsage = await db.get("SELECT COUNT(*) AS count FROM coupon_usages WHERE coupon_id = ?", [coupon.id]);
  if (coupon.usage_limit !== null && Number(totalUsage?.count || 0) >= Number(coupon.usage_limit)) {
    return { valid: false, error: "Limite de usos atingido." };
  }

  if (context.client_id && coupon.usage_limit_per_client !== null) {
    const clientUsage = await db.get(
      "SELECT COUNT(*) AS count FROM coupon_usages WHERE coupon_id = ? AND client_id = ?",
      [coupon.id, Number(context.client_id)]
    );
    if (Number(clientUsage?.count || 0) >= Number(coupon.usage_limit_per_client)) {
      return { valid: false, error: "Limite de uso por cliente atingido." };
    }
  }

  const selectedClients = csvValues(coupon.selected_client_ids);
  if (selectedClients.length && !selectedClients.includes(String(context.client_id || ""))) {
    return { valid: false, error: "Cupom não disponível para este cliente." };
  }

  const productIds = csvValues(coupon.product_ids);
  const categoryIds = csvValues(coupon.category_ids).map((value) => value.toLowerCase());
  const excludedProducts = csvValues(coupon.excluded_product_ids);
  const excludedCategories = csvValues(coupon.excluded_category_ids).map((value) => value.toLowerCase());
  const items = Array.isArray(context.items) ? context.items : [];
  const applicableItems = items.filter((item) => {
    const productId = String(item.product_id || item.id || "");
    const category = String(item.category || "").toLowerCase();
    if (excludedProducts.includes(productId) || excludedCategories.includes(category)) return false;
    if (productIds.length && !productIds.includes(productId)) return false;
    if (categoryIds.length && !categoryIds.includes(category)) return false;
    return true;
  });
  if (items.length && !applicableItems.length) return { valid: false, error: "Cupom não aplicável aos itens." };

  return {
    valid: true,
    coupon: { id: coupon.id, code: coupon.code, internal_name: coupon.internal_name, is_stackable: coupon.is_stackable },
    ...calculateDiscount({
      amount,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      maximumDiscount: coupon.maximum_discount
    })
  };
}
