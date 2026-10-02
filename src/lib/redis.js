import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

redis.on("connect", () => {
  console.log("Redis conectado");
});

redis.on("error", (err) => {
  console.error("Error de Redis:", err);
});

// Un fallo de caché (Redis caído/lento) jamás debe tumbar una petición:
// el UPDATE/SELECT ya ocurrió en BD. Se registra y se sigue sin caché.
export async function cacheGet(key, ttlSeconds, fetchFunction) {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    const data = await fetchFunction();
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(data));
    } catch (err) {
      console.warn("⚠️ Redis setex falló, se sirve sin caché:", err.message);
    }
    return data;
  } catch (err) {
    console.warn("⚠️ Redis get falló, consulta directa a BD:", err.message);
    return fetchFunction();
  }
}

export async function cacheInvalidate(pattern) {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    // La BD ya quedó actualizada; solo se avisa (el caché expirará por TTL).
    console.warn("⚠️ Redis invalidate falló (expirará por TTL):", err.message);
  }
}

export { redis };
