import { Router } from "express";
import {
  generarDescripcion,
  mejorarDescripcion,
  refinarDescripcion,
} from "../controllers/ia.controllers.js";
import {
  createRateLimitMiddleware,
  createRateLimiter,
} from "../lib/rateLimit.js";
import { verificarToken } from "../middleware/auth.middleware.js";

const router = Router();

const iaLimiter = createRateLimitMiddleware(createRateLimiter(20, 60000));

router.post(
  "/generar-descripcion",
  verificarToken,
  iaLimiter,
  generarDescripcion,
);

router.post(
  "/refinar-descripcion",
  verificarToken,
  iaLimiter,
  refinarDescripcion,
);

router.post(
  "/mejorar-descripcion",
  verificarToken,
  iaLimiter,
  mejorarDescripcion,
);

export default router;
