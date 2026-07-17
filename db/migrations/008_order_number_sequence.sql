CREATE SEQUENCE IF NOT EXISTS order_number_seq AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  NO CYCLE;

DO $$
DECLARE
  max_existing BIGINT;
  current_sequence BIGINT;
  sequence_called BOOLEAN;
BEGIN
  SELECT COALESCE(MAX(substring(order_no FROM 3)::BIGINT), 0)
  INTO max_existing
  FROM orders
  WHERE order_no ~ '^XJ[0-9]+$';

  SELECT last_value, is_called INTO current_sequence, sequence_called FROM order_number_seq;
  IF max_existing > current_sequence
    OR (max_existing > 0 AND max_existing = current_sequence AND NOT sequence_called) THEN
    PERFORM setval('order_number_seq', max_existing, TRUE);
  END IF;
END $$;

COMMENT ON SEQUENCE order_number_seq IS
  'Global, non-cycling source for system-generated XJ order numbers';

INSERT INTO schema_migrations(version, name)
VALUES (8, 'global non-cycling order number sequence')
ON CONFLICT (version) DO NOTHING;
