import { redis } from "./redis.js";

// Límites diferenciados:
// - Anónimo (por IP, compartida tras un NAT): estricto, como hasta ahora.
// - Autenticado (por usuario, requiere que verificarToken corra antes):
//   generoso — un toggle dispara PATCH + lista + detalle + leads + título.
// Si Redis falla, se deja pasar (fail-open): el límite no puede tumbar la app.
export function createRateLimiter(maxRequests = 10, windowMs = 60000, authMaxRequests = null) {
  const authMax = authMaxRequests ?? maxRequests * 10;
  return async (req) => {
    const userId = req.usuario?.id;
    const key = userId
      ? `rate_limit:user:${userId}`
      : `rate_limit:ip:${req.headers["x-api-key"] || req.ip || "anonymous"}`;
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
