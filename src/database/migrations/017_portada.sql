-- MIGRACIÓN 017 — PORTADA DESTACADA (un solo anuncio del hero principal)
-- Idempotente y transaccional. Aplica con: psql -f 017_portada.sql
-- Replicada en db.sql (fuente de verdad para instalaciones nuevas).
--
-- Una sola fila (id = 1): el superadmin elige qué anuncio y qué imagen
-- se renderizan en la portada del portal. Sin fila = fallback del portal.
BEGIN;

CREATE TABLE IF NOT EXISTS portada_destacada (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    propiedad_id INTEGER REFERENCES propiedades(id) ON DELETE SET NULL,
    imagen_url VARCHAR(500),
    actualizado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
