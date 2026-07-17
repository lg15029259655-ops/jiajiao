ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rough_address TEXT;

UPDATE orders SET rough_address = area
WHERE NULLIF(btrim(rough_address), '') IS NULL;

ALTER TABLE orders
  ALTER COLUMN rough_address SET NOT NULL;

INSERT INTO schema_migrations(version, name)
VALUES (9, 'address privacy and required wechat')
ON CONFLICT (version) DO NOTHING;
