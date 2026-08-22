-- Fluxos transacionais de compra, venda, agenda e ajuste registram quando o
-- saldo consolidado do produto mudou. Instalações antigas não possuíam a
-- coluna, embora as variações já mantivessem esse timestamp.
ALTER TABLE jewelry_inventory
  ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL
  DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS');
