-- Checklist e biossegurança são opt-in. Configuração vazia não altera o fluxo.
CREATE TABLE service_operational_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  checklist_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  biosafety_config JSONB NOT NULL DEFAULT '{"enabled":false,"required_fields":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO service_operational_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE services ADD COLUMN IF NOT EXISTS checklist_config JSONB;
ALTER TABLE services ADD COLUMN IF NOT EXISTS biosafety_config JSONB;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS checklist_config JSONB;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS biosafety_config JSONB;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS operational_requirements_snapshot JSONB NOT NULL DEFAULT '{"checklist":[],"biosafety":{"enabled":false,"required_fields":[]}}'::jsonb;
ALTER TABLE service_executions ADD COLUMN IF NOT EXISTS checklist_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE service_executions ADD COLUMN IF NOT EXISTS biosafety_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE service_execution_operational_revisions (
  id BIGSERIAL PRIMARY KEY,
  service_execution_id INTEGER NOT NULL REFERENCES service_executions(id) ON DELETE RESTRICT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  checklist_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  biosafety_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_execution_operational_history
  ON service_execution_operational_revisions(service_execution_id, recorded_at DESC);
