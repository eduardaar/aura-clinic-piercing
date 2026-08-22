-- Consolida a origem de contas a receber de vendas e ordens de serviço.
-- A migration 0008 pertence ao fluxo de Compras; por isso este pacote começa
-- deliberadamente em 0009.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS receivable_mode TEXT NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS installment_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_due_date TEXT,
  ADD COLUMN IF NOT EXISTS stock_deducted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_receivable_mode_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_receivable_mode_check
  CHECK (receivable_mode IN ('paid', 'pending'));
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_installment_count_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_installment_count_check
  CHECK (installment_count BETWEEN 1 AND 120);

-- Pedidos históricos já liquidados podem ou não ter movimentos antigos sem
-- vínculo estrutural. Marcá-los evita uma segunda baixa ao serem editados.
UPDATE sales_orders
   SET stock_deducted = 1
 WHERE status IN ('pago', 'concluida');

-- Um atendimento só pode possuir uma ordem de serviço. A aplicação também
-- bloqueia a linha do agendamento; o índice é a última barreira contra corrida.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_orders_appointment_service
  ON sales_orders (appointment_id)
  WHERE appointment_id IS NOT NULL AND order_type = 'ordem_servico';

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_idempotency_key
  ON payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- O movimento passa a apontar para a linha exata da venda. Isso permite
-- repetir confirmação/PATCH/webhook sem descontar o mesmo item duas vezes.
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS sales_order_id INTEGER REFERENCES sales_orders(id),
  ADD COLUMN IF NOT EXISTS sales_order_item_id INTEGER REFERENCES sales_order_items(id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_movements_sales_order_item
  ON stock_movements (sales_order_id, sales_order_item_id, movement_type)
  WHERE sales_order_id IS NOT NULL AND sales_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_entries_sales_order_receivable
  ON financial_entries (source_id, installment_number, status)
  WHERE source_type = 'sales_order' AND entry_type = 'receivable';
