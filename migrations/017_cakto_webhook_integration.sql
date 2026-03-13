ALTER TABLE subscriptions ADD COLUMN external_order_id TEXT;
ALTER TABLE subscriptions ADD COLUMN external_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN customer_email TEXT;
ALTER TABLE subscriptions ADD COLUMN checkout_url TEXT;
ALTER TABLE subscriptions ADD COLUMN product_id TEXT;
ALTER TABLE subscriptions ADD COLUMN started_at TEXT;
ALTER TABLE subscriptions ADD COLUMN expires_at TEXT;
ALTER TABLE subscriptions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_external_order_unique
ON subscriptions(external_order_id)
WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_email
ON subscriptions(customer_email);

CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at
ON subscriptions(expires_at);

CREATE TABLE IF NOT EXISTS cakto_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  external_order_id TEXT,
  identified_user_id TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  payload_json TEXT NOT NULL,
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cakto_webhook_events_status
ON cakto_webhook_events(status);

CREATE INDEX IF NOT EXISTS idx_cakto_webhook_events_external_order
ON cakto_webhook_events(external_order_id);

CREATE INDEX IF NOT EXISTS idx_cakto_webhook_events_identified_user
ON cakto_webhook_events(identified_user_id);
