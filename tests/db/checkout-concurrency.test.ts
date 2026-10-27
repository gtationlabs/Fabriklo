import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, pool } from "./helpers";

/**
 * Real parallel checkouts on separate connections (committed), for the last
 * unit of a throwaway product. Everything created here is removed afterwards.
 */
let productId: string;
let variantId: string;
const orderIds: string[] = [];
const cartTokens: string[] = [];

beforeAll(async () => {
  const s = randomUUID().slice(0, 8);
  [{ id: productId }] = await admin<{ id: string }>(
    `insert into public.products (slug, title, status, published_at, is_demo) values ($1, 'Checkout race item', 'active', now(), true) returning id`,
    [`checkout-race-${s}`],
  );
  [{ id: variantId }] = await admin<{ id: string }>(
    `insert into public.product_variants (product_id, sku, size, color, price_minor) values ($1, $2, 'L', 'Olive', 120000) returning id`,
    [productId, `RACE-${s}`],
  );
  const [{ id: wh }] = await admin<{ id: string }>(`select id from public.warehouses where is_default`);
  await admin(`select private.apply_stock_movement($1, $2, 'receive', 1, 0, 'last unit', 'seed', null, $3)`, [
    variantId, wh, `race-seed-${s}`,
  ]);
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("set session_replication_role = replica");
    for (const t of ["risk_signals", "order_status_events", "order_items", "shipments"]) {
      await c.query(`delete from public.${t} where order_id = any($1::uuid[])`, [orderIds]);
    }
    await c.query(`delete from public.orders where id = any($1::uuid[])`, [orderIds]);
    const carts = `(select id from public.carts where token_hash in (select extensions.digest(t, 'sha256') from unnest($1::text[]) t))`;
    await c.query(`delete from public.cart_items where cart_id in ${carts}`, [cartTokens]);
    await c.query(`delete from public.carts where id in ${carts}`, [cartTokens]);
    await c.query(`delete from public.stock_movements where variant_id = $1`, [variantId]);
    await c.query(`delete from public.inventory_reservations where variant_id = $1`, [variantId]);
    await c.query(`delete from public.stock_balances where variant_id = $1`, [variantId]);
    await c.query(`delete from public.products where id = $1`, [productId]);
    await c.query("set session_replication_role = origin");
  } finally {
    c.release();
  }
  await pool.end();
});

describe("checkout under contention", () => {
  it("10 customers order the last unit at once: exactly one order is created", async () => {
    for (let i = 0; i < 10; i++) {
      const [{ token }] = await admin<{ token: string }>(`select public.cart_create() as token`);
      await admin(`select public.cart_set_item($1, $2, 1)`, [token, variantId]);
      cartTokens.push(token);
    }
    const results = await Promise.all(
      cartTokens.map((token, i) =>
        pool
          .query(`select public.create_order($1, $2, $3, $4, 'cod', $5, null) as r`, [
            token,
            `race-${randomUUID()}`,
            { name: `Race Buyer ${i}`, phone: `+88019${String(10000000 + i * 7919).slice(0, 8)}` },
            { district: "Dhaka", area: "Mirpur", address_line: `House ${i}, Road 1` },
            120000 + 7000,
          ])
          .then((res) => {
            orderIds.push(res.rows[0].r.order_id);
            return "ok" as const;
          })
          .catch((e: { hint?: string }) => (e.hint === "stock_unavailable" ? ("sold_out" as const) : Promise.reject(e))),
      ),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "sold_out")).toHaveLength(9);
    const [bal] = await admin<{ on_hand: number; reserved: number }>(
      `select on_hand, reserved from public.stock_balances where variant_id = $1`,
      [variantId],
    );
    expect(bal).toEqual({ on_hand: 0, reserved: 0 });
  });
});
