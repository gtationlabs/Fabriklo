import { Pool } from "pg";

const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Most admin specs exercise the strict policy (authenticator code at sign-in), so
 * the E2E run switches staff MFA ON and puts the previous value back at the end.
 * admin-no-otp.spec.ts covers the default "off" policy itself.
 */
export default async function globalSetup() {
  if (!/127\.0\.0\.1|localhost/.test(DB_URL)) throw new Error("E2E fixtures only run against local Supabase");
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  const { rows } = await pool.query<{ v: boolean }>(`select staff_mfa_required as v from private.security_settings`);
  const before = rows[0]?.v ?? false;
  await pool.query(`update private.security_settings set staff_mfa_required = true`);
  await pool.end();
  return async () => {
    const p = new Pool({ connectionString: DB_URL, max: 1 });
    await p.query(`update private.security_settings set staff_mfa_required = $1`, [before]);
    await p.end();
  };
}
