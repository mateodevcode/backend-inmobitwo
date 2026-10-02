import { Router } from "express";
import {
  getMiPerfilBuscador,
  upsertMiPerfilBuscador,
  deleteMiPerfilBuscador,
} from "../controllers/room_seeker.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/room-seeker/me";

// ────────────────────────────────────────────────────────────────
// Perfil de buscador de habitación (un perfil por usuario, todo con login)
// ────────────────────────────────────────────────────────────────
router.get(ruta, verificarToken, rateLimit, getMiPerfilBuscador);
router.put(ruta, verificarToken, rateLimit, upsertMiPerfilBuscador);
router.delete(ruta, verificarToken, rateLimit, deleteMiPerfilBuscador);

export default router;
