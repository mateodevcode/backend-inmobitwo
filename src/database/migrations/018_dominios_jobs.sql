-- MIGRACIÓN 018 — JOBS DE DOMINIOS (ejecución remota en el VPS)
-- Idempotente y transaccional. Aplica con: psql -f 018_dominios_jobs.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Cada ejecución de agregar/quitar dominio desde el CRM deja un job con su
-- log, para seguimiento en vivo y auditoría. Solo el superadmin los crea.
BEGIN;

CREATE TABLE IF NOT EXISTS dominios_jobs (
    id BIGSERIAL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('agregar', 'quitar')),
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE SET NULL,
    dominio VARCHAR(253) NOT NULL,
    con_www BOOLEAN NOT NULL DEFAULT TRUE,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'ejecutando', 'ok', 'fallo')),
    log TEXT NOT NULL DEFAULT '',
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dominios_jobs_org
    ON dominios_jobs (organizacion_id);
CREATE INDEX IF NOT EXISTS idx_dominios_jobs_estado
    ON dominios_jobs (estado) WHERE estado IN ('pendiente', 'ejecutando');

COMMIT;
