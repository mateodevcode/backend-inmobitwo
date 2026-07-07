import { Router } from "express";
import {
  getCountries,
  getStates,
  getCities,
} from "../controllers/geo.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

router.get("/countries", rateLimit, getCountries);
router.get("/states", rateLimit, getStates);
router.get("/cities", rateLimit, getCities);

export default router;
