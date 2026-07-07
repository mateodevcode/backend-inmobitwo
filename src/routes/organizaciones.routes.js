import { Router } from "express";
import {
  getOrganizaciones,
  getOrganizacionById,
  deleteOrganizacion,
  createOrganizacion,
  updateOrganizacion,
} from "../controllers/organizaciones.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
// import { validateApiKey } from "../lib/validateApiKey.js";
import { verificarToken, verificarRol } from "../middleware/auth.middleware.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

const ruta = "/organizaciones";

// 🔒 Todas estas rutas ahora necesitan token de forma obligatoria
router.get(ruta, rateLimit, getOrganizaciones);
router.get(`${ruta}/:id`, rateLimit, getOrganizacionById);
// router.patch(`${ruta}/:id`, verificarToken, updateOrganizacion);

// // Solo el superadmin puede crear o eliminar otros usuarios del sistema
router.post(ruta, createOrganizacion);
// router.delete(`${ruta}/:id`, verificarToken, deleteOrganizacion);

export default router;
