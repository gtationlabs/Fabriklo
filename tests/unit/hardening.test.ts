import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_SITE_URL: "https://shop.example", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" } }));

import { buildCsp, makeNonce, sentryOriginFromDsn } from "@/lib/security/csp";
import { __resetRateLimitsForTests, __setRateLimitHitForTests, enforceRateLimit, hashRateLimitKey, sharedStoreEnabled } from "@/lib/security/rate-limit";
import { verifyTurnstile, turnstileEnabled } from "@/lib/security/turnstile";
import { scrubEvent, scrubString } from "@/lib/monitoring/sentry-options";

const base = { nonce: "abc123", isDev: false, supabaseOrigin: "https://x.supabase.co", ga4: false, pixel: false, turnstile: false, sentryOrigin: null };

describe("content security policy", () => {
  it("uses a nonce and strict-dynamic, never unsafe-inline for scripts", () => {
    const csp = buildCsp(base);
    const script = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).toContain("connect-src 'self' https://x.supabase.co wss://x.supabase.co");
  });
  it("allows eval only in development", () => {
    expect(buildCsp({ ...base, isDev: true })).toContain("'unsafe-eval'");
    expect(buildCsp({ ...base, isDev: true })).not.toContain("upgrade-insecure-requests");
  });
  it("adds third-party origins only for configured integrations", () => {
    expect(buildCsp(base)).not.toContain("googletagmanager");
    expect(buildCsp(base)).not.toContain("cloudflare");
    const all = buildCsp({ ...base, ga4: true, pixel: true, turnstile: true, sentryOrigin: "https://o1.ingest.sentry.io" });
    expect(all).toContain("https://www.googletagmanager.com");
    expect(all).toContain("https://connect.facebook.net");
    expect(all).toContain("frame-src https://challenges.cloudflare.com");
    expect(all).toContain("https://o1.ingest.sentry.io");
  });
  it("mints distinct base64 nonces", () => {
    const a = makeNonce();
    const b = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
  it("derives the Sentry origin from a DSN", () => {
    expect(sentryOriginFromDsn("https://abc@o1.ingest.sentry.io/123")).toBe("https://o1.ingest.sentry.io");
    expect(sentryOriginFromDsn("nope")).toBeNull();
    expect(sentryOriginFromDsn(undefined)).toBeNull();
  });
});

describe("turnstile", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it("is skipped (and reports so) when not configured", async () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileEnabled()).toBe(false);
    const fetchSpy = vi.fn();
    await expect(verifyTurnstile(undefined, "1.2.3.4", fetchSpy as unknown as typeof fetch)).resolves.toEqual({ ok: true, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("requires both keys", () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileEnabled()).toBe(false);
  });
  describe("when configured", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
      process.env.TURNSTILE_SECRET_KEY = "secret";
    });
    it("rejects a missing token without calling Cloudflare", async () => {
      const fetchSpy = vi.fn();
      await expect(verifyTurnstile(undefined, "1.2.3.4", fetchSpy as unknown as typeof fetch)).resolves.toEqual({ ok: false, reason: "missing-token" });
      await expect(verifyTurnstile("short", "1.2.3.4", fetchSpy as unknown as typeof fetch)).resolves.toEqual({ ok: false, reason: "missing-token" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
    it("posts secret, token and ip to siteverify and trusts only success:true", async () => {
      const calls: { url: string; body: URLSearchParams }[] = [];
      const fetchOk = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: init.body as URLSearchParams });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });
      await expect(verifyTurnstile("0.token-token-token", "1.2.3.4", fetchOk as unknown as typeof fetch)).resolves.toEqual({ ok: true, skipped: false });
      expect(calls[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(calls[0].body.get("secret")).toBe("secret");
      expect(calls[0].body.get("response")).toBe("0.token-token-token");
      expect(calls[0].body.get("remoteip")).toBe("1.2.3.4");

      const fetchFail = vi.fn(async () => new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }), { status: 200 }));
      await expect(verifyTurnstile("0.token-token-token", null, fetchFail as unknown as typeof fetch)).resolves.toEqual({ ok: false, reason: "timeout-or-duplicate" });
    });
    it("fails closed when siteverify is unreachable", async () => {
      const fetchDown = vi.fn(async () => {
        throw new Error("ECONNRESET");
      });
      await expect(verifyTurnstile("0.token-token-token", null, fetchDown as unknown as typeof fetch)).resolves.toEqual({ ok: false, reason: "unreachable" });
    });
  });
});

