import { pool } from "../db.js";

export const getCountries = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, iso2, phonecode, flag_emoji, latitude, longitude
       FROM countries
       ORDER BY name ASC`,
    );
    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al obtener países",
      data: null,
      error: error.message,
    });
  }
};

export const getStates = async (req, res) => {
  const { countryId } = req.query;

  if (!countryId) {
    return res.status(400).json({
      success: false,
      message: "countryId es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, country_id, name, latitude, longitude
       FROM states
       WHERE country_id = $1
       ORDER BY name ASC`,
      [countryId],
    );
    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al obtener provincias/departamentos",
      data: null,
      error: error.message,
    });
  }
};

export const getCities = async (req, res) => {
  const { stateId } = req.query;

  if (!stateId) {
    return res.status(400).json({
      success: false,
      message: "stateId es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, state_id, name, latitude::float, longitude::float
      FROM cities
      WHERE state_id = $1
      ORDER BY name ASC`,
      [stateId],
    );
    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al obtener ciudades",
      data: null,
      error: error.message,
    });
  }
};

export const getLocationInfo = async (req, res) => {
  const { city, dept, region, operation, type } = req.query;

  if (!city && !dept && !region) {
    return res.status(400).json({
      success: false,
      message: "Se requiere al menos city, dept o region",
      data: null,
      error: null,
    });
  }

  try {
    const params = [];

    let mainParamCount;
    if (region) {
      params.push(region);
      mainParamCount = 1;
    } else if (dept && !city) {
      params.push(dept);
      mainParamCount = 1;
    } else {
      params.push(city, dept);
      mainParamCount = 2;
    }

    const filterConditions = [];

    if (operation) {
      params.push(operation);
      filterConditions.push(
        `AND LOWER(p.operacion) = LOWER($${params.length})`,
      );
    }

    if (type) {
      const types = type.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length === 1) {
        params.push(types[0]);
        filterConditions.push(
          `AND LOWER(p.tipo) = LOWER($${params.length})`,
        );
      } else if (types.length > 1) {
        const startIdx = params.length + 1;
        types.forEach((t) => params.push(t));
        const placeholders = types.map((_, i) => `LOWER($${startIdx + i})`);
        filterConditions.push(
          `AND LOWER(p.tipo) IN (${placeholders.join(", ")})`,
        );
      }
    }

    const filterClause = filterConditions.join(" ");

    let query;

    if (region) {
      query = `
        WITH region_data AS (
          SELECT id as region_id, name as region_name, slug as region_slug
          FROM regions WHERE slug = $1
        )
        SELECT
          rd.region_id, rd.region_name, rd.region_slug,
          NULL as city_id, NULL as city_name, NULL as city_slug,
          NULL as state_id, NULL as state_name, NULL as state_slug,
          'region' as tipo,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           INNER JOIN states s ON c.state_id = s.id
           WHERE s.region_id = rd.region_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_matching,
          0::int as total_city,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           INNER JOIN states s ON c.state_id = s.id
           WHERE s.region_id = rd.region_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_state_all,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           INNER JOIN states s ON c.state_id = s.id
           WHERE s.region_id = rd.region_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_region
        FROM region_data rd
      `;
    } else if (dept && !city) {
      query = `
        WITH state_data AS (
          SELECT s.id as state_id, s.name as state_name, s.slug as state_slug,
                 s.region_id as region_id, r.name as region_name, r.slug as region_slug
          FROM states s
          LEFT JOIN regions r ON s.region_id = r.id
          WHERE s.slug = $1
        )
        SELECT
          sd.region_id, sd.region_name, sd.region_slug,
          NULL as city_id, NULL as city_name, NULL as city_slug,
          sd.state_id, sd.state_name, sd.state_slug,
          'departamento' as tipo,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           WHERE c.state_id = sd.state_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_matching,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           WHERE c.state_id = sd.state_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_state,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           WHERE c.state_id = sd.state_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_state_all,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           INNER JOIN states s2 ON c.state_id = s2.id
           WHERE s2.region_id = sd.region_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_region
        FROM state_data sd
      `;
    } else {
      query = `
        WITH city_state AS (
          SELECT 
            c.id as city_id, c.name as city_name, c.slug as city_slug,
            s.id as state_id, s.name as state_name, s.slug as state_slug,
            s.region_id as region_id, r.name as region_name, r.slug as region_slug
          FROM cities c
          INNER JOIN states s ON c.state_id = s.id
          LEFT JOIN regions r ON s.region_id = r.id
          WHERE c.slug = $1 AND s.slug = $2
        )
        SELECT 
          cs.region_id, cs.region_name, cs.region_slug,
          cs.city_id, cs.city_name, cs.city_slug,
          cs.state_id, cs.state_name, cs.state_slug,
          'ciudad' as tipo,
          (SELECT COUNT(*) FROM propiedades p 
           WHERE p.city_id = cs.city_id AND p.estado = 'publicado'
             ${filterClause}
          )::int as total_matching,
          (SELECT COUNT(*) FROM propiedades p 
           WHERE p.city_id = cs.city_id AND p.estado = 'publicado'
             ${filterClause}
          )::int as total_city,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c2 ON p.city_id = c2.id
           WHERE c2.state_id = cs.state_id AND p.estado = 'publicado'
             ${filterClause}
          )::int as total_state,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c2 ON p.city_id = c2.id
           WHERE c2.state_id = cs.state_id AND p.estado = 'publicado'
             ${filterClause}
          )::int as total_state_all,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c2 ON p.city_id = c2.id
           INNER JOIN states s2 ON c2.state_id = s2.id
           WHERE s2.region_id = cs.region_id AND p.estado = 'publicado'
           ${filterClause}
          )::int as total_region
        FROM city_state cs
      `;
    }

    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ubicación no encontrada",
        data: null,
        error: null,
      });
    }

    return res.json({
      success: true,
      message: null,
      data: rows[0],
      error: null,
    });
  } catch (error) {
    console.error("Error en getLocationInfo:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno al obtener información de ubicación",
      data: null,
      error: error.message,
    });
  }
};

// ============================================================================
// GeoJSON endpoints (para SelectZonaMap del frontend)
// ============================================================================

export const getStatesGeoJSON = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name, dane_code, slug,
              ST_AsGeoJSON(geom)::json AS geometry
       FROM states
       WHERE geom IS NOT NULL
       ORDER BY name ASC`,
    );

    const features = rows.map((r) => ({
      type: "Feature",
      properties: {
        DPTO_CCDGO: r.dane_code,
        DPTO_CNMBR: r.name,
        slug: r.slug,
      },
      geometry: r.geometry,
    }));

    res.json({
      success: true,
      message: null,
      data: { type: "FeatureCollection", features },
      error: null,
    });
  } catch (error) {
    console.error("Error en getStatesGeoJSON:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener geometría de departamentos",
      data: null,
      error: error.message,
    });
  }
};

