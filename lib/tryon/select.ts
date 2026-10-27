/** Pure provider choice (no env access) so it can be unit-tested. */
export type TryonEnv = { FASHN_API_KEY?: string; TRYON_ALLOW_MOCK?: string; NODE_ENV?: string };

/**
 * - a FASHN key → FASHN
 * - no key, and not production (or TRYON_ALLOW_MOCK=true) → the labelled mock
 * - otherwise → try-on is unavailable (the product page hides the feature)
 */
export function selectTryonProvider(env: TryonEnv): "fashn" | "mock" | null {
  if (env.FASHN_API_KEY) return "fashn";
  if (env.TRYON_ALLOW_MOCK === "true" || env.NODE_ENV !== "production") return "mock";
  return null;
}
