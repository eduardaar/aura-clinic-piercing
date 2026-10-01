-- Devolução de venda pelo valor LÍQUIDO (preço − desconto rateado).
--
-- Com o rateio do desconto por item (0039), a devolução passa a restituir o que
-- o cliente efetivamente pagou. Um item 100% descontado (cupom ou desconto
-- manual) devolve só o estoque, com valor R$ 0,00 — e a restrição original da
-- 0015 (`total_value > 0`) impedia registrar essa devolução. A 0015 não é
-- editada (migration aplicada é imutável); a restrição é trocada aqui.
ALTER TABLE sales_returns DROP CONSTRAINT IF EXISTS sales_returns_total_value_check;
ALTER TABLE sales_returns ADD CONSTRAINT sales_returns_total_value_check CHECK (total_value >= 0);

-- Composição da devolução, para relatório e conferência: `total_value` é o
-- líquido devolvido, `gross_value` o preço de tabela das unidades devolvidas e
-- `discount_value` a parte do desconto da venda que acompanhou essas unidades.
-- Devoluções antigas ficam com `gross_value` nulo (eram registradas pelo bruto).
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS gross_value NUMERIC(12,2);
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE sales_returns ADD CONSTRAINT sales_returns_discount_nonnegative_check
    CHECK (discount_value >= 0 AND (gross_value IS NULL OR gross_value >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Por item: `unit_price` continua sendo o preço unitário da venda; `net_value`
-- é o que aquela linha devolveu (com arredondamento acumulado exato) e
-- `discount_value` a parte do desconto correspondente.
ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS net_value NUMERIC(12,2);

DO $$ BEGIN
  ALTER TABLE sales_return_items ADD CONSTRAINT sales_return_items_discount_nonnegative_check
    CHECK (discount_value >= 0 AND (net_value IS NULL OR net_value >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Uso de cupom em venda passa a ser gravado com `sale_id` (antes só o
-- agendamento gravava). Um uso por cupom e venda, como já é no agendamento.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usages_sale_unique
  ON coupon_usages(coupon_id, sale_id) WHERE sale_id IS NOT NULL;
