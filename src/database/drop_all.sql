-- ============================================================================
-- SCRIPT DE LIMPIEZA TOTAL (DROP) — INMOBITWO Master Reset
-- Versión: 4.1 (Agregado DROP de tabla barrios)
-- ============================================================================
-- 1. Eliminación de Triggers de auditoría para evitar bloqueos de dependencias
DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
DROP TRIGGER IF EXISTS trg_organizaciones_updated_at ON organizaciones;
DROP TRIGGER IF EXISTS trg_org_miembros_updated_at ON organizacion_miembros;
DROP TRIGGER IF EXISTS trg_propiedades_updated_at ON propiedades;
-- 2. Eliminación de Funciones Globales
DROP FUNCTION IF EXISTS update_updated_at_column();
-- 3. Eliminación de Tablas Secundarias y relacionales (Orden Inverso de dependencias)
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS usuario_favoritos CASCADE;
DROP TABLE IF EXISTS propiedades_galeria CASCADE;
DROP TABLE IF EXISTS propiedades CASCADE;
DROP TABLE IF EXISTS barrios CASCADE;
-- 👈 NUEVO: Se elimina antes que cities
DROP TABLE IF EXISTS cities CASCADE;
DROP TABLE IF EXISTS states CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS countries CASCADE;
DROP TABLE IF EXISTS organizacion_miembros CASCADE;
DROP TABLE IF EXISTS organizaciones CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
-- 4. Eliminación de Funciones wrapper antes de las extensiones
DROP FUNCTION IF EXISTS f_unaccent(text);
-- 5. Desactivación de las Extensiones
DROP EXTENSION IF EXISTS postgis CASCADE;
DROP EXTENSION IF EXISTS unaccent CASCADE;
DROP EXTENSION IF EXISTS pg_trgm CASCADE;