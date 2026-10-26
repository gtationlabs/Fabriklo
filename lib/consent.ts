/**
 * Cookie consent, stored in the browser only (no identity involved):
 * `fbk_consent={"v":1,"analytics":bool,"marketing":bool}`. Essential cookies
 * (cart, session, CSRF) never need consent. Analytics tags and attribution
 * capture run only with `analytics`; the ad pixel only with `marketing`.
 */
export const CONSENT_COOKIE = "fbk_consent";
export type Consent = { v: 1; analytics: boolean; marketing: boolean };

export function parseConsent(raw: string | undefined | null): Consent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<Consent>;
    if (parsed.v !== 1) return null;
    return { v: 1, analytics: parsed.analytics === true, marketing: parsed.marketing === true };
  } catch {
    return null;
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return m ? m.slice(name.length + 1) : null;
}
