import { pool } from "../db.js";

// ────────────────────────────────────────────────────────────────
// Middleware: resuelve la organización (tenant) a partir del host
// que manda el FRONTEND explícitamente (no de req.headers.host,
// porque ese siempre va a ser api.barbershopbbg.com sin importar
// desde qué dominio esté navegando el visitante).
//
// El frontend debe mandar el host actual de una de estas dos formas:
//   - Query param:  ?host=www.inmobiliariaoviedo.com
//   - Header:       X-Tenant-Host: www.inmobiliariaoviedo.com
//
// Uso en una ruta:
//   router.get("/algo", resolverTenant, miControlador)
//   luego dentro del controller: req.tenant  -> organización o null
// ────────────────────────────────────────────────────────────────

export const resolverTenant = async (req, res, next) => {
  try {
    const host = req.query.host || req.headers["x-tenant-host"] || null;

    if (!host) {
      req.tenant = null;
      return next();
    }

    const { rows } = await pool.query(
      `SELECT * FROM organizaciones 
       WHERE custom_domain = $1 
         AND dominio_estado = 'activo' 
         AND estado = 'aprobada'`,
      [host.toLowerCase().trim()],
    );

    req.tenant = rows[0] || null;
    next();
  } catch (error) {
    // Si falla la resolución del tenant no debe tumbar la request completa,
    // simplemente sigue como "sin tenant" (modo red social).
    console.error("⚠️ Error resolviendo tenant:", error.message);
    req.tenant = null;
    next();
  }
};

// ────────────────────────────────────────────────────────────────
// Middleware: exige que exista un tenant resuelto (para rutas que
// solo tienen sentido dentro del contexto de una organización).
// Debe usarse SIEMPRE después de resolverTenant en la cadena.
// ────────────────────────────────────────────────────────────────
export const requiereTenant = (req, res, next) => {
  if (!req.tenant) {
    return res.status(404).json({
      success: false,
      error: "No se pudo resolver la organización para este host.",
    });
  }
  next();
};
