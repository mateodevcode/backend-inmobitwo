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
          NULL as city_name,
          NULL as city_slug,
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
          NULL as city_name,
          NULL as city_slug,
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
          c.name as city_name,
          c.slug as city_slug,
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
        GROUP BY c.id, c.name, c.slug, s.name, s.slug, r.name, r.slug

        UNION ALL

        -- Ciudades (coincidencia indirecta: el departamento hizo match, la ciudad no)
        SELECT
          c.id,
          r.name as region_name,
          r.slug as region_slug,
          s.name as state_name,
          s.slug as state_slug,
          c.name as city_name,
          c.slug as city_slug,
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
        GROUP BY c.id, c.name, c.slug, s.name, s.slug, r.name, r.slug
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
