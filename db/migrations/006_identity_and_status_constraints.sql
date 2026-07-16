UPDATE orders
SET status = 'deleted', close_reason = COALESCE(close_reason, '旧待审核记录迁入历史'),
    closed_at = COALESCE(closed_at, updated_at, now())
WHERE status = 'pending_review';

ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'deleted'));

CREATE OR REPLACE FUNCTION enforce_agent_login_identity_uniqueness()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  identities TEXT[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('agent-login-identities'));
  identities := ARRAY_REMOVE(ARRAY[NULLIF(NEW.account, ''), NULLIF(NEW.phone, ''), NULLIF(NEW.wechat, '')], NULL);
  IF (SELECT count(*) <> count(DISTINCT value) FROM unnest(identities) value) THEN
    RAISE EXCEPTION 'Agent login identities must be unique' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM agents a
    WHERE a.id <> NEW.id
      AND ARRAY_REMOVE(ARRAY[NULLIF(a.account, ''), NULLIF(a.phone, ''), NULLIF(a.wechat, '')], NULL) && identities
  ) THEN
    RAISE EXCEPTION 'Agent login identity conflicts with another account' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agents_login_identity_unique ON agents;
CREATE TRIGGER trg_agents_login_identity_unique
BEFORE INSERT OR UPDATE OF account, phone, wechat ON agents
FOR EACH ROW EXECUTE FUNCTION enforce_agent_login_identity_uniqueness();

INSERT INTO schema_migrations(version, name)
VALUES (6, 'cross-field login identity and five-state orders')
ON CONFLICT (version) DO NOTHING;
