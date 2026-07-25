import { Router } from "express";
import {
  getCountries,
  getStates,
  getCities,
  suggestCities,
  getLocationInfo,
  getStatesGeoJSON,
  getCitiesGeoJSON,
  getBarrios,
  getGeoCount,
  getLocationGeoJSON,
} from "../controllers/geo.controllers.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);

router.get("/countries", rateLimit, getCountries);
router.get("/states", rateLimit, getStates);
router.get("/cities", rateLimit, getCities);

// Autocompletado tipo Idealista
router.get("/suggest-cities", rateLimit, suggestCities);

// Info de ubicación con conteos
router.get("/location-info", rateLimit, getLocationInfo);

// GeoJSON para el mapa SelectZona (polígonos reales)
router.get("/states/geojson", rateLimit, getStatesGeoJSON);
router.get("/cities/geojson", rateLimit, getCitiesGeoJSON);
router.get("/barrios", rateLimit, getBarrios);

// Conteo de propiedades por zona geográfica
router.get("/geo-count", rateLimit, getGeoCount);

// GeoJSON de una zona específica (mini-mapa en ListaPropiedades)
router.get("/location-geojson", rateLimit, getLocationGeoJSON);

export default router;
