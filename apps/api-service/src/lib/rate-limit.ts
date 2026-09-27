/**
 * Minimal Redis-backed fixed-window rate limiter for the extra per-resource limits
 * (e.g. "5/min/account" for login) that don't fit `@fastify/rate-limit`'s per-route,
 * per-IP model. Fails open when Redis is unavailable (matches the rest of the app's
 * degrade-gracefully-without-Redis behavior).
 */
export async function checkRateLimit(
  redis: any,
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  if (!redis) return true;
  try {
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, windowSeconds);
    return current <= max;
  } catch {
    return true;
  }
}
