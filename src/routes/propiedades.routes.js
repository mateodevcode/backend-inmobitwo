import { Router } from "express";
import {
  getPropiedades,
  createPropiedades,
  getPropiedadesById,
  updatePropiedades,
  deletePropiedades,
  publicarAnuncios,
  getPropiedadesHome,
  getPropiedadesMisAnuncios,
  getPropiedadesByOrganizacion,
  getPropertiesBySlugs,
  getInmueblesEnBbox,
  getPropiedadResumen,
} from "../controllers/propiedades.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
import { APIKEY } from "../config.js";
import { upload } from "../lib/multer.js";
import { verificarToken, verificarRol } from "../middleware/auth.middleware.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

const uploadFields = upload.fields([
  { name: "imagenPrincipal", maxCount: 1 },
  { name: "galeria", maxCount: 20 },
  { name: "planos", maxCount: 20 },
]);

const ruta = "/propiedades";

// 1. RUTAS ESTÁTICAS GENERALES DE PROPIEDADES (Siempre arriba)
router.get(ruta, rateLimit, getPropiedades);
router.get(`${ruta}/inicio`, rateLimit, getPropiedadesHome);
router.get(
  `${ruta}/mis-anuncios`,
  verificarToken,
  rateLimit,
  getPropiedadesMisAnuncios,
);

// 2. NUEVA RUTA POR SLUG ESTILO IDEALISTA (Corregida con el prefijo ${ruta} y bien posicionada)
router.get(`${ruta}/search-slugs`, rateLimit, getPropertiesBySlugs);

// Búsqueda por bounding box (MapaInmuebles)
router.get(`${ruta}/inmuebles-en-bbox`, rateLimit, getInmueblesEnBbox);

// Resumen ligero de propiedad para PropertyCard
router.get(`${ruta}/:id/resumen`, rateLimit, getPropiedadResumen);

// 3. VISTA DE ORGANIZACIÓN (TENANT) - Va antes de los parámetros dinámicos generales
router.get(
  `${ruta}/organizacion/:slug`,
  rateLimit,
  getPropiedadesByOrganizacion,
);

// 4. PARÁMETROS DINÁMICOS GENERALES (Siempre abajo del todo para evitar colisiones de tipos)
router.get(`${ruta}/:id`, rateLimit, getPropiedadesById);

// 5. MÉTODOS DE ESCRITURA Y ACCIONES
router.post(ruta, verificarToken, uploadFields, createPropiedades);
router.patch(`${ruta}/:id`, verificarToken, uploadFields, updatePropiedades);

router.delete(`${ruta}/:id`, verificarToken, deletePropiedades);

router.post(
  "/publicar-anuncios",
  verificarToken,
  uploadFields,
  publicarAnuncios,
);

export default router;