export const getCitiesGeoJSON = async (req, res) => {
  const { stateDaneCode } = req.query;

  if (!stateDaneCode) {
    return res.status(400).json({
      success: false,
      message: "stateDaneCode es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT c.name, c.dane_code, c.slug, c.latitude, c.longitude,
              ST_AsGeoJSON(c.geom)::json AS geometry
       FROM cities c
       INNER JOIN states s ON c.state_id = s.id
       WHERE s.dane_code = $1 AND c.geom IS NOT NULL
       ORDER BY c.name ASC`,
      [stateDaneCode],
    );

    const features = rows.map((r) => ({
      type: "Feature",
      properties: {
        MPIO_CCNCT: r.dane_code,
        MPIO_CNMBR: r.name,
        DPTO_CCDGO: stateDaneCode,
        slug: r.slug,
      },
      geometry: r.geometry,
    }));

    res.json({
      success: true,
      message: null,
      data: { type: "FeatureCollection", features },
      error: null,
    });
  } catch (error) {
    console.error("Error en getCitiesGeoJSON:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener geometría de municipios",
      data: null,
      error: error.message,
    });
  }
};

export const getBarrios = async (req, res) => {
  const { cityDaneCode } = req.query;

  if (!cityDaneCode) {
    return res.status(400).json({
      success: false,
      message: "cityDaneCode es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT b.name, b.dane_code, b.slug, b.latitude, b.longitude,
              ST_AsGeoJSON(b.geom)::json AS geometry
       FROM barrios b
       INNER JOIN cities c ON b.city_id = c.id
       WHERE c.dane_code = $1
       ORDER BY b.name ASC`,
      [cityDaneCode],
    );

    const features = rows.map((r) => ({
      type: "Feature",
      properties: {
        BAR_COD: r.dane_code,
        NOMB_BARR: r.name,
        slug: r.slug,
      },
      geometry: r.geometry,
    }));

    res.json({
      success: true,
      message: null,
      data: { type: "FeatureCollection", features },
      error: null,
    });
  } catch (error) {
    console.error("Error en getBarrios:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener barrios",
      data: null,
      error: error.message,
    });
  }
};

