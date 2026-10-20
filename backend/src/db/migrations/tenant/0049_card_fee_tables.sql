CREATE TABLE IF NOT EXISTS card_fee_tables (
  id SERIAL PRIMARY KEY,
  operator_name TEXT NOT NULL,
  valid_from DATE NOT NULL,
  debit_percent NUMERIC(7,4) NOT NULL CHECK (debit_percent BETWEEN 0 AND 100),
  credit_rates JSONB NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_fee_table_id INTEGER REFERENCES card_fee_tables(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_fee_snapshot JSONB;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS card_fee_table_id INTEGER REFERENCES card_fee_tables(id);
