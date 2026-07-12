// src/controllers/organizacion_miembros.controllers.js
import { pool } from "../db.js";
import { puedeAdministrarOrganizacion } from "../lib/organizacionPermisos.js";

// ────────────────────────────────────────────────────────────────
// GET /organizaciones/:organizacionId/miembros
// Lista agentes + agency_admins de una organización.
// ────────────────────────────────────────────────────────────────
export const getMiembros = async (req, res) => {
  try {
    const { organizacionId } = req.params;

    const { rows } = await pool.query(
      `SELECT 
        om.id, om.rol_en_org, om.estado, om.created_at,
        u.id AS usuario_id, u.name, u.email, u.telefono, u.image_url
       FROM organizacion_miembros om
       JOIN usuarios u ON u.id = om.usuario_id
       WHERE om.organizacion_id = $1
       ORDER BY om.created_at ASC`,
      [organizacionId],
    );

    res.status(200).json({
      success: true,
      message: "Miembros obtenidos.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /organizaciones/:organizacionId/miembros
// Agrega un usuario YA REGISTRADO (por email) como agente/admin.
// No crea usuarios nuevos: si el email no existe, se pide que se
// registre primero (evita crear cuentas fantasma sin contraseña).
// ────────────────────────────────────────────────────────────────
export const crearMiembro = async (req, res) => {
  try {
    const { organizacionId } = req.params;
    const { email, rol_en_org } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "El email es requerido.",
      });
    }

    const rolFinal = rol_en_org === "agency_admin" ? "agency_admin" : "agent";

    const { rows: usuarioRows } = await pool.query(
      "SELECT id, name, email, image_url, telefono FROM usuarios WHERE email = $1",
      [email.toLowerCase().trim()],
    );
    const usuario = usuarioRows[0];

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error:
          "No existe ningún usuario registrado con ese email. Debe crear su cuenta primero.",
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO organizacion_miembros (usuario_id, organizacion_id, rol_en_org)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [usuario.id, organizacionId, rolFinal],
    );

    res.status(201).json({
      success: true,
      message: "Agente agregado a la organización.",
      data: {
        ...rows[0],
        name: usuario.name,
        email: usuario.email,
        image_url: usuario.image_url,
        telefono: usuario.telefono,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "Ese usuario ya pertenece a esta organización.",
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// PATCH /organizaciones/miembros/:id
// Edita rol_en_org y/o estado de un miembro.
// El permiso se valida aquí (no en middleware) porque necesitamos
// primero saber a qué organización pertenece este miembro.
// ────────────────────────────────────────────────────────────────
export const actualizarMiembro = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol_en_org, estado } = req.body;

    const { rows: existenteRows } = await pool.query(
      "SELECT * FROM organizacion_miembros WHERE id = $1",
      [id],
    );
    const existente = existenteRows[0];

    if (!existente) {
      return res.status(404).json({
        success: false,
        error: "Miembro no encontrado.",
      });
    }

    const autorizado = await puedeAdministrarOrganizacion(
      req.usuario.id,
      existente.organizacion_id,
      req.usuario.rol,
    );
    if (!autorizado) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos sobre esta organización.",
      });
    }

    const campos = [];
    const valores = [];
    let contador = 1;

    if (rol_en_org) {
      campos.push(`rol_en_org = $${contador}`);
      valores.push(rol_en_org);
      contador++;
    }
    if (estado) {
      campos.push(`estado = $${contador}`);
      valores.push(estado);
      contador++;
    }

    if (campos.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No hay campos para actualizar.",
      });
    }

    valores.push(id);
    const { rows } = await pool.query(
      `UPDATE organizacion_miembros SET ${campos.join(", ")} WHERE id = $${contador} RETURNING *`,
      valores,
    );

    res.status(200).json({
      success: true,
      message: "Miembro actualizado.",
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// DELETE /organizaciones/miembros/:id
// Quita a un agente/admin de la organización.
// No permite eliminar al último agency_admin activo (evita orgs huérfanas).
// ────────────────────────────────────────────────────────────────
export const eliminarMiembro = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: existenteRows } = await pool.query(
      "SELECT * FROM organizacion_miembros WHERE id = $1",
      [id],
    );
    const existente = existenteRows[0];

    if (!existente) {
      return res.status(404).json({
        success: false,
        error: "Miembro no encontrado.",
      });
    }

    const autorizado = await puedeAdministrarOrganizacion(
      req.usuario.id,
      existente.organizacion_id,
      req.usuario.rol,
    );
    if (!autorizado) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos sobre esta organización.",
      });
    }

    if (existente.rol_en_org === "agency_admin") {
      const { rows: admins } = await pool.query(
        `SELECT id FROM organizacion_miembros 
         WHERE organizacion_id = $1 AND rol_en_org = 'agency_admin' AND estado = 'activo'`,
        [existente.organizacion_id],
      );
      if (admins.length <= 1) {
        return res.status(400).json({
          success: false,
          error:
            "No puedes eliminar al único administrador de la organización.",
        });
      }
    }

    await pool.query("DELETE FROM organizacion_miembros WHERE id = $1", [id]);

    res.status(200).json({
      success: true,
      message: "Miembro eliminado.",
      data: existente,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
