import { Router } from "express";
import {
  createRateLimitMiddleware,
  verificacionCodigoLimiter,
} from "../lib/rateLimit.js";
import {
  generarCodigo,
  validarCodigo,
  resetPassword,
} from "../controllers/password.recovery.controllers.js";

const router = Router();

const rateLimitOtp = createRateLimitMiddleware(verificacionCodigoLimiter);

// Públicas (el usuario aún no tiene sesión): con límite anti-abuso
router.patch("/api/generar-codigo", rateLimitOtp, generarCodigo);
router.post("/api/validar-codigo", rateLimitOtp, validarCodigo);
router.patch("/api/usuario/reset-password", rateLimitOtp, resetPassword);

export default router;
