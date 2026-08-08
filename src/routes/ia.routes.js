import { Router } from "express";
import { generarDescripcion } from "../controllers/ia.controllers.js";
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

export default router;
