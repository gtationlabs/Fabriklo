import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, deleteUsers, pool, switchActor, type Sql } from "./helpers";

/**
 * Checkout + order lifecycle. Each test runs in a rolled-back transaction; the
 * throwaway product below is committed in beforeAll and removed afterwards.
 */
let productId: string;
let variantId: string;
let draftVariantId: string;
let orderManager: string;
let supportAgent: string;
const STOCK = 5;
const PRICE = 250000; // ৳2,500.00

beforeAll(async () => {
  const s = randomUUID().slice(0, 8);
  [{ id: productId }] = await admin<{ id: string }>(
    `insert into public.products (slug, title, status, published_at, is_demo) values ($1, 'Order test shirt', 'active', now(), true) returning id`,
    [`order-test-${s}`],
  );
  [{ id: variantId }] = await admin<{ id: string }>(
    `insert into public.product_variants (product_id, sku, size, color, price_minor) values ($1, $2, 'M', 'Navy', $3) returning id`,
    [productId, `ORD-${s}`, PRICE],
  );
  const [{ id: draftId }] = await admin<{ id: string }>(
    `insert into public.products (slug, title, status, is_demo) values ($1, 'Draft test', 'draft', true) returning id`,
    [`order-draft-${s}`],
  );
  [{ id: draftVariantId }] = await admin<{ id: string }>(
    `insert into public.product_variants (product_id, sku, size, color, price_minor) values ($1, $2, 'M', 'Navy', 1000) returning id`,
    [draftId, `ORDD-${s}`],
  );
  const [{ id: wh }] = await admin<{ id: string }>(`select id from public.warehouses where is_default`);
  for (const v of [variantId, draftVariantId]) {
    await admin(`select private.apply_stock_movement($1, $2, 'receive', $3, 0, 'test stock', 'seed', null, $4)`, [
      v, wh, STOCK, `order-test-seed-${v}`,
    ]);
  }
  orderManager = await createStaff("order_manager");
  supportAgent = await createStaff("support_agent");
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("set session_replication_role = replica");
    const products = `(select id from public.products where slug like 'order-test-%' or slug like 'order-draft-%')`;
    const variants = `(select id from public.product_variants where product_id in ${products})`;
    await c.query(`delete from public.stock_movements where variant_id in ${variants}`);
    await c.query(`delete from public.inventory_reservations where variant_id in ${variants}`);
    await c.query(`delete from public.stock_balances where variant_id in ${variants}`);
    await c.query(`delete from public.products where id in ${products}`);
    await c.query("set session_replication_role = origin");
  } finally {
    c.release();
  }
  await deleteUsers([orderManager, supportAgent]);
  await pool.end();
});

