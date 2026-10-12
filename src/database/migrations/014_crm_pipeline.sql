-- MIGRACIÓN 014 — PIPELINE CRM (etapas, oportunidades)
-- Idempotente y transaccional. Aplica con: psql -f 014_crm_pipeline.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Las etapas se siembran por espacio en el backend la primera vez que se usa
-- (Prospecto → Contactado → Interesado → Visita → Oferta → Negociando → Ganado → Perdido).
BEGIN;

-- ────────────────────────────────────────────────────────────────
-- crm_etapas
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_etapas (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_etapas_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    nombre VARCHAR(100) NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0,
    color VARCHAR(20),
    probabilidad_default INTEGER NOT NULL DEFAULT 50 CHECK (probabilidad_default BETWEEN 0 AND 100),
    tipo VARCHAR(20) NOT NULL DEFAULT 'abierta'
        CHECK (tipo IN ('abierta', 'ganada', 'perdida')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_etapas_org_orden
    ON crm_etapas (organizacion_id, orden) WHERE organizacion_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_etapas_user_orden
    ON crm_etapas (usuario_id, orden) WHERE usuario_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- crm_oportunidades
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_oportunidades (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_oportunidades_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    contacto_id BIGINT NOT NULL REFERENCES crm_contactos(id) ON DELETE CASCADE,
    propiedad_id INTEGER REFERENCES propiedades(id) ON DELETE SET NULL,
    etapa_id BIGINT NOT NULL REFERENCES crm_etapas(id) ON DELETE RESTRICT,
    titulo VARCHAR(200) NOT NULL,
    valor BIGINT CHECK (valor IS NULL OR valor >= 0),
    probabilidad INTEGER NOT NULL DEFAULT 50 CHECK (probabilidad BETWEEN 0 AND 100),
    estado VARCHAR(20) NOT NULL DEFAULT 'abierta'
        CHECK (estado IN ('abierta', 'ganada', 'perdida')),
    motivo_perdida VARCHAR(300),
    cierre_estimado DATE,
    posicion INTEGER NOT NULL DEFAULT 0,
    asignado_a_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    cerrada_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_oport_etapa
    ON crm_oportunidades (etapa_id, posicion) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS idx_crm_oport_contacto
    ON crm_oportunidades (contacto_id);
CREATE INDEX IF NOT EXISTS idx_crm_oport_org
    ON crm_oportunidades (organizacion_id) WHERE organizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_oport_user
    ON crm_oportunidades (usuario_id) WHERE usuario_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- FKs diferidas de fase 2 (oportunidad_id era BIGINT sin FK)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE crm_actividades DROP CONSTRAINT IF EXISTS crm_actividades_oportunidad_fk;
ALTER TABLE crm_actividades
    ADD CONSTRAINT crm_actividades_oportunidad_fk
    FOREIGN KEY (oportunidad_id) REFERENCES crm_oportunidades(id) ON DELETE CASCADE;

ALTER TABLE crm_tareas DROP CONSTRAINT IF EXISTS crm_tareas_oportunidad_fk;
ALTER TABLE crm_tareas
    ADD CONSTRAINT crm_tareas_oportunidad_fk
    FOREIGN KEY (oportunidad_id) REFERENCES crm_oportunidades(id) ON DELETE CASCADE;

COMMIT;
