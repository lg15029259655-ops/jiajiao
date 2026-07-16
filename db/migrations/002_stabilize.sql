CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE orders
SET closed_at = COALESCE(closed_at, updated_at, now())
WHERE status IN ('completed', 'cancelled', 'deleted') AND closed_at IS NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending_review', 'active', 'paused', 'completed', 'cancelled', 'deleted'));

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ip_hash TEXT;

CREATE TABLE IF NOT EXISTS import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_text TEXT,
  parsed_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('ready', 'needs_review', 'published')),
  duplicate_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  published_order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number)
);

CREATE TABLE IF NOT EXISTS order_sequences (
  order_date DATE PRIMARY KEY,
  last_value INTEGER NOT NULL CHECK (last_value > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_public_listing
  ON orders(status, published_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_working_listing
  ON orders(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_closed_at
  ON orders(closed_at) WHERE closed_at IS NOT NULL AND anonymized_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_import_items_batch_status
  ON import_items(batch_id, review_status, row_number);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

INSERT INTO schema_migrations(version, name)
VALUES (2, 'stabilize application data model')
ON CONFLICT (version) DO NOTHING;
