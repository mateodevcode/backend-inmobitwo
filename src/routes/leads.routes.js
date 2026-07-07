// src/routes/leads.routes.js
import { Router } from "express";
import {
  getLeads,
  updateLeadEstado,
} from "../controllers/leads.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
import { verificarToken } from "../middleware/auth.middleware.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/leads";

// Todas requieren estar logueado — son datos privados del agente/dueño
router.get(ruta, verificarToken, rateLimit, getLeads);
router.patch(`${ruta}/:id`, verificarToken, rateLimit, updateLeadEstado);

export default router;
