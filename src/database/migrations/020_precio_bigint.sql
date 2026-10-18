-- MIGRACIÓN 020 — precio BIGINT (soporta propiedades de lujo en COP)
-- Contexto: precio INTEGER se desborda (22003) con cifras > 2.147.483.647,
-- algo alcanzable en inmuebles de gama alta en Colombia.
-- Idempotente y transaccional. Las vistas que dependen de propiedades se
-- sueltan ANTES del ALTER y se recrean con la MISMA definición de db.sql.
BEGIN;

DO $$
BEGIN
    IF (
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'propiedades'
          AND column_name = 'precio'
    ) = 'integer' THEN
        -- Vistas dependientes de propiedades (bloquean ALTER TYPE)
        DROP VIEW IF EXISTS v_property_summary;
        DROP VIEW IF EXISTS v_recent_price_changes;

        ALTER TABLE propiedades ALTER COLUMN precio TYPE BIGINT;

        -- Recreación (idéntica a db.sql secciones 15)
        CREATE OR REPLACE VIEW v_property_summary AS
        SELECT p.id,
            p.titulo,
            p.precio,
            p.price_per_sqm,
            p.constructed_area,
            p.private_area,
            p.room_count,
            p.bedroom_count,
            p.bathroom_count,
            p.direccion,
            c.name AS ciudad,
            s.name AS departamento,
            b.name AS barrio,
            p.latitude,
            p.longitude,
            ot.label_es AS operacion,
            pt.label_es AS tipo_inmueble,
            ct.label_es AS estado_conservacion,
            p.estrato,
            p.listing_status,
            p.published_at,
            p.updated_at,
            u.name AS publicado_por,
            o.nombre AS organizacion,
            (
                SELECT pg.url
                FROM propiedades_galeria pg
                WHERE pg.propiedad_id = p.id
                    AND pg.es_portada = TRUE
                    AND pg.tamaño = 'medium'
                LIMIT 1
            ) AS main_image_url
        FROM propiedades p
            LEFT JOIN operation_types ot ON p.operation_type_id = ot.id
            LEFT JOIN property_types pt ON p.property_type_id = pt.id
            LEFT JOIN condition_types ct ON p.condition_type_id = ct.id
            LEFT JOIN cities c ON p.city_id = c.id
            LEFT JOIN states s ON p.state_id = s.id
            LEFT JOIN barrios b ON p.barrio_id = b.id
            LEFT JOIN usuarios u ON p.publicado_por_id = u.id
            LEFT JOIN organizaciones o ON p.organizacion_id = o.id
        WHERE p.listing_status = 'active';

        CREATE OR REPLACE VIEW v_recent_price_changes AS
        SELECT p.id AS propiedad_id,
            p.titulo,
            c.name AS ciudad,
            ph.old_price,
            ph.new_price,
            ph.price_change,
            ph.change_percent,
            ph.change_type,
            ph.detected_at
        FROM price_history ph
            JOIN propiedades p ON ph.propiedad_id = p.id
            LEFT JOIN cities c ON p.city_id = c.id
        WHERE ph.detected_at >= NOW() - INTERVAL '30 days'
        ORDER BY ph.detected_at DESC;
    END IF;
END
$$;

COMMIT;
