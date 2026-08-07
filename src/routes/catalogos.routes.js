import { Router } from "express";
import {
  getOperationTypes,
  getRentalTypes,
  getPropertyTypes,
  getConditionTypes,
  getHeatingTypes,
  getFeatureCatalog,
} from "../controllers/catalogos.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

// Catálogos de solo lectura (lookups para el frontend)
router.get("/operaciones", rateLimit, getOperationTypes);
router.get("/tipos-alquiler", rateLimit, getRentalTypes);
router.get("/tipos-inmueble", rateLimit, getPropertyTypes);
router.get("/estados", rateLimit, getConditionTypes);
router.get("/calefaccion", rateLimit, getHeatingTypes);
router.get("/caracteristicas", rateLimit, getFeatureCatalog);

export default router;
