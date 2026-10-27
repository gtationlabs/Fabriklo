/** Pure provider choice (no env access) so it can be unit-tested. */
export type ProviderEnv = {
  SSLCOMMERZ_STORE_ID?: string;
  SSLCOMMERZ_STORE_PASSWORD?: string;
  SSLCOMMERZ_SANDBOX?: string;
  PAYMENTS_ALLOW_MOCK?: string;
  NODE_ENV?: string;
};

/**
 * Which provider to use, decided from the environment only:
 * - real SSLCOMMERZ credentials → SSLCOMMERZ (sandbox unless SSLCOMMERZ_SANDBOX=false)
 * - no credentials, and not production (or PAYMENTS_ALLOW_MOCK=true) → the labelled mock
 * - otherwise → online payment is unavailable (checkout shows COD only)
 */
export function selectProvider(env: ProviderEnv): "sslcommerz" | "mock" | null {
  if (env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD) return "sslcommerz";
  if (env.PAYMENTS_ALLOW_MOCK === "true" || env.NODE_ENV !== "production") return "mock";
  return null;
}
