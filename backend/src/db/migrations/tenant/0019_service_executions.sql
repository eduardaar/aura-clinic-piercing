-- Execução real do atendimento separada de vendas de produtos.
CREATE TABLE IF NOT EXISTS service_executions (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  product_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  receivable_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  installment_count INTEGER NOT NULL DEFAULT 1 CHECK (installment_count BETWEEN 1 AND 120),
  first_due_date TEXT,
  installments_json JSONB,
  executed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_execution_items (
  id SERIAL PRIMARY KEY,
  service_execution_id INTEGER NOT NULL REFERENCES service_executions(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('service', 'product')),
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES jewelry_inventory(id) ON DELETE SET NULL,
  product_variant_id INTEGER REFERENCES jewelry_variants(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS service_execution_id INTEGER REFERENCES service_executions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_service_executions_completed ON service_executions(completed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_service_executions_client ON service_executions(client_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_executions_professional ON service_executions(professional_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_execution_items_execution ON service_execution_items(service_execution_id, id);
CREATE INDEX IF NOT EXISTS idx_payments_service_execution ON payments(service_execution_id);
