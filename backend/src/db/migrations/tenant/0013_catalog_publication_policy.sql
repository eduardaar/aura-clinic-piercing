-- Produtos novos devem nascer fora da vitrine. A publicação passa pelo
-- formulário, que sincroniza os marcadores legados durante a transição.
ALTER TABLE jewelry_inventory
  ALTER COLUMN is_catalog_active SET DEFAULT 0,
  ALTER COLUMN is_published SET DEFAULT 0,
  ALTER COLUMN virtual_store_active SET DEFAULT 0;