export const getGeoCount = async (req, res) => {
  const { type, daneCode, operation, inmueble } = req.query;

  if (!type || !daneCode) {
    return res.status(400).json({
      success: false,
      message: "type y daneCode son requeridos",
      data: null,
      error: null,
    });
  }

  try {
    const params = [];
    const filters = ["p.estado = 'publicado'"];

    if (operation) {
      params.push(operation);
      filters.push(`LOWER(p.operacion) = LOWER($${params.length})`);
    }

    if (inmueble) {
      const tipos = inmueble.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (tipos.length === 1) {
        params.push(tipos[0]);
        filters.push(`LOWER(p.tipo) = LOWER($${params.length})`);
      } else if (tipos.length > 1) {
        const start = params.length + 1;
        tipos.forEach((t) => params.push(t));
        const ph = tipos.map((_, i) => `LOWER($${start + i})`);
        filters.push(`LOWER(p.tipo) IN (${ph.join(", ")})`);
      }
    }

    const filterSQL = filters.join(" AND ");
    let query;

    if (type === "departamento") {
      params.push(daneCode);
      query = `
        SELECT COUNT(p.id)::int AS total
        FROM propiedades p
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id
        WHERE s.dane_code = $${params.length} AND ${filterSQL}
      `;
    } else if (type === "municipio") {
      params.push(daneCode);
      query = `
        SELECT COUNT(p.id)::int AS total
        FROM propiedades p
        INNER JOIN cities c ON p.city_id = c.id
        WHERE c.dane_code = $${params.length} AND ${filterSQL}
      `;
    } else if (type === "barrio") {
      params.push(daneCode);
      query = `
        SELECT COUNT(p.id)::int AS total
        FROM propiedades p
        INNER JOIN barrios b ON p.barrio_id = b.id
        WHERE b.dane_code = $${params.length} AND ${filterSQL}
      `;
    } else {
      params.push(daneCode);
      query = `
        SELECT COUNT(p.id)::int AS total
        FROM propiedades p
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id
        WHERE s.dane_code = $${params.length} AND ${filterSQL}
      `;
    }

    const { rows } = await pool.query(query, params);
    const total = rows[0]?.total || 0;

    res.json({
      success: true,
      message: null,
      data: { total },
      error: null,
    });
  } catch (error) {
    console.error("Error en getGeoCount:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener conteo de propiedades",
      data: null,
      error: error.message,
    });
  }
};

// ============================================================================
// GeoJSON de una zona específica para el mini-mapa en ListaPropiedades
// ============================================================================

