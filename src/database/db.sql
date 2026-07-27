-- ============================================================================
-- SCHEMA COMPLETO — PLATAFORMA INMOBILIARIA
-- Versión: 3.6 — Geometría PostGIS + DANE codes + Barrios completos
-- ============================================================================
-- ORDEN DE CREACIÓN:
-- 0. extensiones (PostGIS, pg_trgm, unaccent)
-- 1. usuarios
-- 2. organizaciones (inmobiliarias / tenants)
-- 3. organizacion_miembros (relación usuarios ↔ organizaciones)
-- 4. countries / regions / states / cities
-- 5. barrios (nuevo)
-- 6. propiedades
-- 7. propiedades_galeria
-- 8. usuario_favoritos
-- 9. refresh_tokens (para JWT)
-- 10. función update_updated_at
-- 11. triggers
-- ============================================================================
-- ============================================================================
-- 0. EXTENSIONES PREVIAS REQUERIDAS
-- ============================================================================
-- Activada para permitir búsquedas dinámicas en el mapa local mediante figuras
-- geométricas o polígonos dibujados a mano de forma gratuita.
CREATE EXTENSION IF NOT EXISTS postgis;
-- 👈 NUEVO v3.4: Habilita búsqueda eficiente de substrings (ILIKE '%texto%')
-- Necesaria para el autocompletado de ciudades tipo Idealista (suggest-cities)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- 👈 NUEVO v3.5: Habilita búsqueda insensible a tildes (unaccent)
-- Convierte á→a, é→e, í→i, ó→o, ú→u, ñ→n para que "malaga" encuentre "Málaga"
CREATE EXTENSION IF NOT EXISTS unaccent;
-- 👈 NUEVO v3.5: Wrapper IMMUTABLE de unaccent() para poder usarlo en índices
-- PostgreSQL marca unaccent() como STABLE, pero los índices requieren IMMUTABLE
CREATE OR REPLACE FUNCTION f_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
-- ============================================================================
-- 1. USUARIOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),
    telefono VARCHAR(20),
    -- Rol global: 'guest' solo existe en frontend, en DB mínimo es 'user'
    -- 'user' | 'superadmin'
    rol VARCHAR(50) DEFAULT 'user' NOT NULL,
    -- Auth social
    provider VARCHAR(50) DEFAULT 'local',
    -- 'local' | 'google' | 'github'
    provider_id VARCHAR(255),
    -- Avatar
    image_url VARCHAR(500),
    public_id VARCHAR(255),
    -- Seguridad
    email_verificado BOOLEAN DEFAULT false,
    codigo_verificacion INTEGER,
    date_codigo_verificacion TIMESTAMP,
    bloqueado BOOLEAN DEFAULT false,
    intentos_fallidos INTEGER DEFAULT 0,
    ultimo_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rol_valido CHECK (rol IN ('user', 'superadmin'))
);
-- ============================================================================
-- 2. ORGANIZACIONES (INMOBILIARIAS / TENANTS)
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
    -- ------------------------------------------------------------------
    -- MULTI-TENANT: identidad web de la organización
    -- ------------------------------------------------------------------
    -- slug -> usado en ://inmobitwo.com
    -- Se genera automáticamente a partir del nombre al crear la organización.
    slug VARCHAR(150) UNIQUE,
    -- custom_domain -> dominio propio del cliente (ej: ://inmobiliariaoviedo.com)
    -- NULL mientras no tenga dominio propio configurado.
    custom_domain VARCHAR(255) UNIQUE,
    -- dominio_estado -> ciclo de vida de la configuración del dominio propio
    -- 'sin_dominio'   -> usa solo el slug bajo inmobitwo.com
    -- 'pendiente_dns' -> el cliente ya dio su dominio, falta verificar DNS + emitir SSL
    -- 'activo'        -> DNS verificado y SSL emitido, dominio propio funcionando
    dominio_estado VARCHAR(50) DEFAULT 'sin_dominio' NOT NULL,
    -- plan -> para el futuro cobro por premium
    plan VARCHAR(50) DEFAULT 'free' NOT NULL,
    -- ------------------------------------------------------------------
    -- Estado de aprobación de la organización
    -- ------------------------------------------------------------------
    -- 'pendiente' -> recién solicitada
    -- 'aprobada'  -> visible y operativa
    -- 'suspendida'-> bloqueada por superadmin
    estado VARCHAR(50) DEFAULT 'pendiente' NOT NULL,
    -- ------------------------------------------------------------------
    -- DISEÑO DEL ESCAPARATE — NUEVO en v3.2
    -- ------------------------------------------------------------------
    -- tema -> qué plantilla de landing usa el escaparate público de esta
    -- organización (mismo dato de fondo, distinto diseño/layout).
    -- 'tema1' (Clásico) | 'tema2' (Moderno) | 'tema3' (Con mapa) | 'tema4' (Minimalista)
    tema VARCHAR(50) DEFAULT 'tema1' NOT NULL,
    -- Usuario que solicitó crear la organización
    creada_por_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creada_por_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
    CONSTRAINT estado_org_valido CHECK (
        estado IN ('pendiente', 'aprobada', 'suspendida')
    ),
    CONSTRAINT dominio_estado_valido CHECK (
        dominio_estado IN ('sin_dominio', 'pendiente_dns', 'activo')
    ),
    CONSTRAINT plan_valido CHECK (plan IN ('free', 'premium')),
    CONSTRAINT tema_valido CHECK (
        tema IN ('tema1', 'tema2', 'tema3', 'tema4')
    )
);
CREATE INDEX IF NOT EXISTS idx_organizaciones_slug ON organizaciones(slug);
CREATE INDEX IF NOT EXISTS idx_organizaciones_custom_domain ON organizaciones(custom_domain);
-- ============================================================================
-- 3. ORGANIZACION_MIEMBROS
-- Un usuario puede pertenecer a varias organizaciones con distintos roles
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizacion_miembros (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    organizacion_id INTEGER NOT NULL,
    -- Rol dentro de la organización
    -- 'agent'        → agente, publica bajo el sello de la inmo
    -- 'agency_admin' → administra la inmo y sus agentes
    rol_en_org VARCHAR(50) DEFAULT 'agent' NOT NULL,
    -- Un agente puede ser invitado o unirse por solicitud
    estado VARCHAR(50) DEFAULT 'activo' NOT NULL,
    -- 'activo' | 'suspendido'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id) ON DELETE CASCADE,
    -- Un usuario solo puede tener un rol por organización
    UNIQUE (usuario_id, organizacion_id),
    CONSTRAINT rol_org_valido CHECK (rol_en_org IN ('agent', 'agency_admin')),
    CONSTRAINT estado_miembro_valido CHECK (estado IN ('activo', 'suspendido'))
);
-- ============================================================================
-- 4. GEOGRAFÍA: countries → regions → states → cities
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
-- "states" cubre tanto provincias (España) como departamentos (Colombia)
CREATE TABLE IF NOT EXISTS states (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
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
-- ============================================================================
-- 4.1 GEOGRAFÍA: BARRIOS (Neighborhoods)
-- ============================================================================
CREATE TABLE IF NOT EXISTS barrios (
    id SERIAL PRIMARY KEY,
    city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150),
    dane_code VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    -- Polígono del barrio (acepta Polygon y MultiPolygon)
    geom GEOMETRY(Geometry, 4326), 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ============================================================================
-- 5. PROPIEDADES
-- ============================================================================
CREATE TABLE IF NOT EXISTS propiedades (
    id SERIAL PRIMARY KEY,
    -- Contenido
    -- ['piso', 'apartamento']
    tipo VARCHAR(255),
    -- ['venta', 'alquiler']
    operacion VARCHAR(255),
    -- Ubicación: catálogo (FK a countries/states/cities)
    -- NULL permitido a propósito: el wizard permite guardar el borrador
    -- de una propiedad antes de completar el paso de ubicación.
    country_id INTEGER,
    state_id INTEGER,
    city_id INTEGER,
    barrio_id INTEGER REFERENCES barrios(id) ON DELETE SET NULL,
    -- Ubicación: texto libre (no existe en ningún catálogo)
    direccion VARCHAR(255),
    numero_direccion VARCHAR(50),
    -- Ubicación: coordenada final confirmada en el mapa (paso de Nominatim + Leaflet)
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    geom GEOMETRY(Point, 4326),
    -- 👈 NUEVO v3.3: Punto geográfico nativo indexado para mapas eficientes
    titulo VARCHAR(255),
    precio INTEGER,
    -- Imagenes
    imagen_principal_url VARCHAR(500),
    imagen_principal_public_id VARCHAR(255),
    -- Estado de la propiedad
    estado VARCHAR(50) NOT NULL DEFAULT 'publicado',
    -- Publicador
    publicado_por_id INTEGER NOT NULL,
    -- Organización (opcional — si se publica bajo el sello de una inmo)
    organizacion_id INTEGER,
    es_de_organizacion BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (publicado_por_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id) ON DELETE
    SET NULL,
        FOREIGN KEY (country_id) REFERENCES countries(id),
        FOREIGN KEY (state_id) REFERENCES states(id),
        FOREIGN KEY (city_id) REFERENCES cities(id),
        CONSTRAINT estado_propiedad_valido CHECK (
            estado IN ('publicado', 'no_publicado')
        )
);
CREATE INDEX IF NOT EXISTS idx_propiedades_country_id ON propiedades(country_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_state_id ON propiedades(state_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_city_id ON propiedades(city_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_barrio_id ON propiedades(barrio_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_organizacion_id ON propiedades(organizacion_id);
CREATE INDEX IF NOT EXISTS idx_propiedades_geom ON propiedades USING GIST(geom);
-- 👈 NUEVO v3.3: Índice espacial GIST para velocidad de pines en mapas
-- ============================================================================
-- 6. PROPIEDADES_GALERIA
-- ============================================================================
CREATE TABLE IF NOT EXISTS propiedades_galeria (
    id SERIAL PRIMARY KEY,
    propiedad_id INTEGER NOT NULL,
    url VARCHAR(500) NOT NULL,
    public_id VARCHAR(255),
    orden INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (propiedad_id) REFERENCES propiedades(id) ON DELETE CASCADE
);
-- ============================================================================
-- 7. USUARIO_FAVORITOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS usuario_favoritos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    propiedad_id INTEGER NOT NULL,
    -- Fecha en la que el usuario guardó la propiedad como favorito
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (propiedad_id) REFERENCES propiedades(id) ON DELETE CASCADE,
    -- Evita que un usuario guarde la misma propiedad varias veces
    UNIQUE (usuario_id, propiedad_id)
);
CREATE INDEX IF NOT EXISTS idx_usuario_favoritos_usuario_id ON usuario_favoritos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_favoritos_propiedad_id ON usuario_favoritos(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_usuario_favoritos_created_at ON usuario_favoritos(created_at);
-- ============================================================================
-- 8. REFRESH TOKENS (para renovar access_token sin re-login)
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    token VARCHAR(512) NOT NULL UNIQUE,
    expira_en TIMESTAMP NOT NULL,
    revocado BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
-- ============================================================================
-- 9. FUNCIÓN PARA ACTUALIZAR updated_at AUTOMÁTICAMENTE
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = CURRENT_TIMESTAMP;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 👈 NUEVO v3.6: Mantiene geom sincronizado con lat/lng
CREATE OR REPLACE FUNCTION sync_geom_from_lat_lng() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- ============================================================================
-- 10. TRIGGERS
-- ============================================================================
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
DROP TRIGGER IF EXISTS trg_propiedades_geom_sync ON propiedades;
CREATE TRIGGER trg_propiedades_geom_sync BEFORE INSERT OR UPDATE ON propiedades
FOR EACH ROW EXECUTE FUNCTION sync_geom_from_lat_lng();
-- ============================================================================
-- 11. ÍNDICES PARA BÚSQUEDA EFICIENTE
-- ============================================================================
-- Índices para la tabla countries
CREATE INDEX IF NOT EXISTS idx_countries_name ON countries(name);
CREATE INDEX IF NOT EXISTS idx_countries_name_trgm ON countries USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_countries_name_unaccent ON countries USING gin (f_unaccent(name) gin_trgm_ops);

-- Índices para la tabla regions
CREATE INDEX IF NOT EXISTS idx_regions_country_id ON regions(country_id);
CREATE INDEX IF NOT EXISTS idx_regions_slug ON regions(slug);
CREATE INDEX IF NOT EXISTS idx_regions_name ON regions(name);
CREATE INDEX IF NOT EXISTS idx_regions_name_trgm ON regions USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_regions_name_unaccent ON regions USING gin (f_unaccent(name) gin_trgm_ops);

-- Índices para la tabla states
CREATE INDEX IF NOT EXISTS idx_states_country_id ON states(country_id);
CREATE INDEX IF NOT EXISTS idx_states_region_id ON states(region_id);
CREATE INDEX IF NOT EXISTS idx_states_name ON states(name);
CREATE INDEX IF NOT EXISTS idx_states_name_trgm ON states USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_states_name_unaccent ON states USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_states_slug ON states(slug);

-- Índices para la tabla states
CREATE INDEX IF NOT EXISTS idx_states_country_id ON states(country_id);
CREATE INDEX IF NOT EXISTS idx_states_region_id ON states(region_id);
CREATE INDEX IF NOT EXISTS idx_states_name ON states(name);
CREATE INDEX IF NOT EXISTS idx_states_name_trgm ON states USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_states_name_unaccent ON states USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_states_slug ON states(slug);
CREATE INDEX IF NOT EXISTS idx_states_dane_code ON states(dane_code);
CREATE INDEX IF NOT EXISTS idx_states_geom ON states USING GIST(geom);

-- Índices para la tabla cities
CREATE INDEX IF NOT EXISTS idx_cities_state_id ON cities(state_id);
CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_name_trgm ON cities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cities_name_unaccent ON cities USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cities_slug ON cities(slug);
CREATE INDEX IF NOT EXISTS idx_cities_dane_code ON cities(dane_code);
CREATE INDEX IF NOT EXISTS idx_cities_geom ON cities USING GIST(geom);

-- Índices para la tabla barrios
CREATE INDEX IF NOT EXISTS idx_barrios_city_id ON barrios(city_id);
CREATE INDEX IF NOT EXISTS idx_barrios_name ON barrios(name);
CREATE INDEX IF NOT EXISTS idx_barrios_name_trgm ON barrios USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_barrios_name_unaccent ON barrios USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_barrios_slug ON barrios(slug);
CREATE INDEX IF NOT EXISTS idx_barrios_dane_code ON barrios(dane_code);
CREATE INDEX IF NOT EXISTS idx_barrios_geom ON barrios USING GIST(geom);
-- ============================================================================
-- ✅ SCHEMA CREADO CORRECTAMENTE (Versión 3.6 - Geometría + DANE + Barrios completos)
-- ============================================================================