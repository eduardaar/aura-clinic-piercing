CREATE TABLE IF NOT EXISTS financial_entry_payments (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES financial_entries(id),
  amount NUMERIC(12,2) NOT NULL,
  paid_at TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, idempotency_key)
);
INSERT INTO financial_entry_payments (entry_id, amount, paid_at, payment_method, notes, idempotency_key)
SELECT id, paid_amount, COALESCE(paid_at, due_date), COALESCE(payment_method, 'Pix'), 'Saldo pago anterior ao histórico detalhado', 'opening-balance'
FROM financial_entries WHERE entry_type IN ('payable','expense') AND paid_amount > 0
ON CONFLICT (entry_id, idempotency_key) DO NOTHING;
