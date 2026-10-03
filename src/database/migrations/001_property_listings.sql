-- MIGRACIÓN 001 — OFERTAS POR OPERACIÓN
-- Idempotente y transaccional. Aplica con: psql -f 001_property_listings.sql
BEGIN;

-- 1. Ofertas por operación
CREATE TABLE IF NOT EXISTS property_listings (
    id SERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    operation_type_id SMALLINT NOT NULL REFERENCES operation_types(id),
    precio BIGINT,
    price_per_sqm DECIMAL(10, 2),
    rental_type_id SMALLINT REFERENCES rental_types(id),
    parking_space_price INTEGER,
    listing_status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (listing_status IN ('active','inactive','sold','rented','expired')),
    published_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (propiedad_id, operation_type_id),
    -- Tope temporal: sube cuando propiedades.precio pase a BIGINT
    CONSTRAINT chk_listing_precio CHECK (precio IS NULL OR (precio > 0 AND precio <= 2147483647))
);
CREATE INDEX IF NOT EXISTS idx_listings_propiedad ON property_listings(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_listings_search ON property_listings(operation_type_id, listing_status, precio);

DROP TRIGGER IF EXISTS trg_listings_updated_at ON property_listings;
CREATE TRIGGER trg_listings_updated_at BEFORE UPDATE ON property_listings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Historial de ofertas retiradas / cambiadas / cerradas
CREATE TABLE IF NOT EXISTS property_listing_history (
    id BIGSERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    operation_type_id SMALLINT REFERENCES operation_types(id),
    action VARCHAR(20) NOT NULL CHECK (action IN ('removed','switched','status_changed')),
    snapshot JSONB NOT NULL,
    changed_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_listing_history_prop ON property_listing_history(propiedad_id, changed_at DESC);

-- 3. Alcance de cada característica
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'both';
ALTER TABLE feature_catalog DROP CONSTRAINT IF EXISTS feature_catalog_applies_to_check;
ALTER TABLE feature_catalog ADD CONSTRAINT feature_catalog_applies_to_check
    CHECK (applies_to IN ('both','rent','sale'));
UPDATE feature_catalog SET applies_to = 'rent'
WHERE code IN ('mascotas','no_mascotas','no_fumadores','uso_cocina','uso_sala','uso_lavadora',
               'solo_estudiantes','solo_mujeres','solo_hombres',
               'servicios_incluidos','internet_incluido','alimentacion_incluida');

-- 4. price_history: a qué operación pertenece cada precio
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS operation_type_id SMALLINT REFERENCES operation_types(id);
UPDATE price_history ph SET operation_type_id = p.operation_type_id
FROM propiedades p WHERE ph.propiedad_id = p.id AND ph.operation_type_id IS NULL;

-- 5. Marca de descripción desactualizada
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS description_needs_review BOOLEAN NOT NULL DEFAULT FALSE;

-- 6. Backfill: una oferta por cada propiedad que aún no tenga ninguna
INSERT INTO property_listings (propiedad_id, operation_type_id, precio, price_per_sqm, rental_type_id,
                               parking_space_price, listing_status, published_at, expires_at, created_at)
SELECT p.id, p.operation_type_id,
       CASE WHEN p.precio > 0 THEN p.precio END,
       p.price_per_sqm, p.rental_type_id, p.parking_space_price,
       COALESCE(p.listing_status, 'active'), p.published_at, p.expires_at, p.created_at
FROM propiedades p
WHERE p.operation_type_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM property_listings l WHERE l.propiedad_id = p.id);

-- 7. Espejo: propiedades refleja la oferta principal (activa primero, venta antes que arriendo)
CREATE OR REPLACE FUNCTION sync_property_from_listings(p_id INTEGER) RETURNS VOID AS $$
DECLARE
    v_primary property_listings%ROWTYPE;
    v_status VARCHAR(20);
BEGIN
    SELECT l.* INTO v_primary
    FROM property_listings l
    JOIN operation_types ot ON ot.id = l.operation_type_id
    WHERE l.propiedad_id = p_id
    ORDER BY (l.listing_status = 'active') DESC, (ot.code = 'venta') DESC, l.updated_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT CASE
        WHEN bool_or(listing_status = 'active') THEN 'active'
        WHEN bool_or(listing_status = 'sold')   THEN 'sold'
        WHEN bool_or(listing_status = 'rented') THEN 'rented'
        WHEN bool_or(listing_status = 'expired') THEN 'expired'
        ELSE 'inactive'
    END INTO v_status
    FROM property_listings WHERE propiedad_id = p_id;

    UPDATE propiedades SET
        operation_type_id = v_primary.operation_type_id,
        precio = v_primary.precio,
        price_per_sqm = v_primary.price_per_sqm,
        rental_type_id = v_primary.rental_type_id,
        parking_space_price = v_primary.parking_space_price,
        listing_status = v_status,
        published_at = v_primary.published_at,
        expires_at = v_primary.expires_at
    WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_listings_sync() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sync_property_from_listings(OLD.propiedad_id);
        RETURN OLD;
    END IF;
    PERFORM sync_property_from_listings(NEW.propiedad_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El trigger se crea DESPUÉS del backfill a propósito
DROP TRIGGER IF EXISTS trg_property_listings_sync ON property_listings;
CREATE TRIGGER trg_property_listings_sync
AFTER INSERT OR UPDATE OR DELETE ON property_listings
FOR EACH ROW EXECUTE FUNCTION trg_listings_sync();

-- 8. Leads: operación de origen (la tabla SÍ tiene propiedad_id en esta base)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS operation_type_id SMALLINT REFERENCES operation_types(id);

COMMIT;
