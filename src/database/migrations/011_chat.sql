-- MIGRACIÓN 011 — CHAT ENTRE USUARIOS (conversaciones + mensajes)
-- Idempotente y transaccional. Aplica con: psql -f 011_chat.sql
-- (después de 010)
BEGIN;

CREATE TABLE IF NOT EXISTS chat_conversaciones (
    id BIGSERIAL PRIMARY KEY,
    propiedad_id INTEGER REFERENCES propiedades(id) ON DELETE SET NULL,
    propiedad_titulo VARCHAR(255),
    interesado_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    publicador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    ultimo_mensaje_texto VARCHAR(200),
    ultimo_mensaje_de INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    ultimo_mensaje_at TIMESTAMPTZ,
    no_leidos_interesado INTEGER NOT NULL DEFAULT 0 CHECK (no_leidos_interesado >= 0),
    no_leidos_publicador INTEGER NOT NULL DEFAULT 0 CHECK (no_leidos_publicador >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chat_conv_participantes_distintos CHECK (interesado_id <> publicador_id),
    CONSTRAINT chat_conv_unica_por_anuncio UNIQUE (propiedad_id, interesado_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_interesado
    ON chat_conversaciones (interesado_id, ultimo_mensaje_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chat_conv_publicador
    ON chat_conversaciones (publicador_id, ultimo_mensaje_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS chat_mensajes (
    id BIGSERIAL PRIMARY KEY,
    conversacion_id BIGINT NOT NULL REFERENCES chat_conversaciones(id) ON DELETE CASCADE,
    remitente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    contenido TEXT NOT NULL CHECK (char_length(contenido) BETWEEN 1 AND 2000),
    client_msg_id UUID,
    leido_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chat_msg_idempotencia UNIQUE (conversacion_id, remitente_id, client_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_mensajes_conv
    ON chat_mensajes (conversacion_id, id DESC);

COMMIT;
