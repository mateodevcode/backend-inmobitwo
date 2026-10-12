-- MIGRACIÓN 012 — BORRADO DE CHAT POR PARTICIPANTE (soft-delete + hard-delete)
-- Idempotente y transaccional. Aplica con: psql -f 012_chat_borrado.sql
-- (después de 011)
--
-- Regla:
--  - Cada participante oculta con su propio timestamp (borrado_*_at).
--  - Listados y contadores excluyen lo que YO borré; el otro lo sigue viendo.
--  - Cuando ambos borraron, el backend hace DELETE físico (mensajes caen por CASCADE).
--  - Un mensaje nuevo revive (limpia ambos flags) para que el receptor vuelva a verla.
BEGIN;

ALTER TABLE chat_conversaciones
  ADD COLUMN IF NOT EXISTS borrado_interesado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS borrado_publicador_at TIMESTAMPTZ;

COMMIT;
