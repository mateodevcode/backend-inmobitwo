-- 021_mp_payment_id_text.sql
-- Orders API: los ids de orden/pago de MP son strings (ORD01.../PAY01...),
-- no caben en BIGINT. TEXT normaliza el almacenamiento.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pagos'
      AND column_name = 'mp_payment_id'
      AND data_type = 'bigint'
  ) THEN
    ALTER TABLE pagos
      ALTER COLUMN mp_payment_id TYPE TEXT
      USING mp_payment_id::TEXT;
  END IF;
END
$$;

COMMIT;
