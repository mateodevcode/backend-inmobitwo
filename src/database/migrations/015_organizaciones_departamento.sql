-- MIGRACIÓN 015 — organizaciones.provincia → departamento (Colombia)
-- Idempotente y transaccional. Aplica con: psql -f 015_organizaciones_departamento.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
BEGIN;

ALTER TABLE IF EXISTS organizaciones
    RENAME COLUMN provincia TO departamento;

COMMIT;
