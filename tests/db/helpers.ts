import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

/**
 * Database-level authorization harness. Runs SQL exactly as PostgREST would:
 * `SET LOCAL ROLE anon|authenticated` plus `request.jwt.claims`, inside a
 * transaction that is always rolled back.
 *
 * Point SUPABASE_DB_URL at a LOCAL Supabase database only (never production).
 */
export const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (/supabase\.co|pooler\.supabase/.test(DB_URL)) {
  throw new Error("Refusing to run destructive DB tests against a hosted Supabase project.");
}

export const pool = new Pool({ connectionString: DB_URL, max: 30 });

export type Actor =
  | { role: "anon" }
  | { role: "authenticated"; sub: string; aal?: "aal1" | "aal2" }
  | { role: "service_role" };

export type Sql = {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<R[]>;
  /** Runs a statement and returns the Postgres error code (or null on success). */
  errorCode: (text: string, params?: unknown[]) => Promise<string | null>;
};

function claimsFor(actor: Actor) {
  if (actor.role === "authenticated") {
    return {
      sub: actor.sub,
      role: "authenticated",
      aal: actor.aal ?? "aal1",
      aud: "authenticated",
    };
  }
  return { role: actor.role };
}

export async function as<T>(actor: Actor, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claimsFor(actor)),
    ]);
    await client.query(`set local role ${actor.role}`);
    let sp = 0;
    const sql: Sql = {
      query: async (text, params) => (await client.query(text, params)).rows,
      errorCode: async (text, params) => {
        const name = `sp_${++sp}`;
        await client.query(`savepoint ${name}`);
        try {
          await client.query(text, params);
          await client.query(`release savepoint ${name}`);
          return null;
        } catch (e) {
          await client.query(`rollback to savepoint ${name}`);
          return (e as { code?: string }).code ?? "unknown";
        }
      },
    };
    return await fn(sql);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Superuser access for fixtures (bypasses RLS). */
export async function admin<R extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<R[]> {
  return (await pool.query(text, params)).rows as R[];
}

export async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await admin(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{}', $3, now(), now())`,
    [id, `${label}-${id.slice(0, 8)}@test.fabriklo.local`, JSON.stringify({ full_name: label })],
  );
  return id;
}

export async function createStaff(role: string, status = "active"): Promise<string> {
  const id = await createUser(`staff-${role}`);
  await admin(`insert into public.staff_members (user_id, role_code, status, display_name) values ($1, $2, $3, $4)`, [
    id,
    role,
    status,
    `Test ${role}`,
  ]);
  return id;
}

/**
 * Fixture cleanup. Runs with triggers off so that removing a test super admin
 * never trips the "last active super admin" guard (which is tested on purpose
 * in admin-settings.test.ts, and which otherwise fails cleanup on a fresh CI
 * database where the fixture is the only super admin).
 */
export async function deleteUsers(ids: string[]) {
  if (!ids.length) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(`delete from public.staff_members where user_id = any($1::uuid[])`, [ids]);
    // Triggers back on so the auth.users delete cascades (profiles, addresses, …) as in production.
    await client.query("set local session_replication_role = origin");
    await client.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function oneVariant(where: string): Promise<{ id: string; product_id: string }> {
  const rows = await admin<{ id: string; product_id: string }>(
    `select v.id, v.product_id from public.product_variants v join public.products p on p.id = v.product_id where ${where} limit 1`,
  );
  if (!rows[0]) throw new Error(`no variant for ${where}`);
  return rows[0];
}

/** Switches the acting role mid-transaction (e.g. customer checks out, then staff fulfils). */
export async function switchActor(sql: Sql, actor: Actor) {
  await sql.query("reset role");
  await sql.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claimsFor(actor))]);
  await sql.query(`set local role ${actor.role}`);
}
