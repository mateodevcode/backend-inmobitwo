// src/routes/pagos.routes.js
// Rutas de pagos Mercado Pago. Montar en index.js con app.use(pagosRoutes).
// IMPORTANTE: el webhook (/pagos/mp/webhook) va SIN verificarToken y con su
// propio limiter (no el default): MP es una fuente externa.

import { Router } from "express";
import {
  getConfigPagos,
  iniciarPagoUbicacionOculta,
  estadoPagoUbicacionOculta,
  webhookMercadoPago,
} from "../controllers/pagos.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";

const router = Router();

// Config del pago (precio/moneda que consume el Brick). Solo usuarios logueados.
router.get("/pagos/config", verificarToken, getConfigPagos);

// Iniciar el cobro (limiter propio estricto está dentro del handler array).
router.post("/pagos/ubicacion-oculta", verificarToken, iniciarPagoUbicacionOculta);

// Estado del último pago / reconciliación perezosa.
router.get(
  "/pagos/ubicacion-oculta/:propiedadId/estado",
  verificarToken,
  estadoPagoUbicacionOculta,
);

// Webhook de Mercado Pago SIN auth token, con verificación de firma propia.
router.post("/pagos/mp/webhook", webhookMercadoPago);

export default router;
