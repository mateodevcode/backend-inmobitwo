import { Router } from "express";
import {
  getTokenChat,
  crearObtenerConversacion,
  listarConversaciones,
  listarMensajes,
  enviarMensaje,
  marcarLeida,
  contarNoLeidos,
} from "../controllers/chat.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";
import {
  createRateLimitMiddleware,
  createRateLimiter,
  defaultLimiter,
} from "../lib/rateLimit.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
// ~30 envíos/min por usuario
const rateLimitEnvio = createRateLimitMiddleware(
  createRateLimiter(30, 60000, 30, null, "chat-envio"),
);
// ~20 creaciones/hora por usuario
const rateLimitCrear = createRateLimitMiddleware(
  createRateLimiter(20, 3600000, 20, null, "chat-crear"),
);
// ~20 tokens/hora por usuario
const rateLimitToken = createRateLimitMiddleware(
  createRateLimiter(20, 3600000, 20, null, "chat-token"),
);
const ruta = "/chat";

// ────────────────────────────────────────────────────────────────
// Chat entre usuarios (requieren login)
// ────────────────────────────────────────────────────────────────
router.post(`${ruta}/token`, verificarToken, rateLimitToken, getTokenChat);

router.post(
  `${ruta}/conversaciones`,
  verificarToken,
  rateLimitCrear,
  crearObtenerConversacion,
);

router.get(
  `${ruta}/conversaciones`,
  verificarToken,
  rateLimit,
  listarConversaciones,
);

router.get(
  `${ruta}/conversaciones/:id/mensajes`,
  verificarToken,
  rateLimit,
  listarMensajes,
);

router.post(
  `${ruta}/conversaciones/:id/mensajes`,
  verificarToken,
  rateLimitEnvio,
  enviarMensaje,
);

router.post(
  `${ruta}/conversaciones/:id/leer`,
  verificarToken,
  rateLimit,
  marcarLeida,
);

router.get(`${ruta}/no-leidos`, verificarToken, rateLimit, contarNoLeidos);

export default router;
