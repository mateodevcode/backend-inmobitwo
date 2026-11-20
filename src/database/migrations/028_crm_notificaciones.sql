-- MIGRACIÓN 028 — NOTIFICACIONES DENTRO DEL CRM
-- Idempotente y transaccional. Aplica con: psql -f 028_crm_notificaciones.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Un aviso por destinatario. organizacion_id indica el espacio donde aplica
-- (NULL = espacio personal). `clave` evita duplicados del mismo hecho
-- (p. ej. "captacion-vence:15:2026-12-01"). Las leídas se purgan a los 90 días.
BEGIN;

CREATE TABLE IF NOT EXISTS crm_notificaciones (
    id BIGSERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    tipo VARCHAR(40) NOT NULL CHECK (tipo IN (
        'lead_nuevo', 'lead_asignado', 'contacto_asignado', 'tarea_asignada',
        'visita_asignada', 'visita_cambiada', 'demanda_coincidencias', 'captacion_por_vencer')),
    titulo VARCHAR(200) NOT NULL,
    cuerpo VARCHAR(500),
    -- Ruta interna del CRM (empieza por "/").
    url VARCHAR(300) CHECK (url IS NULL OR url LIKE '/%'),
    clave VARCHAR(200),
    actor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    leida_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_notificaciones_clave
    ON crm_notificaciones (usuario_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_notificaciones_usuario
    ON crm_notificaciones (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_notificaciones_no_leidas
    ON crm_notificaciones (usuario_id, organizacion_id) WHERE leida_at IS NULL;

COMMIT;
