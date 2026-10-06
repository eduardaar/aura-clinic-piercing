-- Expectativa preservada separadamente do valor informado/recebido.
-- Não inferimos a expectativa histórica a partir do catálogo atual.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deposit_expected_value NUMERIC(12,2);
DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT appointments_deposit_expected_nonnegative
    CHECK (deposit_expected_value IS NULL OR (deposit_expected_value >= 0 AND deposit_expected_value <> 'NaN'::numeric));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Um recebimento canônico por baixa de título; seu espelho não gera outra receita.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS financial_entry_id INTEGER REFERENCES financial_entries(id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_financial_entry ON payments(financial_entry_id) WHERE financial_entry_id IS NOT NULL;
