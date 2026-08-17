ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS asaas_checkout_id TEXT;
ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS checkout_expires_at TIMESTAMPTZ;
ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS billing_suspended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS platform.billing_notifications (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES platform.tenant_invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, kind)
);

CREATE INDEX IF NOT EXISTS ix_billing_notifications_retry
  ON platform.billing_notifications (status, updated_at);
