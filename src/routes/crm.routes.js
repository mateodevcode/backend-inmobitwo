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
  reasignarMasivo,
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
  reporteAgentes,
  reporteInmuebles,
  reporteRespuesta,
  valorGanado,
} from "../controllers/crm.reportes.controllers.js";
import {
  actualizarVisita,
  cambiarEstadoVisita,
  crearVisita,
  eliminarVisita,
  listarVisitas,
  obtenerVisita,
} from "../controllers/crm.visitas.controllers.js";
import {
  actualizarDemanda,
  buscarCiudades,
  coincidenciasDemanda,
  crearDemanda,
  demandasDePropiedad,
  eliminarDemanda,
  listarBarrios,
  listarDemandas,
  marcarCoincidenciasVistas,
  marcarSeguimiento,
  obtenerDemanda,
  quitarSeguimiento,
} from "../controllers/crm.demandas.controllers.js";
import {
  actualizarCaptacion,
  captacionDePropiedad,
  crearCaptacion,
  descargarDocumento,
  eliminarCaptacion,
  eliminarDocumento,
  listarCaptaciones,
  obtenerCaptacion,
  subirDocumento,
} from "../controllers/crm.captaciones.controllers.js";
import {
  accionesMasivas,
  duplicarPropiedad,
  rendimientoPropiedad,
} from "../controllers/crm.cartera.controllers.js";
import {
  actualizarPlantilla,
  contactoDesdeChat,
  crearPlantilla,
  eliminarPlantilla,
  listarBandeja,
  listarPlantillas,
  usarPlantilla,
} from "../controllers/crm.bandeja.controllers.js";
import {
  guardarMetas,
  guardarReparto,
  obtenerMetas,
  obtenerReparto,
  repartirLeads,
} from "../controllers/crm.equipo.controllers.js";
import { importarContactos, importarInmuebles } from "../controllers/crm.importacion.controllers.js";
import {
  actualizarAutorizacion,
  exportarDatosContacto,
  registroAuditoria,
  suprimirContacto,
} from "../controllers/crm.habeas.controllers.js";
import {
  actualizarPreferencias,
  contadorNotificaciones,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  obtenerPreferencias,
} from "../controllers/crm.notificaciones.controllers.js";
import { uploadDocumento } from "../lib/multer.js";
import { clavePublicaPush, eliminarSuscripcionPush, guardarSuscripcion } from "../controllers/push.controller.js";

// Documento de captación: un archivo en el campo "archivo" (máx. 10 MB).
const unDocumento = (req, res, next) =>
  uploadDocumento.single("archivo")(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, error: "El archivo pesa demasiado (máx. 10 MB)." });
    }
    next(err);
  });

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
router.post("/crm/reasignar", ...conEspacio, reasignarMasivo);
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
router.get("/crm/reportes/agentes", ...conEspacio, reporteAgentes);
router.get("/crm/reportes/inmuebles", ...conEspacio, reporteInmuebles);
router.get("/crm/reportes/respuesta", ...conEspacio, reporteRespuesta);

// Agenda y visitas
router.get("/crm/visitas", ...conEspacio, listarVisitas);
router.post("/crm/visitas", ...conEspacio, crearVisita);
router.get("/crm/visitas/:id", ...conEspacio, obtenerVisita);
router.patch("/crm/visitas/:id", ...conEspacio, actualizarVisita);
router.post("/crm/visitas/:id/estado", ...conEspacio, cambiarEstadoVisita);
router.delete("/crm/visitas/:id", ...conEspacio, eliminarVisita);

// Demandas y cruce
router.get("/crm/demandas", ...conEspacio, listarDemandas);
router.post("/crm/demandas", ...conEspacio, crearDemanda);
router.get("/crm/demandas/:id", ...conEspacio, obtenerDemanda);
router.patch("/crm/demandas/:id", ...conEspacio, actualizarDemanda);
router.delete("/crm/demandas/:id", ...conEspacio, eliminarDemanda);
router.get("/crm/demandas/:id/coincidencias", ...conEspacio, coincidenciasDemanda);
router.post("/crm/demandas/:id/vistas", ...conEspacio, marcarCoincidenciasVistas);
router.put("/crm/demandas/:id/propiedades/:propiedadId", ...conEspacio, marcarSeguimiento);
router.delete("/crm/demandas/:id/propiedades/:propiedadId", ...conEspacio, quitarSeguimiento);
router.get("/crm/propiedades/:id/demandas", ...conEspacio, demandasDePropiedad);
router.get("/crm/catalogos/ciudades", ...conEspacio, buscarCiudades);
router.get("/crm/catalogos/barrios", ...conEspacio, listarBarrios);

