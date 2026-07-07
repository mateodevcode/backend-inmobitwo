-- ============================================================================
-- ⚠️  BORRAR SOLO EL SISTEMA DE TRACKING Y LEADS
-- ============================================================================
-- Esto NO toca usuarios, propiedades, organizaciones ni el resto del core.
-- Útil para resetear el tracking sin perder tus datos de negocio.
-- ============================================================================
-- 1. Borrar trigger primero
DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
-- 2. Borrar tablas en orden inverso de dependencias
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS eventos_tracking CASCADE;
DROP TABLE IF EXISTS sesiones_tracking CASCADE;
-- ============================================================================
-- ✅ TRACKING ELIMINADO — el schema central (usuarios, propiedades, 
--    organizaciones) permanece intacto.
--    Ejecuta schema_tracking.sql para recrear.
-- ============================================================================