import { buildRateLimitKey } from "./rateLimitKey.js";
import { getRedisClient } from "./redisClient.js";

const redisScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;


export const createRateLimit = ({ windowMs = 60_000, max = 120, message = "Too many requests", keyGenerator } = {}) => {
  const buckets = new Map();
  const namespace = String(message).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48) || "requests";

  return async (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    let identity = ip;
    if (typeof keyGenerator === "function") {
      try { identity = String(keyGenerator(req) || "unknown"); }
      catch { identity = "invalid-identity"; }
    }
    const { digest: bucketKey, key: redisKey } = buildRateLimitKey(namespace, identity);
    let count;
    let resetAt;

    const incrementLocalBucket = () => {
      let bucket = buckets.get(bucketKey);
      if (!bucket || now >= bucket.resetAt) bucket = { count: 0, resetAt: now + windowMs };
      bucket.count += 1;
      buckets.set(bucketKey, bucket);
      if (buckets.size > 10_000) {
        for (const [key, value] of buckets) {
          if (now >= value.resetAt) buckets.delete(key);
        }

        while (buckets.size > 25_000) buckets.delete(buckets.keys().next().value);
      }
      return { count: bucket.count, resetAt: bucket.resetAt };
    };

    if (process.env.REDIS_URL) {
      try {
        const client = await getRedisClient();
        const [redisCount, redisTtl] = await client.eval(redisScript, {
          keys: [redisKey],
          arguments: [String(windowMs)],
        });
        count = Number(redisCount);
        resetAt = now + Math.max(0, Number(redisTtl));
      } catch {
        if (process.env.NODE_ENV === "production") {
          console.error("Shared rate limiter unavailable");
          return res.status(503).json({ statusCode: 503, data: null, message: "Request protection is temporarily unavailable", success: false, errors: [] });
        }

        ({ count, resetAt } = incrementLocalBucket());
      }
    } else if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ statusCode: 503, data: null, message: "Shared rate limiting is not configured", success: false, errors: [] });
    } else {
      ({ count, resetAt } = incrementLocalBucket());
    }

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
    if (count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
      return res.status(429).json({ statusCode: 429, data: null, message, success: false, errors: [] });
    }
    return next();
  };
};
