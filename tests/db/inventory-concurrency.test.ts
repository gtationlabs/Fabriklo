import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, pool } from "./helpers";

/**
 * Concurrency tests run real parallel transactions on separate connections, so
 * they commit data. A dedicated throwaway product is created and removed.
 */
let productId: string;
let variantId: string;
let warehouseId: string;

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  [{ id: productId }] = await admin<{ id: string }>(
    `insert into public.products (slug, title, status, published_at, is_demo) values ($1, 'Concurrency test item', 'active', now(), true) returning id`,
    [`concurrency-${suffix}`],
  );
  [{ id: variantId }] = await admin<{ id: string }>(
    `insert into public.product_variants (product_id, sku, size, color, price_minor) values ($1, $2, 'M', 'Black', 10000) returning id`,
    [productId, `CONC-${suffix}`],
  );
  [{ id: warehouseId }] = await admin<{ id: string }>(`select id from public.warehouses where is_default`);
  await admin(
    `select private.apply_stock_movement($1, $2, 'receive', 1, 0, 'last unit', 'seed', null, $3)`,
    [variantId, warehouseId, `test-seed-${suffix}`],
  );
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("set session_replication_role = replica");
    await c.query("delete from public.stock_movements where variant_id = $1", [variantId]);
    await c.query("delete from public.inventory_reservations where variant_id = $1", [variantId]);
    await c.query("delete from public.stock_balances where variant_id = $1", [variantId]);
    await c.query("delete from public.products where id = $1", [productId]);
    await c.query("set session_replication_role = origin");
  } finally {
    c.release();
  }
  await pool.end();
});

describe("inventory reservations under contention", () => {
  it("25 simultaneous checkouts for the last unit: exactly one wins", async () => {
    const attempts = Array.from({ length: 25 }, (_, i) =>
      pool
        .query(`select (private.reserve_stock($1, 1, null, $2)).id as id`, [variantId, `race-${i}-${randomUUID()}`])
        .then(() => "ok" as const)
        .catch((e: { hint?: string }) => (e.hint === "stock_unavailable" ? ("sold_out" as const) : Promise.reject(e))),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "sold_out")).toHaveLength(24);

    const [bal] = await admin<{ on_hand: number; reserved: number }>(
      `select on_hand, reserved from public.stock_balances where variant_id = $1`,
      [variantId],
    );
    expect(bal).toEqual({ on_hand: 1, reserved: 1 });
  });

  it("replaying the same idempotency key returns the same reservation", async () => {
    await admin(`select private.apply_stock_movement($1, $2, 'receive', 2, 0, 'more', 'seed', null, $3)`, [
      variantId,
      warehouseId,
      `test-more-${randomUUID()}`,
    ]);
    const key = `idem-${randomUUID()}`;
    const [a] = await admin<{ id: string }>(`select (private.reserve_stock($1, 1, null, $2)).id as id`, [variantId, key]);
    const [b] = await admin<{ id: string }>(`select (private.reserve_stock($1, 1, null, $2)).id as id`, [variantId, key]);
    expect(a.id).toBe(b.id);
    const [bal] = await admin<{ reserved: number }>(`select reserved from public.stock_balances where variant_id = $1`, [
      variantId,
    ]);
    expect(bal.reserved).toBe(2);
  });

  it("expired reservations are released exactly once, even by parallel workers", async () => {
    await admin(`update public.inventory_reservations set expires_at = now() - interval '1 minute' where variant_id = $1`, [
      variantId,
    ]);
    const counts = await Promise.all(
      Array.from({ length: 5 }, () =>
        pool.query<{ n: number }>(`select public.release_expired_reservations(100) as n`).then((r) => r.rows[0].n),
      ),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    const [bal] = await admin<{ on_hand: number; reserved: number }>(
      `select on_hand, reserved from public.stock_balances where variant_id = $1`,
      [variantId],
    );
    expect(bal).toEqual({ on_hand: 3, reserved: 0 });
    const moves = await admin(`select * from public.stock_movements where variant_id = $1 and movement_type = 'expire'`, [
      variantId,
    ]);
    expect(moves).toHaveLength(2);
  });
});
