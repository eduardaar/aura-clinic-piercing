-- Grade comercial definida para o lançamento de agosto/2026.
-- Atualiza a fonte de verdade usada pela vitrine e por novas cobranças.
UPDATE platform.subscription_plans
   SET price_cents = CASE code
     WHEN 'start' THEN 3990
     WHEN 'profissional' THEN 6990
     WHEN 'studio' THEN 11990
     ELSE price_cents
   END,
       updated_at = now()
 WHERE code IN ('start', 'profissional', 'studio');
