-- ============================================================================
-- ⚠️  BORRAR TODO Y EMPEZAR DE CERO
-- ============================================================================
-- ADVERTENCIA: Esto elimina TODOS los datos permanentemente.
-- Ejecutar solo en desarrollo o cuando quieras resetear la DB completa.
-- ============================================================================
-- 1. Borrar triggers primero
DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
DROP TRIGGER IF EXISTS trg_organizaciones_updated_at ON organizaciones;
DROP TRIGGER IF EXISTS trg_org_miembros_updated_at ON organizacion_miembros;
DROP TRIGGER IF EXISTS trg_propiedades_updated_at ON propiedades;
-- 2. Borrar tablas en orden inverso (dependencias)
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS usuario_favoritos CASCADE;
DROP TABLE IF EXISTS propiedades_galeria CASCADE;
DROP TABLE IF EXISTS propiedades CASCADE;
DROP TABLE IF EXISTS cities CASCADE;
DROP TABLE IF EXISTS states CASCADE;
DROP TABLE IF EXISTS countries CASCADE;
DROP TABLE IF EXISTS organizacion_miembros CASCADE;
DROP TABLE IF EXISTS organizaciones CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
-- 3. Borrar función
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
-- ============================================================================
-- ✅ TODO ELIMINADO — ahora ejecuta schema.sql para recrear
--    (y recuerda correr `npm run seed:geo` después para repoblar
--     countries/states/cities, ya que el reset las borra también)
-- ============================================================================