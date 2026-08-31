-- Corte pré-produção: jewelry_inventory passa a ser a fonte única de itens.
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS stock_unit TEXT NOT NULL DEFAULT 'unidade';
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS purchase_unit TEXT NOT NULL DEFAULT 'unidade';
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS consumption_unit TEXT NOT NULL DEFAULT 'unidade';
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS purchase_to_stock_factor INTEGER NOT NULL DEFAULT 1 CHECK (purchase_to_stock_factor > 0);
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS can_sell BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS can_use_in_service BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS track_lots BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS can_publish BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_target_check;
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_item_type_check;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS consumable_id;
DELETE FROM purchase_order_items WHERE product_id IS NULL;
UPDATE purchase_order_items SET item_type='product';
ALTER TABLE purchase_order_items ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE purchase_order_items ALTER COLUMN item_type SET DEFAULT 'product';
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_item_type_check CHECK (item_type='product');

DROP TABLE IF EXISTS consumable_lot_allocations;
DROP TABLE IF EXISTS appointment_consumptions;
DROP TABLE IF EXISTS consumable_lots;
DROP TABLE IF EXISTS service_consumable_recipes;
DROP TABLE IF EXISTS consumable_stock_movements;
DROP TABLE IF EXISTS consumables CASCADE;

CREATE TABLE service_inventory_recipes (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, inventory_item_id)
);

CREATE TABLE inventory_item_lots (
  id SERIAL PRIMARY KEY,
  inventory_item_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE RESTRICT,
  product_variant_id INTEGER REFERENCES jewelry_variants(id) ON DELETE RESTRICT,
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

CREATE TABLE appointment_consumptions (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  inventory_item_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source TEXT NOT NULL DEFAULT 'service_recipe' CHECK (source IN ('service_recipe', 'manual')),
  notes TEXT NOT NULL DEFAULT '',
  consumed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  reversed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  UNIQUE(appointment_id, inventory_item_id, source)
);

CREATE TABLE inventory_item_lot_allocations (
  id SERIAL PRIMARY KEY,
  appointment_consumption_id INTEGER NOT NULL REFERENCES appointment_consumptions(id) ON DELETE RESTRICT,
  inventory_item_lot_id INTEGER NOT NULL REFERENCES inventory_item_lots(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE(appointment_consumption_id, inventory_item_lot_id)
);

CREATE INDEX idx_inventory_items_behavior ON jewelry_inventory(can_sell, can_use_in_service, can_publish, status);
CREATE INDEX idx_inventory_item_lots_fefo ON inventory_item_lots(inventory_item_id, active, expiry_date, id);
CREATE INDEX idx_service_inventory_recipes_service ON service_inventory_recipes(service_id);
CREATE INDEX idx_appointment_consumptions_appointment ON appointment_consumptions(appointment_id, reversed_at);