export const getLocationGeoJSON = async (req, res) => {
  const { tipo, city, dept, region } = req.query;

  if (!tipo) {
    return res.status(400).json({ success: false, message: "tipo es requerido", data: null, error: null });
  }

  try {
    let query;
    const params = [];

    if (tipo === "ciudad") {
      if (!city || !dept) return res.status(400).json({ success: false, message: "city y dept son requeridos", data: null, error: null });
      params.push(city, dept);
      query = `
        SELECT c.name, c.slug, c.dane_code,
               ST_AsGeoJSON(c.geom)::json AS geometry,
               ST_XMin(c.geom) AS west, ST_YMin(c.geom) AS south,
               ST_XMax(c.geom) AS east, ST_YMax(c.geom) AS north
        FROM cities c
        INNER JOIN states s ON c.state_id = s.id
        WHERE c.slug = $1 AND s.slug = $2 AND c.geom IS NOT NULL
        LIMIT 1
      `;
    } else if (tipo === "departamento") {
      if (!dept) return res.status(400).json({ success: false, message: "dept es requerido", data: null, error: null });
      params.push(dept);
      query = `
        SELECT name, slug, dane_code,
               ST_AsGeoJSON(geom)::json AS geometry,
               ST_XMin(geom) AS west, ST_YMin(geom) AS south,
               ST_XMax(geom) AS east, ST_YMax(geom) AS north
        FROM states
        WHERE slug = $1 AND geom IS NOT NULL
        LIMIT 1
      `;
    } else {
      if (!region) return res.status(400).json({ success: false, message: "region es requerido", data: null, error: null });
      params.push(region);
      query = `
        SELECT r.name, r.slug,
               (SELECT string_agg(s.dane_code, ',') FROM states s WHERE s.region_id = r.id) AS dane_codes,
               NULL::json AS geometry,
               MIN(ST_XMin(s.geom)) AS west, MIN(ST_YMin(s.geom)) AS south,
               MAX(ST_XMax(s.geom)) AS east, MAX(ST_YMax(s.geom)) AS north
        FROM regions r
        INNER JOIN states s ON s.region_id = r.id
        WHERE r.slug = $1 AND s.geom IS NOT NULL
        GROUP BY r.id, r.name, r.slug
        LIMIT 1
      `;
    }

    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Zona no encontrada", data: null, error: null });
    }

    const row = rows[0];
    res.json({
      success: true,
      message: null,
      data: {
        name: row.name,
        slug: row.slug,
        daneCode: row.dane_code || row.dane_codes,
        geometry: row.geometry,
        bounds: row.west && row.south && row.east && row.north
          ? [[row.south, row.west], [row.north, row.east]]
          : null,
      },
      error: null,
    });
  } catch (error) {
    console.error("Error en getLocationGeoJSON:", error);
    res.status(500).json({ success: false, message: "Error al obtener geometría de ubicación", data: null, error: error.message });
  }
};

