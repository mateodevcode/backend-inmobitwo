import { pool } from "../db.js";

// ────────────────────────────────────────────────────────────────
// POST /favoritos/toggle
// Agrega o quita una propiedad de favoritos (toggle)
// ────────────────────────────────────────────────────────────────
export const toggleFavorito = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { propiedadId } = req.body;

    if (!propiedadId) {
      return res.status(400).json({
        success: false,
        error: "propiedadId es requerido.",
      });
    }

    // Verificar que la propiedad existe
    const { rows: propRows } = await pool.query(
      "SELECT id FROM propiedades WHERE id = $1",
      [propiedadId],
    );

    if (propRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada.",
      });
    }

    // Verificar si ya está en favoritos
    const { rows } = await pool.query(
      `SELECT id FROM usuario_favoritos 
       WHERE usuario_id = $1 AND propiedad_id = $2`,
      [usuarioId, propiedadId],
    );

    let action = "agregado";

    if (rows.length > 0) {
      // Quitar de favoritos
      await pool.query(
        `DELETE FROM usuario_favoritos 
         WHERE usuario_id = $1 AND propiedad_id = $2`,
        [usuarioId, propiedadId],
      );
      action = "eliminado";
    } else {
      // Agregar a favoritos
      await pool.query(
        `INSERT INTO usuario_favoritos (usuario_id, propiedad_id) 
         VALUES ($1, $2)`,
        [usuarioId, propiedadId],
      );
    }

    res.status(200).json({
      success: true,
      message: `Propiedad ${action} de favoritos correctamente.`,
      data: { propiedadId, action },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al actualizar favoritos.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /favoritos/mis-favoritos
// Devuelve todas las propiedades favoritas del usuario con galería
// ────────────────────────────────────────────────────────────────
export const getMisFavoritos = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const { rows } = await pool.query(
      `WITH favoritos AS (
        SELECT 
          p.*,
          uf.created_at as fecha_guardado
        FROM usuario_favoritos uf
        JOIN propiedades p ON uf.propiedad_id = p.id
        WHERE uf.usuario_id = $1
      )
      SELECT 
        f.*,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', pg.id,
                'url', pg.url,
                'public_id', pg.public_id,
                'orden', pg.orden
              ) ORDER BY pg.orden ASC
            )
            FROM propiedades_galeria pg 
            WHERE pg.propiedad_id = f.id
          ), 
          '[]'::json
        ) as galeria
      FROM favoritos f
      ORDER BY f.fecha_guardado DESC`,
      [usuarioId],
    );

    res.status(200).json({
      success: true,
      message: "Favoritos obtenidos correctamente.",
      data: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error("Error en getMisFavoritos:", error);
    res.status(500).json({
      success: false,
      error: "Error al obtener tus favoritos.",
    });
  }
};
