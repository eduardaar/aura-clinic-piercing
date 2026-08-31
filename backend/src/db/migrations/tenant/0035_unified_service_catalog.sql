-- `services` passa a ser a fonte única de tipos de atendimento/procedimentos.
-- A tabela procedures permanece somente para leitura de históricos anteriores ao corte.
ALTER TABLE services ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Piercing';
ALTER TABLE services ADD COLUMN IF NOT EXISTS body_area TEXT NOT NULL DEFAULT '';

CREATE TABLE service_compatible_inventory_items (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, inventory_item_id)
);
CREATE INDEX idx_service_compatible_inventory_item
  ON service_compatible_inventory_items(inventory_item_id, service_id);
