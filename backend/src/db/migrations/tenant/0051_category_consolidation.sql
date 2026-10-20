-- Keep the original category rows inactive and retain all historical snapshots.
CREATE TABLE IF NOT EXISTS inventory_category_consolidations (
  id SERIAL PRIMARY KEY, source_category_id INTEGER NOT NULL, target_category_id INTEGER NOT NULL,
  source_name TEXT NOT NULL, target_name TEXT NOT NULL, moved_items INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(source_category_id,target_category_id)
);
DO $$
DECLARE pair RECORD; source RECORD; target RECORD; moved INTEGER;
BEGIN
  FOR pair IN SELECT * FROM (VALUES ('Argola','Argolas'),('Topos','Topo'),('Material de consumo','Materiais de consumo')) AS aliases(old_name,official_name)
  LOOP
    SELECT * INTO source FROM inventory_options WHERE type='category' AND name=pair.old_name;
    SELECT * INTO target FROM inventory_options WHERE type='category' AND name=pair.official_name AND is_active=1;
    IF source.id IS NOT NULL AND target.id IS NOT NULL THEN
      UPDATE jewelry_inventory SET category=target.name,category_id=target.id WHERE category=source.name OR category_id=source.id;
      GET DIAGNOSTICS moved=ROW_COUNT;
      INSERT INTO inventory_category_consolidations(source_category_id,target_category_id,source_name,target_name,moved_items)
      VALUES(source.id,target.id,source.name,target.name,moved) ON CONFLICT DO NOTHING;
      UPDATE inventory_options SET is_active=0 WHERE id=source.id;
    END IF;
  END LOOP;
  FOR source IN SELECT o.*, min(id) OVER (PARTITION BY usage_scope,translate(lower(trim(name)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')) AS official_id
    FROM inventory_options o WHERE type='category' AND is_active=1
  LOOP
    IF source.id<>source.official_id THEN
      SELECT * INTO target FROM inventory_options WHERE id=source.official_id;
      UPDATE jewelry_inventory SET category=target.name,category_id=target.id WHERE category=source.name OR category_id=source.id;
      GET DIAGNOSTICS moved=ROW_COUNT;
      INSERT INTO inventory_category_consolidations(source_category_id,target_category_id,source_name,target_name,moved_items)
      VALUES(source.id,target.id,source.name,target.name,moved) ON CONFLICT DO NOTHING;
      UPDATE inventory_options SET is_active=0 WHERE id=source.id;
    END IF;
  END LOOP;
END $$;
