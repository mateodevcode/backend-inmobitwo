import { Router } from "express";
import {
  getOrganizaciones,
  getOrganizacionesPublicas,
  getMisOrganizaciones,
  getOrganizacionBySlug,
  resolveTenant,
  createOrganizacion,
  getOrganizacionById,
  updateOrganizacion,
  aprobarOrganizacion,
  suspenderOrganizacion,
  solicitarDominioPropio,
  activarDominioPropio,
  getEstadisticasOrganizacion,
  deleteOrganizacion,
  desactivarDominioPropio,
  quitarDominioPropio,
} from "../controllers/organizaciones.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
import { verificarToken, verificarRol } from "../middleware/auth.middleware.js";
import { resolverTenant } from "../middleware/tenant.middleware.js";
import {
  requiereAdminOrganizacion,
  requiereMiembroOrganizacion,
} from "../middleware/organizacion.middleware.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/organizaciones";

// ────────────────────────────────────────────────────────────────
// Lectura pública (sin token)
// ────────────────────────────────────────────────────────────────
router.get(`${ruta}/publicas`, rateLimit, getOrganizacionesPublicas);
router.get(`${ruta}/slug/:slug`, rateLimit, getOrganizacionBySlug);
router.get(`${ruta}/resolve-tenant`, rateLimit, resolverTenant, resolveTenant);

// ────────────────────────────────────────────────────────────────
// "Mi organización" — para el sidebar (usuario logueado)
// Va antes de /:id para que Express no confunda "mias" con un id.
// ────────────────────────────────────────────────────────────────
router.get(`${ruta}/mias`, verificarToken, getMisOrganizaciones);

// ────────────────────────────────────────────────────────────────
// Lectura / escritura autenticada
// ────────────────────────────────────────────────────────────────
router.get(
  ruta,
  verificarToken,
  verificarRol(["superadmin"]),
  getOrganizaciones,
);
router.get(`${ruta}/:id`, rateLimit, getOrganizacionById);

router.post(ruta, verificarToken, createOrganizacion);

// Solo el agency_admin de ESTA organización (o superadmin) puede editarla
router.patch(
  `${ruta}/:id`,
  verificarToken,
  requiereAdminOrganizacion("id"),
  updateOrganizacion,
);

router.delete(
  `${ruta}/:id`,
  verificarToken,
  verificarRol(["superadmin"]),
  deleteOrganizacion,
);

// Estadísticas básicas — cualquier miembro activo de la organización puede verlas
router.get(
  `${ruta}/:id/estadisticas`,
  verificarToken,
  requiereMiembroOrganizacion("id"),
  getEstadisticasOrganizacion,
);

// ────────────────────────────────────────────────────────────────
// Aprobación / suspensión — solo superadmin
// ────────────────────────────────────────────────────────────────
router.patch(
  `${ruta}/:id/aprobar`,
  verificarToken,
  verificarRol(["superadmin"]),
  aprobarOrganizacion,
);
router.patch(
  `${ruta}/:id/suspender`,
  verificarToken,
  verificarRol(["superadmin"]),
  suspenderOrganizacion,
);

// ────────────────────────────────────────────────────────────────
// Dominio propio
// ────────────────────────────────────────────────────────────────
router.patch(
  `${ruta}/:id/dominio`,
  verificarToken,
  requiereAdminOrganizacion("id"),
  solicitarDominioPropio,
);
router.patch(
  `${ruta}/:id/dominio/activar`,
  verificarToken,
  verificarRol(["superadmin"]),
  activarDominioPropio,
);
router.patch(
  `${ruta}/:id/dominio/desactivar`,
  verificarToken,
  verificarRol(["superadmin"]),
  desactivarDominioPropio,
);
router.patch(
  `${ruta}/:id/dominio/quitar`,
  verificarToken,
  verificarRol(["superadmin"]),
  quitarDominioPropio,
);

export default router;
