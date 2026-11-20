-- MIGRACIÓN 025 — CAPTACIÓN Y PROPIETARIOS (CRM)
-- Idempotente y transaccional. Aplica con: psql -f 025_crm_captaciones.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Una captación = el acuerdo con el propietario de un inmueble: tipo de
-- mandato, vigencia, comisión y precio pedido. Una por inmueble (se renueva
-- editándola). Los documentos (cédula, certificado de tradición, contrato…)
-- se guardan en S3 bajo un prefijo privado y SOLO se descargan a través del
-- backend; la tabla guarda la clave, nunca una URL pública.
BEGIN;

CREATE TABLE IF NOT EXISTS crm_captaciones (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_captaciones_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    propiedad_id INTEGER NOT NULL UNIQUE REFERENCES propiedades(id) ON DELETE CASCADE,
    propietario_id BIGINT REFERENCES crm_contactos(id) ON DELETE SET NULL,
    tipo_mandato VARCHAR(20) NOT NULL DEFAULT 'sin_exclusiva'
        CHECK (tipo_mandato IN ('exclusiva', 'compartida', 'sin_exclusiva')),
    inicio_el DATE,
    vence_el DATE,
    CONSTRAINT crm_captaciones_vigencia CHECK (inicio_el IS NULL OR vence_el IS NULL OR vence_el >= inicio_el),
    -- Comisión: porcentaje (0–100) o valor fijo en COP.
    comision_tipo VARCHAR(12) NOT NULL DEFAULT 'porcentaje'
        CHECK (comision_tipo IN ('porcentaje', 'valor')),
    comision_porcentaje NUMERIC(5, 2) CHECK (comision_porcentaje IS NULL OR comision_porcentaje BETWEEN 0 AND 100),
    comision_valor BIGINT CHECK (comision_valor IS NULL OR comision_valor >= 0),
    -- Lo que el propietario espera recibir (puede diferir del precio publicado).
    precio_propietario BIGINT CHECK (precio_propietario IS NULL OR precio_propietario >= 0),
    estado VARCHAR(20) NOT NULL DEFAULT 'activa'
        CHECK (estado IN ('en_captacion', 'activa', 'retirada', 'cerrada')),
    notas TEXT CHECK (notas IS NULL OR char_length(notas) <= 4000),
    asignado_a_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_captaciones_org
    ON crm_captaciones (organizacion_id, estado) WHERE organizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_captaciones_usuario
    ON crm_captaciones (usuario_id, estado) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_captaciones_propietario ON crm_captaciones (propietario_id);
-- Mandatos por vencer.
CREATE INDEX IF NOT EXISTS idx_crm_captaciones_vence
    ON crm_captaciones (vence_el) WHERE estado IN ('en_captacion', 'activa');

CREATE TABLE IF NOT EXISTS crm_captacion_documentos (
    id BIGSERIAL PRIMARY KEY,
    captacion_id BIGINT NOT NULL REFERENCES crm_captaciones(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL DEFAULT 'otro'
        CHECK (tipo IN ('cedula', 'certificado_tradicion', 'contrato_mandato', 'predial', 'paz_y_salvo', 'otro')),
    nombre_archivo VARCHAR(200) NOT NULL,
    s3_key VARCHAR(500) NOT NULL UNIQUE,
    mime VARCHAR(100) NOT NULL,
    tamano_bytes INTEGER NOT NULL CHECK (tamano_bytes > 0),
    subido_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_captacion_documentos_captacion
    ON crm_captacion_documentos (captacion_id);

COMMIT;
