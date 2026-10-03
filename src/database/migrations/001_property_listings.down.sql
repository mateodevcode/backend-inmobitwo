-- REVERSIÓN 001 — OFERTAS POR OPERACIÓN (solo archivo, revisar antes de ejecutar)
-- Revierte todo lo creado por 001_property_listings.sql
BEGIN;

DROP TRIGGER IF EXISTS trg_property_listings_sync ON property_listings;
DROP FUNCTION IF EXISTS trg_listings_sync();
DROP FUNCTION IF EXISTS sync_property_from_listings(INTEGER);
DROP TABLE IF EXISTS property_listing_history CASCADE;
DROP TABLE IF EXISTS property_listings CASCADE;

ALTER TABLE feature_catalog DROP CONSTRAINT IF EXISTS feature_catalog_applies_to_check;
ALTER TABLE feature_catalog DROP COLUMN IF EXISTS applies_to;

ALTER TABLE price_history DROP COLUMN IF EXISTS operation_type_id;
ALTER TABLE propiedades DROP COLUMN IF EXISTS description_needs_review;
ALTER TABLE leads DROP COLUMN IF EXISTS operation_type_id;

COMMIT;
