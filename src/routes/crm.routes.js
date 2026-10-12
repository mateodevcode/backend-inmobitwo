// src/routes/crm.routes.js — CRM fase 1 (lecturas) + fase 2 (núcleo)
import { Router } from "express";
import { verificarToken } from "../middleware/auth.middleware.js";
import { resolverEspacioCrm } from "../middleware/crmEspacio.middleware.js";
import {
  createRateLimitMiddleware,
  defaultLimiter,
} from "../lib/rateLimit.js";
import {
  getCrmLeads,
  getCrmPropiedades,
  getDashboard,
} from "../controllers/crm.controllers.js";
import {
  actualizarContacto,
  actualizarTarea,
  archivarContacto,
  asignarContacto,
  completarTarea,
  convertirLead,
  crearActividad,
  crearContacto,
  crearTarea,
  listarActividades,
  listarContactos,
  listarTareas,
  obtenerContacto,
} from "../controllers/crm.nucleo.controllers.js";
import {
  actualizarEtapa,
  actualizarOportunidad,
  cerrarOportunidad,
  crearEtapa,
  crearOportunidad,
  eliminarEtapa,
  getEtapas,
  listarOportunidades,
  moverOportunidad,
  obtenerOportunidad,
} from "../controllers/crm.pipeline.controllers.js";
import {
  actividad,
  conversion,
  embudo,
  leadsOrigen,
  valorGanado,
} from "../controllers/crm.reportes.controllers.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const conEspacio = [verificarToken, resolverEspacioCrm, rateLimit];

// Fase 1
router.get("/crm/dashboard", ...conEspacio, getDashboard);
router.get("/crm/propiedades", ...conEspacio, getCrmPropiedades);
router.get("/crm/leads", ...conEspacio, getCrmLeads);

// Fase 2 — contactos
router.get("/crm/contactos", ...conEspacio, listarContactos);
router.post("/crm/contactos", ...conEspacio, crearContacto);
router.get("/crm/contactos/:id", ...conEspacio, obtenerContacto);
router.patch("/crm/contactos/:id", ...conEspacio, actualizarContacto);
router.delete("/crm/contactos/:id", ...conEspacio, archivarContacto);
router.patch("/crm/contactos/:id/asignar", ...conEspacio, asignarContacto);
router.post("/crm/leads/:id/convertir", ...conEspacio, convertirLead);

// Fase 2 — actividades y tareas
router.get("/crm/contactos/:id/actividades", ...conEspacio, listarActividades);
router.post("/crm/actividades", ...conEspacio, crearActividad);
router.get("/crm/tareas", ...conEspacio, listarTareas);
router.post("/crm/tareas", ...conEspacio, crearTarea);
router.patch("/crm/tareas/:id", ...conEspacio, actualizarTarea);
router.post("/crm/tareas/:id/completar", ...conEspacio, completarTarea);

// Fase 3 — pipeline
router.get("/crm/etapas", ...conEspacio, getEtapas);
router.post("/crm/etapas", ...conEspacio, crearEtapa);
router.patch("/crm/etapas/:id", ...conEspacio, actualizarEtapa);
router.delete("/crm/etapas/:id", ...conEspacio, eliminarEtapa);
router.get("/crm/oportunidades", ...conEspacio, listarOportunidades);
router.post("/crm/oportunidades", ...conEspacio, crearOportunidad);
router.get("/crm/oportunidades/:id", ...conEspacio, obtenerOportunidad);
router.patch("/crm/oportunidades/:id", ...conEspacio, actualizarOportunidad);
router.patch("/crm/oportunidades/:id/mover", ...conEspacio, moverOportunidad);
router.patch("/crm/oportunidades/:id/cerrar", ...conEspacio, cerrarOportunidad);

// Fase 4 — reportes
router.get("/crm/reportes/embudo", ...conEspacio, embudo);
router.get("/crm/reportes/conversion", ...conEspacio, conversion);
router.get("/crm/reportes/valor-ganado", ...conEspacio, valorGanado);
router.get("/crm/reportes/actividad", ...conEspacio, actividad);
router.get("/crm/reportes/leads-origen", ...conEspacio, leadsOrigen);

export default router;
