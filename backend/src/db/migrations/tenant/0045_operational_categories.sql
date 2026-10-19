-- Cadastros independentes: classificação financeira e classificação do item.
-- Executado uma vez pelo ledger de migrations, preservando renomes/desativações.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE financial_categories ADD COLUMN IF NOT EXISTS usage_scope TEXT NOT NULL DEFAULT 'both'
  CHECK (usage_scope IN ('purchase', 'expense', 'both'));
ALTER TABLE inventory_options ADD COLUMN IF NOT EXISTS usage_scope TEXT NOT NULL DEFAULT 'both'
  CHECK (usage_scope IN ('product', 'material', 'both'));

UPDATE inventory_options SET usage_scope='product' WHERE type='category'
  AND name IN ('Labret', 'Segmento', 'Argola', 'Conector', 'Argolas', 'Barbell Reto',
    'Barbell Curvo', 'Nostril', 'Topo', 'Topos', 'Microdermal', 'Transversal', 'Surface', 'Ouro 14k', 'Ouro 18k');

INSERT INTO financial_categories (name, usage_scope) VALUES
  ('Aluguel', 'expense'), ('Energia elétrica', 'expense'), ('Água', 'expense'),
  ('Internet e telefone', 'expense'), ('Contabilidade', 'expense'),
  ('Salários e pagamentos de funcionários', 'expense'), ('Comissões profissionais', 'expense'),
  ('Impostos e taxas', 'expense'), ('Seguros', 'expense'), ('Assinaturas de sistemas e serviços', 'expense'),
  ('Compras de joias para revenda', 'purchase'), ('Reposição de estoque', 'purchase'),
  ('Materiais para perfuração', 'purchase'), ('Materiais de consumo', 'purchase'),
  ('Materiais de biossegurança e esterilização', 'purchase'), ('Materiais de limpeza', 'purchase'),
  ('Descartáveis e EPIs', 'purchase'), ('Embalagens e materiais auxiliares', 'purchase'),
  ('Equipamentos e ferramentas', 'purchase'), ('Manutenção de equipamentos', 'purchase'),
  ('Frete e entrega', 'purchase'), ('Outros materiais', 'purchase'),
  ('Marketing e publicidade', 'expense'), ('Manutenção e reparos', 'expense'),
  ('Transporte e deslocamento', 'expense'), ('Tarifas bancárias e taxas de pagamento', 'expense'),
  ('Cursos e capacitações', 'expense'), ('Despesas administrativas', 'expense'),
  ('Serviços contratados', 'expense'), ('Outras despesas', 'expense'), ('Outros', 'both')
ON CONFLICT (name) DO UPDATE SET usage_scope = EXCLUDED.usage_scope;

INSERT INTO inventory_options (type, name, description, is_active, usage_scope) VALUES
  ('category', 'Materiais para perfuração', '', 1, 'material'),
  ('category', 'Materiais de consumo', '', 1, 'material'),
  ('category', 'Materiais de biossegurança e esterilização', '', 1, 'material'),
  ('category', 'Materiais de limpeza', '', 1, 'material'),
  ('category', 'Descartáveis e EPIs', '', 1, 'material'),
  ('category', 'Embalagens e materiais auxiliares', '', 1, 'material'),
  ('category', 'Equipamentos e ferramentas', '', 1, 'material'),
  ('category', 'Outros materiais', '', 1, 'material')
ON CONFLICT (type, name) DO NOTHING;
