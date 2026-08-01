-- ============================================================================
-- MIGRACIÓN: Sistema de imágenes multi-tamaño (thumbnail → xlarge) + Portada unificada
-- Versión: 1.0
-- Fecha: 2026-07-31
-- ============================================================================
-- Orden: ejecutar en el orden en que aparecen los bloques.
-- Cada bloque es idempotente (usa IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- ============================================================================
-- 1.1 Agregar columnas nuevas a propiedades_galeria
-- ============================================================================
ALTER TABLE propiedades_galeria
    ADD COLUMN IF NOT EXISTS tamaño VARCHAR(20),
    ADD COLUMN IF NOT EXISTS es_portada BOOLEAN DEFAULT false NOT NULL;

-- Las filas que ya existen (creadas antes de esta migración) no tienen forma
-- de saber su tamaño real porque el controller solo guardaba una URL
-- (thumbnail o medium, según el fallback). Las marcamos como 'medium' por
-- default ya que era el fallback más común en el código viejo.
UPDATE propiedades_galeria SET tamaño = 'medium' WHERE tamaño IS NULL;

ALTER TABLE propiedades_galeria
    ALTER COLUMN tamaño SET NOT NULL;

ALTER TABLE propiedades_galeria
    ADD CONSTRAINT tamano_galeria_valido
    CHECK (tamaño IN ('thumbnail', 'small', 'medium', 'large', 'xlarge'));

-- ============================================================================
-- 1.2 Agregar columna nueva a propiedades_planos (mismo patrón, sin es_portada)
-- ============================================================================
ALTER TABLE propiedades_planos
    ADD COLUMN IF NOT EXISTS tamaño VARCHAR(20);

UPDATE propiedades_planos SET tamaño = 'medium' WHERE tamaño IS NULL;

ALTER TABLE propiedades_planos
    ALTER COLUMN tamaño SET NOT NULL;

ALTER TABLE propiedades_planos
    ADD CONSTRAINT tamano_planos_valido
    CHECK (tamaño IN ('thumbnail', 'small', 'medium', 'large', 'xlarge'));

-- ============================================================================
-- 1.3 Migrar la portada actual (propiedades.imagen_principal_url) hacia propiedades_galeria
-- ============================================================================
INSERT INTO propiedades_galeria (propiedad_id, orden, tamaño, es_portada, url, public_id)
SELECT
    id AS propiedad_id,
    -1 AS orden,
    'medium' AS tamaño,
    true AS es_portada,
    imagen_principal_url AS url,
    imagen_principal_public_id AS public_id
FROM propiedades
WHERE imagen_principal_url IS NOT NULL
  AND imagen_principal_url != '';

-- ============================================================================
-- 1.4 Índice único: solo una portada por tamaño, por propiedad
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_una_portada_por_tamano
ON propiedades_galeria (propiedad_id, tamaño)
WHERE es_portada = true;

-- ============================================================================
-- 1.5 Índices de apoyo para las consultas nuevas
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_galeria_propiedad_tamano ON propiedades_galeria(propiedad_id, tamaño);
CREATE INDEX IF NOT EXISTS idx_galeria_es_portada ON propiedades_galeria(es_portada) WHERE es_portada = true;
CREATE INDEX IF NOT EXISTS idx_planos_propiedad_tamano ON propiedades_planos(propiedad_id, tamaño);
