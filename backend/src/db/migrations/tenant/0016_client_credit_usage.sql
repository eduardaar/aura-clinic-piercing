-- O crédito não é nova receita quando usado. Registramos seu consumo em tabela
-- própria e em payment com status distinto, preservando o saldo financeiro.
CREATE TABLE IF NOT EXISTS client_credit_usages (
  id SERIAL PRIMARY KEY,
  client_credit_id INTEGER NOT NULL REFERENCES client_credits(id) ON DELETE RESTRICT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE RESTRICT,
  sales_order_id INTEGER REFERENCES sales_orders(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((appointment_id IS NOT NULL AND sales_order_id IS NULL) OR (appointment_id IS NULL AND sales_order_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_client_credit_usages_credit ON client_credit_usages(client_credit_id, created_at DESC);
