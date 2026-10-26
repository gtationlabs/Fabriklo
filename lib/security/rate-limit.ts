/**
 * Fixed-window rate limiter. In-memory, so it only protects a single server
 * instance: production must ALSO enforce edge/WAF rate limits (Cloudflare or the
 * host) — see docs/SECURITY_RUNBOOK.md. Swap `store` for Redis/Upstash when
 * running more than one instance.
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (store.size >= MAX_KEYS) {
      for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
      if (store.size >= MAX_KEYS) store.clear();
    }
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
  }
  bucket.count += 1;
  const ok = bucket.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: ok ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
  };
}

export function __resetRateLimitsForTests() {
  store.clear();
}
