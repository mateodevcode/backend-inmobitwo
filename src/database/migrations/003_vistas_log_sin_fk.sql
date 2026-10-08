-- MIGRACIÓN 003 — VISTAS_LOG SIN FK A PROPIEDADES
-- Idempotente y transaccional. Aplica con: psql -f 003_vistas_log_sin_fk.sql
-- El log es la fuente de verdad: debe sobrevivir al borrado del inmueble y
-- aceptar eventos cuya propiedad ya no existe (se registran con su motivo).
-- Solo se elimina la FK de vistas_log.propiedad_id; el resto (resumen,
-- identidades, agregado) conserva sus claves.
BEGIN;

ALTER TABLE IF EXISTS vistas_log
    DROP CONSTRAINT IF EXISTS vistas_log_propiedad_id_fkey;

COMMIT;
