// src/routes/tracking.routes.js
import { Router } from "express";
import {
  registrarSesion,
  registrarEvento,
  crearLeadDirecto,
  getLogsTracking,
  actualizarContactoLead,
} from "../controllers/tracking.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
import {
  verificarToken,
  verificarTokenOpcional,
} from "../middleware/auth.middleware.js"; // 👈 nuevo import

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/tracking";

router.post(
  `${ruta}/sesion`,
  verificarTokenOpcional,
  rateLimit,
  registrarSesion,
); // 👈
router.post(
  `${ruta}/evento`,
  verificarTokenOpcional,
  rateLimit,
  registrarEvento,
); // 👈
router.post(`${ruta}/lead`, rateLimit, crearLeadDirecto);
router.get(`${ruta}/logs`, verificarToken, rateLimit, getLogsTracking);

// Nueva ruta, agregar después de router.post(`${ruta}/lead`, ...)
router.patch(`${ruta}/lead/:id/contacto`, rateLimit, actualizarContactoLead);

export default router;
