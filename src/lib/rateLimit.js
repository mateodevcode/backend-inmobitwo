// lib/rateLimit.js
const rateLimitMap = new Map();

export function createRateLimiter(maxRequests = 10, windowMs = 60000) {
  return (req) => {
    const identifier = req.headers["x-api-key"] || req.ip || "anonymous";
    const now = Date.now();
    const key = `${identifier}-${Math.floor(now / windowMs)}`;

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, 0);
    }

    const count = rateLimitMap.get(key);

    if (count >= maxRequests) {
      return {
        isLimited: true,
        message: `Límite de ${maxRequests} solicitudes por minuto excedido`,
        retryAfter: Math.ceil((windowMs - (now % windowMs)) / 1000),
      };
    }

    rateLimitMap.set(key, count + 1);

    if (Math.random() < 0.01) {
      const cutoff = now - windowMs * 2;
      for (const [mapKey] of rateLimitMap) {
        if (parseInt(mapKey.split("-")[1]) * windowMs < cutoff) {
          rateLimitMap.delete(mapKey);
        }
      }
    }

    return { isLimited: false };
  };
}

export function createRateLimitMiddleware(limiter) {
  return (req, res, next) => {
    const result = limiter(req);

    if (result.isLimited) {
      return res.status(429).set("Retry-After", result.retryAfter).json({
        success: false,
        error: result.message,
      });
    }

    next();
  };
}

export const registerLimiter = createRateLimiter(10, 60000);
export const loginLimiter = createRateLimiter(10, 60000);
export const defaultLimiter = createRateLimiter(50, 60000);
export const verificacionCodigoLimiter = createRateLimiter(5, 10 * 60000); // 5 intentos cada 10 min
