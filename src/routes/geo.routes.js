import { Router } from "express";
import {
  getCountries,
  getStates,
  getCities,
  suggestCities,
} from "../controllers/geo.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

router.get("/countries", rateLimit, getCountries);
router.get("/states", rateLimit, getStates);
router.get("/cities", rateLimit, getCities);

// 👈 2. Registramos el endpoint público de sugerencias tipo Idealista
router.get("/suggest-cities", rateLimit, suggestCities);

export default router;