const staff = (sub: string) => ({ role: "authenticated" as const, sub, aal: "aal2" as const });
const uniquePhone = () => `+88017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function cartWith(sql: Sql, variant: string, qty: number) {
  const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
  await sql.query(`select public.cart_set_item($1, $2, $3)`, [token, variant, qty]);
  return token;
}

async function quote(sql: Sql, token: string, district = "Dhaka") {
  const [{ q }] = await sql.query<{ q: Record<string, unknown> }>(`select public.checkout_quote($1, $2) as q`, [token, district]);
  return q;
}

type OrderResult = { order_id: string; order_number: string; tracking_token: string; total_minor: number; replayed: boolean };

async function placeOrder(
  sql: Sql,
  token: string,
  opts: { phone?: string; district?: string; key?: string; expected?: number; method?: string } = {},
) {
  const district = opts.district ?? "Dhaka";
  const expected = opts.expected ?? Number((await quote(sql, token, district)).total_minor);
  const [{ r }] = await sql.query<{ r: OrderResult }>(
    `select public.create_order($1, $2, $3, $4, $5, $6, null) as r`,
    [
      token,
      opts.key ?? `test-${randomUUID()}`,
      { name: "Rahim Uddin", phone: opts.phone ?? uniquePhone(), email: "rahim@example.com" },
      { district, area: "Dhanmondi", address_line: "House 12, Road 5" },
      opts.method ?? "cod",
      expected,
    ],
  );
  return r;
}

async function hintOf(sql: Sql, fn: () => Promise<unknown>) {
  await sql.query("savepoint h");
  try {
    await fn();
    await sql.query("release savepoint h");
    return null;
  } catch (e) {
    await sql.query("rollback to savepoint h");
    const err = e as { hint?: string; code?: string };
    return err.hint ?? err.code ?? "unknown";
  }
}

async function balance(sql: Sql) {
  // Read as the superuser inside the same transaction, then restore the actor.
  const [{ role }] = await sql.query<{ role: string }>(`select current_user as role`);
  await sql.query("reset role");
  const [b] = await sql.query<{ on_hand: number; reserved: number }>(
    `select sum(on_hand)::int as on_hand, sum(reserved)::int as reserved from public.stock_balances where variant_id = $1`,
    [variantId],
  );
  await sql.query(`set local role ${role}`);
  return b;
}

describe("checkout quote", () => {
  it("prices the cart on the server with the zone fee", () =>
    as({ role: "anon" }, async (sql) => {
      const token = await cartWith(sql, variantId, 1);
      const q = await quote(sql, token, "Dhaka");
      expect(q.subtotal_minor).toBe(PRICE);
      expect(q.shipping_minor).toBe(7000);
      expect(q.total_minor).toBe(PRICE + 7000);
      expect(q.cod_available).toBe(true);
      const outside = await quote(sql, token, "Sylhet");
      expect(outside.shipping_minor).toBe(13000);
    }));

  it("applies the free-delivery threshold", () =>
    as({ role: "anon" }, async (sql) => {
      const token = await cartWith(sql, variantId, 2); // ৳5,000 >= ৳5,000 threshold inside Dhaka
      expect((await quote(sql, token, "Dhaka")).shipping_minor).toBe(0);
    }));
});

describe("create_order", () => {
  it("places a COD order, commits stock and snapshots the lines", () =>
    as({ role: "anon" }, async (sql) => {
      const before = await balance(sql);
      const token = await cartWith(sql, variantId, 2);
      const r = await placeOrder(sql, token);
      expect(r.order_number).toMatch(/^FBK-\d{6,}$/);
      expect(r.tracking_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(r.replayed).toBe(false);

      const after = await balance(sql);
      expect(after.on_hand).toBe(before.on_hand - 2);
      expect(after.reserved).toBe(before.reserved);

      await switchActor(sql, { role: "service_role" });
      const [o] = await sql.query(`select * from public.orders where id = $1`, [r.order_id]);
      expect(o).toMatchObject({ payment_method: "cod", payment_status: "cod_pending", fulfillment_status: "unfulfilled" });
      expect(Number(o.total_minor)).toBe(2 * PRICE);
      const items = await sql.query(`select * from public.order_items where order_id = $1`, [r.order_id]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ quantity: 2, product_title: "Order test shirt", size: "M", color: "Navy" });
      const [cart] = await sql.query(`select status from public.carts c where c.id = $1`, [o.cart_id]);
      expect(cart.status).toBe("converted");
    }));

  it("is idempotent: the same key returns the same order without taking stock twice", () =>
    as({ role: "anon" }, async (sql) => {
      const token = await cartWith(sql, variantId, 1);
      const key = `idem-${randomUUID()}`;
      const first = await placeOrder(sql, token, { key });
      const mid = await balance(sql);
      const second = await placeOrder(sql, token, { key, expected: first.total_minor });
      expect(second).toMatchObject({ order_id: first.order_id, tracking_token: first.tracking_token, replayed: true });
      expect(await balance(sql)).toEqual(mid);
    }));

  it("rejects a stale total so the customer can review the new price", () =>
    as({ role: "anon" }, async (sql) => {
      const token = await cartWith(sql, variantId, 1);
      expect(await hintOf(sql, () => placeOrder(sql, token, { expected: 1 }))).toBe("quote_changed");
    }));

  it("rejects quantities beyond stock, draft products and non-COD methods", () =>
    as({ role: "anon" }, async (sql) => {
      const big = await cartWith(sql, variantId, 1);
      await sql.query(`reset role`);
      await sql.query(`update public.cart_items set quantity = $1 where variant_id = $2`, [STOCK + 1, variantId]);
      await sql.query(`set local role anon`);
      expect(await hintOf(sql, () => placeOrder(sql, big, { expected: 0 }))).toBe("stock_unavailable");

      await sql.query(`reset role`);
      const [{ token: draftCart }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
      await sql.query(
        `insert into public.cart_items (cart_id, variant_id, quantity) select (private.cart_by_token($1)).id, $2, 1`,
        [draftCart, draftVariantId],
      );
      await sql.query(`set local role anon`);
      expect(await hintOf(sql, () => placeOrder(sql, draftCart, { expected: 0 }))).toBe("stock_unavailable");

      const ok = await cartWith(sql, variantId, 1);
      expect(await hintOf(sql, () => placeOrder(sql, ok, { method: "bkash" }))).toBe("payment_unavailable");
    }));

  it("validates phone and district on the server", () =>
    as({ role: "anon" }, async (sql) => {
      const token = await cartWith(sql, variantId, 1);
      expect(await hintOf(sql, () => placeOrder(sql, token, { phone: "01712345678" }))).toBe("invalid_phone");
      expect(await hintOf(sql, () => placeOrder(sql, token, { district: "Atlantis", expected: 1 }))).toBe("invalid_district");
    }));

  it("refuses COD above the configured limit", () =>
    as({ role: "anon" }, async (sql) => {
      await sql.query(`reset role`);
      await sql.query(`update public.site_settings set value = jsonb_set(value, '{max_order_minor}', '100000') where key = 'checkout.cod'`);
      await sql.query(`set local role anon`);
      const token = await cartWith(sql, variantId, 1);
      const q = await quote(sql, token);
      expect(q.cod_available).toBe(false);
      expect(await hintOf(sql, () => placeOrder(sql, token))).toBe("cod_unavailable");
    }));

  it("cannot be written directly by customers", () =>
    as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`insert into public.orders (customer_name) values ('x')`)).toBe("42501");
      expect(await sql.errorCode(`select * from public.orders`)).toBe("42501");
    }));
});

describe("customer tracking", () => {
  it("needs the order number and the matching token, and shows minimised data", () =>
    as({ role: "anon" }, async (sql) => {
      const token = await cartWith(sql, variantId, 1);
      const r = await placeOrder(sql, token, { phone: "+8801712345678" });
      const [{ t }] = await sql.query<{ t: Record<string, unknown> }>(`select public.track_order($1, $2) as t`, [
        r.order_number, r.tracking_token,
      ]);
      expect(t.recipient).toBe("Rahim");
      expect(t.phone_masked).toBe("+88017*****678");
      expect(JSON.stringify(t)).not.toContain("House 12");
      expect(JSON.stringify(t)).not.toContain("rahim@example.com");

      const wrong = r.tracking_token.slice(0, -1) + (r.tracking_token.endsWith("A") ? "B" : "A");
      const [{ t: none }] = await sql.query(`select public.track_order($1, $2) as t`, [r.order_number, wrong]);
      expect(none).toBeNull();
      const [{ t: none2 }] = await sql.query(`select public.track_order($1, $2) as t`, ["FBK-000001", r.tracking_token]);
      expect(none2).toBeNull();
    }));
});

describe("order state machine", () => {
  it("walks a COD order from placed to cash collected", () =>
    as({ role: "anon" }, async (sql) => {
      const r = await placeOrder(sql, await cartWith(sql, variantId, 1));
      await switchActor(sql, staff(orderManager));
      const step = (field: string, to: string, reason: string | null = null) =>
        sql.query(`select public.admin_order_transition($1, $2, $3, $4)`, [r.order_id, field, to, reason]);

      expect(await hintOf(sql, () => step("payment_status", "cod_collected"))).toBe("not_delivered");
      expect(await hintOf(sql, () => step("shipment_status", "ready_for_pickup"))).toBe("not_packed");
      expect(await hintOf(sql, () => step("fulfillment_status", "packed"))).toBe("invalid_transition");
      await step("fulfillment_status", "confirmed");
      await step("fulfillment_status", "picking");
      await step("fulfillment_status", "packed");
      await sql.query(`select public.admin_set_shipment($1, 'manual', 'Test Courier', 'TRK123', 'https://courier.example/t/TRK123')`, [r.order_id]);
      await step("shipment_status", "ready_for_pickup");
      await step("shipment_status", "handed_to_courier");
      await step("shipment_status", "in_transit");
      await step("shipment_status", "out_for_delivery");
      await step("shipment_status", "delivered");
      await step("payment_status", "cod_collected");

      const [o] = await sql.query(`select * from public.orders where id = $1`, [r.order_id]);
      expect(o).toMatchObject({ fulfillment_status: "fulfilled", shipment_status: "delivered", payment_status: "cod_collected" });
      expect(await hintOf(sql, () => step("fulfillment_status", "cancelled", "late"))).toBe("invalid_transition");
      expect(await hintOf(sql, () => step("payment_status", "paid"))).toBe("invalid_transition");

      const events = await sql.query(`select field, to_value from public.order_status_events where order_id = $1 order by id`, [r.order_id]);
      expect(events.map((e) => e.to_value)).toContain("cod_collected");
      expect(await sql.errorCode(`update public.order_status_events set reason = 'x' where order_id = $1`, [r.order_id])).not.toBeNull();
    }));

  it("restocks exactly once when an order is cancelled", () =>
    as({ role: "anon" }, async (sql) => {
      const before = await balance(sql);
      const r = await placeOrder(sql, await cartWith(sql, variantId, 2));
      await switchActor(sql, staff(orderManager));
      expect(
        await hintOf(sql, () => sql.query(`select public.admin_order_transition($1, 'fulfillment_status', 'cancelled', null)`, [r.order_id])),
      ).toBe("reason_required");
      await sql.query(`select public.admin_order_transition($1, 'fulfillment_status', 'cancelled', 'Customer asked to cancel')`, [r.order_id]);
      await sql.query(`select public.admin_order_transition($1, 'fulfillment_status', 'cancelled', 'again')`, [r.order_id]);
      expect(await balance(sql)).toEqual(before);
      const [o] = await sql.query(`select payment_status from public.orders where id = $1`, [r.order_id]);
      expect(o.payment_status).toBe("voided");
    }));

  it("enforces permissions and MFA", () =>
    as({ role: "anon" }, async (sql) => {
      const r = await placeOrder(sql, await cartWith(sql, variantId, 1));
      const call = `select public.admin_order_transition($1, 'fulfillment_status', 'confirmed', null)`;
      await switchActor(sql, { role: "anon" });
      expect(await sql.errorCode(call, [r.order_id])).toBe("42501");
      await switchActor(sql, staff(supportAgent));
      expect(await sql.errorCode(call, [r.order_id])).toBe("42501");
      await switchActor(sql, { role: "authenticated", sub: orderManager, aal: "aal1" });
      expect(await sql.errorCode(call, [r.order_id])).toBe("42501");
      await switchActor(sql, staff(supportAgent));
      const rows = await sql.query(`select id from public.orders where id = $1`, [r.order_id]);
      expect(rows).toHaveLength(1);
      expect(await sql.errorCode(`select * from public.risk_signals`)).toBeNull();
      expect(await sql.query(`select * from public.risk_signals`)).toHaveLength(0);
    }));
});

describe("risk review", () => {
  it("flags the third order from one phone in a day and holds fulfilment until reviewed", () =>
    as({ role: "anon" }, async (sql) => {
      const phone = uniquePhone();
      await placeOrder(sql, await cartWith(sql, variantId, 1), { phone });
      await placeOrder(sql, await cartWith(sql, variantId, 1), { phone }); // duplicate total → flagged too
      const third = await placeOrder(sql, await cartWith(sql, variantId, 2), { phone });

      await switchActor(sql, staff(orderManager));
      const [o] = await sql.query(`select risk_level, risk_review_status from public.orders where id = $1`, [third.order_id]);
      expect(o).toMatchObject({ risk_level: "medium", risk_review_status: "needs_review" });
      const signals = await sql.query(`select rule_code from public.risk_signals where order_id = $1`, [third.order_id]);
      expect(signals.map((s) => s.rule_code)).toContain("phone_velocity");

      const confirm = () =>
        sql.query(`select public.admin_order_transition($1, 'fulfillment_status', 'confirmed', null)`, [third.order_id]);
      expect(await hintOf(sql, confirm)).toBe("risk_review_pending");
      await sql.query(`select public.admin_order_transition($1, 'risk_review_status', 'approved', 'Called customer, confirmed')`, [third.order_id]);
      expect(await hintOf(sql, confirm)).toBeNull();
    }));

  it("rejecting a flagged order cancels it and restocks", () =>
    as({ role: "anon" }, async (sql) => {
      const before = await balance(sql);
      const r = await placeOrder(sql, await cartWith(sql, variantId, 1));
      await switchActor(sql, staff(orderManager));
      await sql.query(`select public.admin_flag_order($1, 'Address looks incomplete')`, [r.order_id]);
      await sql.query(`select public.admin_order_transition($1, 'risk_review_status', 'rejected_with_reason', 'Could not reach customer')`, [r.order_id]);
      const [o] = await sql.query(`select fulfillment_status, payment_status from public.orders where id = $1`, [r.order_id]);
      expect(o).toMatchObject({ fulfillment_status: "cancelled", payment_status: "voided" });
      expect(await balance(sql)).toEqual(before);
    }));
});
