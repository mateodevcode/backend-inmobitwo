-- SCHEMA COMPLETO — PLATAFORMA INMOBILIARIA COLOMBIA
-- Versión: 5.0 — Catálogos + Características N:M + Historial de precios
-- ============================================================================
-- ORDEN DE CREACIÓN:
-- 0. extensiones (PostGIS, pg_trgm, unaccent)
-- 1. catálogos / lookups
-- 2. usuarios
-- 3. organizaciones
-- 4. organizacion_miembros
-- 5. geografía: countries → regions → states → cities → barrios
-- 6. propiedades
-- 7. propiedades_galeria
-- 8. propiedades_planos
-- 9. feature_catalog + property_features
-- 10. price_history
-- 11. related_units
-- 12. usuario_favoritos
-- 13. refresh_tokens
-- 14. funciones y triggers
-- 15. vistas útiles
-- 16. índices finales
-- ============================================================================
-- ============================================================================
-- 0. EXTENSIONES PREVIAS REQUERIDAS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
SELECT public.unaccent('public.unaccent', $1) $$;
-- ============================================================================
-- 1. CATÁLOGOS / LOOKUPS
-- ============================================================================
-- Tipos de operación
CREATE TABLE IF NOT EXISTS operation_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    label_es VARCHAR(50) NOT NULL
);
-- Tipos de alquiler (subtipo de arriendo: residencial, temporada, vacacional)
CREATE TABLE IF NOT EXISTS rental_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    label_es VARCHAR(100) NOT NULL
);
-- Tipos de inmueble
CREATE TABLE IF NOT EXISTS property_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    label_es VARCHAR(50) NOT NULL,
    label_en VARCHAR(50),
    category VARCHAR(30) DEFAULT 'residential' CHECK (
        category IN (
            'residential',
            'commercial',
            'industrial',
            'land',
            'rural',
            'parking',
            'storage'
        )
    )
);
-- Estados de conservación
CREATE TABLE IF NOT EXISTS condition_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    label_es VARCHAR(50) NOT NULL
);
-- Tipos de calefacción (zonas frías de Colombia)
CREATE TABLE IF NOT EXISTS heating_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    label_es VARCHAR(50) NOT NULL
);
-- Catálogo de características adicionales
CREATE TABLE IF NOT EXISTS feature_catalog (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    label_es VARCHAR(100) NOT NULL,
    category VARCHAR(30) CHECK (
        category IN (
            'security',
            'comfort',
            'leisure',
            'accessibility',
            'technology',
            'sustainability',
            'views',
            'rules',
            'services'
        )
    ),
    data_type VARCHAR(20) DEFAULT 'boolean' CHECK (data_type IN ('boolean', 'numeric', 'text'))
);
-- ============================================================================
-- 2. USUARIOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),
    telefono VARCHAR(20),
    telefonos VARCHAR[],
    rol VARCHAR(50) DEFAULT 'user' NOT NULL CHECK (rol IN ('user', 'superadmin')),
    provider VARCHAR(50) DEFAULT 'local',
    provider_id VARCHAR(255),
    image_url VARCHAR(500),
    public_id VARCHAR(255),
    email_verificado BOOLEAN DEFAULT false,
    codigo_verificacion INTEGER,
    date_codigo_verificacion TIMESTAMP,
    bloqueado BOOLEAN DEFAULT false,
    intentos_fallidos INTEGER DEFAULT 0,
    ultimo_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ============================================================================
