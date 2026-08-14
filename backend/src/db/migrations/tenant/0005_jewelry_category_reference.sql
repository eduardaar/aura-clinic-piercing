ALTER TABLE jewelry_inventory
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES inventory_options(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jewelry_inventory_category_id
  ON jewelry_inventory(category_id);

UPDATE jewelry_inventory j
   SET category_id = o.id
  FROM inventory_options o
 WHERE o.type = 'category'
   AND o.name = j.category
   AND j.category_id IS NULL;
