// ────────────────────────────────────────────────────────────────
// CORS DINÁMICO
// FRONTEND_URL cubre los orígenes fijos tuyos (ej: https://inmobitwo.com).
// Los dominios propios de cada organización (custom_domain) se validan
// contra la DB, con un caché en memoria de 60s para no consultar
// Postgres en cada request.

import { FRONTEND_URL } from "./config.js";
import { pool } from "./db.js";

// ────────────────────────────────────────────────────────────────
const origenesFijos = FRONTEND_URL?.split(",").map((o) => o.trim()) || [];

let cacheDominios = { valores: new Set(), expira: 0 };

const obtenerDominiosActivos = async () => {
  const ahora = Date.now();
  if (ahora < cacheDominios.expira) return cacheDominios.valores;

  try {
    const { rows } = await pool.query(
      `SELECT custom_domain FROM organizaciones 
       WHERE dominio_estado = 'activo' AND custom_domain IS NOT NULL`,
    );
    cacheDominios = {
      valores: new Set(rows.map((r) => r.custom_domain)),
      expira: ahora + 60_000, // 60s de caché
    };
  } catch (error) {
    console.error(
      "⚠️ Error refrescando caché de dominios CORS:",
      error.message,
    );
    // Si falla, seguimos con el caché anterior (aunque esté vencido) en vez de tumbar todo
  }

  return cacheDominios.valores;
};

export const corsOptions = {
  origin: async (origin, callback) => {
    // Requests sin origin (curl, Postman, servidor a servidor) se permiten
    if (!origin) return callback(null, true);

    if (origenesFijos.includes(origin)) {
      return callback(null, true);
    }

    // origin viene como "https://www.inmobiliariaoviedo.com" -> comparamos solo el host
    let hostOrigin;
    try {
      hostOrigin = new URL(origin).hostname;
    } catch {
      return callback(new Error("Origin inválido"), false);
    }

    const dominiosActivos = await obtenerDominiosActivos();
    if (dominiosActivos.has(hostOrigin)) {
      return callback(null, true);
    }

    return callback(new Error("No permitido por CORS: " + origin), false);
  },
  credentials: true,
};
