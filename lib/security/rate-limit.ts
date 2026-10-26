import { createHash } from "node:crypto";

/**
 * Fixed-window rate limiting.
 *
 * `enforceRateLimit` is what the app uses. It counts in Postgres
 * (`public.rate_limit_hit`, service_role-only, see migration 0015) so the
 * limit holds across every server instance, and falls back to the in-memory
 * counter below when the database store is off (`RATE_LIMIT_STORE=memory`,
 * no `SUPABASE_SECRET_KEY`, or the RPC fails). Keys are hashed before they
 * leave the process: the table never stores an IP or an email.
 *
 * Production must ALSO enforce edge/WAF rate limits (Cloudflare or the host),
 * see docs/SECURITY_RUNBOOK.md.
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

/** In-memory limiter (single instance). Exported for tests and as the fallback. */
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

export function hashRateLimitKey(key: string): string {
  return createHash("sha256").update(`rl:${process.env.RATE_LIMIT_SALT ?? ""}:${key}`).digest("hex");
}

export function sharedStoreEnabled(): boolean {
  return process.env.RATE_LIMIT_STORE !== "memory" && Boolean(process.env.SUPABASE_SECRET_KEY);
}

type Hit = (key: string, limit: number, windowSeconds: number) => Promise<RateLimitResult | null>;

let hitImpl: Hit | null = null;
let fallbackWarnedAt = 0;

async function dbHit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult | null> {
  // Lazy import keeps this module usable from unit tests without Supabase env.
  const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
  const { data, error } = await createSupabaseServiceClient().rpc("rate_limit_hit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || !data || typeof data !== "object") return null;
  const d = data as { ok?: boolean; remaining?: number; retry_after_seconds?: number };
  if (typeof d.ok !== "boolean") return null;
  return { ok: d.ok, remaining: Number(d.remaining ?? 0), retryAfterSeconds: Number(d.retry_after_seconds ?? 0) };
}

/**
 * Shared limiter. Same signature and semantics as `rateLimit`, but async.
 * Fails over to memory (and logs once a minute) rather than failing open.
 */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (sharedStoreEnabled()) {
    try {
      const res = await (hitImpl ?? dbHit)(hashRateLimitKey(key), limit, Math.max(1, Math.ceil(windowMs / 1000)));
      if (res) return res;
    } catch {
      /* fall through to memory */
    }
    const now = Date.now();
    if (now - fallbackWarnedAt > 60_000) {
      fallbackWarnedAt = now;
      console.warn("[rate-limit] shared store unavailable; using per-instance memory limiter");
    }
  }
  return rateLimit(key, limit, windowMs);
}

export function __resetRateLimitsForTests() {
  store.clear();
}

/** Tests only: replace the database hit with a stub (null = unavailable). */
export function __setRateLimitHitForTests(impl: Hit | null) {
  hitImpl = impl;
}
