const OUTGOING_TYPES = new Set(["saida", "venda", "perda"]);

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function calculateInventoryMetrics(products, movements, windowDays = 90) {
  const days = Math.max(1, Number(windowDays || 90));
  const outgoing = new Map();
  for (const movement of movements) {
    if (!OUTGOING_TYPES.has(normalize(movement.movement_type))) continue;
    const current = outgoing.get(Number(movement.jewelry_id)) || 0;
    outgoing.set(Number(movement.jewelry_id), current + Math.max(0, Number(movement.quantity || 0)));
  }
  const rows = products.map((product) => {
    const unitsOut = outgoing.get(Number(product.id)) || 0;
    const dailyDemand = unitsOut / days;
    const quantity = Math.max(0, Number(product.quantity || 0));
    const daysToStockout = dailyDemand > 0 ? quantity / dailyDemand : null;
    const target = Math.max(Number(product.low_stock_threshold || 0) * 2, Math.ceil(dailyDemand * 45));
    return {
      ...product,
      units_out: unitsOut,
      daily_demand: Number(dailyDemand.toFixed(3)),
      days_to_stockout: daysToStockout === null ? null : Number(daysToStockout.toFixed(1)),
      suggested_purchase: Math.max(0, target - quantity),
      movement_value: unitsOut * Number(product.sale_value || 0)
    };
  }).sort((a, b) => b.movement_value - a.movement_value);
  const totalValue = rows.reduce((sum, row) => sum + row.movement_value, 0);
  let accumulated = 0;
  return rows.map((row) => {
    const shareBefore = totalValue > 0 ? accumulated / totalValue : 1;
    accumulated += row.movement_value;
    return { ...row, abc_class: shareBefore < 0.8 ? "A" : shareBefore < 0.95 ? "B" : "C" };
  });
}

export async function inventoryIntelligence(db, windowDays = 90) {
  const since = new Date(Date.now() - Math.max(1, Number(windowDays || 90)) * 86_400_000).toISOString().slice(0, 10);
  const products = await db.all("SELECT id, name, sku, category, material, color, stone, quantity, sale_value, low_stock_threshold, critical_stock_threshold, supplier FROM jewelry_inventory WHERE status != 'arquivado' ORDER BY name");
  const movements = await db.all("SELECT jewelry_id, movement_type, quantity, movement_date FROM stock_movements WHERE movement_date >= ?", [since]);
  return calculateInventoryMetrics(products, movements, windowDays);
}

export async function refreshInventorySuggestions(db, userId = null) {
  const metrics = await inventoryIntelligence(db, 90);
  for (const item of metrics) {
    if (item.suggested_purchase <= 0 && !(item.days_to_stockout !== null && item.days_to_stockout <= 30)) continue;
    const value = String(Math.max(item.suggested_purchase, Number(item.low_stock_threshold || 0)));
    const reason = item.days_to_stockout === null
      ? "Estoque abaixo do nível mínimo configurado."
      : `Previsão de ruptura em ${item.days_to_stockout} dia(s), com base nos últimos 90 dias.`;
    const existing = await db.get("SELECT id FROM inventory_suggestions WHERE jewelry_id=? AND suggestion_type='reorder' AND status='pending'", [item.id]);
    if (existing) {
      await db.run("UPDATE inventory_suggestions SET suggested_value=?, reason=?, confidence=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [value, reason, item.units_out > 0 ? 0.85 : 0.55, existing.id]);
    } else {
      await db.run(
        "INSERT INTO inventory_suggestions (jewelry_id, suggestion_type, current_value, suggested_value, reason, confidence, reviewed_by) VALUES (?, 'reorder', ?, ?, ?, ?, ?)",
        [item.id, String(item.quantity), value, reason, item.units_out > 0 ? 0.85 : 0.55, userId]
      );
    }
  }
  const products = await db.all("SELECT id, name, category, material, color, stone FROM jewelry_inventory WHERE status!='arquivado'");
  for (const field of ["material", "color", "stone"]) {
    const byCategory = new Map();
    for (const product of products) {
      const value = String(product[field] || "").trim();
      if (!value) continue;
      const key = String(product.category || "");
      const counts = byCategory.get(key) || new Map();
      counts.set(value, (counts.get(value) || 0) + 1);
      byCategory.set(key, counts);
    }
    for (const product of products) {
      if (String(product[field] || "").trim()) continue;
      const counts = byCategory.get(String(product.category || ""));
      const candidate = counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0] : null;
      if (!candidate || candidate[1] < 2) continue;
      const existing = await db.get("SELECT id FROM inventory_suggestions WHERE jewelry_id=? AND suggestion_type=? AND status='pending'", [product.id, field]);
      const values = [candidate[0], `Campo vazio; valor predominante na categoria ${product.category}.`, Math.min(0.95, 0.6 + candidate[1] / 20)];
      if (existing) {
        await db.run("UPDATE inventory_suggestions SET suggested_value=?, reason=?, confidence=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [...values, existing.id]);
      } else {
        await db.run(
          "INSERT INTO inventory_suggestions (jewelry_id, suggestion_type, current_value, suggested_value, reason, confidence, reviewed_by) VALUES (?, ?, '', ?, ?, ?, ?)",
          [product.id, field, ...values, userId]
        );
      }
    }
  }
  return metrics;
}
