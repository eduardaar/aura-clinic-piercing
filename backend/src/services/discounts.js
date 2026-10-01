const csvValues = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);

// Id positivo vindo de opção/contexto; qualquer outra coisa vira null para que
// um valor malformado nunca desligue a contagem de usos por engano.
function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

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

// `options.excludeAppointmentId` / `options.excludeSalesOrderId` tiram da
// contagem de usos o próprio agendamento/venda que está sendo revalidado: sem
// isso, editar um agendamento que já consumiu a última vaga do cupom fazia o
// próprio uso dele bloquear a edição ("Limite de usos atingido"). A exclusão
// vem SÓ de `options`: o `context` pode carregar dados do corpo de rotas
// públicas, e ler as chaves dele deixaria qualquer um ignorar o limite do cupom.
//
// `options.forUpdate` trava a linha do cupom. Use DENTRO da transação que vai
// gravar o uso: assim duas vendas simultâneas não passam juntas pela última
// vaga do cupom (a contagem e a gravação ficam serializadas pela trava).
export async function validateCoupon(db, code, context = {}, options = {}) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) return { valid: false, error: "Informe um cupom." };
  const coupon = await db.get(
    `SELECT * FROM coupons WHERE UPPER(code) = ? AND deleted_at IS NULL${options.forUpdate ? " FOR UPDATE" : ""}`,
    [normalizedCode]
  );
  if (!coupon) return { valid: false, error: "Cupom inválido." };
  if (coupon.status !== "active") return { valid: false, error: "Cupom inativo ou pausado." };

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return { valid: false, error: "Cupom ainda não iniciado." };
  if (coupon.ends_at && new Date(coupon.ends_at) < now) return { valid: false, error: "Cupom expirado." };

  const amount = Math.max(Number(context.amount || 0), 0);
  if (amount < Number(coupon.minimum_amount || 0)) return { valid: false, error: "Valor mínimo não atingido." };

  const excludeAppointmentId = positiveId(options.excludeAppointmentId);
  const excludeSalesOrderId = positiveId(options.excludeSalesOrderId);
  const exclusionClauses = [];
  const exclusionParams = [];
  if (excludeAppointmentId) {
    exclusionClauses.push("appointment_id IS DISTINCT FROM ?");
    exclusionParams.push(excludeAppointmentId);
  }
  if (excludeSalesOrderId) {
    exclusionClauses.push("sale_id IS DISTINCT FROM ?");
    exclusionParams.push(excludeSalesOrderId);
  }
  const exclusion = exclusionClauses.map((clause) => ` AND ${clause}`).join("");

  const totalUsage = await db.get(
    `SELECT COUNT(*) AS count FROM coupon_usages WHERE coupon_id = ?${exclusion}`,
    [coupon.id, ...exclusionParams]
  );
  if (coupon.usage_limit !== null && Number(totalUsage?.count || 0) >= Number(coupon.usage_limit)) {
    return { valid: false, error: "Limite de usos atingido." };
  }

  if (context.client_id && coupon.usage_limit_per_client !== null) {
    const clientUsage = await db.get(
      `SELECT COUNT(*) AS count FROM coupon_usages WHERE coupon_id = ? AND client_id = ?${exclusion}`,
      [coupon.id, Number(context.client_id), ...exclusionParams]
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

// ---------------------------------------------------------------------------
// Aritmética de desconto em centavos inteiros (vendas e devoluções).
//
// Tudo aqui recebe e devolve INTEIROS de centavos. As multiplicações passam por
// BigInt porque `valor × peso` de dois valores monetários grandes estoura o
// inteiro seguro do JavaScript muito antes de cada valor isolado estourar.
// `calculateDiscount` (acima) continua em ponto flutuante de propósito: mudar o
// arredondamento dele alteraria cupons e promoções já em uso.
// ---------------------------------------------------------------------------

function nonNegativeCents(value, label) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`${label} inválido.`);
  return cents;
}

// Divisão inteira com arredondamento meio-para-cima (só valores ≥ 0).
export function roundHalfUpDiv(numerator, denominator) {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d <= 0n || n < 0n) throw new Error("Divisão inválida.");
  return Number((2n * n + d) / (2n * d));
}

