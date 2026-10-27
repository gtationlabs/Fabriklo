import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * Outbound webhooks: https only, host must be on the staff-managed allowlist
 * (checked in the database when the rule is saved and again here, right before
 * the request), never an IP literal or an internal name, no redirects, 10 s
 * timeout. Every request carries an HMAC-SHA256 signature over
 * `${timestamp}.${body}` so the receiver can verify origin and freshness.
 */
export type WebhookTarget = { ok: true; url: URL } | { ok: false; reason: "not_https" | "ip_literal" | "internal_host" | "not_allowlisted" | "invalid" };

export function checkWebhookTarget(raw: string, allowlist: readonly string[]): WebhookTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "invalid" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) return { ok: false, reason: "ip_literal" };
  if (host === "localhost" || /\.(local|internal|localhost)$/.test(host) || !host.includes(".")) return { ok: false, reason: "internal_host" };
  if (!allowlist.some((h) => h.toLowerCase() === host)) return { ok: false, reason: "not_allowlisted" };
  return { ok: true, url };
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** For receivers (and tests): constant-time check with a 5-minute freshness window. */
export function verifyWebhookSignature(secret: string, timestamp: string, body: string, signature: string, now = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > 5 * 60_000) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && given.length > 0 && timingSafeEqual(expected, given);
}

export type WebhookOutcome = { ok: boolean; status: number | null; retryable: boolean; excerpt: string };

export async function sendWebhook(
  url: URL,
  payload: Record<string, unknown>,
  opts: { secret: string | null; eventName: string; deliveryId: string; fetchImpl?: typeof fetch },
): Promise<WebhookOutcome> {
  const body = JSON.stringify({ event: opts.eventName, delivery_id: opts.deliveryId, sent_at: new Date().toISOString(), data: payload });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Fabriklo-Webhooks/1.0",
    "X-Fabriklo-Event": opts.eventName,
    "X-Fabriklo-Delivery": opts.deliveryId,
    "X-Fabriklo-Timestamp": timestamp,
  };
  if (opts.secret) headers["X-Fabriklo-Signature"] = `v1=${signWebhook(opts.secret, timestamp, body)}`;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const excerpt = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, retryable: false, excerpt };
    return { ok: false, status: res.status, retryable: res.status >= 500 || res.status === 429 || res.status === 408, excerpt };
  } catch (e) {
    return { ok: false, status: null, retryable: true, excerpt: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}
