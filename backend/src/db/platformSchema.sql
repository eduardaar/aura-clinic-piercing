-- Schema de controle da plataforma (multi-tenant).
-- Guarda o cadastro das clínicas (tenants) e os usuários do painel de
-- plataforma (super-admins). Cada clínica vive num schema próprio
-- ("tenant_<id>") criado no provisionamento. Idempotente.

CREATE SCHEMA IF NOT EXISTS platform;

-- Clínicas cadastradas na plataforma. O schema Postgres de cada uma é
-- derivado do id ("tenant_" || id) e nunca de input do usuário.
CREATE TABLE IF NOT EXISTS platform.tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso')),
  plan TEXT NOT NULL DEFAULT 'padrao',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usuários do painel de plataforma (super-admins). Separados dos usuários
-- das clínicas: tokens de plataforma não acessam tenants e vice-versa.
CREATE TABLE IF NOT EXISTS platform.platform_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'superadmin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
