-- Vincula cada baixa (`payments`) ao título que ela quita (`sales_orders`).
-- Sem esse vínculo, dinheiro recebido e o que foi vendido moravam em duas
-- tabelas soltas, e vendas de catálogo pagas online (webhook do Asaas) ou
-- confirmadas manualmente pelo staff nunca geravam baixa alguma — ficavam
-- com `sales_orders.status='pago'`, mas invisíveis em todo total financeiro
-- (dashboard, CSV/PDF de faturamento). Ver services/sales.js e
-- services/tenantCharges.js, corrigidos junto com esta migration.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sales_order_id INTEGER REFERENCES sales_orders(id);
CREATE INDEX IF NOT EXISTS idx_payments_sales_order_id ON payments (sales_order_id);

-- Backfill 1 — pagamentos da agenda (sinal + restante): vínculo exato via
-- appointment_id, já que cada atendimento tem no máximo um título
-- 'ordem_servico'.
UPDATE payments p
   SET sales_order_id = so.id
  FROM sales_orders so
 WHERE p.appointment_id IS NOT NULL
   AND p.appointment_id = so.appointment_id
   AND so.order_type = 'ordem_servico'
   AND p.sales_order_id IS NULL;

-- Backfill 2 — vendas de balcão (interno) que já nasciam pagas: o INSERT em
-- payments acontecia na mesma transação da venda, então cliente, valor e
-- instante de criação coincidem (com folga de alguns segundos para absorver
-- qualquer diferença de formatação entre os dois timestamps).
UPDATE payments p
   SET sales_order_id = so.id
  FROM sales_orders so
 WHERE p.sales_order_id IS NULL
   AND p.appointment_id IS NULL
   AND so.source = 'interno'
   AND so.client_id = p.client_id
   AND so.total_value = p.amount
   AND p.paid_at::timestamp BETWEEN so.created_at::timestamp AND so.created_at::timestamp + INTERVAL '5 seconds';

-- Backfill 3 — a receita que faltava de verdade: vendas de catálogo/balcão já
-- marcadas pagas/concluídas (pelo Asaas ou manualmente) que nunca geraram
-- baixa. Deliberadamente restrito a source <> 'agenda': um título 'agenda'
-- sem baixa correspondente após o backfill 1 significa atendimento sem
-- cobrança real (ex.: cortesia), e não deve ganhar um pagamento fabricado.
INSERT INTO payments (appointment_id, client_id, sales_order_id, amount, payment_type, method, status, paid_at)
SELECT NULL, so.client_id, so.id, so.total_value, so.order_type, COALESCE(NULLIF(so.payment_method, ''), 'Pix'), 'pago', so.created_at
  FROM sales_orders so
 WHERE so.source != 'agenda'
   AND so.status IN ('pago', 'concluida')
   AND so.total_value > 0
   AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sales_order_id = so.id);
