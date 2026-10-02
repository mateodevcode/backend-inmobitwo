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
  countPropiedadesMisAnuncios,
  getPropiedadesByOrganizacion,
  getPropertiesBySlugs,
  getInmueblesEnBbox,
  getPropiedadResumen,
  getHistorialPrecios,
  getPropiedadCaracteristicas,
  guardarPropiedadCaracteristicas,
  calcularPrecioSugeridoPropiedad,
  validarPrecioPropiedad,
  searchVivienda,
} from "../controllers/propiedades.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
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
router.get(
  `${ruta}/mis-anuncios/count`,
  verificarToken,
  rateLimit,
  countPropiedadesMisAnuncios,
);

// 2. NUEVA RUTA POR SLUG ESTILO IDEALISTA (Corregida con el prefijo ${ruta} y bien posicionada)
router.get(`${ruta}/search-slugs`, rateLimit, getPropertiesBySlugs);

// Búsqueda por múltiples tipos de vivienda (agrupados)
router.get(`${ruta}/search-vivienda`, rateLimit, searchVivienda);

// Búsqueda por bounding box (MapaInmuebles)
router.get(`${ruta}/inmuebles-en-bbox`, rateLimit, getInmueblesEnBbox);

// Resumen ligero de propiedad para PropertyCard
router.get(`${ruta}/:id/resumen`, rateLimit, getPropiedadResumen);

// Historial de precios (price_history)
router.get(`${ruta}/:id/historial-precios`, rateLimit, getHistorialPrecios);

// Características N:M de una propiedad (feature_catalog)
router.get(
  `${ruta}/:id/caracteristicas`,
  rateLimit,
  getPropiedadCaracteristicas,
);
router.post(
  `${ruta}/:id/caracteristicas`,
  verificarToken,
  rateLimit,
  guardarPropiedadCaracteristicas,
);

// 3. VISTA DE ORGANIZACIÓN (TENANT) - Va antes de los parámetros dinámicos generales
router.get(
  `${ruta}/organizacion/:slug`,
  rateLimit,
  getPropiedadesByOrganizacion,
);

// Algoritmo de precio sugerido (servicio independiente, antes de rutas :id)
router.post(
  `${ruta}/calcular-precio-sugerido`,
  rateLimit,
  calcularPrecioSugeridoPropiedad,
);
router.post(`${ruta}/validar-precio`, rateLimit, validarPrecioPropiedad);

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
