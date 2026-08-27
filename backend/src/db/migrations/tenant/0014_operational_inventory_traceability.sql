-- Ficha técnica de materiais, consumo congelado no atendimento e rastreio de
-- lotes. Nada aqui altera saldos existentes: lotes são opcionais e permitem
-- adoção gradual do controle FEFO.
CREATE TABLE IF NOT EXISTS service_consumable_recipes (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, consumable_id)
);

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS batch_code TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE TABLE IF NOT EXISTS consumable_lots (
  id SERIAL PRIMARY KEY,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE RESTRICT,
  purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  purchase_order_item_id INTEGER REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date DATE,
  received_quantity INTEGER NOT NULL CHECK (received_quantity > 0),
  remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= received_quantity),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_consumptions (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source TEXT NOT NULL DEFAULT 'service_recipe' CHECK (source IN ('service_recipe', 'manual')),
  notes TEXT NOT NULL DEFAULT '',
  consumed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  reversed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  UNIQUE(appointment_id, consumable_id, source)
);

CREATE TABLE IF NOT EXISTS consumable_lot_allocations (
  id SERIAL PRIMARY KEY,
  appointment_consumption_id INTEGER NOT NULL REFERENCES appointment_consumptions(id) ON DELETE RESTRICT,
  consumable_lot_id INTEGER NOT NULL REFERENCES consumable_lots(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE(appointment_consumption_id, consumable_lot_id)
);

CREATE INDEX IF NOT EXISTS idx_service_consumable_recipes_service ON service_consumable_recipes(service_id);
CREATE INDEX IF NOT EXISTS idx_consumable_lots_fefo ON consumable_lots(consumable_id, active, expiry_date, id);
CREATE INDEX IF NOT EXISTS idx_appointment_consumptions_appointment ON appointment_consumptions(appointment_id, reversed_at);
