-- Importação conferida de NF-e para Compras.
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS gtin TEXT;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS supplier_item_code TEXT;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS gtin TEXT;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS supplier_item_code TEXT;
ALTER TABLE consumables ADD COLUMN IF NOT EXISTS gtin TEXT;
ALTER TABLE consumables ADD COLUMN IF NOT EXISTS supplier_item_code TEXT;

CREATE INDEX IF NOT EXISTS idx_jewelry_inventory_fiscal_codes
  ON jewelry_inventory (gtin, supplier_item_code);
CREATE INDEX IF NOT EXISTS idx_jewelry_variants_fiscal_codes
  ON jewelry_variants (gtin, supplier_item_code);
CREATE INDEX IF NOT EXISTS idx_consumables_fiscal_codes
  ON consumables (gtin, supplier_item_code);

CREATE TABLE IF NOT EXISTS purchase_fiscal_documents (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL UNIQUE REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  access_key TEXT NOT NULL UNIQUE CHECK (length(access_key) = 44),
  document_number TEXT,
  series TEXT,
  protocol TEXT,
  authorization_status TEXT NOT NULL,
  xml_hash TEXT NOT NULL UNIQUE,
  issuer_document TEXT,
  original_xml TEXT NOT NULL,
  imported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_purchase_fiscal_documents_issuer
  ON purchase_fiscal_documents (issuer_document, created_at DESC);
