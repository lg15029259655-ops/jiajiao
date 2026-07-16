CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE import_items
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_raw_text_similarity
  ON orders USING gin (raw_text gin_trgm_ops)
  WHERE raw_text IS NOT NULL;

INSERT INTO schema_migrations(version, name)
VALUES (4, 'import concurrency and duplicate similarity')
ON CONFLICT (version) DO NOTHING;