-- 3. ORGANIZACIONES (INMOBILIARIAS / TENANTS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizaciones (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    telefono VARCHAR(20),
    website VARCHAR(255),
    descripcion TEXT,
    logo_url VARCHAR(500),
    logo_public_id VARCHAR(255),
    ciudad VARCHAR(100),
    provincia VARCHAR(100),
    slug VARCHAR(150) UNIQUE,
    custom_domain VARCHAR(255) UNIQUE,
    dominio_estado VARCHAR(50) DEFAULT 'sin_dominio' NOT NULL CHECK (
        dominio_estado IN ('sin_dominio', 'pendiente_dns', 'activo')
    ),
    plan VARCHAR(50) DEFAULT 'free' NOT NULL CHECK (plan IN ('free', 'premium')),
    estado VARCHAR(50) DEFAULT 'pendiente' NOT NULL CHECK (
        estado IN ('pendiente', 'aprobada', 'suspendida')
    ),
    tema VARCHAR(50) DEFAULT 'tema1' NOT NULL CHECK (tema IN ('tema1', 'tema2', 'tema3', 'tema4')),
    creada_por_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creada_por_id) REFERENCES usuarios(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_organizaciones_slug ON organizaciones(slug);
CREATE INDEX IF NOT EXISTS idx_organizaciones_custom_domain ON organizaciones(custom_domain);
-- ============================================================================
-- 4. ORGANIZACION_MIEMBROS
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizacion_miembros (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    organizacion_id INTEGER NOT NULL,
    rol_en_org VARCHAR(50) DEFAULT 'agent' NOT NULL CHECK (rol_en_org IN ('agent', 'agency_admin')),
    estado VARCHAR(50) DEFAULT 'activo' NOT NULL CHECK (estado IN ('activo', 'suspendido')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id) ON DELETE CASCADE,
    UNIQUE (usuario_id, organizacion_id)
);
-- ============================================================================
-- 5. GEOGRAFÍA
-- ============================================================================
CREATE TABLE IF NOT EXISTS countries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    iso2 VARCHAR(2) NOT NULL UNIQUE,
    phonecode VARCHAR(10),
    flag_emoji VARCHAR(10),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8)
);
CREATE TABLE IF NOT EXISTS regions (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150),
    geom GEOMETRY(MultiPolygon, 4326)
);
CREATE TABLE IF NOT EXISTS states (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    region_id INTEGER REFERENCES regions(id) ON DELETE
    SET NULL,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(150),
        dane_code VARCHAR(5),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        geom GEOMETRY(MultiPolygon, 4326)
);
CREATE TABLE IF NOT EXISTS cities (
    id SERIAL PRIMARY KEY,
    state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150),
    dane_code VARCHAR(8),
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    geom GEOMETRY(MultiPolygon, 4326)
);
CREATE TABLE IF NOT EXISTS barrios (
    id SERIAL PRIMARY KEY,
    city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150),
    dane_code VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    geom GEOMETRY(Geometry, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ============================================================================
-- 6. PROPIEDADES
-- ============================================================================
CREATE TABLE IF NOT EXISTS propiedades (
    id SERIAL PRIMARY KEY,
    -- Relaciones a catálogos
    operation_type_id SMALLINT REFERENCES operation_types(id),
    property_type_id SMALLINT REFERENCES property_types(id),
    condition_type_id SMALLINT REFERENCES condition_types(id),
    heating_type_id SMALLINT REFERENCES heating_types(id),
    rental_type_id SMALLINT REFERENCES rental_types(id),
    -- Ubicación: catálogo
    country_id INTEGER REFERENCES countries(id),
    state_id INTEGER REFERENCES states(id),
    city_id INTEGER REFERENCES cities(id),
    barrio_id INTEGER REFERENCES barrios(id) ON DELETE
    SET NULL,
        barrio_nombre VARCHAR(255),
        -- Ubicación: texto libre
        direccion VARCHAR(255),
        numero_direccion VARCHAR(50),
        floor VARCHAR(20),
        interior_apartment_number VARCHAR(10),
        postal_code VARCHAR(10),
        -- Ubicación: coordenadas
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        geom GEOMETRY(Point, 4326),
        -- Identificación Colombia
        estrato SMALLINT CHECK (
            estrato BETWEEN 1 AND 6
        ),
        cedula_catastral VARCHAR(50),
        matricula_inmobiliaria VARCHAR(50),
        -- Contenido
        titulo VARCHAR(255),
        description TEXT,
        precio INTEGER,
        price_per_sqm DECIMAL(10, 2),
        administracion INTEGER,
        -- Áreas
        constructed_area INTEGER,
        private_area INTEGER,
        plot_area INTEGER,
        -- Distribución
        room_count SMALLINT CHECK (room_count >= 0),
        bedroom_count SMALLINT CHECK (bedroom_count >= 0),
        bathroom_count SMALLINT CHECK (bathroom_count >= 0),
        social_bathroom_count SMALLINT CHECK (social_bathroom_count >= 0),
        -- Construcción
        construction_year SMALLINT CHECK (
            construction_year BETWEEN 1000 AND 2100
        ),
        antiguedad_anios SMALLINT,
        is_new_construction BOOLEAN DEFAULT FALSE,
        -- Parqueadero
        parqueadero_tipo VARCHAR(30) CHECK (parqueadero_tipo IN ('cubierto', 'descubierto')),
        parqueadero_modo VARCHAR(30) CHECK (parqueadero_modo IN ('privado', 'comunal')),
        parking_space_count SMALLINT DEFAULT 0,
        parking_space_included BOOLEAN DEFAULT FALSE,
        parking_space_price INTEGER,
        -- Servicios públicos
        tiene_agua BOOLEAN DEFAULT FALSE,
        tiene_luz BOOLEAN DEFAULT FALSE,
        tiene_gas BOOLEAN DEFAULT FALSE,
        tiene_alcantarillado BOOLEAN DEFAULT FALSE,
        -- Amenities comunes (flags rápidos para filtros frecuentes)
        has_elevator BOOLEAN DEFAULT FALSE,
        has_swimming_pool BOOLEAN DEFAULT FALSE,
        has_gym BOOLEAN DEFAULT FALSE,
        has_security_24h BOOLEAN DEFAULT FALSE,
        has_air_conditioning BOOLEAN DEFAULT FALSE,
        is_furnished BOOLEAN,
        -- Zona de uso del suelo
        zona VARCHAR(30) CHECK (
            zona IN (
                'residencial',
                'comercial',
                'industrial',
                'mixta',
                'campestre',
                'rural'
            )
        ),
        -- Estado del anuncio
        estado VARCHAR(50) NOT NULL DEFAULT 'publicado' CHECK (estado IN ('publicado', 'no_publicado')),
        listing_status VARCHAR(20) DEFAULT 'active' CHECK (
            listing_status IN (
                'active',
                'inactive',
                'sold',
                'rented',
                'expired'
            )
        ),
        published_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE,
        -- Publicador
        publicado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        organizacion_id INTEGER REFERENCES organizaciones(id) ON DELETE
    SET NULL,
        es_de_organizacion BOOLEAN DEFAULT FALSE,
        -- Contacto por anuncio
        how_to_contact VARCHAR(30) DEFAULT 'telefono_chat' NOT NULL CHECK (
            how_to_contact IN ('telefono_chat', 'solo_chat', 'solo_telefono')
        ),
        telefono_contacto VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ============================================================================
-- 7. PROPIEDADES_GALERÍA (Multi-tamaño + portada unificada)
-- ============================================================================
CREATE TABLE IF NOT EXISTS propiedades_galeria (
    id SERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    orden INTEGER DEFAULT 0,
    tamaño VARCHAR(20) NOT NULL CHECK (
        tamaño IN (
            'thumbnail',
            'small',
            'medium',
            'large',
            'xlarge'
        )
    ),
    es_portada BOOLEAN DEFAULT FALSE NOT NULL,
    url VARCHAR(500) NOT NULL,
    public_id VARCHAR(255),
    width_px SMALLINT,
    height_px SMALLINT,
    file_size_kb INTEGER,
    mime_type VARCHAR(30),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_una_portada_por_tamano ON propiedades_galeria (propiedad_id, tamaño)
WHERE es_portada = TRUE;
CREATE INDEX IF NOT EXISTS idx_galeria_propiedad_tamano ON propiedades_galeria(propiedad_id, tamaño);
CREATE INDEX IF NOT EXISTS idx_galeria_es_portada ON propiedades_galeria(es_portada)
WHERE es_portada = TRUE;
-- ============================================================================
-- 8. PROPIEDADES_PLANOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS propiedades_planos (
    id SERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    orden INTEGER DEFAULT 0,
    tamaño VARCHAR(20) NOT NULL CHECK (
        tamaño IN (
            'thumbnail',
            'small',
            'medium',
            'large',
            'xlarge'
        )
    ),
    url VARCHAR(500) NOT NULL,
    public_id VARCHAR(255),
    width_px SMALLINT,
    height_px SMALLINT,
    file_size_kb INTEGER,
    mime_type VARCHAR(30),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_planos_propiedad_tamano ON propiedades_planos(propiedad_id, tamaño);
-- ============================================================================
-- 9. CARACTERÍSTICAS ADICIONALES (N:M flexible)
-- ============================================================================
CREATE TABLE IF NOT EXISTS property_features (
    id BIGSERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    feature_id SMALLINT NOT NULL REFERENCES feature_catalog(id),
    bool_value BOOLEAN,
    numeric_value DECIMAL(10, 2),
    text_value VARCHAR(255),
    UNIQUE(propiedad_id, feature_id)
);
CREATE INDEX IF NOT EXISTS idx_features_property ON property_features(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_features_catalog ON property_features(feature_id);
-- ============================================================================
-- 10. HISTORIAL DE PRECIOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS price_history (
    id BIGSERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    old_price INTEGER,
    new_price INTEGER NOT NULL,
    price_change INTEGER GENERATED ALWAYS AS (new_price - COALESCE(old_price, 0)) STORED,
    change_percent DECIMAL(5, 2) GENERATED ALWAYS AS (
        CASE
            WHEN old_price > 0 THEN ROUND(
                ((new_price - old_price)::decimal / old_price) * 100,
                2
            )
            ELSE NULL
        END
    ) STORED,
    change_type VARCHAR(20) CHECK (
        change_type IN ('increase', 'decrease', 'initial', 'relisted')
    ),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source VARCHAR(50) DEFAULT 'user_update'
);
CREATE INDEX IF NOT EXISTS idx_price_history_property ON price_history(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(detected_at);
-- ============================================================================
-- 11. PROPIEDADES RELACIONADAS / UNIDADES
-- ============================================================================
CREATE TABLE IF NOT EXISTS related_units (
    id BIGSERIAL PRIMARY KEY,
    parent_property_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    child_property_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    relationship_type VARCHAR(30) DEFAULT 'same_building' CHECK (
        relationship_type IN (
            'same_building',
            'same_complex',
            'same_development',
            'similar'
        )
    ),
    UNIQUE(parent_property_id, child_property_id)
);
CREATE INDEX IF NOT EXISTS idx_related_parent ON related_units(parent_property_id);
CREATE INDEX IF NOT EXISTS idx_related_child ON related_units(child_property_id);
-- ============================================================================
-- 12. USUARIO_FAVORITOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS usuario_favoritos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (usuario_id, propiedad_id)
);
CREATE INDEX IF NOT EXISTS idx_usuario_favoritos_usuario_id ON usuario_favoritos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_favoritos_propiedad_id ON usuario_favoritos(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_usuario_favoritos_created_at ON usuario_favoritos(created_at);
-- ============================================================================
-- 13. REFRESH TOKENS
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token VARCHAR(512) NOT NULL UNIQUE,
    expira_en TIMESTAMP NOT NULL,
    revocado BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ============================================================================
-- 14. FUNCIONES Y TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = CURRENT_TIMESTAMP;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION sync_geom_from_lat_lng() RETURNS TRIGGER AS $$ BEGIN IF NEW.latitude IS NOT NULL
    AND NEW.longitude IS NOT NULL THEN NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Triggers de updated_at
DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
DROP TRIGGER IF EXISTS trg_organizaciones_updated_at ON organizaciones;
DROP TRIGGER IF EXISTS trg_org_miembros_updated_at ON organizacion_miembros;
DROP TRIGGER IF EXISTS trg_propiedades_updated_at ON propiedades;
CREATE TRIGGER trg_usuarios_updated_at BEFORE
UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_organizaciones_updated_at BEFORE
UPDATE ON organizaciones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_org_miembros_updated_at BEFORE
UPDATE ON organizacion_miembros FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_propiedades_updated_at BEFORE
UPDATE ON propiedades FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- Trigger de sincronización geom
DROP TRIGGER IF EXISTS trg_propiedades_geom_sync ON propiedades;
CREATE TRIGGER trg_propiedades_geom_sync BEFORE
INSERT
    OR
UPDATE ON propiedades FOR EACH ROW EXECUTE FUNCTION sync_geom_from_lat_lng();
-- ============================================================================
-- 15. VISTAS ÚTILES
-- ============================================================================
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
-- ============================================================================
-- 16. ÍNDICES PARA BÚSQUEDA EFICIENTE
-- ============================================================================
-- Propiedades
CREATE INDEX IF NOT EXISTS idx_propiedades_country_id ON propiedades(country_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_state_id ON propiedades(state_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_city_id ON propiedades(city_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_barrio_id ON propiedades(barrio_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_organizacion_id ON propiedades(organizacion_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_geom ON propiedades USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_propiedades_operation_type ON propiedades(operation_type_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_property_type ON propiedades(property_type_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_condition_type ON propiedades(condition_type_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_estrato ON propiedades(estrato);
CREATE INDEX IF NOT EXISTS idx_propiedades_precio ON propiedades(precio);
CREATE INDEX IF NOT EXISTS idx_propiedades_listing_status ON propiedades(listing_status);
CREATE INDEX IF NOT EXISTS idx_propiedades_published_at ON propiedades(published_at);
CREATE INDEX IF NOT EXISTS idx_propiedades_composite ON propiedades(
    city_id,
    operation_type_id,
    property_type_id,
    precio
);
-- Geografía
CREATE INDEX IF NOT EXISTS idx_countries_name ON countries(name);
CREATE INDEX IF NOT EXISTS idx_countries_name_trgm ON countries USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_countries_name_unaccent ON countries USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_regions_country_id ON regions(country_id);
CREATE INDEX IF NOT EXISTS idx_regions_slug ON regions(slug);
CREATE INDEX IF NOT EXISTS idx_regions_name ON regions(name);
CREATE INDEX IF NOT EXISTS idx_regions_name_trgm ON regions USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_regions_name_unaccent ON regions USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_states_country_id ON states(country_id);
CREATE INDEX IF NOT EXISTS idx_states_region_id ON states(region_id);
CREATE INDEX IF NOT EXISTS idx_states_name ON states(name);
CREATE INDEX IF NOT EXISTS idx_states_name_trgm ON states USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_states_name_unaccent ON states USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_states_slug ON states(slug);
CREATE INDEX IF NOT EXISTS idx_states_dane_code ON states(dane_code);
CREATE INDEX IF NOT EXISTS idx_states_geom ON states USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_cities_state_id ON cities(state_id);
CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_name_trgm ON cities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cities_name_unaccent ON cities USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cities_slug ON cities(slug);
CREATE INDEX IF NOT EXISTS idx_cities_dane_code ON cities(dane_code);
CREATE INDEX IF NOT EXISTS idx_cities_geom ON cities USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_barrios_city_id ON barrios(city_id);
CREATE INDEX IF NOT EXISTS idx_barrios_name ON barrios(name);
CREATE INDEX IF NOT EXISTS idx_barrios_name_trgm ON barrios USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_barrios_name_unaccent ON barrios USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_barrios_slug ON barrios(slug);
CREATE INDEX IF NOT EXISTS idx_barrios_dane_code ON barrios(dane_code);
CREATE INDEX IF NOT EXISTS idx_barrios_geom ON barrios USING GIST(geom);
-- Usuarios
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios(rol);
-- ============================================================================
-- 17. POBLAR CATÁLOGOS
-- ============================================================================
INSERT INTO operation_types (code, label_es)
VALUES ('venta', 'Venta'),
    ('arriendo', 'Arriendo'),
    ('arriendo_venta', 'Arriendo con opción a compra');
INSERT INTO rental_types (code, label_es)
VALUES ('residencial', 'Residencial, vivienda habitual'),
    ('temporada', 'De temporada'),
    ('vacacional', 'Vacacional');
INSERT INTO property_types (code, label_es, label_en, category)
VALUES (
        'apartamento',
        'Apartamento',
        'Apartment',
        'residential'
    ),
    ('casa', 'Casa', 'House', 'residential'),
    (
        'casa_campestre',
        'Casa campestre',
        'Country house',
        'residential'
    ),
    (
        'apartaestudio',
        'Apartaestudio',
        'Studio apartment',
        'residential'
    ),
    (
        'penthouse',
        'Penthouse',
        'Penthouse',
        'residential'
    ),
    (
        'casa_lote',
        'Casa lote',
        'House with lot',
        'residential'
    ),
    (
        'local',
        'Local comercial',
        'Commercial premises',
        'commercial'
    ),
    ('oficina', 'Oficina', 'Office', 'commercial'),
    ('bodega', 'Bodega', 'Warehouse', 'commercial'),
    (
        'consultorio',
        'Consultorio',
        'Medical office',
        'commercial'
    ),
    ('edificio', 'Edificio', 'Building', 'commercial'),
    ('lote', 'Lote / Terreno', 'Lot / Land', 'land'),
    ('finca', 'Finca', 'Farm / Estate', 'rural'),
    (
        'parqueadero',
        'Parqueadero',
        'Parking space',
        'parking'
    ),
    (
        'trastero',
        'Trastero',
        'Storage room',
        'storage'
    ),
    (
        'habitacion',
        'Habitación',
        'Room',
        'residential'
    );
INSERT INTO condition_types (code, label_es)
VALUES ('nuevo', 'Nuevo'),
    ('para_estrenar', 'Para estrenar'),
    ('usado', 'Usado'),
    ('remodelado', 'Remodelado'),
    ('para_remodelar', 'Para remodelar'),
    ('obra_negra', 'Obra negra'),
    ('obra_gris', 'Obra gris'),
    ('en_construccion', 'En construcción');
INSERT INTO heating_types (code, label_es)
VALUES ('gas_natural', 'Gas natural'),
    ('electrica', 'Eléctrica'),
    ('lena', 'Leña / Estufa'),
    ('sin_calefaccion', 'Sin calefacción');
INSERT INTO feature_catalog (code, label_es, category, data_type)
VALUES (
        'porteria_24h',
        'Portería 24 horas',
        'security',
        'boolean'
    ),
    ('citofonia', 'Citofonía', 'security', 'boolean'),
    (
        'camaras',
        'Cámaras de seguridad',
        'security',
        'boolean'
    ),
    (
        'cerca_electrica',
        'Cerca eléctrica',
        'security',
        'boolean'
    ),
    (
        'conjunto_cerrado',
        'Conjunto cerrado',
        'security',
        'boolean'
    ),
    (
        'vigilancia_privada',
        'Vigilancia privada',
        'security',
        'boolean'
    ),
    ('piscina', 'Piscina', 'leisure', 'boolean'),
    ('gimnasio', 'Gimnasio', 'leisure', 'boolean'),
    (
        'salon_social',
        'Salón social',
        'leisure',
        'boolean'
    ),
    ('zona_bbq', 'Zona BBQ', 'leisure', 'boolean'),
    (
        'canchas',
        'Canchas deportivas',
        'leisure',
        'boolean'
    ),
    (
        'juegos_infantiles',
        'Juegos infantiles',
        'leisure',
        'boolean'
    ),
    (
        'zonas_verdes',
        'Zonas verdes',
        'leisure',
        'boolean'
    ),
    ('ascensor', 'Ascensor', 'comfort', 'boolean'),
    (
        'shuttle',
        'Buseta / Transporte privado',
        'comfort',
        'boolean'
    ),
    (
        'parqueadero_visitantes',
        'Parqueadero de visitantes',
        'comfort',
        'boolean'
    ),
    ('caldera', 'Caldera', 'comfort', 'boolean'),
    (
        'split',
        'Aire acondicionado Split',
        'comfort',
        'boolean'
    ),
    (
        'ventilador',
        'Ventilador de techo',
        'comfort',
        'boolean'
    ),
    (
        'cortinas',
        'Cortinas / Blackout',
        'comfort',
        'boolean'
    ),
    (
        'calentador',
        'Calentador de agua',
        'comfort',
        'boolean'
    ),
    (
        'tanque_agua',
        'Tanque de agua / Reserva',
        'comfort',
        'boolean'
    ),
    ('terraza', 'Terraza', 'comfort', 'boolean'),
    ('balcon', 'Balcón', 'comfort', 'boolean'),
    ('patio', 'Patio interior', 'comfort', 'boolean'),
    ('sotano', 'Sótano', 'comfort', 'boolean'),
    (
        'deposito',
        'Bodega / Depósito',
        'comfort',
        'boolean'
    ),
    ('chimenea', 'Chimenea', 'comfort', 'boolean'),
    (
        'cocina_integral',
        'Cocina integral',
        'comfort',
        'boolean'
    ),
    (
        'closet',
        'Closets / Vestier',
        'comfort',
        'boolean'
    ),
    (
        'pisos_madera',
        'Pisos en madera',
        'comfort',
        'boolean'
    ),
    (
        'pisos_porcelanato',
        'Pisos en porcelanato',
        'comfort',
        'boolean'
    ),
    (
        'red_gas',
        'Red de gas domiciliario',
        'services',
        'boolean'
    ),
    (
        'internet',
        'Internet / Fibra óptica',
        'technology',
        'boolean'
    ),
    (
        'linea_telefonica',
        'Línea telefónica',
        'technology',
        'boolean'
    ),
    (
        'vista_ciudad',
        'Vista a la ciudad',
        'views',
        'boolean'
    ),
    (
        'vista_montana',
        'Vista a la montaña',
        'views',
        'boolean'
    ),
    (
        'vista_panoramica',
        'Vista panorámica',
        'views',
        'boolean'
    ),
    (
        'mascotas',
        'Se admiten mascotas',
        'rules',
        'boolean'
    ),
    -- Features específicos de "Habitación" (arriendo de habitaciones)
    (
        'bano_privado',
        'Baño privado',
        'comfort',
        'boolean'
    ),
    (
        'bano_compartido',
        'Baño compartido',
        'comfort',
        'boolean'
    ),
    (
        'habitacion_amoblada',
        'Habitación amoblada',
        'comfort',
        'boolean'
    ),
    (
        'servicios_incluidos',
        'Servicios públicos incluidos',
        'services',
        'boolean'
    ),
    (
        'internet_incluido',
        'Internet incluido',
        'services',
        'boolean'
    ),
    (
        'alimentacion_incluida',
        'Alimentación incluida',
        'services',
        'boolean'
    ),
    (
        'uso_cocina',
        'Uso de cocina permitido',
        'rules',
        'boolean'
    ),
    (
        'uso_sala',
        'Uso de sala permitido',
        'rules',
        'boolean'
    ),
    (
        'uso_lavadora',
        'Uso de lavadora permitido',
        'rules',
        'boolean'
    ),
    (
        'acceso_independiente',
        'Acceso independiente',
        'comfort',
        'boolean'
    ),
    (
        'solo_estudiantes',
        'Solo estudiantes',
        'rules',
        'boolean'
    ),
    (
        'solo_mujeres',
        'Solo mujeres',
        'rules',
        'boolean'
    ),
    (
        'solo_hombres',
        'Solo hombres',
        'rules',
        'boolean'
    ),
    (
        'no_mascotas',
        'No se admiten mascotas',
        'rules',
        'boolean'
    ),
    (
        'no_fumadores',
        'No fumadores',
        'rules',
        'boolean'
    ),
    (
        'parqueo_bicicleta',
        'Parqueadero para bicicleta',
        'comfort',
        'boolean'
    ),
    (
        'escritorio',
        'Escritorio / espacio de trabajo',
        'comfort',
        'boolean'
    ),
    (
        'closet_empotrado',
        'Closet empotrado',
        'comfort',
        'boolean'
    ),
    (
        'tv_cable',
        'TV por cable',
        'technology',
        'boolean'
    ),
    (
        'nevera_propio',
        'Nevera propia en la habitación',
        'comfort',
        'boolean'
    );
-- ============================================================================
-- ✅ SCHEMA CREADO CORRECTAMENTE (Versión 5.0 Colombia)
-- ============================================================================