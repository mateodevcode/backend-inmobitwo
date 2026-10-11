import { Router } from "express";
import {
  descartarPropiedad,
  restaurarPropiedad,
  getIdsDescartados,
  getMisDescartados,
} from "../controllers/descartados.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/descartados";

// ────────────────────────────────────────────────────────────────
// Rutas protegidas (requieren login)
// ────────────────────────────────────────────────────────────────
router.post(`${ruta}/descartar`, verificarToken, rateLimit, descartarPropiedad);

router.post(`${ruta}/restaurar`, verificarToken, rateLimit, restaurarPropiedad);

router.get(`${ruta}/ids`, verificarToken, rateLimit, getIdsDescartados);

router.get(
  `${ruta}/mis-descartados`,
  verificarToken,
  rateLimit,
  getMisDescartados,
);

export default router;
