// scripts/migrate-v3.6.js — Agrega columnas y tablas nuevas
import { pool } from "../src/db.js";

const sql = `
DROP TABLE IF EXISTS barrios CASCADE;

CREATE TABLE barrios (
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

-- Columnas nuevas en states
ALTER TABLE states ADD COLUMN IF NOT EXISTS dane_code VARCHAR(5);
ALTER TABLE states ADD COLUMN IF NOT EXISTS geom GEOMETRY(MultiPolygon, 4326);

-- Columnas nuevas en cities
ALTER TABLE cities ADD COLUMN IF NOT EXISTS dane_code VARCHAR(8);
ALTER TABLE cities ADD COLUMN IF NOT EXISTS geom GEOMETRY(MultiPolygon, 4326);

-- Columna barrio_id en propiedades
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS barrio_id INTEGER;
ALTER TABLE propiedades DROP CONSTRAINT IF EXISTS fk_propiedades_barrio_id;
ALTER TABLE propiedades ADD CONSTRAINT fk_propiedades_barrio_id FOREIGN KEY (barrio_id) REFERENCES barrios(id) ON DELETE SET NULL;

-- Índices nuevos
CREATE INDEX IF NOT EXISTS idx_states_dane_code ON states(dane_code);
CREATE INDEX IF NOT EXISTS idx_states_geom ON states USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_cities_dane_code ON cities(dane_code);
CREATE INDEX IF NOT EXISTS idx_cities_geom ON cities USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_barrios_city_id ON barrios(city_id);
CREATE INDEX IF NOT EXISTS idx_barrios_name ON barrios(name);
CREATE INDEX IF NOT EXISTS idx_barrios_name_trgm ON barrios USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_barrios_name_unaccent ON barrios USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_barrios_slug ON barrios(slug);
CREATE INDEX IF NOT EXISTS idx_barrios_dane_code ON barrios(dane_code);
CREATE INDEX IF NOT EXISTS idx_barrios_geom ON barrios USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_propiedades_barrio_id ON propiedades(barrio_id);
`;

pool
  .query(sql)
  .then(() => {
    console.log("✅ Migración v3.6 aplicada");
    pool.end();
  })
  .catch((e) => {
    console.error("❌", e.message);
    pool.end();
  });
