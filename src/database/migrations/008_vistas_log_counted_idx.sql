-- MIGRACIÓN 008 — ÍNDICE PARCIAL PARA CONSOLIDACIÓN DE VISTAS
-- Idempotente y transaccional. Aplica con: psql -f 008_vistas_log_counted_idx.sql
-- La consolidación (job cada 5 min) solo lee eventos counted recientes; el
-- índice parcial evita escanear todos los rechazos.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_vistas_log_prop_fecha_counted
    ON vistas_log (propiedad_id, fecha_local)
    WHERE result = 'counted';

COMMIT;
