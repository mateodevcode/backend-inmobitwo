import { pool } from "../db.js";

const parseId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ────────────────────────────────────────────────────────────────
// POST /descartados/descartar
// Descarta una propiedad (idempotente: repetir no da error)
// ────────────────────────────────────────────────────────────────
export const descartarPropiedad = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const propiedadId = parseId(req.body?.propiedadId);

    if (!propiedadId) {
      return res.status(400).json({
        success: false,
        error: "propiedadId es requerido y debe ser válido.",
      });
    }

    const { rows } = await pool.query(
      "SELECT id FROM propiedades WHERE id = $1",
      [propiedadId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada.",
      });
    }

    await pool.query(
      `INSERT INTO usuario_descartados (usuario_id, propiedad_id)
       VALUES ($1, $2) ON CONFLICT (usuario_id, propiedad_id) DO NOTHING`,
      [usuarioId, propiedadId],
    );

    res.status(200).json({
      success: true,
      message: "Propiedad descartada correctamente.",
      data: { propiedadId, action: "descartado" },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al descartar la propiedad.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /descartados/restaurar
// Restaura una propiedad descartada (idempotente)
// ────────────────────────────────────────────────────────────────
export const restaurarPropiedad = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const propiedadId = parseId(req.body?.propiedadId);

    if (!propiedadId) {
      return res.status(400).json({
        success: false,
        error: "propiedadId es requerido y debe ser válido.",
      });
    }

    await pool.query(
      "DELETE FROM usuario_descartados WHERE usuario_id = $1 AND propiedad_id = $2",
      [usuarioId, propiedadId],
    );

    res.status(200).json({
      success: true,
      message: "Propiedad restaurada correctamente.",
      data: { propiedadId, action: "restaurado" },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al restaurar la propiedad.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /descartados/ids
// Ligero: solo ids, para hidratar el store del frontend al iniciar sesión.
// ────────────────────────────────────────────────────────────────
export const getIdsDescartados = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT propiedad_id FROM usuario_descartados WHERE usuario_id = $1",
      [req.usuario.id],
    );

    res.status(200).json({
      success: true,
      data: rows.map((r) => r.propiedad_id),
    });
  } catch (error) {
    console.error("Error en getIdsDescartados:", error);
    res.status(500).json({
      success: false,
      error: "Error al obtener tus descartados.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /descartados/mis-descartados
// Datos para la pestaña "Descartados". Consulta ligera (sin galería
// completa ni planos): ubicación, precio, estado, portada y ofertas.
// ────────────────────────────────────────────────────────────────
export const getMisDescartados = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         p.id, p.titulo, p.direccion, p.barrio_nombre, p.estado,
         p.private_area, p.constructed_area, p.bedroom_count, p.bathroom_count,
         p.precio AS precio_base,
         c.name AS city_name,
         s.name AS state_name,
         ud.created_at AS fecha_descarte,
         (SELECT pg.url FROM propiedades_galeria pg
           WHERE pg.propiedad_id = p.id ORDER BY pg.orden ASC LIMIT 1) AS portada_url,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'operation_type_id', l.operation_type_id,
                    'rental_type_id', l.rental_type_id,
                    'precio', l.precio,
                    'operacion', ot.code
                  ) ORDER BY l.operation_type_id)
           FROM property_listings l
           JOIN operation_types ot ON ot.id = l.operation_type_id
           WHERE l.propiedad_id = p.id AND l.listing_status = 'active'
         ), '[]'::json) AS ofertas
       FROM usuario_descartados ud
       JOIN propiedades p ON p.id = ud.propiedad_id
       LEFT JOIN cities c ON c.id = p.city_id
       LEFT JOIN states s ON s.id = c.state_id
       WHERE ud.usuario_id = $1
       ORDER BY ud.created_at DESC`,
      [req.usuario.id],
    );

    res.status(200).json({
      success: true,
      message: "Descartados obtenidos correctamente.",
      data: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error("Error en getMisDescartados:", error);
    res.status(500).json({
      success: false,
      error: "Error al obtener tus descartados.",
    });
  }
};
