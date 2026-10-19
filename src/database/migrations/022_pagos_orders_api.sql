-- 022_pagos_orders_api.sql
-- Orders API (POST /v1/orders) reemplaza a /v1/payments para el cobro nuevo.
--   * mp_idempotency_key: X-Idempotency-Key persistida por intento; permite
--     reintentar el MISMO body sin duplicar el cobro y reconciliar tras un
--     timeout (misma fila -> misma key; token nuevo -> fila/key nueva).
--   * mp_transaction_id: id PAY… de transactions.payments[0] (el id ORD… se
--     guarda en mp_payment_id, que ya es TEXT desde la migración 021).
--   * estado 'expirado': intento que nunca llegó a MP (sin id ORD) y superó
--     la ventana de gracia. Nunca se marca 'rejected': no sabemos si cobró.
--   * estados 'refunded' / 'charged_back': se registran pero NUNCA activan.
-- Idempotente: se puede reaplicar.
BEGIN;

ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS mp_idempotency_key TEXT;
ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS mp_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_mp_idempotency_key
  ON pagos (mp_idempotency_key)
  WHERE mp_idempotency_key IS NOT NULL;

-- CHECK de estado: se reemplaza para admitir expirado/refunded/charged_back.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'pagos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%iniciado%'
  LOOP
    EXECUTE format('ALTER TABLE pagos DROP CONSTRAINT %I', con.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pagos'::regclass
      AND conname = 'pagos_estado_check'
  ) THEN
    ALTER TABLE pagos ADD CONSTRAINT pagos_estado_check
      CHECK (estado IN (
        'iniciado', 'pending', 'in_process', 'approved',
        'rejected', 'cancelled', 'expirado', 'refunded', 'charged_back'
      ));
  END IF;
END
$$;

COMMIT;
