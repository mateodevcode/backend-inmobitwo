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
} from "../controllers/propiedades.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";
import { validateApiKey } from "../lib/validateApiKey.js";
import { APIKEY } from "../config.js";
import { upload } from "../lib/multer.js";
import { verificarToken, verificarRol } from "../middleware/auth.middleware.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

const uploadFields = upload.fields([
  { name: "imagenPrincipal", maxCount: 1 },
  { name: "galeria", maxCount: 20 },
]);

const ruta = "/propiedades";

router.get(ruta, rateLimit, getPropiedades);

// rutas especificas raiz inmobitwo
router.get(`${ruta}/inicio`, rateLimit, getPropiedadesHome);
// rutas especificas /usuario/mis-datos/
router.get(`${ruta}/mis-anuncios`, rateLimit, getPropiedadesMisAnuncios);

// NUEVO — vista de organización (tenant), va antes de /:id
router.get(
  `${ruta}/organizacion/:slug`,
  rateLimit,
  getPropiedadesByOrganizacion,
);

router.get(`${ruta}/:id`, rateLimit, getPropiedadesById);

router.post(ruta, verificarToken, uploadFields, createPropiedades);
router.patch(`${ruta}/:id`, verificarToken, uploadFields, updatePropiedades);

router.delete(
  `${ruta}/:id`,
  verificarToken,
  // verificarRol(["admin", "superadmin"]),
  deletePropiedades,
);
router.post(
  "/publicar-anuncios",
  verificarToken,
  uploadFields,
  publicarAnuncios,
);

export default router;
