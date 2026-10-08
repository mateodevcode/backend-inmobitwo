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
  getPropiedadStats,
  calcularPrecioSugeridoPropiedad,
  validarPrecioPropiedad,
  searchVivienda,
  getOfertasPropiedad,
  upsertOfertaPropiedad,
  eliminarOfertaPropiedad,
  cambiarOperacionPropiedad,
  emitirTokenVista,
} from "../controllers/propiedades.controllers.js";
import { createRateLimitMiddleware, createRateLimiter, defaultLimiter } from "../lib/rateLimit.js";
import { ipReal } from "../lib/ipReal.js";
import { requiereVistas } from "../lib/validarSecretos.js";
import { upload } from "../lib/multer.js";
import { verificarToken, verificarRol } from "../middleware/auth.middleware.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

// Emisor de tokens de vista (lote 3 punto 5): 30/min por IP real. Autenticados
// 300/min por usuario (regla del limiter). Fail-open si Redis cae: bloquear
// tokens no cuenta vistas, así que ante la duda se deja pasar.
// Espacio propio (lote 5 punto 2): no consume el cupo de login/default.
const viewTokenLimiter = createRateLimiter(30, 60000, 300, (req) => ipReal(req), "view-token");
const rateLimitViewToken = createRateLimitMiddleware(viewTokenLimiter);

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

// Estadísticas del anuncio (vistas, favoritos, mensajes) — solo el dueño
router.get(
  `${ruta}/:id/stats`,
  verificarToken,
  rateLimit,
  getPropiedadStats,
);

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

// 4. OFERTAS POR OPERACIÓN (antes de :id para evitar colisiones de tipos)
router.get(`${ruta}/:id/ofertas`, verificarToken, rateLimit, getOfertasPropiedad);
router.put(
  `${ruta}/:id/ofertas/:operacion`,
  verificarToken,
  rateLimit,
  upsertOfertaPropiedad,
);
router.delete(
  `${ruta}/:id/ofertas/:operacion`,
  verificarToken,
  rateLimit,
  eliminarOfertaPropiedad,
);
router.post(
  `${ruta}/:id/cambiar-operacion`,
  verificarToken,
  rateLimit,
  cambiarOperacionPropiedad,
);

// Token de ficha para medición de vistas (pública + rate-limit; verifica Rust)
router.post(`${ruta}/:id/view-token`, requiereVistas, rateLimitViewToken, emitirTokenVista);

// 5. PARÁMETROS DINÁMICOS GENERALES (Siempre abajo del todo para evitar colisiones de tipos)
router.get(`${ruta}/:id`, rateLimit, getPropiedadesById);

// 6. MÉTODOS DE ESCRITURA Y ACCIONES
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
