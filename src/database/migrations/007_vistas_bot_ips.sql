-- MIGRACIÓN 007 — IPs/RANGOS DE BOTS PARA VISTAS
-- Idempotente y transaccional. Aplica con: psql -f 007_vistas_bot_ips.sql
-- Rangos CIDR de datacenters/proxies conocidos. rust-tracking los carga en
-- memoria al arrancar y cada 10 min (punto 5); sin SMEMBERS por evento.
-- Vacía por defecto: solo ejemplos comentados (NO aplicar rangos reales sin
-- verificar que no incluyen IPs de usuarios legítimos).
BEGIN;

CREATE TABLE IF NOT EXISTS vistas_bot_ips (
    id SERIAL PRIMARY KEY,
    cidr CIDR NOT NULL UNIQUE,
    descripcion VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
