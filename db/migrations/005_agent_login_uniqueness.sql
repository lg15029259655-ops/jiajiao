CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_phone_unique
  ON agents(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_wechat_unique
  ON agents(wechat) WHERE wechat IS NOT NULL AND wechat <> '';

INSERT INTO schema_migrations(version, name)
VALUES (5, 'unique agent login identities')
ON CONFLICT (version) DO NOTHING;
