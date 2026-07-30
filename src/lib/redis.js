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

export async function cacheGet(key, ttlSeconds, fetchFunction) {
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  const data = await fetchFunction();
  await redis.setex(key, ttlSeconds, JSON.stringify(data));
  return data;
}

export async function cacheInvalidate(pattern) {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export { redis };
