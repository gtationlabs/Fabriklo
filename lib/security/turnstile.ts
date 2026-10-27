import "server-only";

/**
 * Cloudflare Turnstile verification (bot challenge on sign-in, sign-up,
 * checkout and newsletter). Active only when BOTH keys are configured:
 * otherwise the check is skipped and the UI renders no widget, so local QA
 * and CI run without Cloudflare. Never report "protected" when it is off:
 * `turnstileEnabled()` drives the admin status page and the docs.
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_FIELD = "cf-turnstile-response";

export function turnstileEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}

export type TurnstileResult = { ok: true; skipped: boolean } | { ok: false; reason: string };

export async function verifyTurnstile(
  token: unknown,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!turnstileEnabled()) return { ok: true, skipped: true };
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return { ok: false, reason: "missing-token" };
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `siteverify-${res.status}` };
    const json = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (json.success === true) return { ok: true, skipped: false };
    return { ok: false, reason: json["error-codes"]?.join(",") || "failed" };
  } catch {
    // Verification outage: fail closed on the high-value forms (callers decide
    // the message); the rate limiter is still in front of everything.
    return { ok: false, reason: "unreachable" };
  }
}

/** Shared message so every form tells the same story. */
export const TURNSTILE_FAILED_MESSAGE = "We couldn't confirm you're human. Please try again.";
