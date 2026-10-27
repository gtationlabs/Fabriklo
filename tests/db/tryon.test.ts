import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, createUser, deleteUsers, pool, switchActor, type Sql } from "./helpers";

/**
 * Try-on at the database level: consent, quotas, ownership, worker RPCs,
 * expiry and staff visibility. Storage objects are simulated by inserting
 * rows into storage.objects (as the local Storage service would).
 */
let customerA: string;
let customerB: string;
let manager: string;
let variantId: string;
let noGarmentVariant: string;

beforeAll(async () => {
  customerA = await createUser("tryon-a");
  customerB = await createUser("tryon-b");
  manager = await createStaff("super_admin");
  [{ id: variantId }] = await admin<{ id: string }>(
    `select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'essential-crew-tee' and v.is_active limit 1`,
  );
  [{ id: noGarmentVariant }] = await admin<{ id: string }>(
    `select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.status = 'active' and not p.tryon_enabled and v.is_active limit 1`,
  );
});

afterAll(async () => {
  await deleteUsers([customerA, customerB, manager]);
  await pool.end();
});

const customer = (sub: string) => ({ role: "authenticated" as const, sub, aal: "aal1" as const });

/** Pretend the customer uploaded a photo (what the Storage API writes). */
async function fakeUpload(sql: Sql, uid: string, name = `${randomUUID()}.jpg`) {
  const [{ role }] = await sql.query<{ role: string }>(`select current_user as role`);
  await sql.query("reset role");
  await sql.query(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('tryon-inputs', $1, $2, '{"mimetype":"image/jpeg"}')`, [`${uid}/${name}`, uid]);
  await sql.query(`set local role ${role}`);
  return `${uid}/${name}`;
}

const CONSENT = "2026-10-26";

describe("creating try-on jobs", () => {
  it("requires sign-in, consent, an owned photo and a supported product", () =>
    as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select public.tryon_create_job($1, 'x/y.jpg', $2, null)`, [variantId, CONSENT])).toBe("42501");
      await switchActor(sql, customer(customerA));
      const mine = await fakeUpload(sql, customerA);
      const theirs = await fakeUpload(sql, customerB);
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, 'old-version', null)`, [variantId, mine])).toBe("22023");
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, $3, null)`, [variantId, theirs, CONSENT])).toBe("22023");
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, $3, null)`, [variantId, `${customerA}/missing.jpg`, CONSENT])).toBe("P0002");
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, $3, null)`, [noGarmentVariant, mine, CONSENT])).toBe("P0001");
      const [{ r }] = await sql.query<{ r: { job_id: string; status: string } }>(`select public.tryon_create_job($1, $2, $3, $4) as r`, [variantId, mine, CONSENT, "a".repeat(64)]);
      expect(r.status).toBe("queued");
      const consents = await sql.query(`select consent_version from public.tryon_consent_events where job_id = $1`, [r.job_id]);
      expect(consents).toEqual([{ consent_version: CONSENT }]);
      // Only one in flight per customer.
      const again = await fakeUpload(sql, customerA);
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, $3, null)`, [variantId, again, CONSENT])).toBe("P0001");
      // Customers cannot update job rows or read other customers' jobs.
      expect(await sql.errorCode(`update public.tryon_jobs set status = 'completed' where id = $1`, [r.job_id])).toBe("42501");
      await switchActor(sql, customer(customerB));
      expect(await sql.query(`select id from public.tryon_jobs`)).toHaveLength(0);
      expect(await sql.query(`select id from public.tryon_consent_events`)).toHaveLength(0);
      const [{ cancelled }] = await sql.query<{ cancelled: boolean }>(`select public.tryon_cancel_job($1) as cancelled`, [r.job_id]);
      expect(cancelled).toBe(false);
    }));

  it("enforces the per-customer daily quota, the site switch and the credit cap", () =>
    as(customer(customerA), async (sql) => {
      await sql.query("reset role");
      await sql.query(`update public.site_settings set value = value || '{"per_user_daily": 2}' where key = 'tryon.limits'`);
      await sql.query("set local role authenticated");
      for (let i = 0; i < 2; i++) {
        const p = await fakeUpload(sql, customerA);
        const [{ r }] = await sql.query<{ r: { job_id: string } }>(`select public.tryon_create_job($1, $2, $3, null) as r`, [variantId, p, CONSENT]);
        // Finish it so the next one may start.
        await sql.query("reset role");
        await sql.query(`update public.tryon_jobs set status = 'failed' where id = $1`, [r.job_id]);
        await sql.query("set local role authenticated");
      }
      const third = await fakeUpload(sql, customerA);
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, $3, null)`, [variantId, third, CONSENT])).toBe("P0001");

      await sql.query("reset role");
      await sql.query(`update public.site_settings set value = value || '{"per_user_daily": 50, "daily_credit_cap": 1}' where key = 'tryon.limits'`);
      await sql.query(`insert into public.tryon_usage_ledger (user_id, job_id, provider, credits) values ($1, gen_random_uuid(), 'fashn', 1)`, [customerB]);
      await sql.query("set local role authenticated");
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, $3, null)`, [variantId, third, CONSENT])).toBe("P0001");

      await sql.query("reset role");
      await sql.query(`update public.site_settings set value = value || '{"daily_credit_cap": 300, "enabled": false}' where key = 'tryon.limits'`);
      await sql.query("set local role authenticated");
      expect(await sql.errorCode(`select public.tryon_create_job($1, $2, $3, null)`, [variantId, third, CONSENT])).toBe("P0001");
      const [{ c }] = await sql.query<{ c: { enabled: boolean } }>(`select public.tryon_public_config() as c`);
      expect(c.enabled).toBe(false);
    }));
});

describe("worker lifecycle", () => {
  it("claims once, logs provider events once, completes into the owner's folder and charges the ledger", () =>
    as(customer(customerA), async (sql) => {
      const p = await fakeUpload(sql, customerA);
      const [{ r }] = await sql.query<{ r: { job_id: string } }>(`select public.tryon_create_job($1, $2, $3, null) as r`, [variantId, p, CONSENT]);
      // Only the worker can claim.
      expect(await sql.errorCode(`select public.tryon_claim_jobs(5, 'mock')`)).toBe("42501");
      await switchActor(sql, { role: "service_role" });
      const claimed = await sql.query<{ tryon_claim_jobs: { job_id: string; input_path: string; garment_path: string; attempts: number; provider: string } }>(`select public.tryon_claim_jobs(5, 'mock')`);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.tryon_claim_jobs).toMatchObject({ job_id: r.job_id, input_path: p, garment_path: "/assets/demo/garment-tee.png", attempts: 1, provider: "mock" });
      expect(await sql.query(`select public.tryon_claim_jobs(5, 'mock')`)).toHaveLength(0);

      const [{ first }] = await sql.query<{ first: boolean }>(`select public.tryon_job_event($1, 'submitted', 'submit:1', 'mock-1', 'submitted', '{}', 0) as first`, [r.job_id]);
      const [{ dup }] = await sql.query<{ dup: boolean }>(`select public.tryon_job_event($1, 'submitted', 'submit:1', 'mock-1', 'submitted', '{}', 0) as dup`, [r.job_id]);
      expect(first).toBe(true);
      expect(dup).toBe(false);
      expect(await sql.errorCode(`select public.tryon_complete_job($1, $2, 1)`, [r.job_id, `${customerB}/evil.jpg`])).toBe("22023");
      const [{ done }] = await sql.query<{ done: { changed: boolean; status: string } }>(`select public.tryon_complete_job($1, $2, 1) as done`, [r.job_id, `${customerA}/${r.job_id}.jpg`]);
      expect(done).toEqual({ changed: true, status: "completed" });
      expect((await sql.query<{ done: { changed: boolean } }>(`select public.tryon_complete_job($1, $2, 1) as done`, [r.job_id, `${customerA}/${r.job_id}.jpg`]))[0]!.done.changed).toBe(false);
      const [{ credits }] = await sql.query<{ credits: number }>(`select sum(credits)::int as credits from public.tryon_usage_ledger where job_id = $1`, [r.job_id]);
      expect(credits).toBe(1);
      // The ledger and provider events are append-only.
      expect(await sql.errorCode(`delete from public.tryon_usage_ledger where job_id = $1`, [r.job_id])).toBe("42501");
      expect(await sql.errorCode(`update public.tryon_provider_events set payload = '{"x":1}' where job_id = $1`, [r.job_id])).toBe("42501");

      // The owner sees it completed; the result path is in their own folder.
      await switchActor(sql, customer(customerA));
      const [job] = await sql.query<{ status: string; output_path: string; provider: string }>(`select status, output_path, provider from public.tryon_jobs where id = $1`, [r.job_id]);
      expect(job).toEqual({ status: "completed", output_path: `${customerA}/${r.job_id}.jpg`, provider: "mock" });
    }));

  it("retries retryable failures up to the limit, then fails for good", () =>
    as(customer(customerA), async (sql) => {
      const p = await fakeUpload(sql, customerA);
      const [{ r }] = await sql.query<{ r: { job_id: string } }>(`select public.tryon_create_job($1, $2, $3, null) as r`, [variantId, p, CONSENT]);
      await switchActor(sql, { role: "service_role" });
      await sql.query(`select public.tryon_claim_jobs(1, 'fashn')`);
      const [{ a }] = await sql.query<{ a: { status: string } }>(`select public.tryon_fail_job($1, 'RateLimitExceeded', 'busy', true) as a`, [r.job_id]);
      expect(a.status).toBe("queued");
      await sql.query(`select public.tryon_claim_jobs(1, 'fashn')`);
      const [{ b }] = await sql.query<{ b: { status: string } }>(`select public.tryon_fail_job($1, 'RateLimitExceeded', 'busy', true) as b`, [r.job_id]);
      expect(b.status).toBe("failed");
      const [{ c }] = await sql.query<{ c: { status: string } }>(`select public.tryon_fail_job($1, 'PoseError', 'no pose', false) as c`, [r.job_id]);
      expect(c.status).toBe("failed");
      const events = await sql.query<{ kind: string }>(`select kind from public.tryon_provider_events where job_id = $1 order by id`, [r.job_id]);
      expect(events.map((e) => e.kind)).toEqual(["retry", "failed", "failed"]);
      // Non-retryable failures are final on the first attempt.
      await switchActor(sql, customer(customerA));
      const p2 = await fakeUpload(sql, customerA);
      const [{ r2 }] = await sql.query<{ r2: { job_id: string } }>(`select public.tryon_create_job($1, $2, $3, null) as r2`, [variantId, p2, CONSENT]);
      await switchActor(sql, { role: "service_role" });
      await sql.query(`select public.tryon_claim_jobs(1, 'fashn')`);
      expect((await sql.query<{ d: { status: string } }>(`select public.tryon_fail_job($1, 'PoseError', 'no pose', false) as d`, [r2.job_id]))[0]!.d.status).toBe("failed");
    }));

  it("expired jobs are listed for purge, marked by the cron fallback, and purged with a trace", () =>
    as(customer(customerA), async (sql) => {
      const p = await fakeUpload(sql, customerA);
      const [{ r }] = await sql.query<{ r: { job_id: string } }>(`select public.tryon_create_job($1, $2, $3, null) as r`, [variantId, p, CONSENT]);
      await sql.query("reset role");
      await sql.query(`update public.tryon_jobs set expires_at = now() - interval '1 minute' where id = $1`, [r.job_id]);
      await sql.query(`select private.tryon_mark_expired()`);
      await sql.query("set local role service_role");
      const expired = await sql.query<{ id: string; input_path: string; status: string }>(`select id, input_path, status from public.tryon_expired_jobs(10)`);
      expect(expired).toEqual([{ id: r.job_id, input_path: p, status: "expired" }]);
      const [{ purged }] = await sql.query<{ purged: boolean }>(`select public.tryon_purge_job($1, 'expired') as purged`, [r.job_id]);
      expect(purged).toBe(true);
      expect(await sql.query(`select id from public.tryon_jobs where id = $1`, [r.job_id])).toHaveLength(0);
      const trace = await sql.query<{ kind: string; payload: { had_output: boolean } }>(`select kind, payload from public.tryon_provider_events where job_id = $1`, [r.job_id]);
      expect(trace).toEqual([{ kind: "expired", payload: { had_output: false } }]);
    }));
});

describe("staff view", () => {
  it("managers get counts and can change limits; nobody gets photo paths; customers cannot", () =>
    as(customer(customerA), async (sql) => {
      const p = await fakeUpload(sql, customerA);
      await sql.query(`select public.tryon_create_job($1, $2, $3, null)`, [variantId, p, CONSENT]);
      expect(await sql.errorCode(`select public.tryon_admin_stats()`)).toBe("42501");
      expect(await sql.errorCode(`select public.admin_update_tryon_limits('{"per_user_daily": 99}')`)).toBe("42501");
      await switchActor(sql, { role: "authenticated", sub: manager, aal: "aal1" });
      expect(await sql.errorCode(`select public.tryon_admin_stats()`)).toBe("42501"); // MFA required
      await switchActor(sql, { role: "authenticated", sub: manager, aal: "aal2" });
      const [{ s }] = await sql.query<{ s: Record<string, unknown> }>(`select public.tryon_admin_stats() as s`);
      expect(s.queued).toBe(1);
      expect(JSON.stringify(s)).not.toContain(customerA);
      expect(JSON.stringify(s)).not.toContain(".jpg");
      expect(await sql.query(`select id from public.tryon_jobs`)).toHaveLength(0); // staff have no row access
      const [{ l }] = await sql.query<{ l: { per_user_daily: number; consent_version: string } }>(`select public.admin_update_tryon_limits('{"per_user_daily": 9, "consent_version": "hack"}') as l`);
      expect(l.per_user_daily).toBe(9);
      expect(l.consent_version).toBe(CONSENT);
      expect(await sql.errorCode(`select public.admin_update_tryon_limits('{"retention_hours": 999}')`)).toBe("22023");
    }));

  it("catalogue editors attach a garment reference, which enables try-on for the product", () =>
    as({ role: "authenticated", sub: manager, aal: "aal2" }, async (sql) => {
      const [{ id: productId }] = await sql.query<{ id: string }>(`select p.id from public.products p join public.product_variants v on v.product_id = p.id where v.id = $1`, [noGarmentVariant]);
      await sql.query("reset role");
      await sql.query(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('product-media', $1, $2, '{"mimetype":"image/jpeg"}')`, [`products/${productId}/garment-x.jpg`, manager]);
      await sql.query("set local role authenticated");
      expect(await sql.errorCode(`select public.admin_set_tryon_garment($1, 'products/nope.jpg', 'Garment', 800, 1000)`, [productId])).toBe("P0002");
      const [{ m }] = await sql.query<{ m: string }>(`select public.admin_set_tryon_garment($1, $2, 'Garment flat-lay', 800, 1000) as m`, [productId, `products/${productId}/garment-x.jpg`]);
      expect(m).toMatch(/^[0-9a-f-]{36}$/);
      const [prod] = await sql.query<{ tryon_enabled: boolean }>(`select tryon_enabled from public.products where id = $1`, [productId]);
      expect(prod.tryon_enabled).toBe(true);
    }));
});
