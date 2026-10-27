import { publicEnv } from "@/lib/env";

/** Best-effort client IP. Only trust X-Forwarded-For when behind a known proxy. */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * CSRF defence for cookie-authenticated JSON endpoints: require a same-origin
 * request (Origin header, falling back to Sec-Fetch-Site). Cookies are also
 * SameSite=Lax.
 */
export function isSameOrigin(headers: Headers, requestUrl: string): boolean {
  const origin = headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(requestUrl).origin, new URL(publicEnv.NEXT_PUBLIC_SITE_URL).origin]);
    return allowed.has(origin);
  }
  const site = headers.get("sec-fetch-site");
  return site === "same-origin";
}
