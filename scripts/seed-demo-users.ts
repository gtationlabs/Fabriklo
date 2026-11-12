/**
 * Creates (or refreshes) the demo accounts used to test the store and the admin.
 *
 *   npm run seed:demo-users                       # local Supabase (127.0.0.1)
 *   npm run seed:demo-users -- --allow-remote     # a hosted DEV project
 *   npm run seed:demo-users -- --remove           # delete the demo accounts again
 *
 * DEV / SANDBOX ONLY. Every account shares one well-known password, so never run
 * this against the production project.
 *
 * MFA stays mandatory for staff (RLS requires an aal2 session). Instead of
 * weakening that, the script enrols an authenticator (TOTP) factor for each staff
 * account itself and saves the secrets to .demo-users.local.json (git-ignored).
 * `npm run demo:otp -- admin` prints the current 6-digit code, or add the printed
 * secret to an authenticator app once.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY (read from .env.local by the npm script).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { DEFAULT_DEMO_PASSWORD, DEMO_ACCOUNTS, DEMO_CUSTOMER_PHONE, DEMO_SECRETS_FILE, type DemoAccount } from "./demo-users/accounts";
import { totp } from "./demo-users/totp";

type SavedFactor = { email: string; role: string; factorId: string; secret: string };
type SecretsFile = { url: string; createdAt: string; factors: Record<string, SavedFactor> };

const args = new Set(process.argv.slice(2));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.DEMO_USERS_PASSWORD || DEFAULT_DEMO_PASSWORD;
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function guard() {
  if (!url || !publishable || !secretKey) {
    fail(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must be set in .env.local.\n" +
        "  The secret key is in Supabase Dashboard → Project Settings → API Keys → Secret keys.",
    );
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    fail("Refusing to create demo accounts in a production environment.");
  }
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
  if (!isLocal && !args.has("--allow-remote") && process.env.DEMO_USERS_ALLOW_REMOTE !== "1") {
    fail(
      `${url} is a hosted Supabase project.\n` +
        "  Demo accounts share a public password. If this is your DEV project, re-run with:\n" +
        "    npm run seed:demo-users -- --allow-remote\n" +
        "  Never do this on the production project.",
    );
  }
}

function serviceClient() {
  return createClient(url!, secretKey!, { auth: { persistSession: false, autoRefreshToken: false } });
}

function userClient() {
  return createClient(url!, publishable!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findUser(admin: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

function loadSecrets(): SecretsFile {
  if (existsSync(DEMO_SECRETS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(DEMO_SECRETS_FILE, "utf8")) as SecretsFile;
      if (parsed.url === url) return parsed;
    } catch {
      /* rewrite below */
    }
  }
  return { url: url!, createdAt: new Date().toISOString(), factors: {} };
}

async function roleExists(admin: SupabaseClient, code: string) {
  const { data, error } = await admin.from("staff_roles").select("code").eq("code", code).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function upsertUser(admin: SupabaseClient, acc: DemoAccount): Promise<User> {
  const existing = await findUser(admin, acc.email);
  const attrs = {
    password,
    email_confirm: true,
    ban_duration: "none",
    user_metadata: { full_name: acc.name, demo_account: true },
  };
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, attrs);
    if (error || !data.user) throw error ?? new Error(`update ${acc.email} failed`);
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({ email: acc.email, ...attrs });
  if (error || !data.user) throw error ?? new Error(`create ${acc.email} failed`);
  return data.user;
}

/**
 * Makes sure the staff account has exactly one verified TOTP factor whose secret
 * we know. Reuses the saved one when it still exists; otherwise resets and enrols.
 */
async function ensureTotp(admin: SupabaseClient, user: User, acc: DemoAccount, role: string, saved: SecretsFile) {
  const { data: listed, error: listErr } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (listErr) throw listErr;
  const factors = listed?.factors ?? [];
  const known = saved.factors[acc.key];
  if (known && factors.some((f) => f.id === known.factorId && f.status === "verified")) {
    saved.factors[acc.key] = { ...known, role, email: acc.email };
    return;
  }
  for (const f of factors) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id });
    if (error) throw error;
  }

  const client = userClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email: acc.email, password });
  if (signInErr) throw new Error(`sign-in as ${acc.email} failed: ${signInErr.message}`);
  const { data: enrolled, error: enrollErr } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Fabriklo demo authenticator",
  });
  if (enrollErr || !enrolled) {
    throw new Error(
      `MFA enrol for ${acc.email} failed: ${enrollErr?.message ?? "unknown"}. ` +
        "Check that TOTP is enabled in Supabase Dashboard → Authentication → Multi-Factor.",
    );
  }
  const secret = enrolled.totp.secret;
  const { error: verifyErr } = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: totp(secret) });
  if (verifyErr) throw new Error(`MFA verify for ${acc.email} failed: ${verifyErr.message} (is this computer's clock correct?)`);
  await client.auth.signOut({ scope: "local" });
  saved.factors[acc.key] = { email: acc.email, role, factorId: enrolled.id, secret };
}

