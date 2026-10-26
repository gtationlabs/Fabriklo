import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Trusted server client (service role). Bypasses RLS, so it is used ONLY for
 * the few RPCs that are granted to `service_role` on purpose: recording and
 * settling payments after server-side validation, and applying verified
 * courier webhooks. Never import this from a client component or pass its
 * results to the browser unfiltered. Throws when the key is not configured.
 */
export function createSupabaseServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured (server-only; required for payment and courier webhooks)");
  if (key.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY must be a secret (service) key, not a publishable key");
  }
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
