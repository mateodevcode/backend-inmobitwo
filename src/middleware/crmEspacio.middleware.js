// src/middleware/crmEspacio.middleware.js
// Espacio CRM desde header X-Crm-Espacio: "personal" | "org:{id}".
// Nunca confía en organizacion_id/usuario_id del cliente.
// El superadmin NO tiene acceso implícito a espacios ajenos.
import { pool } from "../db.js";

export const resolverEspacioCrm = async (req, res, next) => {
  try {
    const crudo = (req.headers["x-crm-espacio"] || "personal").trim();
    const usuarioId = req.usuario.id;

    if (crudo === "personal" || crudo === "") {
      req.crm = { tipo: "personal", usuarioId, organizacionId: null, rolEnOrg: null };
      return next();
    }

    const match = /^org:(\d+)$/.exec(crudo);
    if (!match) {
      return res.status(400).json({
        success: false,
        error: "Espacio inválido. Use personal u org:{id}.",
      });
    }

    const organizacionId = Number(match[1]);
    const { rows } = await pool.query(
      `SELECT om.rol_en_org
       FROM organizacion_miembros om
       JOIN organizaciones o ON o.id = om.organizacion_id
       WHERE om.usuario_id = $1
         AND om.organizacion_id = $2
         AND om.estado = 'activo'
         AND o.estado = 'aprobada'`,
      [usuarioId, organizacionId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Espacio no encontrado." });
    }

    req.crm = {
      tipo: "org",
      usuarioId,
      organizacionId,
      rolEnOrg: rows[0].rol_en_org,
    };
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
