ALTER TABLE order_logs
  ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP TABLE IF EXISTS teacher_inquiries;

INSERT INTO schema_migrations(version, name)
VALUES (3, 'structured audit records and inquiry removal')
ON CONFLICT (version) DO NOTHING;
