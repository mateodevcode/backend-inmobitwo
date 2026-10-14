// src/routes/portada.routes.js — hero principal del portal (un solo destacado).
// Lectura pública; gestión solo superadmin.
import { Router } from "express";
import { verificarRol, verificarToken } from "../middleware/auth.middleware.js";
import {
  createRateLimitMiddleware,
  defaultLimiter,
} from "../lib/rateLimit.js";
import {
  buscarPortada,
  getPortada,
  putPortada,
} from "../controllers/portada.controllers.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const soloSuperadmin = [verificarToken, verificarRol(["superadmin"]), rateLimit];

router.get("/portada", rateLimit, getPortada);
router.get("/portada/buscar", ...soloSuperadmin, buscarPortada);
router.put("/portada", ...soloSuperadmin, putPortada);

export default router;
