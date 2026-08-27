-- Materiais de consumo são estoque operacional: não pertencem ao catálogo nem
-- podem ser vendidos. A migração mantém todas as compras anteriores como itens
-- de revenda e passa a permitir os dois tipos no mesmo pedido de compra.
CREATE TABLE IF NOT EXISTS consumables (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'unidade',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_quantity INTEGER NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  cost_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_value >= 0),
  supplier TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'product';
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS consumable_id INTEGER REFERENCES consumables(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_item_type_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_item_type_check CHECK (item_type IN ('product', 'consumable'));
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_target_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_target_check CHECK (
  (item_type = 'product' AND product_id IS NOT NULL AND consumable_id IS NULL) OR
  (item_type = 'consumable' AND consumable_id IS NOT NULL AND product_id IS NULL AND product_variant_id IS NULL)
);

CREATE TABLE IF NOT EXISTS consumable_stock_movements (
  id SERIAL PRIMARY KEY,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('Entrada', 'Saida', 'Ajuste')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT,
  movement_date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  purchase_order_item_id INTEGER REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_consumables_status_name ON consumables(status, name);
CREATE INDEX IF NOT EXISTS idx_consumable_stock_movements_item_date ON consumable_stock_movements(consumable_id, movement_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_consumable ON purchase_order_items(consumable_id) WHERE consumable_id IS NOT NULL;
