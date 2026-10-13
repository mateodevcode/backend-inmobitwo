-- MIGRACIÓN 016 — código de operación arriendo → alquiler (Colombia)
-- Idempotente y transaccional. Aplica con: psql -f 016_operacion_alquiler.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
-- Los listados usan operation_type_id (FK), así que el renombre no los toca.
BEGIN;

UPDATE operation_types SET code = 'alquiler', label_es = 'Alquiler'
    WHERE code = 'arriendo';
UPDATE operation_types SET code = 'alquiler_venta', label_es = 'Alquiler con opción a compra'
    WHERE code = 'arriendo_venta';

-- Búsquedas guardadas: filtros JSONB con la operación antigua
UPDATE saved_searches
    SET filtros = replace(replace(filtros::text, '"arriendo_venta"', '"alquiler_venta"'), '"arriendo"', '"alquiler"')::jsonb
    WHERE filtros::text LIKE '%arriendo%';

COMMIT;
