// src/routes/tracking.routes.js
import { Router } from "express";
import {
  registrarSesion,
  registrarEvento,
  registrarVista,
  crearLeadDirecto,
  getLogsTracking,
  actualizarContactoLead,
} from "../controllers/tracking.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
import {
  verificarToken,
  verificarTokenOpcional,
  verificarRol,
} from "../middleware/auth.middleware.js"; // 👈 nuevo import
import { requiereVistas } from "../lib/validarSecretos.js";
import { getVistasAgregados } from "../controllers/vistas.agregados.controllers.js";

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
// Vista de detalle (decide Rust, sin fallback; Node solo enriquece)
router.post(`${ruta}/vista`, requiereVistas, verificarTokenOpcional, rateLimit, registrarVista);
// Agregados de vistas por día (punto 3): solo superadmin, con filas + SCAN.
router.get(
  `${ruta}/vistas/agregados`,
  verificarToken,
  verificarRol(["superadmin"]),
  getVistasAgregados,
);
router.get(`${ruta}/logs`, verificarToken, rateLimit, getLogsTracking);

// Nueva ruta, agregar después de router.post(`${ruta}/lead`, ...)
router.patch(`${ruta}/lead/:id/contacto`, rateLimit, actualizarContactoLead);

export default router;
