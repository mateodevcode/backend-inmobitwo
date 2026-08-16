import { redis } from "./redis.js";

export function createRateLimiter(maxRequests = 10, windowMs = 60000) {
  return async (req) => {
    const key = req.headers["x-api-key"] || req.ip || "anonymous";
    const limiterKey = `rate_limit:${key}`;

    const current = await redis.incr(limiterKey);

    if (current === 1) {
      await redis.pexpire(limiterKey, windowMs);
    }

    const ttl = await redis.pttl(limiterKey);

    return {
      isLimited: current > maxRequests,
      message: current > maxRequests ? "Demasiadas solicitudes" : null,
      retryAfter: Math.ceil(ttl / 1000),
    };
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
export const defaultLimiter = createRateLimiter(50, 60000);
export const verificacionCodigoLimiter = createRateLimiter(5, 10 * 60000);
