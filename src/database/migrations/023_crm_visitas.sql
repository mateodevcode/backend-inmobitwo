-- MIGRACIÓN 023 — AGENDA Y VISITAS DEL CRM
-- Idempotente y transaccional. Aplica con: psql -f 023_crm_visitas.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Una visita = cita de un agente con un contacto, normalmente para mostrar
-- un inmueble. Mismo modelo de dueño que el resto del CRM: exactamente uno
-- de organizacion_id / usuario_id. asignado_a_id es el agente que la atiende
-- (mismo nombre que en contactos/tareas para reutilizar whereEspacioPropio).
BEGIN;

CREATE TABLE IF NOT EXISTS crm_visitas (
    id BIGSERIAL PRIMARY KEY,
    organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT crm_visitas_dueno CHECK (num_nonnulls(organizacion_id, usuario_id) = 1),
    contacto_id BIGINT NOT NULL REFERENCES crm_contactos(id) ON DELETE CASCADE,
    propiedad_id INTEGER REFERENCES propiedades(id) ON DELETE SET NULL,
    oportunidad_id BIGINT REFERENCES crm_oportunidades(id) ON DELETE SET NULL,
    inicio_at TIMESTAMPTZ NOT NULL,
    fin_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT crm_visitas_rango CHECK (fin_at > inicio_at),
    lugar VARCHAR(300),
    notas TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'programada'
        CHECK (estado IN ('programada', 'confirmada', 'realizada', 'cancelada', 'no_asistio')),
    -- Resultado tras la visita (feedback del cliente).
    resultado_interes VARCHAR(10)
        CHECK (resultado_interes IS NULL OR resultado_interes IN ('alto', 'medio', 'bajo', 'ninguno')),
    resultado_comentario TEXT,
    motivo_cancelacion VARCHAR(300),
    -- Recordatorio por correo al agente: minutos antes del inicio (NULL = sin recordatorio).
    recordatorio_minutos INTEGER
        CHECK (recordatorio_minutos IS NULL OR recordatorio_minutos BETWEEN 5 AND 2880),
    recordatorio_enviado_at TIMESTAMPTZ,
    asignado_a_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Calendario por espacio (rango de fechas).
CREATE INDEX IF NOT EXISTS idx_crm_visitas_org_inicio
    ON crm_visitas (organizacion_id, inicio_at) WHERE organizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_visitas_usuario_inicio
    ON crm_visitas (usuario_id, inicio_at) WHERE usuario_id IS NOT NULL;
-- Agenda del agente y detección de choques de horario.
CREATE INDEX IF NOT EXISTS idx_crm_visitas_agente_inicio
    ON crm_visitas (asignado_a_id, inicio_at);
CREATE INDEX IF NOT EXISTS idx_crm_visitas_contacto
    ON crm_visitas (contacto_id);
CREATE INDEX IF NOT EXISTS idx_crm_visitas_propiedad
    ON crm_visitas (propiedad_id) WHERE propiedad_id IS NOT NULL;
-- Cola del job de recordatorios.
CREATE INDEX IF NOT EXISTS idx_crm_visitas_recordatorio_pendiente
    ON crm_visitas (inicio_at)
    WHERE recordatorio_minutos IS NOT NULL
      AND recordatorio_enviado_at IS NULL
      AND estado IN ('programada', 'confirmada');

COMMIT;
