-- Configuração SMTP global da plataforma. A senha nunca é armazenada em claro:
-- services/smtpVault.js cifra com AES-256-GCM antes desta tabela receber o valor.
CREATE TABLE IF NOT EXISTS platform.smtp_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
  secure BOOLEAN NOT NULL DEFAULT false,
  require_tls BOOLEAN NOT NULL DEFAULT true,
  username TEXT,
  password_encrypted TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL DEFAULT '',
  reply_to TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by INTEGER REFERENCES platform.platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