export const suggestCities = async (req, res) => {
  const { q, operation, type } = req.query;

  if (!q || q.trim().length < 2) {
    return res.json({ success: true, message: null, data: [], error: null });
  }

  try {
    const countryId = 2;
    const params = [countryId, `%${q}%`, `${q}%`];

    let operacionFilter = "";
    if (operation) {
      params.push(operation);
      operacionFilter = `AND LOWER(p.operacion) = LOWER($${params.length})`;
    }

    let typeFilter = "";
    if (type) {
      const types = type.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (types.length === 1) {
        params.push(types[0]);
        typeFilter = `AND LOWER(p.tipo) = LOWER($${params.length})`;
      } else if (types.length > 1) {
        const startIdx = params.length + 1;
        types.forEach((t) => params.push(t));
        const placeholders = types.map((_, i) => `LOWER($${startIdx + i})`);
        typeFilter = `AND LOWER(p.tipo) IN (${placeholders.join(", ")})`;
      }
    }

    const query = `
      SELECT * FROM (
        -- Regiones (regiones naturales / CCAA)
        SELECT 
          r.id,
          r.name as region_name,
          r.slug as region_slug,
          NULL as state_name,
          NULL as state_slug,
          NULL as state_dane_code,
          NULL as city_name,
          NULL as city_slug,
          NULL as city_dane_code,
          'region' as tipo,
          0 as match_level,
          0 as direct_match,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           INNER JOIN states s2 ON c.state_id = s2.id
           WHERE s2.region_id = r.id AND p.estado = 'publicado'
            ${operacionFilter}
            ${typeFilter}
           )::int as total_propiedades
        FROM regions r
        WHERE r.country_id = $1
          AND f_unaccent(r.name) ILIKE f_unaccent($2)

        UNION ALL

        -- Departamentos / Provincias
        SELECT
          s.id,
          r.name as region_name,
          r.slug as region_slug,
          s.name as state_name,
          s.slug as state_slug,
          s.dane_code as state_dane_code,
          NULL as city_name,
          NULL as city_slug,
          NULL as city_dane_code,
          'departamento' as tipo,
          1 as match_level,
          0 as direct_match,
          (SELECT COUNT(*) FROM propiedades p
           INNER JOIN cities c ON p.city_id = c.id
           WHERE c.state_id = s.id AND p.estado = 'publicado'
            ${operacionFilter}
            ${typeFilter}
           )::int as total_propiedades
        FROM states s
        LEFT JOIN regions r ON s.region_id = r.id
        WHERE s.country_id = $1
          AND f_unaccent(s.name) ILIKE f_unaccent($2)

        UNION ALL

        -- Ciudades (coincidencia directa por nombre de ciudad)
        SELECT
          c.id,
          r.name as region_name,
          r.slug as region_slug,
          s.name as state_name,
          s.slug as state_slug,
          s.dane_code as state_dane_code,
          c.name as city_name,
          c.slug as city_slug,
          c.dane_code as city_dane_code,
          'ciudad' as tipo,
          2 as match_level,
          0 as direct_match,
          COUNT(p.id)::int as total_propiedades
        FROM cities c
        INNER JOIN states s ON c.state_id = s.id
        LEFT JOIN regions r ON s.region_id = r.id
        LEFT JOIN propiedades p ON c.id = p.city_id AND p.estado = 'publicado'
          ${operacionFilter}
          ${typeFilter}
        WHERE s.country_id = $1
          AND f_unaccent(c.name) ILIKE f_unaccent($2)
        GROUP BY c.id, c.name, c.slug, c.dane_code, s.name, s.slug, s.dane_code, r.name, r.slug

        UNION ALL

        -- Ciudades (coincidencia indirecta: el departamento hizo match, la ciudad no)
        SELECT
          c.id,
          r.name as region_name,
          r.slug as region_slug,
          s.name as state_name,
          s.slug as state_slug,
          s.dane_code as state_dane_code,
          c.name as city_name,
          c.slug as city_slug,
          c.dane_code as city_dane_code,
          'ciudad' as tipo,
          2 as match_level,
          1 as direct_match,
          COUNT(p.id)::int as total_propiedades
        FROM cities c
        INNER JOIN states s ON c.state_id = s.id
        LEFT JOIN regions r ON s.region_id = r.id
        LEFT JOIN propiedades p ON c.id = p.city_id AND p.estado = 'publicado'
          ${operacionFilter}
          ${typeFilter}
        WHERE s.country_id = $1
          AND f_unaccent(s.name) ILIKE f_unaccent($2)
          AND NOT f_unaccent(c.name) ILIKE f_unaccent($2)
        GROUP BY c.id, c.name, c.slug, c.dane_code, s.name, s.slug, s.dane_code, r.name, r.slug
      ) results
      ORDER BY
        match_level ASC,
        direct_match ASC,
        CASE
          WHEN f_unaccent(COALESCE(region_name, state_name, city_name)) ILIKE f_unaccent($3) THEN 0
          ELSE 1
        END,
        COALESCE(region_name, state_name, city_name) ASC
      LIMIT 12;
    `;

    const { rows } = await pool.query(query, params);

    return res.json({
      success: true,
      message: null,
      data: rows,
      error: null,
    });
  } catch (error) {
    console.error("Error en suggestCities:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno al obtener sugerencias de ubicaciones",
      data: null,
      error: error.message,
    });
  }
};
