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

export default router;
