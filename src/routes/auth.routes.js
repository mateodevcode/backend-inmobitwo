// src/routes/auth.routes.js
import { Router } from "express";
import {
  registro,
  login,
  verificarOtpLogin,
  reenviarOtpLogin,
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
  verificacionCodigoLimiter,
} from "../lib/rateLimit.js";

const router = Router();

const sLimiterRegistro = createRateLimitMiddleware(registerLimiter);
const sLimiterLogin = createRateLimitMiddleware(loginLimiter);
// OTP del segundo factor: 5 intentos cada 10 min (igual que verificación por email)
const sLimiterOtp = createRateLimitMiddleware(verificacionCodigoLimiter);

// Rutas públicas
// router.post("/auth/registro", registro);
// router.post("/auth/login", login);

router.post("/auth/registro", sLimiterRegistro, registro);
router.post("/auth/check-email", checkEmail); // ← Agregar esto
router.post("/auth/login", sLimiterLogin, login);
router.post("/auth/verificar-otp-login", sLimiterOtp, verificarOtpLogin);
router.post("/auth/reenviar-otp-login", sLimiterOtp, reenviarOtpLogin);

router.post("/auth/refresh", refresh); // usa cookie httpOnly
router.post("/auth/logout", logout); // usa cookie httpOnly

// Ruta protegida — devuelve el usuario actual
router.get("/auth/me", verificarToken, me);

export default router;
