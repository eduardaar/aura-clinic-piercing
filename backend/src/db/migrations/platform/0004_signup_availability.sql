-- Registro imutável do e-mail que abriu a clínica. O e-mail de cobrança fica
-- em `platform.tenants.email` e pode mudar, portanto não serve para impedir
-- que o mesmo administrador crie duas contas por engano.
ALTER TABLE platform.tenants
  ADD COLUMN IF NOT EXISTS signup_admin_email TEXT;

-- Backfill conservador: cada schema antigo informa o primeiro admin. Caso o
-- mesmo e-mail apareça em mais de uma clínica antiga, só o primeiro é marcado;
-- isso já basta para impedir outro cadastro com aquele e-mail sem alterar os
-- usuários legados, que continuaram válidos no modelo anterior.
DO $$
DECLARE
  tenant_record RECORD;
  admin_email TEXT;
BEGIN
  FOR tenant_record IN
    SELECT id
      FROM platform.tenants
     WHERE signup_admin_email IS NULL
     ORDER BY id
  LOOP
    admin_email := NULL;
    BEGIN
      EXECUTE format(
        'SELECT lower(email) FROM %I.users WHERE role = ''admin'' ORDER BY id LIMIT 1',
        format('tenant_%s', tenant_record.id)
      ) INTO admin_email;
    EXCEPTION WHEN undefined_table THEN
      -- Tenant legado incompleto: o provisionamento atual continua sendo a
      -- fonte de verdade para todos os próximos cadastros.
      admin_email := NULL;
    END;

    IF admin_email IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM platform.tenants AS existing
          WHERE lower(existing.signup_admin_email) = admin_email
       ) THEN
      UPDATE platform.tenants
         SET signup_admin_email = admin_email
       WHERE id = tenant_record.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_signup_admin_email
  ON platform.tenants (lower(signup_admin_email))
  WHERE signup_admin_email IS NOT NULL;
