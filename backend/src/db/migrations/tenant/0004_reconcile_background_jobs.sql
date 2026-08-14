-- Reconcilia instalações cujo ledger registra 0002, mas a estrutura física da
-- fila foi perdida ou ficou parcial. O runner valida a estrutura ainda dentro
-- da operação atômica; definição incompatível desfaz integralmente a mudança.
CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('report_export', 'aura_jewelry_import', 'asaas_reconcile')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_hash TEXT NOT NULL,
  result JSONB,
  idempotency_key TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'queued';
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS requested_by INTEGER;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_type_check
    CHECK (type IN ('report_export', 'aura_jewelry_import', 'asaas_reconcile'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_attempts_check CHECK (attempts >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 10);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE background_jobs ALTER COLUMN type SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN status SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN payload SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN request_hash SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN attempts SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN max_attempts SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN available_at SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE background_jobs ALTER COLUMN updated_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_background_jobs_idempotency
  ON background_jobs(type, requested_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_background_jobs_claim
  ON background_jobs(status, available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS ix_background_jobs_recent
  ON background_jobs(created_at DESC, id DESC);
