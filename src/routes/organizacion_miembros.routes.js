// src/routes/organizacion_miembros.routes.js
import { Router } from "express";
import {
  getMiembros,
  crearMiembro,
  actualizarMiembro,
  eliminarMiembro,
} from "../controllers/organizacion_miembros.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";
import {
  requiereAdminOrganizacion,
  requiereMiembroOrganizacion,
} from "../middleware/organizacion.middleware.js";

const router = Router();

// Cualquier miembro activo de la organización puede ver el listado de agentes
router.get(
  "/organizaciones/:organizacionId/miembros",
  verificarToken,
  requiereMiembroOrganizacion("organizacionId"),
  getMiembros,
);

// Solo agency_admin de esa organización (o superadmin) puede agregar agentes
router.post(
  "/organizaciones/:organizacionId/miembros",
  verificarToken,
  requiereAdminOrganizacion("organizacionId"),
  crearMiembro,
);

// El permiso se valida dentro del controller (necesita resolver primero
// a qué organización pertenece el miembro con ese :id)
router.patch("/organizaciones/miembros/:id", verificarToken, actualizarMiembro);

router.delete("/organizaciones/miembros/:id", verificarToken, eliminarMiembro);

export default router;
