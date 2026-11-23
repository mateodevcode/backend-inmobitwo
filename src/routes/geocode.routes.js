import { Router } from "express";
import { getGeocode } from "../controllers/geocode.controllers.js";
import { createRateLimitMiddleware, geocodeLimiter } from "../lib/rateLimit.js";
import { verificarTokenOpcional } from "../middleware/auth.middleware.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(geocodeLimiter);

// Público (lo usan los mapas del portal) pero con límite propio; con sesión, el límite es por usuario.
router.get("/geocode", verificarTokenOpcional, rateLimit, getGeocode);

export default router;
