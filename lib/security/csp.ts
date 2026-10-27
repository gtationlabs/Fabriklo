/**
 * Content Security Policy, built per request with a nonce (see proxy.ts).
 * Scripts: only our origin and nonce-tagged inline bootstrap, plus
 * 'strict-dynamic' so scripts loaded by trusted scripts (Next chunks) run.
 * No 'unsafe-inline' for scripts in production. Third-party origins are added
 * ONLY when the matching integration is configured.
 */
export type CspOptions = {
  nonce: string;
  isDev: boolean;
  supabaseOrigin: string;
  ga4: boolean;
  pixel: boolean;
  turnstile: boolean;
  sentryOrigin: string | null;
};

const GA4_HOSTS = ["https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com"];
const PIXEL_HOSTS = ["https://connect.facebook.net", "https://www.facebook.com"];
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

const join = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" ");

export function buildCsp(o: CspOptions): string {
  const supabaseWs = o.supabaseOrigin ? o.supabaseOrigin.replace(/^http/, "ws") : "";
  const scriptHosts = join([o.ga4 && GA4_HOSTS[0], o.pixel && PIXEL_HOSTS[0], o.turnstile && TURNSTILE_HOST]);
  const connectHosts = join([o.supabaseOrigin, supabaseWs, ...(o.ga4 ? GA4_HOSTS : []), ...(o.pixel ? PIXEL_HOSTS : []), o.sentryOrigin, o.turnstile && TURNSTILE_HOST]);
  const imgHosts = join([o.supabaseOrigin, ...(o.ga4 ? GA4_HOSTS : []), ...(o.pixel ? PIXEL_HOSTS : [])]);
  return [
    "default-src 'self'",
    // 'strict-dynamic' makes the host allow-list irrelevant in modern browsers (nonce propagates trust);
    // the hosts stay for older ones. Dev needs eval for React Refresh.
    join([`script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic'`, o.isDev && "'unsafe-eval'", scriptHosts]),
    // Inline styles remain (Tailwind runtime, next/font, theme variables): styles cannot execute code.
    "style-src 'self' 'unsafe-inline'",
    join(["img-src 'self' data: blob:", imgHosts]),
    "font-src 'self' data:",
    join(["connect-src 'self'", connectHosts]),
    join(["frame-src", o.turnstile ? TURNSTILE_HOST : "'none'"]),
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(o.isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** 128-bit random nonce, base64 (works in the Edge runtime). */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function sentryOriginFromDsn(dsn: string | undefined | null): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}
