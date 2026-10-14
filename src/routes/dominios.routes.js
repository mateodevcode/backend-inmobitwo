// src/routes/dominios.routes.js — dominios propios con ejecución remota.
// Todo el módulo es solo superadmin (incluida la lectura: expone la
// infraestructura de los clientes).
import { Router } from "express";
import { verificarRol, verificarToken } from "../middleware/auth.middleware.js";
import {
  createRateLimitMiddleware,
  defaultLimiter,
} from "../lib/rateLimit.js";
import {
  agregarDominio,
  listarJobs,
  obtenerJob,
  quitarDominio,
  solicitudesDominios,
} from "../controllers/dominios.controllers.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const soloSuperadmin = [verificarToken, verificarRol(["superadmin"]), rateLimit];

router.get("/dominios/solicitudes", ...soloSuperadmin, solicitudesDominios);
router.get("/dominios/jobs", ...soloSuperadmin, listarJobs);
router.get("/dominios/jobs/:id", ...soloSuperadmin, obtenerJob);
router.post("/dominios/agregar", ...soloSuperadmin, agregarDominio);
router.post("/dominios/quitar", ...soloSuperadmin, quitarDominio);

export default router;
