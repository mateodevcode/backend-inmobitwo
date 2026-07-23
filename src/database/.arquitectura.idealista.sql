-- ============================================================
-- ESQUEMA: idealista
-- DESCRIPCIÓN: Base de datos relacional para almacenar
--              fichas de inmuebles de Idealista
-- ============================================================
CREATE SCHEMA IF NOT EXISTS idealista;
-- ============================================================
-- 1. TABLAS DE CATÁLOGOS / LOOKUPS (normalización de valores fijos)
-- ============================================================
-- Tipos de operación: venta, alquiler, alquiler_temporal
CREATE TABLE idealista.operation_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    label_es VARCHAR(50) NOT NULL,
    label_en VARCHAR(50)
);
-- Tipos de propiedad: piso, ático, dúplex, chalet, estudio, etc.
CREATE TABLE idealista.property_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    label_es VARCHAR(50) NOT NULL,
    label_en VARCHAR(50),
    category VARCHAR(30) -- 'residential', 'commercial', 'garage', etc.
);
-- Tipos de anunciante
CREATE TABLE idealista.advertiser_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    -- 'agency', 'private', 'builder', 'bank'
    label_es VARCHAR(50) NOT NULL
);
-- Estados del inmueble
CREATE TABLE idealista.condition_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    -- 'new', 'good', 'renovated', 'to_renovate'
    label_es VARCHAR(50) NOT NULL
);
-- Tipos de orientación
CREATE TABLE idealista.orientation_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    -- 'north', 'south', 'east', 'west', 'northeast'...
    label_es VARCHAR(30) NOT NULL
);
-- Tipos de calefacción
CREATE TABLE idealista.heating_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    -- 'natural_gas', 'electric', 'diesel', 'solar'...
    label_es VARCHAR(50) NOT NULL
);
-- Tipos de certificación energética
CREATE TABLE idealista.energy_ratings (
    id SMALLSERIAL PRIMARY KEY,
    letter CHAR(1) NOT NULL UNIQUE CHECK (letter IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
    description VARCHAR(100)
);
-- ============================================================
-- 2. TABLA PRINCIPAL: INMUEBLES (properties)
-- ============================================================
CREATE TABLE idealista.properties (
    -- Identidad
    id BIGSERIAL PRIMARY KEY,
    idealista_id VARCHAR(20) NOT NULL UNIQUE,
    -- ej: '112091457'
    url TEXT NOT NULL,
    title VARCHAR(500) NOT NULL,
    slug VARCHAR(500),
    -- Relaciones a catálogos
    operation_type_id SMALLINT NOT NULL REFERENCES idealista.operation_types(id),
    property_type_id SMALLINT NOT NULL REFERENCES idealista.property_types(id),
    condition_type_id SMALLINT REFERENCES idealista.condition_types(id),
    -- Precio
    price NUMERIC(12, 2) NOT NULL CHECK (price > 0),
    currency VARCHAR(3) DEFAULT 'EUR',
    price_per_sqm NUMERIC(10, 2) GENERATED ALWAYS AS (
        CASE
            WHEN constructed_area > 0 THEN price / constructed_area
            ELSE NULL
        END
    ) STORED,
    price_includes_vat BOOLEAN DEFAULT FALSE,
    community_fees NUMERIC(10, 2),
    ibi_annual NUMERIC(10, 2),
    -- Impuesto de Bienes Inmuebles
    -- Ubicación (denormalizado para queries rápidas, con referencia geoespacial)
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    street VARCHAR(255),
    street_number VARCHAR(20),
    floor VARCHAR(20),
    -- "3º", "Bajo", "Entreplanta"
    door VARCHAR(10),
    neighborhood VARCHAR(100),
    district VARCHAR(100),
    city VARCHAR(100) NOT NULL,
    province VARCHAR(100) NOT NULL,
    postal_code VARCHAR(10),
    country VARCHAR(2) DEFAULT 'ES',
    -- Coordenadas geoespaciales (PostGIS)
    location GEOGRAPHY(POINT, 4326),
    -- Características físicas
    constructed_area NUMERIC(8, 2) CHECK (constructed_area > 0),
    -- m² construidos
    usable_area NUMERIC(8, 2) CHECK (usable_area > 0),
    -- m² útiles
    plot_area NUMERIC(8, 2),
    -- m² parcela (chalets)
    room_count SMALLINT CHECK (room_count >= 0),
    bedroom_count SMALLINT CHECK (bedroom_count >= 0),
    bathroom_count SMALLINT CHECK (bathroom_count >= 0),
    toilet_count SMALLINT CHECK (toilet_count >= 0),
    total_floors_building SMALLINT,
    floor_number SMALLINT,
    -- -1 = sótano, 0 = bajo
    has_elevator BOOLEAN DEFAULT FALSE,
    is_duplex BOOLEAN DEFAULT FALSE,
    is_studio BOOLEAN DEFAULT FALSE,
    is_penthouse BOOLEAN DEFAULT FALSE,
    is_ground_floor BOOLEAN DEFAULT FALSE,
    has_terrace BOOLEAN DEFAULT FALSE,
    terrace_area NUMERIC(8, 2),
    has_balcony BOOLEAN DEFAULT FALSE,
    has_garden BOOLEAN DEFAULT FALSE,
    garden_area NUMERIC(8, 2),
    has_swimming_pool BOOLEAN DEFAULT FALSE,
    has_storage_room BOOLEAN DEFAULT FALSE,
    has_parking_space BOOLEAN DEFAULT FALSE,
    parking_space_included BOOLEAN DEFAULT FALSE,
    parking_space_price NUMERIC(12, 2),
    parking_space_count SMALLINT DEFAULT 0,
    -- Construcción
    construction_year SMALLINT CHECK (
        construction_year BETWEEN 1000 AND 2100
    ),
    is_new_construction BOOLEAN DEFAULT FALSE,
    is_bank_owned BOOLEAN DEFAULT FALSE,
    -- De banco / embargado
    -- Equipamiento
    has_air_conditioning BOOLEAN DEFAULT FALSE,
    has_heating BOOLEAN DEFAULT FALSE,
    heating_type_id SMALLINT REFERENCES idealista.heating_types(id),
    orientation_id SMALLINT REFERENCES idealista.orientation_types(id),
    is_furnished BOOLEAN,
    -- Certificación energética
    energy_consumption_rating_id SMALLINT REFERENCES idealista.energy_ratings(id),
    energy_emissions_rating_id SMALLINT REFERENCES idealista.energy_ratings(id),
    energy_certificate_number VARCHAR(50),
    -- Descripción
    description TEXT,
    -- Anunciante
    advertiser_type_id SMALLINT REFERENCES idealista.advertiser_types(id),
    advertiser_name VARCHAR(200),
    advertiser_phone VARCHAR(20),
    advertiser_email VARCHAR(255),
    advertiser_url TEXT,
    advertiser_logo_url TEXT,
    -- Metadatos del anuncio
    listing_status VARCHAR(20) DEFAULT 'active' CHECK (
        listing_status IN ('active', 'inactive', 'sold', 'rented', 'expired')
    ),
    published_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source_url TEXT,
    -- Auditoría
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    modified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Índices para performance
CREATE INDEX idx_properties_price ON idealista.properties(price);
CREATE INDEX idx_properties_city ON idealista.properties(city);
CREATE INDEX idx_properties_neighborhood ON idealista.properties(neighborhood);
CREATE INDEX idx_properties_postal_code ON idealista.properties(postal_code);
CREATE INDEX idx_properties_operation ON idealista.properties(operation_type_id);
CREATE INDEX idx_properties_type ON idealista.properties(property_type_id);
CREATE INDEX idx_properties_status ON idealista.properties(listing_status);
CREATE INDEX idx_properties_published ON idealista.properties(published_at);
CREATE INDEX idx_properties_location ON idealista.properties USING GIST(location);
-- PostGIS
CREATE INDEX idx_properties_price_sqm ON idealista.properties(price_per_sqm);
CREATE INDEX idx_properties_rooms ON idealista.properties(room_count);
CREATE INDEX idx_properties_area ON idealista.properties(constructed_area);
CREATE INDEX idx_properties_year ON idealista.properties(construction_year);
CREATE INDEX idx_properties_composite ON idealista.properties(city, operation_type_id, property_type_id, price);
-- ============================================================
-- 3. TABLA DE IMÁGENES (property_images) — 1:N con properties
-- ============================================================
CREATE TABLE idealista.property_images (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES idealista.properties(id) ON DELETE CASCADE,
    -- Metadatos de la imagen
    image_url TEXT NOT NULL,
    thumbnail_url TEXT,
    high_res_url TEXT,
    -- Clasificación por estancia (Idealista agrupa fotos por habitación)
    room_label VARCHAR(50),
    -- 'Salón', 'Cocina', 'Dormitorio principal', 'Baño', 'Terraza'...
    room_type VARCHAR(30),
    -- 'living_room', 'kitchen', 'bedroom', 'bathroom', 'exterior', 'plan', 'other'
    -- Orden y estado
    display_order SMALLINT NOT NULL DEFAULT 0,
    is_main_image BOOLEAN DEFAULT FALSE,
    -- Foto principal/portada
    is_floor_plan BOOLEAN DEFAULT FALSE,
    -- Metadatos técnicos
    width_px SMALLINT,
    height_px SMALLINT,
    file_size_kb INTEGER,
    mime_type VARCHAR(30),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_images_property ON idealista.property_images(property_id);
CREATE INDEX idx_images_main ON idealista.property_images(property_id, is_main_image)
WHERE is_main_image = TRUE;
CREATE INDEX idx_images_room ON idealista.property_images(property_id, room_type);
-- ============================================================
-- 4. TABLA DE CARACTERÍSTICAS ADICIONALES (property_features) — N:M flexible
-- ============================================================
-- Catálogo de características posibles
CREATE TABLE idealista.feature_catalog (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    label_es VARCHAR(100) NOT NULL,
    category VARCHAR(30),
    -- 'security', 'comfort', 'leisure', 'accessibility', 'technology'
    data_type VARCHAR(20) DEFAULT 'boolean' CHECK (data_type IN ('boolean', 'numeric', 'text'))
);
-- Valores por inmueble
CREATE TABLE idealista.property_features (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES idealista.properties(id) ON DELETE CASCADE,
    feature_id SMALLINT NOT NULL REFERENCES idealista.feature_catalog(id),
    -- Valor (puede ser booleano, numérico o texto según feature)
    bool_value BOOLEAN,
    numeric_value NUMERIC(10, 2),
    text_value VARCHAR(255),
    UNIQUE(property_id, feature_id)
);
CREATE INDEX idx_features_property ON idealista.property_features(property_id);
CREATE INDEX idx_features_catalog ON idealista.property_features(feature_id);
-- ============================================================
-- 5. TABLA DE HISTORIAL DE PRECIOS (price_history) — trazabilidad temporal
-- ============================================================
CREATE TABLE idealista.price_history (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES idealista.properties(id) ON DELETE CASCADE,
    old_price NUMERIC(12, 2),
    new_price NUMERIC(12, 2) NOT NULL,
    price_change NUMERIC(12, 2) GENERATED ALWAYS AS (new_price - COALESCE(old_price, 0)) STORED,
    change_percent NUMERIC(5, 2) GENERATED ALWAYS AS (
        CASE
            WHEN old_price > 0 THEN ROUND(((new_price - old_price) / old_price) * 100, 2)
            ELSE NULL
        END
    ) STORED,
    change_type VARCHAR(20) CHECK (
        change_type IN ('increase', 'decrease', 'initial', 'relisted')
    ),
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    source VARCHAR(50) DEFAULT 'scraper'
);
CREATE INDEX idx_price_history_property ON idealista.price_history(property_id);
CREATE INDEX idx_price_history_date ON idealista.price_history(detected_at);
-- ============================================================
-- 6. TABLA DE HISTORIAL DE SCRAPING (scraping_logs) — auditoría
-- ============================================================
CREATE TABLE idealista.scraping_logs (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT REFERENCES idealista.properties(id),
    idealista_id VARCHAR(20),
    url TEXT,
    status VARCHAR(20) NOT NULL CHECK (
        status IN (
            'success',
            'error',
            'not_found',
            'blocked',
            'timeout'
        )
    ),
    http_status SMALLINT,
    error_message TEXT,
    response_time_ms INTEGER,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);
CREATE INDEX idx_scraping_logs_property ON idealista.scraping_logs(property_id);
CREATE INDEX idx_scraping_logs_status ON idealista.scraping_logs(status);
CREATE INDEX idx_scraping_logs_date ON idealista.scraping_logs(scraped_at);
-- ============================================================
-- 7. TABLA DE PROPIEDADES RELACIONADAS / UNIDADES (related_units)
-- ============================================================
-- Idealista a veces muestra "unidades relacionadas" en el mismo edificio/complejo
CREATE TABLE idealista.related_units (
    id BIGSERIAL PRIMARY KEY,
    parent_property_id BIGINT NOT NULL REFERENCES idealista.properties(id) ON DELETE CASCADE,
    child_property_id BIGINT NOT NULL REFERENCES idealista.properties(id) ON DELETE CASCADE,
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
CREATE INDEX idx_related_parent ON idealista.related_units(parent_property_id);
CREATE INDEX idx_related_child ON idealista.related_units(child_property_id);
-- ============================================================
-- 8. POBLAR CATÁLOGOS
-- ============================================================
INSERT INTO idealista.operation_types (code, label_es, label_en)
VALUES ('sale', 'Venta', 'Sale'),
    ('rent', 'Alquiler', 'Rent'),
    (
        'rent_temporal',
        'Alquiler temporal',
        'Temporary rent'
    ),
    ('share', 'Compartir', 'Room sharing');
INSERT INTO idealista.property_types (code, label_es, label_en, category)
VALUES ('flat', 'Piso', 'Flat', 'residential'),
    ('penthouse', 'Ático', 'Penthouse', 'residential'),
    ('duplex', 'Dúplex', 'Duplex', 'residential'),
    ('studio', 'Estudio', 'Studio', 'residential'),
    ('chalet', 'Chalet', 'Chalet', 'residential'),
    ('house', 'Casa', 'House', 'residential'),
    (
        'townhouse',
        'Casa adosada',
        'Townhouse',
        'residential'
    ),
    (
        'country_house',
        'Casa rural',
        'Country house',
        'residential'
    ),
    ('office', 'Oficina', 'Office', 'commercial'),
    ('premises', 'Local', 'Premises', 'commercial'),
    ('garage', 'Garaje', 'Garage', 'parking'),
    ('storage', 'Trastero', 'Storage room', 'storage'),
    ('building', 'Edificio', 'Building', 'commercial');
INSERT INTO idealista.advertiser_types (code, label_es)
VALUES ('private', 'Particular'),
    ('agency', 'Inmobiliaria'),
    ('builder', 'Promotora'),
    ('bank', 'Entidad bancaria'),
    ('developer', 'Desarrollador');
INSERT INTO idealista.condition_types (code, label_es)
VALUES ('new', 'A estrenar'),
    ('good', 'Buen estado'),
    ('renovated', 'Reformado'),
    ('to_renovate', 'Para reformar'),
    ('under_construction', 'En construcción');
INSERT INTO idealista.energy_ratings (letter, description)
VALUES ('A', 'Muy eficiente'),
    ('B', 'Eficiente'),
    ('C', 'Moderadamente eficiente'),
    ('D', 'Poco eficiente'),
    ('E', 'Ineficiente'),
    ('F', 'Muy ineficiente'),
    ('G', 'Extremadamente ineficiente');
INSERT INTO idealista.feature_catalog (code, label_es, category, data_type)
VALUES (
        'security_door',
        'Puerta de seguridad',
        'security',
        'boolean'
    ),
    (
        'alarm',
        'Sistema de alarma',
        'security',
        'boolean'
    ),
    (
        'video_intercom',
        'Videoportero',
        'security',
        'boolean'
    ),
    (
        'concierge',
        'Portero físico',
        'security',
        'boolean'
    ),
    (
        'access_control',
        'Control de accesos',
        'security',
        'boolean'
    ),
    (
        'double_glazing',
        'Doble acristalamiento',
        'comfort',
        'boolean'
    ),
    (
        'fitted_wardrobes',
        'Armarios empotrados',
        'comfort',
        'boolean'
    ),
    (
        'parquet',
        'Suelo de parquet',
        'comfort',
        'boolean'
    ),
    (
        'marble_floor',
        'Suelo de mármol',
        'comfort',
        'boolean'
    ),
    (
        'smoke_detector',
        'Detector de humo',
        'safety',
        'boolean'
    ),
    (
        'fiber_optic',
        'Fibra óptica',
        'technology',
        'boolean'
    ),
    (
        'solar_panels',
        'Placas solares',
        'sustainability',
        'boolean'
    ),
    (
        'accessibility_ramp',
        'Rampa de accesibilidad',
        'accessibility',
        'boolean'
    ),
    (
        'adapted_bathroom',
        'Baño adaptado',
        'accessibility',
        'boolean'
    ),
    ('sea_views', 'Vistas al mar', 'views', 'boolean'),
    (
        'mountain_views',
        'Vistas a la montaña',
        'views',
        'boolean'
    ),
    (
        'city_views',
        'Vistas a la ciudad',
        'views',
        'boolean'
    ),
    (
        'courtyard_views',
        'Vistas a patio',
        'views',
        'boolean'
    ),
    (
        'pets_allowed',
        'Se admiten mascotas',
        'rules',
        'boolean'
    ),
    (
        'smokers_allowed',
        'Se permite fumar',
        'rules',
        'boolean'
    );
-- ============================================================
-- 9. TRIGGER PARA ACTUALIZAR modified_at
-- ============================================================
CREATE OR REPLACE FUNCTION idealista.update_modified_at() RETURNS TRIGGER AS $$ BEGIN NEW.modified_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_properties_modified BEFORE
UPDATE ON idealista.properties FOR EACH ROW EXECUTE FUNCTION idealista.update_modified_at();
-- ============================================================
-- 10. VISTAS ÚTILES
-- ============================================================
-- Vista resumen para dashboards
CREATE OR REPLACE VIEW idealista.v_property_summary AS
SELECT p.id,
    p.idealista_id,
    p.title,
    p.price,
    p.price_per_sqm,
    p.constructed_area,
    p.room_count,
    p.bathroom_count,
    p.city,
    p.neighborhood,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    ot.label_es AS operation,
    pt.label_es AS property_type,
    p.listing_status,
    p.published_at,
    p.updated_at,
    (
        SELECT image_url
        FROM idealista.property_images pi2
        WHERE pi2.property_id = p.id
            AND pi2.is_main_image = TRUE
        LIMIT 1
    ) AS main_image_url
FROM idealista.properties p
    JOIN idealista.operation_types ot ON p.operation_type_id = ot.id
    JOIN idealista.property_types pt ON p.property_type_id = pt.id
WHERE p.listing_status = 'active';
-- Vista de últimos cambios de precio
CREATE OR REPLACE VIEW idealista.v_recent_price_changes AS
SELECT p.idealista_id,
    p.title,
    p.city,
    ph.old_price,
    ph.new_price,
    ph.price_change,
    ph.change_percent,
    ph.change_type,
    ph.detected_at
FROM idealista.price_history ph
    JOIN idealista.properties p ON ph.property_id = p.id
WHERE ph.detected_at >= NOW() - INTERVAL '30 days'
ORDER BY ph.detected_at DESC;