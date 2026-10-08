-- MIGRACIÓN 002 — VISTAS DE DETALLE (algoritmo_vista_detalle.md §8-§9 + decisiones 6 y 10)
-- Idempotente y transaccional. Aplica con: psql -f 002_vistas_detalle.sql
-- NO toca eventos_tracking ni sesiones_tracking. Todo TIMESTAMPTZ (no TIMESTAMP).
BEGIN;

-- 1. Log: un registro por evento RECIBIDO, siempre (principios 3-4).
CREATE TABLE IF NOT EXISTS vistas_log (
    event_id BIGSERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_local DATE NOT NULL,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    agency_id INTEGER REFERENCES organizaciones(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    anon_id VARCHAR(100),
    identidad_debil BOOLEAN NOT NULL DEFAULT FALSE,
    ip_hash VARCHAR(128) NOT NULL,
    user_agent TEXT,
    source VARCHAR(30),
    utm JSONB,
    referer TEXT,
    visible_seconds INTEGER,
    server_elapsed_ms INTEGER NOT NULL,
    result VARCHAR(10) NOT NULL CHECK (result IN ('counted','rejected')),
    reason VARCHAR(30) NOT NULL CHECK (reason IN (
        'counted','evento_invalido','token_invalido','token_expirado',
        'token_reutilizado','tiempo_insuficiente','inmueble_inexistente',
        'inmueble_no_activo','sin_identidad','interno','bot',
        'rate_limit','duplicado','tope_diario','error_sistema')),
    sospechoso BOOLEAN NOT NULL DEFAULT FALSE,
    rules_version VARCHAR(20) NOT NULL DEFAULT 'v1',
    CONSTRAINT chk_vistas_log_result_reason CHECK (
        (result = 'counted' AND reason = 'counted') OR
        (result = 'rejected' AND reason <> 'counted'))
);
CREATE INDEX IF NOT EXISTS idx_vistas_log_prop_fecha ON vistas_log(propiedad_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_vistas_log_agencia_fecha ON vistas_log(agency_id, fecha_local);
CREATE INDEX IF NOT EXISTS idx_vistas_log_user ON vistas_log(user_id);

-- 2. Resumen diario por inmueble (contadores derivan del log, §10).
CREATE TABLE IF NOT EXISTS vistas_resumen_diario (
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    fecha_local DATE NOT NULL,
    vistas INTEGER NOT NULL DEFAULT 0 CHECK (vistas >= 0),
    visitantes_unicos INTEGER NOT NULL DEFAULT 0 CHECK (visitantes_unicos >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (propiedad_id, fecha_local)
);

-- 3. Vinculación anon_id <-> user_id (§5.3: dedupe y tope cruzan identidades).
CREATE TABLE IF NOT EXISTS vistas_identidades (
    anon_id VARCHAR(100) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (anon_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_vistas_ident_user ON vistas_identidades(user_id);
CREATE INDEX IF NOT EXISTS idx_vistas_ident_anon ON vistas_identidades(anon_id);

-- 4. Agregado anti-inflado de log (decisión 10): rechazos rate_limit que excedan
--    1 fila/min/IP en vistas_log se cuentan aquí en vez de insertar más filas.
CREATE TABLE IF NOT EXISTS vistas_rate_limit_agregado (
    ip_hash VARCHAR(128) NOT NULL,
    ventana_minuto TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(30) NOT NULL DEFAULT 'rate_limit' CHECK (motivo = 'rate_limit'),
    conteo INTEGER NOT NULL DEFAULT 1 CHECK (conteo >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ip_hash, ventana_minuto)
);

COMMIT;