async function seed() {
  guard();
  const admin = serviceClient();
  const saved = loadSecrets();
  const rows: { account: string; email: string; role: string; login: string; mfa: string }[] = [];

  for (const acc of DEMO_ACCOUNTS) {
    const user = await upsertUser(admin, acc);

    const profile: Record<string, unknown> = { full_name: acc.name };
    if (!acc.role) profile.phone = DEMO_CUSTOMER_PHONE;
    const { error: profErr } = await admin.from("profiles").upsert({ id: user.id, ...profile }, { onConflict: "id" });
    if (profErr) throw profErr;

    if (!acc.role) {
      // A customer must not keep a staff row from an earlier run.
      await admin.from("staff_members").delete().eq("user_id", user.id);
      const { count } = await admin.from("addresses").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      if (!count) {
        const { error } = await admin.from("addresses").insert({
          user_id: user.id,
          label: "Home",
          recipient_name: acc.name,
          phone: DEMO_CUSTOMER_PHONE,
          division: "Dhaka",
          district: "Dhaka",
          area: "Gulshan",
          address_line: "House 1, Road 1, Gulshan 1 (demo address)",
          postal_code: "1212",
          is_default: true,
        });
        if (error) throw error;
      }
      rows.push({ account: acc.key, email: acc.email, role: "customer", login: acc.loginPath, mfa: "none" });
      continue;
    }

    let role = acc.role;
    if (!(await roleExists(admin, role))) {
      if (!acc.fallbackRole) throw new Error(`Role ${role} is missing from staff_roles. Apply the migrations first.`);
      console.warn(
        `⚠ Role "${role}" is not in this database yet (run \`npx supabase db push\` to apply the new migration). ` +
          `Using "${acc.fallbackRole}" for ${acc.email} for now; re-run this script afterwards.`,
      );
      role = acc.fallbackRole;
    }
    const { error: staffErr } = await admin
      .from("staff_members")
      .upsert({ user_id: user.id, role_code: role, status: "active", display_name: acc.name }, { onConflict: "user_id" });
    if (staffErr) throw staffErr;

    await ensureTotp(admin, user, acc, role, saved);
    rows.push({ account: acc.key, email: acc.email, role, login: acc.loginPath, mfa: "TOTP (npm run demo:otp)" });
  }

  writeFileSync(DEMO_SECRETS_FILE, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });

  console.log(`\nDemo accounts ready on ${url}  (DEV / SANDBOX ONLY)\n`);
  console.table(rows.map((r) => ({ ...r, login: `${siteUrl}${r.login}` })));
  console.log(`Password for every account: ${password}\n`);
  console.log("Staff sign-in asks for a 6-digit code. Get the current one with:");
  console.log("  npm run demo:otp -- admin      (or owner | manager | staff | all)\n");
  console.log("Or add a secret to your authenticator app once (Google Authenticator → Enter a setup key):");
  for (const [key, f] of Object.entries(saved.factors)) console.log(`  ${key.padEnd(8)} ${f.secret}`);
  console.log(`\nSecrets saved to ${DEMO_SECRETS_FILE} (git-ignored). Remove everything with: npm run seed:demo-users -- --remove\n`);
}

async function remove() {
  guard();
  const admin = serviceClient();
  // Delete the super admin last: the database refuses to remove the last active one.
  const ordered = [...DEMO_ACCOUNTS].sort((a, b) => Number(a.role === "super_admin") - Number(b.role === "super_admin"));
  for (const acc of ordered) {
    const user = await findUser(admin, acc.email);
    if (!user) {
      console.log(`- ${acc.email}: not found`);
      continue;
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.warn(
        `- ${acc.email}: NOT deleted (${error.message}). If it is the only super admin, create a real owner first ` +
          "(npm run staff:create -- you@example.com super_admin) and run --remove again.",
      );
    } else {
      console.log(`- ${acc.email}: deleted`);
    }
  }
  if (existsSync(DEMO_SECRETS_FILE)) rmSync(DEMO_SECRETS_FILE);
  console.log("\nDone.\n");
}

(args.has("--remove") ? remove() : seed()).catch((e) => {
  fail(e instanceof Error ? e.message : JSON.stringify(e));
});
