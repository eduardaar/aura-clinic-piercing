-- Vitrine comercial: categorias hierárquicas e campanhas temporárias.
--
-- São estruturas do catálogo público, separadas das categorias internas de
-- estoque (`inventory_options`) e das financeiras. Produtos entram por
-- relacionamento: nenhum cadastro, SKU, variação ou saldo é copiado.

CREATE TABLE IF NOT EXISTS catalog_categories (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 90),
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  image_alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_categories_slug ON catalog_categories(slug);
-- Mesmo nome só é recusado entre irmãs: "Titânio" pode existir em Argolas e em Labrets.
CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_categories_sibling_name ON catalog_categories(COALESCE(parent_id, 0), lower(trim(name)));
CREATE INDEX IF NOT EXISTS ix_catalog_categories_parent ON catalog_categories(parent_id, sort_order, id);

CREATE TABLE IF NOT EXISTS catalog_category_products (
  category_id INTEGER NOT NULL REFERENCES catalog_categories(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, product_id)
);
CREATE INDEX IF NOT EXISTS ix_catalog_category_products_product ON catalog_category_products(product_id);

-- `status` guarda a decisão do administrador; o estado exibido (agendada,
-- ativa, encerrada) é calculado pelo horário de início e fim.
CREATE TABLE IF NOT EXISTS catalog_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 90),
  summary TEXT NOT NULL DEFAULT '',
  banner_desktop_url TEXT NOT NULL DEFAULT '',
  banner_mobile_url TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  image_alt TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'ended')),
  display_position TEXT NOT NULL DEFAULT 'top' CHECK (display_position IN ('top', 'before_products')),
  priority INTEGER NOT NULL DEFAULT 0,
  show_on_home BOOLEAN NOT NULL DEFAULT true,
  show_in_nav BOOLEAN NOT NULL DEFAULT false,
  highlight_until TIMESTAMPTZ,
  promotion_id INTEGER REFERENCES catalog_promotions(id) ON DELETE SET NULL,
  ended_at TIMESTAMPTZ,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_campaigns_slug ON catalog_campaigns(slug);
CREATE INDEX IF NOT EXISTS ix_catalog_campaigns_public ON catalog_campaigns(status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS catalog_campaign_sections (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, slug)
);

CREATE TABLE IF NOT EXISTS catalog_campaign_products (
  campaign_id INTEGER NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES catalog_campaign_sections(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, product_id)
);
CREATE INDEX IF NOT EXISTS ix_catalog_campaign_products_product ON catalog_campaign_products(product_id);

-- Fuso horário da loja: as datas das campanhas são digitadas no horário local
-- da clínica e gravadas como instantes absolutos.
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
