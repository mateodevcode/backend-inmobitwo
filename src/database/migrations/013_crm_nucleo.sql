-- MIGRACIÓN 013 — NÚCLEO CRM (contactos, actividades, tareas)
-- Idempotente y transaccional. Aplica con: psql -f 013_crm_nucleo.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Todas las tablas crm_* llevan dueño de espacio: exactamente uno de
-- organizacion_id / usuario_id (CHECK num_nonnulls = 1).
-- Moneda (presupuestos): BIGINT. Timestamps: TIMESTAMPTZ.
-- oportunidad_id queda como BIGINT sin FK: la FK se añade en 014 (pipeline).
BEGIN;

-- ────────────────────────────────────────────────────────────────
-- crm_contactos
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_contactos (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_contactos_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    nombre VARCHAR(200) NOT NULL,
    email VARCHAR(200),
    telefono VARCHAR(30),
    tipo VARCHAR(30) NOT NULL DEFAULT 'otro'
        CHECK (tipo IN ('comprador', 'vendedor', 'arrendatario', 'inversor', 'otro')),
    origen VARCHAR(30) NOT NULL DEFAULT 'manual'
        CHECK (origen IN ('manual', 'portal', 'chat', 'importacion')),
    presupuesto_min BIGINT CHECK (presupuesto_min IS NULL OR presupuesto_min >= 0),
    presupuesto_max BIGINT CHECK (presupuesto_max IS NULL OR presupuesto_max >= 0),
    zona_interes VARCHAR(200),
    preferencias JSONB NOT NULL DEFAULT '{}',
    etiquetas TEXT[] NOT NULL DEFAULT '{}',
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    asignado_a_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    autorizacion_datos_at TIMESTAMPTZ,
    autorizacion_origen VARCHAR(50),
    archivado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unicidad por espacio + email (ignora archivados y nulos)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contactos_org_email
    ON crm_contactos (organizacion_id, lower(email))
    WHERE archivado_at IS NULL AND email IS NOT NULL AND organizacion_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contactos_user_email
    ON crm_contactos (usuario_id, lower(email))
    WHERE archivado_at IS NULL AND email IS NOT NULL AND usuario_id IS NOT NULL;
-- Unicidad por espacio + teléfono normalizado
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contactos_org_tel
    ON crm_contactos (organizacion_id, telefono)
    WHERE archivado_at IS NULL AND telefono IS NOT NULL AND organizacion_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contactos_user_tel
    ON crm_contactos (usuario_id, telefono)
    WHERE archivado_at IS NULL AND telefono IS NOT NULL AND usuario_id IS NOT NULL;
-- Un lead genera como máximo un contacto por espacio (idempotencia)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contactos_org_lead
    ON crm_contactos (organizacion_id, lead_id)
    WHERE archivado_at IS NULL AND lead_id IS NOT NULL AND organizacion_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contactos_user_lead
    ON crm_contactos (usuario_id, lead_id)
    WHERE archivado_at IS NULL AND lead_id IS NOT NULL AND usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contactos_org ON crm_contactos (organizacion_id) WHERE archivado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contactos_user ON crm_contactos (usuario_id) WHERE archivado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contactos_asignado ON crm_contactos (asignado_a_id) WHERE archivado_at IS NULL;

-- ────────────────────────────────────────────────────────────────
-- crm_actividades
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_actividades (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_actividades_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    contacto_id BIGINT NOT NULL REFERENCES crm_contactos(id) ON DELETE CASCADE,
    oportunidad_id BIGINT,
    propiedad_id INTEGER REFERENCES propiedades(id) ON DELETE SET NULL,
    tipo VARCHAR(30) NOT NULL
        CHECK (tipo IN ('nota', 'llamada', 'email', 'whatsapp', 'visita', 'reunion', 'cambio_etapa', 'sistema')),
    contenido TEXT CHECK (contenido IS NULL OR char_length(contenido) <= 4000),
    resultado VARCHAR(200),
    duracion_min INTEGER CHECK (duracion_min IS NULL OR duracion_min >= 0),
    ocurrio_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    autor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_actividades_contacto
    ON crm_actividades (contacto_id, ocurrio_at DESC);

-- ────────────────────────────────────────────────────────────────
-- crm_tareas
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_tareas (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_tareas_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    contacto_id BIGINT REFERENCES crm_contactos(id) ON DELETE CASCADE,
    oportunidad_id BIGINT,
    titulo VARCHAR(200) NOT NULL,
    descripcion TEXT,
    prioridad VARCHAR(20) NOT NULL DEFAULT 'media'
        CHECK (prioridad IN ('baja', 'media', 'alta')),
    vence_at TIMESTAMPTZ,
    completada_at TIMESTAMPTZ,
    asignado_a_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tareas_pendientes
    ON crm_tareas (asignado_a_id, vence_at) WHERE completada_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_tareas_contacto
    ON crm_tareas (contacto_id) WHERE contacto_id IS NOT NULL;

COMMIT;
