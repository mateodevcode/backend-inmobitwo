import { Router } from "express";
import {
  toggleFavorito,
  getMisFavoritos,
} from "../controllers/favoritos.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/favoritos";

// ────────────────────────────────────────────────────────────────
// Rutas protegidas (requieren login)
// ────────────────────────────────────────────────────────────────
router.post(`${ruta}/toggle`, verificarToken, rateLimit, toggleFavorito);

router.get(`${ruta}/mis-favoritos`, verificarToken, rateLimit, getMisFavoritos);

export default router;
