ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stock_conversion_factor INTEGER CHECK (stock_conversion_factor > 0);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS purchase_unit TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stock_unit TEXT;
UPDATE purchase_order_items p SET stock_conversion_factor=COALESCE(j.purchase_to_stock_factor,1),purchase_unit=j.purchase_unit,stock_unit=j.stock_unit
FROM jewelry_inventory j WHERE j.id=p.product_id AND p.stock_conversion_factor IS NULL;
