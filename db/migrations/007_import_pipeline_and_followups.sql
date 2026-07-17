ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS start_time_text TEXT,
  ADD COLUMN IF NOT EXISTS lesson_frequency TEXT,
  ADD COLUMN IF NOT EXISTS lesson_duration TEXT,
  ADD COLUMN IF NOT EXISTS teacher_gender_requirement TEXT,
  ADD COLUMN IF NOT EXISTS teacher_education_requirement TEXT,
  ADD COLUMN IF NOT EXISTS locked_by_agent_id UUID REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_follow_up_at TIMESTAMPTZ;

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'reviewing',
  ADD COLUMN IF NOT EXISTS processed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_processed_row INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_status_check
  CHECK (status IN ('queued', 'processing', 'reviewing', 'publishing', 'completed', 'failed'));

ALTER TABLE import_items
  ADD COLUMN IF NOT EXISTS field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS field_sources JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS error_category TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_lock_follow_up
  ON orders(lock_follow_up_at) WHERE status = 'paused' AND lock_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_stale_active
  ON orders(updated_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_import_items_fingerprint
  ON import_items(content_fingerprint) WHERE content_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_import_batches_progress
  ON import_batches(status, updated_at DESC);

INSERT INTO schema_migrations(version, name)
VALUES (7, 'structured imports, resumable progress and follow-up reminders')
ON CONFLICT (version) DO NOTHING;