// Percentual (em centésimos: 1250 = 12,50%) aplicado sobre uma base em
// centavos, arredondado ao centavo (meio para cima).
export function percentOfCents(baseCents, percentHundredths) {
  const base = nonNegativeCents(baseCents, "Base do desconto");
  const percent = nonNegativeCents(percentHundredths, "Percentual");
  return roundHalfUpDiv(BigInt(base) * BigInt(percent), 10000);
}

// Rateio de `totalCents` proporcional aos `weights` (centavos de cada parte)
// pelo método do maior resto: cada parte recebe o piso da sua cota exata e os
// centavos que sobram vão, um a um, para os maiores restos — empate decidido
// pela ordem (o primeiro item leva). A soma devolvida é SEMPRE `totalCents`, e
// nenhuma parte recebe mais que o próprio peso quando `totalCents ≤ Σ pesos`
// (a cota exata nunca passa do peso; o centavo extra só vai para quem tem
// resto, isto é, cota estritamente menor que o peso).
export function allocateCents(totalCents, weights = []) {
  const total = nonNegativeCents(totalCents, "Valor a ratear");
  const parts = weights.map((weight) => nonNegativeCents(weight, "Peso do rateio"));
  if (!parts.length) {
    if (total) throw new Error("Não há itens para ratear o desconto.");
    return [];
  }
  const sum = parts.reduce((acc, weight) => acc + BigInt(weight), 0n);
  if (sum === 0n) {
    if (total) throw new Error("Não há valor bruto para ratear o desconto.");
    return parts.map(() => 0);
  }
  const shares = parts.map((weight, index) => {
    const exact = BigInt(total) * BigInt(weight);
    return { index, value: exact / sum, remainder: exact % sum };
  });
  let leftover = BigInt(total) - shares.reduce((acc, share) => acc + share.value, 0n);
  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (const share of byRemainder) {
    if (leftover <= 0n) break;
    share.value += 1n;
    leftover -= 1n;
  }
  return shares.map((share) => Number(share.value));
}

// Valor de uma devolução parcial, com arredondamento ACUMULADO: devolver as
// unidades de uma em uma (ou em lotes) soma exatamente o líquido do item.
// Ex.: líquido 10.001 centavos em 3 unidades → 3.334 + 3.333 + 3.334.
export function proportionalReturnCents(netCents, soldQuantity, alreadyReturned, returning) {
  const net = nonNegativeCents(netCents, "Valor líquido do item");
  const sold = Number(soldQuantity);
  const before = Number(alreadyReturned);
  const now = Number(returning);
  if (!Number.isSafeInteger(sold) || sold < 1) throw new Error("Quantidade vendida inválida.");
  if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(now) || now < 1 || before + now > sold) {
    throw new Error("Quantidade devolvida inválida.");
  }
  return roundHalfUpDiv(BigInt(net) * BigInt(before + now), sold) - roundHalfUpDiv(BigInt(net) * BigInt(before), sold);
}

// Bruto (centavos) de uma linha de venda: preço unitário × quantidade.
export function salesItemGrossCents(item = {}) {
  return Math.round(Number(item.unit_price || 0) * 100) * Math.max(0, Math.trunc(Number(item.quantity || 0)));
}

// Desconto (centavos) de cada item de uma venda.
//
// Vendas novas gravam o rateio em `sales_order_items.discount_value`. Vendas
// antigas têm 0 em todos os itens mesmo com desconto no pedido: para elas o
// rateio proporcional é calculado na hora, com a mesma regra da gravação, e o
// desconto nunca passa do bruto somado dos itens.
export function salesItemDiscountCents(orderDiscountValue, items = []) {
  const gross = items.map(salesItemGrossCents);
  const stored = items.map((item) => Math.max(0, Math.round(Number(item.discount_value || 0) * 100)));
  if (stored.some((value) => value > 0)) return stored.map((value, index) => Math.min(value, gross[index]));
  const orderDiscount = Math.max(0, Math.round(Number(orderDiscountValue || 0) * 100));
  const grossSum = gross.reduce((sum, value) => sum + value, 0);
  if (!orderDiscount || !grossSum) return gross.map(() => 0);
  return allocateCents(Math.min(orderDiscount, grossSum), gross);
}
