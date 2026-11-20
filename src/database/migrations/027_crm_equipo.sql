-- MIGRACIÓN 027 — EQUIPO: REPARTO DE LEADS Y METAS (CRM)
-- Idempotente y transaccional. Aplica con: psql -f 027_crm_equipo.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Solo para inmobiliarias (espacio org):
--   crm_reparto: cómo se asignan los leads que se convierten en contactos.
--     manual   → a quien lo convierte (comportamiento anterior).
--     rotacion → al siguiente agente de la lista, por turnos.
--   crm_metas: objetivo mensual de cada agente por métrica.
BEGIN;

CREATE TABLE IF NOT EXISTS crm_reparto (
    organizacion_id INTEGER PRIMARY KEY REFERENCES organizaciones(id) ON DELETE CASCADE,
    modo VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (modo IN ('manual', 'rotacion')),
    -- Orden de la rotación (ids de usuario, miembros activos de la org).
    agentes INTEGER[] NOT NULL DEFAULT '{}',
    -- Índice del último agente que recibió un lead (−1 = ninguno aún).
    ultimo_indice INTEGER NOT NULL DEFAULT -1,
    actualizado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_metas (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    -- Primer día del mes (hora de Bogotá).
    mes DATE NOT NULL CHECK (EXTRACT(DAY FROM mes) = 1),
    metrica VARCHAR(30) NOT NULL CHECK (metrica IN (
        'visitas_realizadas', 'captaciones', 'oportunidades_ganadas', 'valor_ganado', 'contactos_nuevos')),
    objetivo BIGINT NOT NULL CHECK (objetivo > 0),
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm_metas_unica UNIQUE (organizacion_id, usuario_id, mes, metrica)
);

CREATE INDEX IF NOT EXISTS idx_crm_metas_org_mes ON crm_metas (organizacion_id, mes);

COMMIT;
