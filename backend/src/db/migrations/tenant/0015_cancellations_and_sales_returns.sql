-- Operações de reversão nunca apagam a origem: retenções, créditos, reembolsos
-- e devoluções mantêm uma trilha própria e idempotente.
CREATE TABLE IF NOT EXISTS client_credits (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  appointment_cancellation_id INTEGER,
  sales_return_id INTEGER,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  remaining_amount NUMERIC(12,2) NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= amount),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_used', 'used', 'canceled')),
  reason TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_cancellations (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  resolution TEXT NOT NULL CHECK (resolution IN ('retain_deposit', 'client_credit', 'manual_refund', 'no_payment')),
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  refund_method TEXT,
  reason TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE client_credits ADD CONSTRAINT client_credits_appointment_cancellation_fk
  FOREIGN KEY (appointment_cancellation_id) REFERENCES appointment_cancellations(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS sales_returns (
  id SERIAL PRIMARY KEY,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  financial_action TEXT NOT NULL CHECK (financial_action IN ('none', 'client_credit', 'manual_refund')),
  total_value NUMERIC(12,2) NOT NULL CHECK (total_value > 0),
  financial_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (financial_value >= 0 AND financial_value <= total_value),
  refund_method TEXT,
  reason TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE client_credits ADD CONSTRAINT client_credits_sales_return_fk
  FOREIGN KEY (sales_return_id) REFERENCES sales_returns(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS sales_return_items (
  id SERIAL PRIMARY KEY,
  sales_return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
  sales_order_item_id INTEGER NOT NULL REFERENCES sales_order_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  return_to_stock BOOLEAN NOT NULL DEFAULT true,
  condition TEXT NOT NULL DEFAULT 'sellable' CHECK (condition IN ('sellable', 'damaged', 'discarded')),
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(sales_return_id, sales_order_item_id)
);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS sales_return_item_id INTEGER REFERENCES sales_return_items(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_sales_returns_order ON sales_returns(sales_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_order_item ON sales_return_items(sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_client_credits_client ON client_credits(client_id, status, created_at DESC);
