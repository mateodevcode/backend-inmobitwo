-- MIGRACIÓN 030 — AVISOS DEL CRM POR CORREO
-- Idempotente y transaccional. Aplica con: psql -f 030_crm_avisos_correo.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- correo_enviado_at: cuándo salió el aviso en el resumen por correo (NULL =
-- pendiente). Los avisos que ya existían al crear la columna se marcan como
-- enviados para no mandar el atraso. crm_preferencias_avisos guarda si cada
-- usuario quiere recibirlos por correo (sin fila = sí).
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'crm_notificaciones' AND column_name = 'correo_enviado_at'
    ) THEN
        ALTER TABLE crm_notificaciones ADD COLUMN correo_enviado_at TIMESTAMPTZ;
        UPDATE crm_notificaciones SET correo_enviado_at = created_at;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_notificaciones_correo_pendiente
    ON crm_notificaciones (created_at)
    WHERE correo_enviado_at IS NULL AND leida_at IS NULL;

CREATE TABLE IF NOT EXISTS crm_preferencias_avisos (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    correo BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
