-- MIGRACIÓN 031 — SUSCRIPCIONES PUSH POR APLICACIÓN
-- Idempotente y transaccional. Aplica con: psql -f 031_push_app.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- push_subscriptions la usan el portal (búsquedas guardadas) y el CRM (avisos).
-- Cada navegador se suscribe desde un origen distinto, así que cada fila dice
-- de qué aplicación es para mandar cada aviso solo a donde corresponde.
-- Las filas que ya existían son del portal.
BEGIN;

ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS app VARCHAR(10) NOT NULL DEFAULT 'portal';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_app_check') THEN
        ALTER TABLE push_subscriptions
            ADD CONSTRAINT push_subscriptions_app_check CHECK (app IN ('portal', 'crm'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_push_subs_usuario_app ON push_subscriptions (usuario_id, app);

COMMIT;
