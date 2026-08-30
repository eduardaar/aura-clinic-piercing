-- Composição do total da compra, necessária para manter os valores fiscais da NF-e.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS products_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS freight_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;
