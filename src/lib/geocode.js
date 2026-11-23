// lib/geocode.js
//
// Proxy hacia Nominatim (OpenStreetMap) para geocodificar direcciones.
// Por qué un proxy y no llamar a Nominatim directo desde el frontend:
//   1. Nominatim exige un User-Agent identificando la app (política de uso).
//   2. Evita que el navegador del usuario dispare muchas peticiones seguidas
//      (ej. si alguien escribe rápido) violando el límite de 1 req/seg.
//   3. Permite cachear resultados sin tocar el frontend.

import { cacheGet } from "./redis.js";

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim exige identificar la app con un contacto (política de uso:
// https://operations.osmfoundation.org/policies/nominatim/). El contacto va en
// la variable GEOCODE_CONTACT, no en el código (auditoría N-36).
const USER_AGENT = `InmobiTwo/1.0 (${process.env.GEOCODE_CONTACT || "https://inmobitwo.seventwo.tech"})`;
const TIMEOUT_MS = 8000;

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 horas

export async function geocodeAddress(address) {
  const cacheKey = `geocode:${address.trim().toLowerCase()}`;

  return cacheGet(cacheKey, CACHE_TTL_SECONDS, async () => {
    const url = new URL(NOMINATIM_BASE_URL);
    url.searchParams.set("q", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "es",
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim respondió ${response.status}`);
    }

    const results = await response.json();

    if (results.length === 0) {
      return null;
    }

    const result = results[0];
    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name,
      importance: result.importance ?? null,
    };
  });
}
