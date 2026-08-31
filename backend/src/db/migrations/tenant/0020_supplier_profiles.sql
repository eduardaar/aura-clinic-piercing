-- Evolui a fonte única de fornecedores usada por Compras e Contas a Pagar.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS trade_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS state_registration TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS street_number TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address_complement TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'Brasil';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS categories JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS brands JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS certifications JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS material_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lot_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_days INTEGER CHECK (payment_days BETWEEN 0 AND 3650);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER CHECK (lead_time_days BETWEEN 0 AND 3650);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS minimum_order_value NUMERIC(12,2) CHECK (minimum_order_value >= 0);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS freight_terms TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'review'
  CHECK (quality_status IN ('approved', 'review', 'blocked'));
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS');

CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_document
  ON suppliers (document) WHERE NULLIF(document, '') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_name_search ON suppliers (lower(name));
CREATE INDEX IF NOT EXISTS idx_suppliers_categories ON suppliers USING GIN (categories);
