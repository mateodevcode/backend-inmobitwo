-- MIGRACIÓN 024 — DEMANDAS Y CRUCE (CRM)
-- Idempotente y transaccional. Aplica con: psql -f 024_crm_demandas.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Una demanda = lo que busca un contacto (comprador o arrendatario). El CRM
-- la cruza con los inmuebles (cartera propia o portal) y lleva el registro de
-- qué inmuebles ya se le enviaron o descartó.
BEGIN;

CREATE TABLE IF NOT EXISTS crm_demandas (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_demandas_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    contacto_id BIGINT NOT NULL REFERENCES crm_contactos(id) ON DELETE CASCADE,
    -- Solo venta o alquiler: una oferta "alquiler_venta" coincide con ambas.
    operation_type_id SMALLINT NOT NULL REFERENCES operation_types(id),
    -- Vacío = cualquier tipo / ciudad / barrio / estrato.
    property_type_ids SMALLINT[] NOT NULL DEFAULT '{}',
    city_ids INTEGER[] NOT NULL DEFAULT '{}',
    barrio_ids INTEGER[] NOT NULL DEFAULT '{}',
    estratos SMALLINT[] NOT NULL DEFAULT '{}',
    precio_min BIGINT CHECK (precio_min IS NULL OR precio_min >= 0),
    precio_max BIGINT CHECK (precio_max IS NULL OR precio_max >= 0),
    CONSTRAINT crm_demandas_precio CHECK (precio_min IS NULL OR precio_max IS NULL OR precio_max >= precio_min),
    habitaciones_min SMALLINT CHECK (habitaciones_min IS NULL OR habitaciones_min BETWEEN 0 AND 20),
    banos_min SMALLINT CHECK (banos_min IS NULL OR banos_min BETWEEN 0 AND 20),
    parqueaderos_min SMALLINT CHECK (parqueaderos_min IS NULL OR parqueaderos_min BETWEEN 0 AND 20),
    area_min INTEGER CHECK (area_min IS NULL OR area_min >= 0),
    area_max INTEGER CHECK (area_max IS NULL OR area_max >= 0),
    notas TEXT CHECK (notas IS NULL OR char_length(notas) <= 4000),
    estado VARCHAR(20) NOT NULL DEFAULT 'activa'
        CHECK (estado IN ('activa', 'pausada', 'cerrada')),
    -- Aviso por correo de inmuebles nuevos que coinciden (job diario).
    avisar BOOLEAN NOT NULL DEFAULT true,
    -- Inmuebles creados después de esta marca cuentan como "nuevos".
    coincidencias_vistas_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notificado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    asignado_a_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_demandas_org
    ON crm_demandas (organizacion_id, estado) WHERE organizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_demandas_usuario
    ON crm_demandas (usuario_id, estado) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_demandas_contacto ON crm_demandas (contacto_id);
CREATE INDEX IF NOT EXISTS idx_crm_demandas_asignado ON crm_demandas (asignado_a_id);

-- Seguimiento inmueble ↔ demanda: enviado al cliente o descartado.
CREATE TABLE IF NOT EXISTS crm_demanda_propiedades (
    demanda_id BIGINT NOT NULL REFERENCES crm_demandas(id) ON DELETE CASCADE,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('enviada', 'descartada')),
    autor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (demanda_id, propiedad_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_demanda_propiedades_propiedad
    ON crm_demanda_propiedades (propiedad_id);

COMMIT;
