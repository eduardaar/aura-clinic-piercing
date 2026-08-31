-- Perfis reutilizaveis de acesso e trilha central de auditoria.
CREATE TABLE IF NOT EXISTS access_profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  base_role TEXT NOT NULL DEFAULT 'reception',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_profiles_base_role_check
    CHECK (base_role IN ('piercer', 'reception', 'finance'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_access_profiles_name
  ON access_profiles (lower(name));

CREATE TABLE IF NOT EXISTS access_profile_permissions (
  profile_id INTEGER NOT NULL REFERENCES access_profiles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, permission)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS access_profile_id INTEGER REFERENCES access_profiles(id) ON DELETE SET NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_access_profile ON users(access_profile_id);
CREATE INDEX IF NOT EXISTS idx_users_professional ON users(professional_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  actor_email TEXT,
  actor_role TEXT,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB,
  severity TEXT NOT NULL DEFAULT 'info',
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_severity_check
    CHECK (severity IN ('info', 'warning', 'critical'))
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_module ON audit_events(module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at DESC);
