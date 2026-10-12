// src/controllers/leads.controllers.js
import { pool } from "../db.js";

// Lista los leads de las propiedades del usuario logueado (o de su organización)
export const getLeads = async (req, res) => {
  try {
    const usuario_id = req.usuario.id; // viene de verificarToken

    const { rows } = await pool.query(
      `SELECT l.*, p.titulo as propiedad_titulo
       FROM leads l
       JOIN propiedades p ON p.id = l.propiedad_id
       WHERE p.publicado_por_id = $1
          OR p.organizacion_id IN (
               SELECT organizacion_id FROM organizacion_miembros 
               WHERE usuario_id = $1 AND estado = 'activo'
             )
       ORDER BY l.created_at DESC`,
      [usuario_id],
    );

    res.status(200).json({
      success: true,
      message: "Leads obtenidos correctamente.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const updateLeadEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const estadosValidos = [
      "nuevo",
      "contactado",
      "en_negociacion",
      "cerrado",
      "descartado",
    ];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: "Estado no válido.",
      });
    }

    const { rows } = await pool.query(
      `UPDATE leads SET estado = $1 WHERE id = $2
       AND (
         propiedad_id IN (SELECT id FROM propiedades WHERE publicado_por_id = $3 AND organizacion_id IS NULL)
         OR propiedad_id IN (
           SELECT p.id FROM propiedades p
           WHERE p.organizacion_id IN (
             SELECT om.organizacion_id FROM organizacion_miembros om
             JOIN organizaciones o ON o.id = om.organizacion_id
             WHERE om.usuario_id = $3 AND om.estado = 'activo' AND o.estado = 'aprobada'
           )
         )
       )
       RETURNING *`,
      [estado, id, req.usuario.id],
    );

    if (!rows[0]) {
      // Mismo 404 exista o no: no revela leads ajenos.
      return res.status(404).json({
        success: false,
        error: "Lead no encontrado.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Estado del lead actualizado.",
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
