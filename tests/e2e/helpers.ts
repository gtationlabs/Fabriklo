import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const secret = process.env.SUPABASE_SECRET_KEY;

/** Service client for TEST FIXTURES ONLY (local Supabase). */
export function serviceClient() {
  if (!secret) throw new Error("SUPABASE_SECRET_KEY must be set for E2E fixtures (local only)");
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("E2E fixtures only run against local Supabase");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function createTestUser(role: string | null) {
  const admin = serviceClient();
  const email = `e2e-${role ?? "customer"}-${randomUUID().slice(0, 8)}@test.fabriklo.local`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  if (role) {
    const { error: e2 } = await admin.from("staff_members").insert({ user_id: data.user.id, role_code: role, display_name: `E2E ${role}` });
    if (e2) throw e2;
  }
  return { id: data.user.id, email, password };
}

export async function deleteTestUser(id: string) {
  await serviceClient().auth.admin.deleteUser(id);
}
