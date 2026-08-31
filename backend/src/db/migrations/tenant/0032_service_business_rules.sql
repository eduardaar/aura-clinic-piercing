-- Regras opcionais do catálogo único de serviço/variação.
-- NULL nas variações significa herdar a configuração do serviço principal.
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
UPDATE services SET is_active = (active_online_booking = 1) WHERE is_active IS DISTINCT FROM (active_online_booking = 1);
ALTER TABLE services ADD COLUMN IF NOT EXISTS minimum_age_years INTEGER CHECK (minimum_age_years BETWEEN 0 AND 120);
ALTER TABLE services ADD COLUMN IF NOT EXISTS requires_guardian BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS requires_signed_term BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS return_after_days INTEGER CHECK (return_after_days BETWEEN 1 AND 3650);
ALTER TABLE services ADD COLUMN IF NOT EXISTS scheduling_interval_minutes INTEGER NOT NULL DEFAULT 0 CHECK (scheduling_interval_minutes BETWEEN 0 AND 1440);
ALTER TABLE services ADD COLUMN IF NOT EXISTS minimum_advance_minutes INTEGER NOT NULL DEFAULT 0 CHECK (minimum_advance_minutes BETWEEN 0 AND 525600);
ALTER TABLE services ADD COLUMN IF NOT EXISTS postcare_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS postcare_days JSONB NOT NULL DEFAULT '[7,15,30]'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS aftercare_instructions TEXT;

ALTER TABLE procedures ADD COLUMN IF NOT EXISTS minimum_age_years INTEGER CHECK (minimum_age_years BETWEEN 0 AND 120);
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS requires_guardian BOOLEAN;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS requires_signed_term BOOLEAN;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS return_after_days INTEGER CHECK (return_after_days BETWEEN 1 AND 3650);
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS scheduling_interval_minutes INTEGER CHECK (scheduling_interval_minutes BETWEEN 0 AND 1440);
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS minimum_advance_minutes INTEGER CHECK (minimum_advance_minutes BETWEEN 0 AND 525600);
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS postcare_enabled BOOLEAN;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS postcare_days JSONB;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS available_online BOOLEAN;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_rules_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE appointment_items ADD COLUMN IF NOT EXISTS service_rules_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_services_active_online
  ON services(is_active, active_online_booking, name);
