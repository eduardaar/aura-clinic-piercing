ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_refresh_token_hash TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_refresh_valid_until TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS remember_access BOOLEAN NOT NULL DEFAULT true;
