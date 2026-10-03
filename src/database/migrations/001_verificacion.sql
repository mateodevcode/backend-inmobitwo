-- VERIFICACIÓN 001 — solo lectura tras aplicar 001_property_listings.sql

-- (1) Propiedades con operation_type_id NOT NULL sin oferta (esperado: 0)
SELECT COUNT(*) AS sin_oferta
FROM propiedades p
WHERE p.operation_type_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM property_listings l WHERE l.propiedad_id = p.id);

-- (2) Espejos que no coinciden con su oferta principal
SELECT p.id, p.operation_type_id AS espejo_op, p.precio AS espejo_precio,
       p.listing_status AS espejo_status,
       l.operation_type_id AS oferta_op, l.precio AS oferta_precio,
       l.listing_status AS oferta_status
FROM propiedades p
JOIN property_listings l ON l.propiedad_id = p.id
JOIN operation_types ot ON ot.id = l.operation_type_id
WHERE l.listing_status = 'active'
ORDER BY (ot.code = 'venta') DESC, l.updated_at DESC;

-- (3) Propiedades con precio <= 0 que quedaron con oferta de precio NULL (conteo)
SELECT COUNT(*) AS ofertas_precio_null
FROM property_listings l
JOIN propiedades p ON p.id = l.propiedad_id
WHERE l.precio IS NULL AND (p.precio IS NULL OR p.precio <= 0);

-- (4) Propiedades sin operation_type_id: no recibieron oferta (conteo)
SELECT COUNT(*) AS sin_operacion
FROM propiedades
WHERE operation_type_id IS NULL;
