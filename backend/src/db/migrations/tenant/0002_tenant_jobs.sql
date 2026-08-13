-- Fila persistente por clínica para trabalho que não deve bloquear HTTP.
-- JSONB guarda apenas parâmetros de execução e metadados do resultado; nunca
-- credenciais, tokens de sessão ou dados brutos de cartão.
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

-- Uma repetição do mesmo pedido devolve o job original, inclusive quando há
-- dois requests concorrentes. O índice só vale para chaves informadas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_background_jobs_idempotency
  ON background_jobs(type, requested_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Claim da fila: encontra pendências sem varrer histórico completo.
CREATE INDEX IF NOT EXISTS ix_background_jobs_claim
  ON background_jobs(status, available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS ix_background_jobs_recent
  ON background_jobs(created_at DESC, id DESC);
