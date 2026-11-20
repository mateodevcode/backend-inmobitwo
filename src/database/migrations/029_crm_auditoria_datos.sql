-- MIGRACIÓN 029 — HABEAS DATA: REGISTRO DE AUDITORÍA (CRM)
-- Idempotente y transaccional. Aplica con: psql -f 029_crm_auditoria_datos.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Ley 1581 de 2012: deja constancia de quién consultó (exportó), rectificó o
-- suprimió los datos de un contacto y de los cambios de autorización.
-- NO guarda datos personales: solo el id del contacto (sin FK, para que
-- sobreviva a la supresión), la acción, quién la hizo y conteos.
BEGIN;

CREATE TABLE IF NOT EXISTS crm_auditoria_datos (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_auditoria_datos_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    contacto_id BIGINT NOT NULL,
    accion VARCHAR(30) NOT NULL CHECK (accion IN (
        'exportacion', 'rectificacion', 'supresion', 'autorizacion_registrada', 'autorizacion_retirada')),
    actor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    detalle JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_auditoria_datos_org
    ON crm_auditoria_datos (organizacion_id, created_at DESC) WHERE organizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_auditoria_datos_user
    ON crm_auditoria_datos (usuario_id, created_at DESC) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_auditoria_datos_contacto
    ON crm_auditoria_datos (contacto_id);

COMMIT;
