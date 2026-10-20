ALTER TABLE services ADD COLUMN IF NOT EXISTS inventory_kit_name TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consumption_confirmed_at TIMESTAMPTZ;
UPDATE appointments SET consumption_confirmed_at=now() WHERE status='atendido' AND consumption_confirmed_at IS NULL;
ALTER TABLE service_inventory_recipes ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE service_inventory_recipes ADD COLUMN IF NOT EXISTS usage_stage TEXT NOT NULL DEFAULT 'procedure'
  CHECK (usage_stage IN ('procedure','preparation','sterilization','hygiene','reusable'));
ALTER TABLE service_inventory_recipes ADD COLUMN IF NOT EXISTS auto_consume BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE service_inventory_recipes ADD COLUMN IF NOT EXISTS inventory_variant_id INTEGER REFERENCES jewelry_variants(id);
ALTER TABLE appointment_consumptions ADD COLUMN IF NOT EXISTS inventory_variant_id INTEGER REFERENCES jewelry_variants(id);
ALTER TABLE appointment_consumptions ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE appointment_consumptions ADD COLUMN IF NOT EXISTS usage_stage TEXT NOT NULL DEFAULT 'procedure';
-- Each reopening creates a new immutable consumption event. Only the active
-- event is unique; reversed events remain in the audit history.
ALTER TABLE appointment_consumptions DROP CONSTRAINT IF EXISTS appointment_consumptions_appointment_id_inventory_item_id_s_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_consumptions_active_recipe ON appointment_consumptions(appointment_id,inventory_item_id,source) WHERE reversed_at IS NULL;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS item_classification TEXT NOT NULL DEFAULT 'resale'
  CHECK (item_classification IN ('resale','material'));
UPDATE jewelry_inventory SET item_classification='material' WHERE can_sell=false;
