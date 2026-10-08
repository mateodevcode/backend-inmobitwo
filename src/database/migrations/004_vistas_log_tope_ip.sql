-- MIGRACIÓN 004 — MOTIVO tope_ip EN vistas_log
-- Idempotente y transaccional. Aplica con: psql -f 004_vistas_log_tope_ip.sql
-- El Lua distingue el tope por IP (tope_ip) del tope por visitante
-- (tope_diario). Sin este motivo el CHECK rechazaría esas filas.
BEGIN;

ALTER TABLE IF EXISTS vistas_log
    DROP CONSTRAINT IF EXISTS vistas_log_reason_check;

ALTER TABLE IF EXISTS vistas_log
    ADD CONSTRAINT vistas_log_reason_check CHECK (reason IN (
        'counted','evento_invalido','token_invalido','token_expirado',
        'token_reutilizado','tiempo_insuficiente','inmueble_inexistente',
        'inmueble_no_activo','sin_identidad','interno','bot',
        'rate_limit','duplicado','tope_diario','tope_ip','error_sistema'));

COMMIT;
