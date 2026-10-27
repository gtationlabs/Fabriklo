/** First-touch attribution kept in a first-party cookie (only with analytics consent). */
export const ATTRIBUTION_COOKIE_NAME = "fbk_utm";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export function attributionFromLocation(loc: { search: string; pathname: string }, referrer: string): Record<string, string> | null {
  const params = new URLSearchParams(loc.search);
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k)?.trim();
    if (v) out[k] = v.slice(0, 150);
  }
  let referrerHost = "";
  try {
    referrerHost = referrer ? new URL(referrer).hostname : "";
  } catch {
    referrerHost = "";
  }
  if (!Object.keys(out).length && !referrerHost) return null;
  out.landing_path = loc.pathname.slice(0, 300);
  if (referrerHost) out.referrer_host = referrerHost.slice(0, 200);
  out.first_seen_at = new Date().toISOString();
  return out;
}

/** Writes the cookie once (first touch wins) and only when there is something to attribute. */
export function captureAttribution(loc: { search: string; pathname: string }, referrer: string, existing: string | null) {
  if (existing) return;
  const data = attributionFromLocation(loc, referrer);
  if (!data) return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(data))}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax${secure}`;
}
