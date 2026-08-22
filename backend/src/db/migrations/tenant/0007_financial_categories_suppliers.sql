-- Cadastro de verdade para categoria financeira (hoje era texto livre em
-- Contas a Receber e uma lista fixa embutida no código em Contas a Pagar —
-- as duas telas divergiam) e para fornecedor (não existia; só um campo de
-- categoria chamado "Fornecedores" e uma dica pra digitar o nome nas
-- observações). Mesma estrutura simples de platform.financial_cost_centers,
-- que já resolve isso bem para centro de custo.
CREATE TABLE IF NOT EXISTS financial_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

-- Semente: a lista que hoje só existe hardcoded no frontend (Payables.jsx),
-- pra ninguém perder as opções que já usava.
INSERT INTO financial_categories (name) VALUES
  ('Aluguel'), ('Água'), ('Energia elétrica'), ('Internet e telefone'), ('Fornecedores'),
  ('Empréstimo'), ('Impostos e taxas'), ('Marketing'), ('Manutenção'), ('Salários'), ('Outros')
ON CONFLICT (name) DO NOTHING;

-- Backfill: qualquer categoria já usada em lançamentos reais que não esteja
-- na semente acima também vira uma opção do cadastro — sem isso, lançamentos
-- antigos ficariam com uma categoria "invisível" para o novo seletor.
INSERT INTO financial_categories (name)
SELECT DISTINCT NULLIF(TRIM(category), '') FROM financial_entries WHERE NULLIF(TRIM(category), '') IS NOT NULL
ON CONFLICT (name) DO NOTHING;

INSERT INTO financial_categories (name)
SELECT DISTINCT NULLIF(TRIM(category), '') FROM expenses WHERE NULLIF(TRIM(category), '') IS NOT NULL
ON CONFLICT (name) DO NOTHING;
