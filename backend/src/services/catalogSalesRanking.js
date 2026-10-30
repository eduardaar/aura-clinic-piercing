// Unidades efetivamente vendidas: pedidos concluídos, líquidos de devoluções.
// O movimento marca a conclusão; pedidos sem controle de estoque usam a criação.
export async function catalogSalesRanking(db) {
  const rows = await db.all(`
    WITH returned AS (
      SELECT sales_order_item_id, SUM(quantity) AS quantity
      FROM sales_return_items GROUP BY sales_order_item_id
    ), sold AS (
      SELECT i.product_id, GREATEST(i.quantity - COALESCE(r.quantity, 0), 0) AS quantity
      FROM sales_order_items i
      JOIN sales_orders o ON o.id = i.sales_order_id
      LEFT JOIN returned r ON r.sales_order_item_id = i.id
      LEFT JOIN LATERAL (
        SELECT MIN(m.created_at)::timestamp AS sold_at
        FROM stock_movements m
        WHERE m.sales_order_item_id = i.id AND m.movement_type IN ('Saida', 'Saída')
      ) movement ON true
      WHERE i.product_id IS NOT NULL AND i.item_type = 'produto'
        AND o.status IN ('concluida', 'pago')
        AND (o.source<>'agenda' OR EXISTS (SELECT 1 FROM appointments a WHERE a.id=o.appointment_id AND a.status='atendido'))
        AND COALESCE(movement.sold_at, o.created_at::timestamp)
          BETWEEN LOCALTIMESTAMP - INTERVAL '30 days' AND LOCALTIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.sales_order_id = o.id
            AND p.status IN ('refunded', 'estornado')
        )
    )
    SELECT product_id, SUM(quantity)::int AS units_sold_30d
    FROM sold GROUP BY product_id HAVING SUM(quantity) > 0
  `);
  return new Map(rows.map((row) => [Number(row.product_id), Number(row.units_sold_30d)]));
}
