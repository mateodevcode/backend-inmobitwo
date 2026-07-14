// lib/geocode.js
//
// Proxy hacia Nominatim (OpenStreetMap) para geocodificar direcciones.
// Por qué un proxy y no llamar a Nominatim directo desde el frontend:
//   1. Nominatim exige un User-Agent identificando la app (política de uso).
//   2. Evita que el navegador del usuario dispare muchas peticiones seguidas
//      (ej. si alguien escribe rápido) violando el límite de 1 req/seg.
//   3. Permite cachear resultados sin tocar el frontend.

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search";

// ⚠️ Cambia esto por el nombre real de tu app y un contacto válido,
// Nominatim lo exige en su política de uso (https://operations.osmfoundation.org/policies/nominatim/)
const USER_AGENT = "InmobiTwo/1.0 (mateodevcode@gmail.com)"; // mateo@seventwo.tech

// Caché simple en memoria. Para producción con más de una instancia del server,
// considera moverlo a Redis (la firma de geocodeAddress no cambiaría).
const geocodeCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 horas

export async function geocodeAddress(address) {
  const cacheKey = address.trim().toLowerCase();
  const cached = geocodeCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = new URL(NOMINATIM_BASE_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
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
  const data = {
    latitude: parseFloat(result.lat),
    longitude: parseFloat(result.lon),
    displayName: result.display_name,
    importance: result.importance ?? null,
  };

  geocodeCache.set(cacheKey, { data, timestamp: Date.now() });

  return data;
}
