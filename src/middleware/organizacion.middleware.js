// src/middleware/organizacion.middleware.js
import {
  puedeAdministrarOrganizacion,
  esMiembroDeOrganizacion,
} from "../lib/organizacionPermisos.js";

// ────────────────────────────────────────────────────────────────
// Exige que req.usuario sea agency_admin de la organización (o superadmin).
// paramName: nombre del param de la ruta donde viene el id de la organización
// (ej: "id" en /organizaciones/:id, "organizacionId" en /organizaciones/:organizacionId/miembros)
// ────────────────────────────────────────────────────────────────
export const requiereAdminOrganizacion = (paramName = "organizacionId") => {
  return async (req, res, next) => {
    try {
      const organizacionId = req.params[paramName] || req.body.organizacion_id;

      if (!organizacionId) {
        return res.status(400).json({
          success: false,
          error: "organizacion_id requerido.",
        });
      }

      const autorizado = await puedeAdministrarOrganizacion(
        req.usuario.id,
        organizacionId,
        req.usuario.rol,
      );

      if (!autorizado) {
        return res.status(403).json({
          success: false,
          error: "No tienes permisos de administrador sobre esta organización.",
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  };
};

// ────────────────────────────────────────────────────────────────
// Exige ser miembro (agent o agency_admin) de la organización, o superadmin.
// Para endpoints de solo lectura donde cualquier agente puede ver.
// ────────────────────────────────────────────────────────────────
export const requiereMiembroOrganizacion = (paramName = "organizacionId") => {
  return async (req, res, next) => {
    try {
      const organizacionId = req.params[paramName] || req.body.organizacion_id;

      if (!organizacionId) {
        return res.status(400).json({
          success: false,
          error: "organizacion_id requerido.",
        });
      }

      const autorizado = await esMiembroDeOrganizacion(
        req.usuario.id,
        organizacionId,
        req.usuario.rol,
      );

      if (!autorizado) {
        return res.status(403).json({
          success: false,
          error: "No perteneces a esta organización.",
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  };
};
