import { Router } from "express";
import { getGeocode } from "../controllers/geocode.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

router.get("/geocode", rateLimit, getGeocode);

export default router;