// Captación y propietarios
router.get("/crm/captaciones", ...conEspacio, listarCaptaciones);
router.post("/crm/captaciones", ...conEspacio, crearCaptacion);
router.get("/crm/captaciones/:id", ...conEspacio, obtenerCaptacion);
router.patch("/crm/captaciones/:id", ...conEspacio, actualizarCaptacion);
router.delete("/crm/captaciones/:id", ...conEspacio, eliminarCaptacion);
router.post("/crm/captaciones/:id/documentos", ...conEspacio, unDocumento, subirDocumento);
router.get("/crm/captaciones/:id/documentos/:docId", ...conEspacio, descargarDocumento);
router.delete("/crm/captaciones/:id/documentos/:docId", ...conEspacio, eliminarDocumento);
router.get("/crm/propiedades/:id/captacion", ...conEspacio, captacionDePropiedad);

// Cartera avanzada
router.post("/crm/propiedades/acciones", ...conEspacio, accionesMasivas);
router.post("/crm/propiedades/:id/duplicar", ...conEspacio, duplicarPropiedad);
router.get("/crm/propiedades/:id/rendimiento", ...conEspacio, rendimientoPropiedad);

// Bandeja unificada y plantillas de respuesta
router.get("/crm/bandeja", ...conEspacio, listarBandeja);
router.post("/crm/bandeja/chat/:id/contacto", ...conEspacio, contactoDesdeChat);
router.get("/crm/plantillas", ...conEspacio, listarPlantillas);
router.post("/crm/plantillas", ...conEspacio, crearPlantilla);
router.patch("/crm/plantillas/:id", ...conEspacio, actualizarPlantilla);
router.delete("/crm/plantillas/:id", ...conEspacio, eliminarPlantilla);
router.post("/crm/plantillas/:id/uso", ...conEspacio, usarPlantilla);

// Equipo: reparto de leads y metas
router.get("/crm/equipo/reparto", ...conEspacio, obtenerReparto);
router.put("/crm/equipo/reparto", ...conEspacio, guardarReparto);
router.post("/crm/equipo/repartir-leads", ...conEspacio, repartirLeads);
router.get("/crm/equipo/metas", ...conEspacio, obtenerMetas);
router.put("/crm/equipo/metas", ...conEspacio, guardarMetas);

// Importación desde CSV/Excel (`simular: true` = vista previa sin escribir)
router.post("/crm/importar/contactos", ...conEspacio, importarContactos);
router.post("/crm/importar/inmuebles", ...conEspacio, importarInmuebles);

// Notificaciones dentro del CRM (del espacio activo)
router.get("/crm/notificaciones", ...conEspacio, listarNotificaciones);
router.get("/crm/notificaciones/contador", ...conEspacio, contadorNotificaciones);
router.get("/crm/notificaciones/preferencias", ...conEspacio, obtenerPreferencias);
router.put("/crm/notificaciones/preferencias", ...conEspacio, actualizarPreferencias);
// Push del navegador para los avisos (suscripciones con app = 'crm'; 503 si está apagado).
router.get("/crm/push/clave-publica", verificarToken, rateLimit, clavePublicaPush);
router.post("/crm/push/suscripcion", verificarToken, rateLimit, guardarSuscripcion("crm"));
router.delete("/crm/push/suscripcion", verificarToken, rateLimit, eliminarSuscripcionPush);
router.post("/crm/notificaciones/leer-todas", ...conEspacio, marcarTodasLeidas);
router.post("/crm/notificaciones/:id/leida", ...conEspacio, marcarLeida);

// Habeas Data (Ley 1581): acceso, autorización, supresión y registro
router.get("/crm/contactos/:id/datos-personales", ...conEspacio, exportarDatosContacto);
router.put("/crm/contactos/:id/autorizacion", ...conEspacio, actualizarAutorizacion);
router.post("/crm/contactos/:id/suprimir", ...conEspacio, suprimirContacto);
router.get("/crm/habeas-data/registro", ...conEspacio, registroAuditoria);

export default router;
