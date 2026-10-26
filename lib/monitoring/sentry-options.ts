/**
 * Shared Sentry options. Error reporting is ON only when a DSN is configured
 * (SENTRY_DSN on the server, NEXT_PUBLIC_SENTRY_DSN in the browser); otherwise
 * nothing is initialised and nothing leaves the process.
 *
 * Privacy: no default PII, no request bodies, no cookies, no IPs; the
 * `beforeSend` scrubber drops auth headers, tokens and emails from whatever
 * remains. Try-on photos never reach Sentry (they are never in error context).
 */
type Primitive = string | number | boolean | null | undefined;
type Json = Primitive | Json[] | { [k: string]: Json };

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|x-api-key|apikey|password|token|secret|otp|code|email|phone|session|refresh_token|access_token|cf-turnstile-response)$/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TOKEN_RE = /\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;

export function scrubString(s: string): string {
  return s.replace(TOKEN_RE, "[redacted]").replace(EMAIL_RE, "[email]");
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value as Json;
}

/** `beforeSend` / `beforeSendTransaction`: scrub, and drop the request body entirely. */
export function scrubEvent<T extends object>(event: T): T {
  const e = event as unknown as Record<string, unknown>;
  const req = e.request as Record<string, unknown> | undefined;
  if (req) {
    delete req.data;
    delete req.cookies;
    if (req.headers) req.headers = scrubValue(req.headers);
    if (typeof req.url === "string") req.url = scrubString(req.url.replace(/([?&](?:token|token_hash|code|otp|t)=)[^&]+/gi, "$1[redacted]"));
  }
  if (e.user) e.user = { id: (e.user as { id?: string }).id };
  if (e.extra) e.extra = scrubValue(e.extra);
  if (e.contexts) e.contexts = scrubValue(e.contexts);
  if (e.breadcrumbs) e.breadcrumbs = scrubValue(e.breadcrumbs);
  if (typeof e.message === "string") e.message = scrubString(e.message);
  const ex = e.exception as { values?: { value?: string }[] } | undefined;
  for (const v of ex?.values ?? []) if (typeof v.value === "string") v.value = scrubString(v.value);
  return event;
}

export function baseOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND", /ResizeObserver loop/, /AbortError/],
  };
}
