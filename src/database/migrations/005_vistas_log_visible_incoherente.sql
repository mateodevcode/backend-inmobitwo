-- MIGRACIÓN 005 — MOTIVO visible_incoherente EN vistas_log
-- Idempotente y transaccional. Aplica con: psql -f 005_vistas_log_visible_incoherente.sql
-- El motivo es de agregado (sin fila), pero la lista cerrada del CHECK debe
-- conocerlo para no romper futuras escrituras ni herramientas de reporte.
BEGIN;

ALTER TABLE IF EXISTS vistas_log
    DROP CONSTRAINT IF EXISTS vistas_log_reason_check;

ALTER TABLE IF EXISTS vistas_log
    ADD CONSTRAINT vistas_log_reason_check CHECK (reason IN (
        'counted','evento_invalido','token_invalido','token_expirado',
        'token_reutilizado','tiempo_insuficiente','inmueble_inexistente',
        'inmueble_no_activo','sin_identidad','interno','bot',
        'rate_limit','duplicado','tope_diario','tope_ip',
        'visible_incoherente','error_sistema'));

COMMIT;
