-- Compras passam a ser a origem única da entrada de mercadoria e das contas a
-- pagar correspondentes. A chave de idempotência impede que um reenvio do
-- formulário duplique estoque ou parcelas financeiras.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS person_type TEXT NOT NULL DEFAULT 'PJ' CHECK (person_type IN ('PJ', 'PF'));
ALTER TABLE financial_categories ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_date TEXT NOT NULL,
  first_due_date TEXT NOT NULL,
  installment_count INTEGER NOT NULL DEFAULT 1 CHECK (installment_count BETWEEN 1 AND 120),
  payment_method TEXT,
  category TEXT,
  cost_center_id INTEGER REFERENCES financial_cost_centers(id) ON DELETE SET NULL,
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  CONSTRAINT ux_purchase_orders_idempotency UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE RESTRICT,
  product_variant_id INTEGER REFERENCES jewelry_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS purchase_order_item_id INTEGER REFERENCES purchase_order_items(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_date ON purchase_orders (supplier_id, purchase_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_date ON purchase_orders (status, purchase_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items (purchase_order_id, id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_purchase ON stock_movements (purchase_order_id, purchase_order_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_financial_entries_purchase_source
  ON financial_entries (source_key)
  WHERE source_type = 'purchase_order';
