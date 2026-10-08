import { redis } from "./redis.js";

// Límites diferenciados:
// - Anónimo (por IP, compartida tras un NAT): estricto, como hasta ahora.
// - Autenticado (por usuario, requiere que verificarToken corra antes):
//   generoso — un toggle dispara PATCH + lista + detalle + leads + título.
// - Espacio de nombres (namespace): cada limitador tiene sus claves
//   (punto 2), p. ej. rate_limit:view-token:ip:{ip}. Sin namespace se
//   mantiene el formato histórico rate_limit:ip:{ip}.
// Si Redis falla, se deja pasar (fail-open): el límite no puede tumbar la app.
export function createRateLimiter(maxRequests = 10, windowMs = 60000, authMaxRequests = null, getAnonKey = null, namespace = "") {
  const authMax = authMaxRequests ?? maxRequests * 10;
  const ns = namespace ? `:${namespace}` : "";
  return async (req) => {
    const userId = req.usuario?.id;
    const anonKey = getAnonKey
      ? getAnonKey(req) || "anonymous"
      : req.headers["x-api-key"] || req.ip || "anonymous";
    const key = userId ? `rate_limit${ns}:user:${userId}` : `rate_limit${ns}:ip:${anonKey}`;
    const max = userId ? authMax : maxRequests;

    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.pexpire(key, windowMs);
      }

      const ttl = await redis.pttl(key);

      return {
        isLimited: current > max,
        message: current > max ? "Demasiadas solicitudes" : null,
        retryAfter: Math.ceil(ttl / 1000),
      };
    } catch (err) {
      console.warn("⚠️ Rate-limit sin Redis, se deja pasar:", err.message);
      return { isLimited: false, message: null, retryAfter: 0 };
    }
  };
}

export function createRateLimitMiddleware(limiter) {
  return async (req, res, next) => {
    const { isLimited, message, retryAfter } = await limiter(req);

    if (isLimited) {
      return res.status(429).set("Retry-After", retryAfter).json({
        success: false,
        error: message,
      });
    }

    next();
  };
}

export const registerLimiter = createRateLimiter(20, 60000);
export const loginLimiter = createRateLimiter(20, 60000);
// Anónimos: 50/min por IP (como hasta ahora). Autenticados: 500/min por usuario.
export const defaultLimiter = createRateLimiter(50, 60000, 500);
export const verificacionCodigoLimiter = createRateLimiter(5, 10 * 60000);
