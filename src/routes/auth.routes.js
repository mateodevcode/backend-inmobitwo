// src/routes/auth.routes.js
import { Router } from "express";
import {
  registro,
  login,
  refresh,
  logout,
  me,
  checkEmail,
} from "../controllers/auth.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";
import {
  createRateLimitMiddleware,
  registerLimiter,
  loginLimiter,
} from "../lib/rateLimit.js";

const router = Router();

const sLimiterRegistro = createRateLimitMiddleware(registerLimiter);
const sLimiterLogin = createRateLimitMiddleware(loginLimiter);

// Rutas públicas
// router.post("/auth/registro", registro);
// router.post("/auth/login", login);

router.post("/auth/registro", sLimiterRegistro, registro);
router.post("/auth/check-email", checkEmail); // ← Agregar esto
router.post("/auth/login", sLimiterLogin, login);

router.post("/auth/refresh", refresh); // usa cookie httpOnly
router.post("/auth/logout", logout); // usa cookie httpOnly

// Ruta protegida — devuelve el usuario actual
router.get("/auth/me", verificarToken, me);

export default router;
