-- MIGRACIÓN 009 — BÚSQUEDAS GUARDADAS CON ALERTAS (email + push preparado)
-- Idempotente y transaccional. Aplica con: psql -f 009_busquedas_guardadas.sql
-- (después de 008; el 002 ya existe como 002_vistas_detalle.sql)
BEGIN;

-- ============ Búsquedas guardadas ============
CREATE TABLE IF NOT EXISTS saved_searches (
  id                 SERIAL PRIMARY KEY,
  usuario_id         INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre             VARCHAR(160) NOT NULL,
  filtros            JSONB NOT NULL,
  filtros_hash       CHAR(64) NOT NULL,
  url_original       TEXT NOT NULL,
  frecuencia         VARCHAR(10) NOT NULL DEFAULT 'diaria'
                     CHECK (frecuencia IN ('inmediata','diaria','semanal')),
  canal_email        BOOLEAN NOT NULL DEFAULT TRUE,
  canal_push         BOOLEAN NOT NULL DEFAULT FALSE,
  estado             VARCHAR(10) NOT NULL DEFAULT 'activa'
                     CHECK (estado IN ('activa','pausada')),
  last_checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at       TIMESTAMPTZ,
  fallos_envio       INTEGER NOT NULL DEFAULT 0,
  unsubscribe_token  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  consentimiento_at  TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, filtros_hash)
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_usuario ON saved_searches(usuario_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_cron
  ON saved_searches(frecuencia, estado) WHERE estado = 'activa';

DROP TRIGGER IF EXISTS trg_saved_searches_updated ON saved_searches;
CREATE TRIGGER trg_saved_searches_updated BEFORE UPDATE ON saved_searches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============ Eventos de vivienda ============
-- clock_timestamp() (no NOW()) para que el timestamp sea el momento real del insert
-- y no el inicio de la transacción (evita que el cron "se salte" eventos).
CREATE TABLE IF NOT EXISTS property_events (
  id                 BIGSERIAL PRIMARY KEY,
  propiedad_id       INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
  operation_type_id  INTEGER NOT NULL,
  event_type         VARCHAR(12) NOT NULL
                     CHECK (event_type IN ('created','price_drop','relisted')),
  precio_anterior    INTEGER,
  precio_nuevo       INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_property_events_created ON property_events(created_at);
CREATE INDEX IF NOT EXISTS idx_property_events_prop ON property_events(propiedad_id);

-- ============ Notificaciones enviadas (anti-duplicado) ============
CREATE TABLE IF NOT EXISTS saved_search_notifications (
  id          BIGSERIAL PRIMARY KEY,
  search_id   INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  event_id    BIGINT  NOT NULL REFERENCES property_events(id) ON DELETE CASCADE,
  canal       VARCHAR(10) NOT NULL DEFAULT 'email' CHECK (canal IN ('email','push')),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (search_id, event_id, canal)
);

-- ============ Suscripciones push (listas, sin usar aún) ============
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_usuario ON push_subscriptions(usuario_id);

-- ============ Triggers que generan los eventos ============
CREATE OR REPLACE FUNCTION fn_property_events_from_listings() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.listing_status = 'active' THEN
      INSERT INTO property_events (propiedad_id, operation_type_id, event_type, precio_nuevo)
      VALUES (NEW.propiedad_id, NEW.operation_type_id, 'created', NEW.precio);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.listing_status = 'active' AND OLD.listing_status IS DISTINCT FROM 'active' THEN
      INSERT INTO property_events (propiedad_id, operation_type_id, event_type, precio_nuevo)
      VALUES (NEW.propiedad_id, NEW.operation_type_id, 'relisted', NEW.precio);
    ELSIF NEW.listing_status = 'active' AND OLD.listing_status = 'active'
          AND NEW.precio IS NOT NULL AND OLD.precio IS NOT NULL
          AND NEW.precio < OLD.precio THEN
      INSERT INTO property_events (propiedad_id, operation_type_id, event_type, precio_anterior, precio_nuevo)
      VALUES (NEW.propiedad_id, NEW.operation_type_id, 'price_drop', OLD.precio, NEW.precio);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_property_events_listings ON property_listings;
CREATE TRIGGER trg_property_events_listings
  AFTER INSERT OR UPDATE ON property_listings
  FOR EACH ROW EXECUTE FUNCTION fn_property_events_from_listings();

-- Cuando una propiedad pasa de 'no_publicado' a 'publicado'
CREATE OR REPLACE FUNCTION fn_property_events_from_propiedades() RETURNS trigger AS $$
BEGIN
  INSERT INTO property_events (propiedad_id, operation_type_id, event_type, precio_nuevo)
  SELECT l.propiedad_id, l.operation_type_id, 'relisted', l.precio
  FROM property_listings l
  WHERE l.propiedad_id = NEW.id AND l.listing_status = 'active';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_property_events_publicar ON propiedades;
CREATE TRIGGER trg_property_events_publicar
  AFTER UPDATE OF estado ON propiedades
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'publicado')
  EXECUTE FUNCTION fn_property_events_from_propiedades();

COMMIT;
