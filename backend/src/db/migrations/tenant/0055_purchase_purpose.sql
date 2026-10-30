ALTER TABLE purchase_order_items ADD COLUMN purchase_purpose TEXT NOT NULL DEFAULT 'resale'
  CHECK (purchase_purpose IN ('resale','consumption'));
UPDATE purchase_order_items p SET purchase_purpose='consumption'
FROM jewelry_inventory j WHERE j.id=p.product_id AND j.can_use_in_service=true AND j.can_sell=false;
