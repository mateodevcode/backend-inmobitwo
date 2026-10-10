// src/routes/busquedas.guardadas.routes.js
import { Router } from "express";
import { verificarToken } from "../middleware/auth.middleware.js";
import {
  crearBusqueda, listarBusquedas, verificarBusqueda, actualizarBusqueda,
  eliminarBusqueda, bajaPorToken, reactivarPorToken,
} from "../controllers/busquedas.guardadas.controller.js";
import {
  clavePublicaPush, guardarSuscripcionPush, eliminarSuscripcionPush,
} from "../controllers/push.controller.js";

const router = Router();
const base = "/busquedas-guardadas";

// Públicas (token del email). Usa POST para que los escáneres de correo no den de baja solos.
router.post(`${base}/baja/:token`, bajaPorToken);
router.post(`${base}/baja/:token/reactivar`, reactivarPorToken);

// Push (apagado por PUSH_ENABLED=false)
router.get(`${base}/push/clave-publica`, clavePublicaPush);
router.post(`${base}/push/suscripcion`, verificarToken, guardarSuscripcionPush);
router.delete(`${base}/push/suscripcion`, verificarToken, eliminarSuscripcionPush);

// CRUD (protegidas)
router.get(base, verificarToken, listarBusquedas);
router.post(base, verificarToken, crearBusqueda);
router.post(`${base}/verificar`, verificarToken, verificarBusqueda);
router.patch(`${base}/:id`, verificarToken, actualizarBusqueda);
router.delete(`${base}/:id`, verificarToken, eliminarBusqueda);

export default router;
