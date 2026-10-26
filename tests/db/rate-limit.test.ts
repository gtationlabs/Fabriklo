import { describe, expect, it } from "vitest";
import { as, pool } from "./helpers";

/** Slice 9: shared rate-limit buckets (service_role-only RPC, hashed keys). */
const key = (n: number) => `${"a".repeat(60)}${n.toString(16).padStart(4, "0")}`;

describe("rate_limit_hit", () => {
  it("is callable by service_role only", async () => {
    await as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select public.rate_limit_hit($1, 3, 60)`, [key(1)])).toBe("42501");
    });
    await as({ role: "authenticated", sub: "00000000-0000-0000-0000-000000000001" }, async (sql) => {
      expect(await sql.errorCode(`select public.rate_limit_hit($1, 3, 60)`, [key(1)])).toBe("42501");
    });
    await as({ role: "service_role" }, async (sql) => {
      expect(await sql.errorCode(`select public.rate_limit_hit($1, 3, 60)`, [key(1)])).toBeNull();
    });
  });

  it("counts a fixed window, blocks past the limit and reports retry-after", async () => {
    await as({ role: "service_role" }, async (sql) => {
      const hits = [];
      for (let i = 0; i < 4; i++) hits.push((await sql.query<{ r: { ok: boolean; remaining: number; retry_after_seconds: number } }>(`select public.rate_limit_hit($1, 3, 60) as r`, [key(2)]))[0].r);
      expect(hits.map((h) => h.ok)).toEqual([true, true, true, false]);
      expect(hits.map((h) => h.remaining)).toEqual([2, 1, 0, 0]);
      expect(hits[3].retry_after_seconds).toBeGreaterThan(0);
      expect(hits[3].retry_after_seconds).toBeLessThanOrEqual(60);
      // Other keys are independent.
      expect((await sql.query<{ r: { ok: boolean } }>(`select public.rate_limit_hit($1, 3, 60) as r`, [key(3)]))[0].r.ok).toBe(true);
    });
  });

  it("resets after the window and the purge job deletes stale buckets", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`select public.rate_limit_hit($1, 1, 60)`, [key(4)]);
      const blocked = (await client.query(`select public.rate_limit_hit($1, 1, 60) as r`, [key(4)])).rows[0].r;
      expect(blocked.ok).toBe(false);
      // Age the bucket past its window (superuser, inside the rolled-back transaction).
      await client.query(`update private.rate_limit_buckets set reset_at = now() - interval '2 hours' where key = $1`, [key(4)]);
      const fresh = (await client.query(`select public.rate_limit_hit($1, 1, 60) as r`, [key(4)])).rows[0].r;
      expect(fresh.ok).toBe(true);
      await client.query(`update private.rate_limit_buckets set reset_at = now() - interval '2 hours' where key = $1`, [key(4)]);
      const purged = (await client.query(`select private.purge_rate_limit_buckets() as n`)).rows[0].n;
      expect(purged).toBeGreaterThanOrEqual(1);
      expect((await client.query(`select 1 from private.rate_limit_buckets where key = $1`, [key(4)])).rowCount).toBe(0);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it("rejects non-digest keys and silly limits", async () => {
    await as({ role: "service_role" }, async (sql) => {
      expect(await sql.errorCode(`select public.rate_limit_hit('user@example.com', 3, 60)`)).toBe("22023");
      expect(await sql.errorCode(`select public.rate_limit_hit($1, 0, 60)`, [key(5)])).toBe("22023");
      expect(await sql.errorCode(`select public.rate_limit_hit($1, 3, 999999)`, [key(5)])).toBe("22023");
    });
  });

  it("is scheduled for purging", async () => {
    const { rows } = await pool.query(`select 1 from cron.job where jobname = 'purge-rate-limit-buckets'`);
    expect(rows).toHaveLength(1);
  });
});
