import { Router } from "express";
import {
  getOrganizaciones,
  getOrganizacionesPublicas,
  getOrganizacionBySlug,
  resolveTenant,
  createOrganizacion,
  getOrganizacionById,
  updateOrganizacion,
  aprobarOrganizacion,
  suspenderOrganizacion,
  solicitarDominioPropio,
  activarDominioPropio,
  deleteOrganizacion,
} from "../controllers/organizaciones.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
import { verificarToken, verificarRol } from "../middleware/auth.middleware.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/organizaciones";

// ────────────────────────────────────────────────────────────────
// Lectura pública (sin token)
// ────────────────────────────────────────────────────────────────
router.get(`${ruta}/publicas`, rateLimit, getOrganizacionesPublicas);
router.get(`${ruta}/slug/:slug`, rateLimit, getOrganizacionBySlug);
router.get(`${ruta}/resolve-tenant`, rateLimit, resolveTenant);

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
router.patch(`${ruta}/:id`, verificarToken, updateOrganizacion);
router.delete(
  `${ruta}/:id`,
  verificarToken,
  verificarRol(["superadmin"]),
  deleteOrganizacion,
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
router.patch(`${ruta}/:id/dominio`, verificarToken, solicitarDominioPropio);
router.patch(
  `${ruta}/:id/dominio/activar`,
  verificarToken,
  verificarRol(["superadmin"]),
  activarDominioPropio,
);

export default router;
