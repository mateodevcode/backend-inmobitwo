-- SCRIPT DE LIMPIEZA TOTAL (DROP) — INMOBITWO Master Reset
-- Versión: 5.0 Colombia — Incluye catálogos, features N:M, historial de precios
-- ============================================================================
-- 1. Eliminación de Vistas
DROP VIEW IF EXISTS v_property_summary CASCADE;
DROP VIEW IF EXISTS v_recent_price_changes CASCADE;
-- 2. Eliminación de Triggers (evita bloqueos de dependencias)
DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
DROP TRIGGER IF EXISTS trg_organizaciones_updated_at ON organizaciones;
DROP TRIGGER IF EXISTS trg_org_miembros_updated_at ON organizacion_miembros;
DROP TRIGGER IF EXISTS trg_propiedades_updated_at ON propiedades;
DROP TRIGGER IF EXISTS trg_propiedades_geom_sync ON propiedades;
-- 3. Eliminación de Funciones
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS sync_geom_from_lat_lng();
-- 4. Eliminación de Tablas (orden inverso de dependencias)
-- Tablas relacionales / N:M / historiales
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS usuario_favoritos CASCADE;
DROP TABLE IF EXISTS price_history CASCADE;
DROP TABLE IF EXISTS property_features CASCADE;
DROP TABLE IF EXISTS related_units CASCADE;
DROP TABLE IF EXISTS propiedades_planos CASCADE;
DROP TABLE IF EXISTS propiedades_galeria CASCADE;
-- Tabla principal
DROP TABLE IF EXISTS propiedades CASCADE;
-- Geografía (de adentro hacia afuera)
DROP TABLE IF EXISTS barrios CASCADE;
DROP TABLE IF EXISTS cities CASCADE;
DROP TABLE IF EXISTS states CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS countries CASCADE;
-- Multi-tenant
DROP TABLE IF EXISTS organizacion_miembros CASCADE;
DROP TABLE IF EXISTS organizaciones CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
-- Catálogos / Lookups (sin dependencias entrantes)
DROP TABLE IF EXISTS feature_catalog CASCADE;
DROP TABLE IF EXISTS heating_types CASCADE;
DROP TABLE IF EXISTS condition_types CASCADE;
DROP TABLE IF EXISTS rental_types CASCADE;
DROP TABLE IF EXISTS property_types CASCADE;
DROP TABLE IF EXISTS operation_types CASCADE;
-- 5. Eliminación de Funciones wrapper antes de las extensiones
DROP FUNCTION IF EXISTS f_unaccent(text);
-- 6. Desactivación de Extensiones
DROP EXTENSION IF EXISTS postgis CASCADE;
DROP EXTENSION IF EXISTS unaccent CASCADE;
DROP EXTENSION IF EXISTS pg_trgm CASCADE;
-- ============================================================================
-- ✅ BASE DE DATOS LIMPIA — Listo para ejecutar db_completo_colombia.sql
-- ============================================================================