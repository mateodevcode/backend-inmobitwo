-- ============================================================================
-- SCHEMA — SISTEMA DE TRACKING Y LEADS
-- Depende de: usuarios, propiedades, organizaciones (deben existir antes)
-- ============================================================================
-- ORDEN DE CREACIÓN:
-- 1. sesiones_tracking
-- 2. eventos_tracking
-- 3. leads
-- 4. trigger updated_at para leads (reutiliza la función del schema central)
-- ============================================================================

-- ============================================================================
-- 1. SESIONES_TRACKING
-- Identifica a cada visitante (anónimo o logueado) de forma persistente
-- ============================================================================
CREATE TABLE IF NOT EXISTS sesiones_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) UNIQUE NOT NULL,
    usuario_id INTEGER,
    ip_address VARCHAR(45),
    user_agent TEXT,
    ciudad_aproximada VARCHAR(100),
    consentimiento_dado BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultima_actividad TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sesiones_session_id ON sesiones_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_id ON sesiones_tracking(usuario_id);

-- ============================================================================
-- 2. EVENTOS_TRACKING
-- Cada acción individual del visitante sobre una propiedad
-- ============================================================================
CREATE TABLE IF NOT EXISTS eventos_tracking (
    id BIGSERIAL PRIMARY KEY,
    sesion_id UUID NOT NULL,
    propiedad_id INTEGER NOT NULL,
    -- 'vista_propiedad' | 'vista_imagen' | 'favorito_agregado' |
    -- 'click_telefono' | 'click_whatsapp' | 'formulario_enviado' | 'tiempo_en_pagina'
    tipo_evento VARCHAR(50) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sesion_id) REFERENCES sesiones_tracking(id) ON DELETE CASCADE,
    FOREIGN KEY (propiedad_id) REFERENCES propiedades(id) ON DELETE CASCADE,
    CONSTRAINT tipo_evento_valido CHECK (
        tipo_evento IN (
            'vista_propiedad',
            'vista_imagen',
            'favorito_agregado',
            'click_telefono',
            'click_whatsapp',
            'formulario_enviado',
            'tiempo_en_pagina'
        )
    )
);
CREATE INDEX IF NOT EXISTS idx_eventos_sesion ON eventos_tracking(sesion_id);
CREATE INDEX IF NOT EXISTS idx_eventos_propiedad ON eventos_tracking(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo ON eventos_tracking(tipo_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_sesion_propiedad ON eventos_tracking(sesion_id, propiedad_id);

-- ============================================================================
-- 3. LEADS
-- Se crea cuando el scoring cruza el umbral, o cuando alguien manda un formulario
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL,
    sesion_id UUID,
    usuario_id INTEGER,
    nombre VARCHAR(150),
    email VARCHAR(150),
    telefono VARCHAR(30),
    score INTEGER NOT NULL DEFAULT 0,
    -- 'formulario_directo' | 'scoring_comportamiento'
    origen VARCHAR(50) NOT NULL,
    -- 'nuevo' | 'contactado' | 'en_negociacion' | 'cerrado' | 'descartado'
    estado VARCHAR(30) DEFAULT 'nuevo' NOT NULL,
    notificado BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (propiedad_id) REFERENCES propiedades(id) ON DELETE CASCADE,
    FOREIGN KEY (sesion_id) REFERENCES sesiones_tracking(id) ON DELETE SET NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    CONSTRAINT origen_lead_valido CHECK (
        origen IN ('formulario_directo', 'scoring_comportamiento')
    ),
    CONSTRAINT estado_lead_valido CHECK (
        estado IN (
            'nuevo',
            'contactado',
            'en_negociacion',
            'cerrado',
            'descartado'
        )
    ),
    -- 👇 NUEVO: evita que dos eventos concurrentes (misma sesión + misma
    -- propiedad) generen dos leads y por lo tanto dos correos duplicados.
    -- Postgres trata cada NULL como distinto entre sí, así que esto NO
    -- afecta a los leads de origen 'formulario_directo' que no tengan
    -- sesion_id (pueden repetirse sin problema).
    CONSTRAINT uq_leads_sesion_propiedad UNIQUE (sesion_id, propiedad_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_propiedad ON leads(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);

-- ============================================================================
-- 4. TRIGGER updated_at (reutiliza la función update_updated_at_column()
--    que ya existe en el schema central — NO la vuelvas a crear aquí)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE
UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ✅ SCHEMA DE TRACKING CREADO CORRECTAMENTE
-- ⚠️ Requiere que schema.sql (core) ya se haya ejecutado antes
-- ============================================================================