/**
 * Creates (or updates) a staff account in a LOCAL/DEV Supabase project.
 *
 *   npx tsx scripts/create-staff.ts owner@example.com super_admin
 *
 * Prompts are avoided on purpose: the password is generated and printed once.
 * Requires SUPABASE_SECRET_KEY (server-only) — never expose it to the browser.
 * Refuses to run against a hosted project unless ALLOW_REMOTE_STAFF_BOOTSTRAP=1.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ROLES = ["super_admin", "admin", "catalog_manager", "inventory_manager", "order_manager", "support_agent", "marketing_manager", "content_editor", "analyst"];

async function main() {
  const [email, role = "super_admin"] = process.argv.slice(2);
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || !ROLES.includes(role)) {
    console.error(`Usage: tsx scripts/create-staff.ts <email> <${ROLES.join("|")}>`);
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  if (!isLocal && process.env.ALLOW_REMOTE_STAFF_BOOTSTRAP !== "1") {
    throw new Error("Refusing to bootstrap staff on a non-local project without ALLOW_REMOTE_STAFF_BOOTSTRAP=1");
  }

  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = process.env.STAFF_PASSWORD ?? `${randomBytes(12).toString("base64url")}9a`;

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("createUser failed");
    user = data.user;
  } else if (process.env.STAFF_PASSWORD) {
    await admin.auth.admin.updateUserById(user.id, { password });
  }

  const { error } = await admin
    .from("staff_members")
    .upsert({ user_id: user.id, role_code: role, status: "active", display_name: email.split("@")[0] }, { onConflict: "user_id" });
  if (error) throw error;

  console.log(`Staff ready: ${email} (${role})`);
  if (!process.env.STAFF_PASSWORD) console.log(`Generated password (shown once): ${password}`);
  console.log("Sign in at /admin/login; you'll be asked to enrol an authenticator app (TOTP).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
