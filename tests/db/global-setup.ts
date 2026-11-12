import { Pool } from "pg";

/**
 * The DB suite was written for the strict policy (staff need an aal2 session), so
 * it runs with staff MFA switched ON and restores the previous value afterwards.
 * Tests for the "MFA off" policy opt in per transaction with `as({ ..., staffMfa: false })`.
 */
export default async function setup() {
  const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (/supabase\.co|pooler\.supabase/.test(url)) throw new Error("Refusing to run DB tests against a hosted Supabase project.");
  const pool = new Pool({ connectionString: url, max: 1 });
  const { rows } = await pool.query<{ v: boolean }>(`select staff_mfa_required as v from private.security_settings`);
  const before = rows[0]?.v ?? false;
  await pool.query(`update private.security_settings set staff_mfa_required = true`);
  await pool.end();
  return async () => {
    const p = new Pool({ connectionString: url, max: 1 });
    await p.query(`update private.security_settings set staff_mfa_required = $1`, [before]);
    await p.end();
  };
}
