import { pool } from "../db.js";
import { room_seeker_validate } from "../validations/room_seeker_validate.js";

// Columnas editables desde PUT /room-seeker/me
const CAMPOS_EDITABLES = [
  "genero",
  "edad",
  "ocupacion",
  "fuma_en_casa",
  "tiene_mascota",
  "busca_con",
  "presupuesto_max",
  "state_id",
  "city_id",
  "fecha_entrada",
  "habitacion_privada",
  "amoblada",
  "bano_privado",
];

const SELECT_PERFIL = `
  SELECT rsp.*,
         c.name AS city_name,
         c.slug AS city_slug,
         s.name AS state_name,
         s.slug AS state_slug
    FROM room_seeker_profiles rsp
    LEFT JOIN cities c ON c.id = rsp.city_id
    LEFT JOIN states s ON s.id = rsp.state_id
   WHERE rsp.usuario_id = $1
`;

// ────────────────────────────────────────────────────────────────
// GET /room-seeker/me — perfil del usuario autenticado (null si no existe)
// ────────────────────────────────────────────────────────────────
export const getMiPerfilBuscador = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { rows } = await pool.query(SELECT_PERFIL, [usuarioId]);

    return res.status(200).json({
      success: true,
      data: rows[0] ?? null,
    });
  } catch (error) {
    console.error("❌ Error en GET /room-seeker/me:", error);
    return res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// PUT /room-seeker/me — crea o actualiza (upsert por usuario_id)
// null limpia el campo; undefined lo deja como está.
// ────────────────────────────────────────────────────────────────
export const upsertMiPerfilBuscador = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const datos = req.body ?? {};

    const errores = room_seeker_validate(datos);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: errores[0] });
    }

    // Solo columnas conocidas; undefined = no tocar, null = limpiar.
    const aGuardar = {};
    for (const campo of CAMPOS_EDITABLES) {
      if (datos[campo] !== undefined) aGuardar[campo] = datos[campo];
    }

    if (Object.keys(aGuardar).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No hay campos para guardar.",
      });
    }

    // Coherencia geo: si manda ciudad, debe existir; si además manda
    // departamento, la ciudad debe pertenecerle.
    if (aGuardar.city_id !== undefined && aGuardar.city_id !== null) {
      const { rows } = await pool.query(
        "SELECT id, state_id FROM cities WHERE id = $1",
        [aGuardar.city_id],
      );
      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: "La ciudad indicada no existe.",
        });
      }
      if (
        aGuardar.state_id !== undefined &&
        aGuardar.state_id !== null &&
        rows[0].state_id !== aGuardar.state_id
      ) {
        return res.status(400).json({
          success: false,
          error: "La ciudad no pertenece al departamento indicado.",
        });
      }
      // Si solo mandó ciudad, heredamos su departamento.
      if (aGuardar.state_id === undefined) {
        aGuardar.state_id = rows[0].state_id;
      }
    } else if (aGuardar.state_id !== undefined && aGuardar.state_id !== null) {
      const { rows } = await pool.query(
        "SELECT id FROM states WHERE id = $1",
        [aGuardar.state_id],
      );
      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: "El departamento indicado no existe.",
        });
      }
    }

    const columnas = ["usuario_id", ...Object.keys(aGuardar)];
    const valores = [usuarioId, ...Object.values(aGuardar)];
    const placeholders = columnas.map((_, i) => `$${i + 1}`).join(", ");
    const updates = Object.keys(aGuardar)
      .map((col) => `${col} = EXCLUDED.${col}`)
      .join(", ");

    await pool.query(
      `INSERT INTO room_seeker_profiles (${columnas.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (usuario_id) DO UPDATE SET ${updates}`,
      valores,
    );

    const { rows } = await pool.query(SELECT_PERFIL, [usuarioId]);

    return res.status(200).json({
      success: true,
      message: "Perfil de habitación guardado correctamente.",
      data: rows[0] ?? null,
    });
  } catch (error) {
    console.error("❌ Error en PUT /room-seeker/me:", error);
    return res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// DELETE /room-seeker/me — borra el perfil del usuario autenticado
// ────────────────────────────────────────────────────────────────
export const deleteMiPerfilBuscador = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { rowCount } = await pool.query(
      "DELETE FROM room_seeker_profiles WHERE usuario_id = $1",
      [usuarioId],
    );

    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "No tienes un perfil de habitación para borrar.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Perfil de habitación borrado correctamente.",
      data: null,
    });
  } catch (error) {
    console.error("❌ Error en DELETE /room-seeker/me:", error);
    return res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
    });
  }
};
