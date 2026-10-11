-- MIGRACIÓN 010 — DESCARTADOS DE PROPIEDADES
-- Idempotente y transaccional. Aplica con: psql -f 010_descartados.sql
-- (después de 009)
BEGIN;

CREATE TABLE IF NOT EXISTS usuario_descartados (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (usuario_id, propiedad_id)
);

-- El UNIQUE ya cubre (usuario_id, propiedad_id) para el NOT EXISTS de los listados.
-- Este índice sirve para ordenar la pestaña "Descartados" por fecha.
CREATE INDEX IF NOT EXISTS idx_usuario_descartados_usuario_fecha
    ON usuario_descartados (usuario_id, created_at DESC);

COMMIT;
