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
-- 5b. room_seeker_profiles (perfil buscador de habitación, 1 por usuario)
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
-- 17. datos de catálogos
-- 18. ofertas por operación (réplica de migrations/001)
-- 19. tracking y leads (réplica de schema.tracking.sql; va ANTES del
--     bloque 18 porque este hace ALTER TABLE leads)
-- 20. vistas de detalle (estado final de migrations/002-008, sin FK en log)
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
    otp_login INTEGER,
    otp_login_expira TIMESTAMP,
    otp_login_intentos INTEGER DEFAULT 0,
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
-- 5b. PERFIL BUSCADOR DE HABITACIÓN (un perfil por usuario)
-- Presentación (quién soy como roomie) + preferencias de búsqueda
-- (pre-rellenan los filtros del listado de habitaciones).
-- Va aquí (tras geografía) porque referencia a states/cities.
-- ============================================================================
CREATE TABLE IF NOT EXISTS room_seeker_profiles (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    -- Presentación
    genero VARCHAR(20) CHECK (genero IN ('hombre', 'mujer', 'otro')),
    edad SMALLINT CHECK (edad BETWEEN 16 AND 100),
    ocupacion VARCHAR(20) CHECK (ocupacion IN ('estudio', 'trabajo', 'ambos')),
    fuma_en_casa BOOLEAN,
    tiene_mascota BOOLEAN,
    busca_con VARCHAR(20) DEFAULT 'solo_yo' CHECK (
        busca_con IN ('solo_yo', 'pareja', 'amigos')
    ),
    -- Búsqueda
    presupuesto_max INTEGER CHECK (presupuesto_max > 0),
    state_id INTEGER REFERENCES states(id) ON DELETE SET NULL,
    city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
    fecha_entrada DATE,
    habitacion_privada BOOLEAN,
    amoblada BOOLEAN,
    bano_privado BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_room_seeker_usuario ON room_seeker_profiles(usuario_id);
CREATE INDEX IF NOT EXISTS idx_room_seeker_city ON room_seeker_profiles(city_id);
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
DROP TRIGGER IF EXISTS trg_room_seeker_updated_at ON room_seeker_profiles;
CREATE TRIGGER trg_usuarios_updated_at BEFORE
UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_organizaciones_updated_at BEFORE
UPDATE ON organizaciones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_org_miembros_updated_at BEFORE
UPDATE ON organizacion_miembros FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_propiedades_updated_at BEFORE
UPDATE ON propiedades FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_room_seeker_updated_at BEFORE
UPDATE ON room_seeker_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
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
-- 19. TRACKING Y LEADS (réplica de src/database/schema.tracking.sql para
-- instalaciones nuevas; el orden respeta dependencias ya creadas)
-- ============================================================================
-- NOTA: este bloque es idéntico a src/database/schema.tracking.sql
-- (salvo este encabezado). Cualquier cambio debe hacerse en ambos.
-- Va ANTES del bloque 18 porque aquel hace ALTER TABLE leads.
-- ============================================================================
-- 19.1 SESIONES_TRACKING
-- Identifica a cada visitante (anónimo o logueado) de forma persistente
-- ============================================================================
CREATE TABLE IF NOT EXISTS sesiones_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) UNIQUE NOT NULL,
    usuario_id INTEGER,
    ip_address VARCHAR(45),
    user_agent TEXT,
    ciudad_aproximada VARCHAR(100),
    consentimiento_dado BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultima_actividad TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sesiones_session_id ON sesiones_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_id ON sesiones_tracking(usuario_id);