describe("shared rate limiter", () => {
  const env = { ...process.env };
  beforeEach(() => {
    __resetRateLimitsForTests();
    __setRateLimitHitForTests(null);
  });
  afterEach(() => {
    process.env = { ...env };
    __setRateLimitHitForTests(null);
  });
  it("hashes keys so the store never sees raw ips or emails", () => {
    const h = hashRateLimitKey("login-email:someone@example.com");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain("example");
    expect(hashRateLimitKey("a")).not.toBe(hashRateLimitKey("b"));
  });
  it("uses memory when the shared store is off", async () => {
    process.env.RATE_LIMIT_STORE = "memory";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_x";
    expect(sharedStoreEnabled()).toBe(false);
    const hit = vi.fn();
    __setRateLimitHitForTests(hit);
    for (let i = 0; i < 2; i++) expect((await enforceRateLimit("k", 2, 60_000)).ok).toBe(true);
    expect((await enforceRateLimit("k", 2, 60_000)).ok).toBe(false);
    expect(hit).not.toHaveBeenCalled();
  });
  it("counts in the shared store when configured, passing a hashed key and seconds", async () => {
    delete process.env.RATE_LIMIT_STORE;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_x";
    expect(sharedStoreEnabled()).toBe(true);
    const hit = vi.fn(async (key: string, limit: number, windowSeconds: number) => ({ ok: false, remaining: 0, retryAfterSeconds: 42, key, limit, windowSeconds }));
    __setRateLimitHitForTests(hit);
    const res = await enforceRateLimit("order:1.2.3.4", 8, 10 * 60_000);
    expect(res.ok).toBe(false);
    expect(res.retryAfterSeconds).toBe(42);
    expect(hit).toHaveBeenCalledWith(hashRateLimitKey("order:1.2.3.4"), 8, 600);
  });
  it("falls back to memory when the shared store fails, instead of failing open", async () => {
    delete process.env.RATE_LIMIT_STORE;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_x";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    __setRateLimitHitForTests(async () => {
      throw new Error("db down");
    });
    expect((await enforceRateLimit("k", 1, 60_000)).ok).toBe(true);
    expect((await enforceRateLimit("k", 1, 60_000)).ok).toBe(false);
    __setRateLimitHitForTests(async () => null);
    expect((await enforceRateLimit("k", 1, 60_000)).ok).toBe(false);
    warn.mockRestore();
  });
});

describe("sentry scrubbing", () => {
  it("redacts emails and tokens in strings", () => {
    expect(scrubString("user jane@example.com failed with sb_secret_abcDEF123")).toBe("user [email] failed with [redacted]");
    expect(scrubString("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmnop")).toBe("jwt [redacted]");
  });
  it("drops bodies, cookies and sensitive headers; keeps only the user id", () => {
    const event = scrubEvent({
      message: "login for jane@example.com",
      request: {
        url: "https://shop.example/admin/welcome?token_hash=abc&x=1",
        data: { password: "hunter2" },
        cookies: { "sb-access-token": "x" },
        headers: { Authorization: "Bearer eyJ...", "User-Agent": "ua", cookie: "a=b" },
      },
      user: { id: "u1", email: "jane@example.com", ip_address: "1.2.3.4" },
      extra: { email: "jane@example.com", note: "contact jane@example.com", nested: { token: "t", ok: 1 } },
      exception: { values: [{ value: "duplicate key jane@example.com" }] },
    });
    expect(event.message).toBe("login for [email]");
    expect(event.request).toEqual({ url: "https://shop.example/admin/welcome?token_hash=[redacted]&x=1", headers: { Authorization: "[redacted]", "User-Agent": "ua", cookie: "[redacted]" } });
    expect(event.user).toEqual({ id: "u1" });
    expect(event.extra).toEqual({ email: "[redacted]", note: "contact [email]", nested: { token: "[redacted]", ok: 1 } });
    expect(event.exception.values[0].value).toBe("duplicate key [email]");
  });
});
