-- Desconto manual em vendas.
--
-- `sales_orders.discount_value` continua sendo o desconto TOTAL da venda
-- (cupom + desconto manual). A parcela manual fica separada, com autor, data e
-- motivo, para rastreabilidade no financeiro e nos relatórios.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS manual_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS manual_discount_reason TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS manual_discount_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS manual_discount_updated_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_manual_discount_nonnegative_check
    CHECK (manual_discount_value >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Parcela do desconto total da venda atribuída a cada item, gravada na
-- criação. Devoluções e relatórios usam esse valor para devolver e reportar
-- exatamente o que foi cobrado; vendas antigas (0 em todos os itens) seguem
-- com o rateio proporcional calculado na hora.
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE sales_order_items ADD CONSTRAINT sales_order_items_discount_nonnegative_check
    CHECK (discount_value >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
