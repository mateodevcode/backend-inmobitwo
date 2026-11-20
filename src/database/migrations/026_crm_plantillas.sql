-- MIGRACIÓN 026 — PLANTILLAS DE RESPUESTA (CRM, bandeja unificada)
-- Idempotente y transaccional. Aplica con: psql -f 026_crm_plantillas.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Respuestas rápidas para chat, WhatsApp y correo. Compartidas en el espacio
-- (toda la inmobiliaria las ve). Variables en el texto: {nombre}, {inmueble},
-- {agente}, {inmobiliaria}; el CRM las reemplaza al usarlas.
BEGIN;

CREATE TABLE IF NOT EXISTS crm_plantillas (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_plantillas_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    titulo VARCHAR(80) NOT NULL CHECK (char_length(titulo) >= 2),
    contenido TEXT NOT NULL CHECK (char_length(contenido) BETWEEN 2 AND 2000),
    usos INTEGER NOT NULL DEFAULT 0 CHECK (usos >= 0),
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_plantillas_org
    ON crm_plantillas (organizacion_id) WHERE organizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_plantillas_usuario
    ON crm_plantillas (usuario_id) WHERE usuario_id IS NOT NULL;

COMMIT;