-- ============================================================================
-- 19.2 EVENTOS_TRACKING
-- Cada acción individual del visitante sobre una propiedad
-- ============================================================================
CREATE TABLE IF NOT EXISTS eventos_tracking (
    id BIGSERIAL PRIMARY KEY,
    sesion_id UUID NOT NULL,
    propiedad_id INTEGER NOT NULL,
    -- 'vista_propiedad' | 'vista_imagen' | 'favorito_agregado' |
    -- 'click_telefono' | 'click_whatsapp' | 'formulario_enviado' | 'tiempo_en_pagina'
    tipo_evento VARCHAR(50) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sesion_id) REFERENCES sesiones_tracking(id) ON DELETE CASCADE,
    FOREIGN KEY (propiedad_id) REFERENCES propiedades(id) ON DELETE CASCADE,
    CONSTRAINT tipo_evento_valido CHECK (
        tipo_evento IN (
            'vista_propiedad',
            'vista_imagen',
            'favorito_agregado',
            'click_telefono',
            'click_whatsapp',
            'formulario_enviado',
            'tiempo_en_pagina'
        )
    )
);
CREATE INDEX IF NOT EXISTS idx_eventos_sesion ON eventos_tracking(sesion_id);
CREATE INDEX IF NOT EXISTS idx_eventos_propiedad ON eventos_tracking(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo ON eventos_tracking(tipo_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_sesion_propiedad ON eventos_tracking(sesion_id, propiedad_id);

-- ============================================================================
-- 19.3 LEADS
-- Se crea cuando el scoring cruza el umbral, o cuando alguien manda un formulario
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL,
    sesion_id UUID,
    usuario_id INTEGER,
    nombre VARCHAR(150),
    email VARCHAR(150),
    telefono VARCHAR(30),
    score INTEGER NOT NULL DEFAULT 0,
    -- 'formulario_directo' | 'scoring_comportamiento'
    origen VARCHAR(50) NOT NULL,
    -- 'nuevo' | 'contactado' | 'en_negociacion' | 'cerrado' | 'descartado'
    estado VARCHAR(30) DEFAULT 'nuevo' NOT NULL,
    notificado BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (propiedad_id) REFERENCES propiedades(id) ON DELETE CASCADE,
    FOREIGN KEY (sesion_id) REFERENCES sesiones_tracking(id) ON DELETE SET NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    CONSTRAINT origen_lead_valido CHECK (
        origen IN ('formulario_directo', 'scoring_comportamiento')
    ),
    CONSTRAINT estado_lead_valido CHECK (
        estado IN (
            'nuevo',
            'contactado',
            'en_negociacion',
            'cerrado',
            'descartado'
        )
    ),
    -- Evita que dos eventos concurrentes (misma sesión + misma
    -- propiedad) generen dos leads y por lo tanto dos correos duplicados.
    -- Postgres trata cada NULL como distinto entre sí, así que esto NO
    -- afecta a los leads de origen 'formulario_directo' que no tengan
    -- sesion_id (pueden repetirse sin problema).
    CONSTRAINT uq_leads_sesion_propiedad UNIQUE (sesion_id, propiedad_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_propiedad ON leads(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);

-- Trigger updated_at (reutiliza update_updated_at_column() del schema central)
DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE
UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 18. OFERTAS POR OPERACIÓN (réplica de migrations/001_property_listings.sql
-- para instalaciones nuevas; el orden respeta dependencias ya creadas)
-- ============================================================================
-- NOTA: este bloque es idéntico a src/database/migrations/001_property_listings.sql
-- (salvo este encabezado). Cualquier cambio debe hacerse en ambos.

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
-- ============================================================================
-- 20. VISTAS DE DETALLE (estado final de migrations/002, 003, 004, 005, 007
-- y 008 para instalaciones nuevas; el orden respeta dependencias ya creadas)
-- ============================================================================
-- NOTA: cualquier cambio debe hacerse también en la migración correspondiente.
-- Sin FK de vistas_log a propiedades (003): el log sobrevive al borrado.
BEGIN;

-- 20.1 Log: un registro por evento RECIBIDO, siempre (fuente de verdad).
CREATE TABLE IF NOT EXISTS vistas_log (
    event_id BIGSERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_local DATE NOT NULL,
    propiedad_id INTEGER NOT NULL,
    agency_id INTEGER REFERENCES organizaciones(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    anon_id VARCHAR(100),
    identidad_debil BOOLEAN NOT NULL DEFAULT FALSE,
    ip_hash VARCHAR(128) NOT NULL,
    user_agent TEXT,
    source VARCHAR(50),
    utm JSONB,
    referer TEXT,
    visible_seconds INTEGER,
    server_elapsed_ms INTEGER NOT NULL,
    result VARCHAR(10) NOT NULL CHECK (result IN ('counted','rejected')),
    reason VARCHAR(30) NOT NULL CHECK (reason IN (
        'counted','evento_invalido','token_invalido','token_expirado',
        'token_reutilizado','tiempo_insuficiente','inmueble_inexistente',
        'inmueble_no_activo','sin_identidad','interno','bot',
        'rate_limit','duplicado','tope_diario','tope_ip',
        'visible_incoherente','error_sistema')),
    sospechoso BOOLEAN NOT NULL DEFAULT FALSE,
    rules_version VARCHAR(20) NOT NULL DEFAULT 'v1',
    CONSTRAINT chk_vistas_log_result_reason CHECK (
        (result = 'counted' AND reason = 'counted') OR
        (result = 'rejected' AND reason <> 'counted'))
);
CREATE INDEX IF NOT EXISTS idx_vistas_log_prop_fecha ON vistas_log(propiedad_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_vistas_log_agencia_fecha ON vistas_log(agency_id, fecha_local);
CREATE INDEX IF NOT EXISTS idx_vistas_log_user ON vistas_log(user_id);

-- 20.2 Resumen diario por inmueble (DERIVADO del log, recalculable).
CREATE TABLE IF NOT EXISTS vistas_resumen_diario (
    propiedad_id INTEGER NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
    fecha_local DATE NOT NULL,
    vistas INTEGER NOT NULL DEFAULT 0 CHECK (vistas >= 0),
    visitantes_unicos INTEGER NOT NULL DEFAULT 0 CHECK (visitantes_unicos >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (propiedad_id, fecha_local)
);

-- 20.3 Vinculación anon_id <-> user_id (dedupe y tope cruzan identidades).
CREATE TABLE IF NOT EXISTS vistas_identidades (
    anon_id VARCHAR(100) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (anon_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_vistas_ident_user ON vistas_identidades(user_id);
CREATE INDEX IF NOT EXISTS idx_vistas_ident_anon ON vistas_identidades(anon_id);

-- 20.4 Agregado anti-inflado de log (máx 1 fila/min/IP para rate_limit).
CREATE TABLE IF NOT EXISTS vistas_rate_limit_agregado (
    ip_hash VARCHAR(128) NOT NULL,
    ventana_minuto TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(30) NOT NULL DEFAULT 'rate_limit' CHECK (motivo = 'rate_limit'),
    conteo INTEGER NOT NULL DEFAULT 1 CHECK (conteo >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ip_hash, ventana_minuto)
);

-- 20.5 IPs/rangos de bots (carga en memoria del tracking, recarga 10 min).
CREATE TABLE IF NOT EXISTS vistas_bot_ips (
    id SERIAL PRIMARY KEY,
    cidr CIDR NOT NULL UNIQUE,
    descripcion VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20.6 Índice parcial para la consolidación (solo counted recientes).
CREATE INDEX IF NOT EXISTS idx_vistas_log_prop_fecha_counted
    ON vistas_log (propiedad_id, fecha_local)
    WHERE result = 'counted';

COMMIT;
-- ============================================================================
-- ✅ SCHEMA CREADO CORRECTAMENTE (Versión 5.0 Colombia + Ofertas por operación + Tracking + Vistas)
-- ============================================================================

-- ============================================================================
-- 21. BÚSQUEDAS GUARDADAS CON ALERTAS (migración 009, idempotente).
--     Fuente: src/database/migrations/009_busquedas_guardadas.sql
-- ============================================================================
BEGIN;

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

CREATE TABLE IF NOT EXISTS saved_search_notifications (
  id          BIGSERIAL PRIMARY KEY,
  search_id   INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  event_id    BIGINT  NOT NULL REFERENCES property_events(id) ON DELETE CASCADE,
  canal       VARCHAR(10) NOT NULL DEFAULT 'email' CHECK (canal IN ('email','push')),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (search_id, event_id, canal)
);

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