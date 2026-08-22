-- Mantém o cronograma editável enquanto compra/venda ainda está em
-- rascunho/aberta. Ao confirmar, as linhas são materializadas exatamente em
-- financial_entries; o JSON não substitui o razão, apenas preserva o plano.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS installments_json JSONB;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS installments_json JSONB;
