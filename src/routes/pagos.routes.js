// src/routes/pagos.routes.js
// Rutas de pagos Mercado Pago. Montar en index.js con app.use(pagosRoutes).
// El producto se resuelve por slug en el controlador (genérico).
// IMPORTANTE: el webhook (/pagos/mp/webhook) va SIN verificarToken y con su
// propio limiter (no el default): MP es una fuente externa.
//
// Rutas compatibles con las anteriores:
//   POST /pagos/ubicacion-oculta
//   GET  /pagos/ubicacion-oculta/:propiedadId/estado

import { Router } from "express";
import {
  getConfigPagos,
  iniciarPago,
  estadoPago,
  webhookMercadoPago,
} from "../controllers/pagos.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";

const router = Router();

// Config del pago (precio/moneda que consume el Brick). Solo usuarios logueados.
router.get("/pagos/config", verificarToken, getConfigPagos);

// Webhook de Mercado Pago SIN auth token, con verificación de firma propia.
router.post("/pagos/mp/webhook", webhookMercadoPago);

// Iniciar el cobro de un producto (limiter propio dentro del handler array).
router.post("/pagos/:producto", verificarToken, iniciarPago);

// Estado del último pago / reconciliación perezosa.
router.get(
  "/pagos/:producto/:contextoId/estado",
  verificarToken,
  estadoPago,
);

export default router;
