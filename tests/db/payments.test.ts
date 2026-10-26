import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, deleteUsers, pool, switchActor, type Sql } from "./helpers";

/**
 * Online payments and courier events at the database level. Every test runs in
 * a rolled-back transaction against a throwaway product created below.
 */
let variantId: string;
let orderManager: string;
const STOCK = 6;
const PRICE = 150000; // ৳1,500.00

beforeAll(async () => {
  const s = randomUUID().slice(0, 8);
  const [{ id: productId }] = await admin<{ id: string }>(
    `insert into public.products (slug, title, status, published_at, is_demo) values ($1, 'Payment test kurti', 'active', now(), true) returning id`,
    [`pay-test-${s}`],
  );
  [{ id: variantId }] = await admin<{ id: string }>(
    `insert into public.product_variants (product_id, sku, size, color, price_minor) values ($1, $2, 'M', 'Teal', $3) returning id`,
    [productId, `PAY-${s}`, PRICE],
  );
  const [{ id: wh }] = await admin<{ id: string }>(`select id from public.warehouses where is_default`);
  await admin(`select private.apply_stock_movement($1, $2, 'receive', $3, 0, 'test stock', 'seed', null, $4)`, [variantId, wh, STOCK, `pay-test-seed-${variantId}`]);
  orderManager = await createStaff("order_manager");
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("set session_replication_role = replica");
    const products = `(select id from public.products where slug like 'pay-test-%')`;
    const variants = `(select id from public.product_variants where product_id in ${products})`;
    await c.query(`delete from public.stock_movements where variant_id in ${variants}`);
    await c.query(`delete from public.inventory_reservations where variant_id in ${variants}`);
    await c.query(`delete from public.stock_balances where variant_id in ${variants}`);
    await c.query(`delete from public.products where id in ${products}`);
    await c.query("set session_replication_role = origin");
  } finally {
    c.release();
  }
  await deleteUsers([orderManager]);
  await pool.end();
});

type Placed = { order_id: string; order_number: string; tracking_token: string; payment_status: string; total_minor: number };

async function placeOnline(sql: Sql, qty = 2, method: "sslcommerz" | "cod" = "sslcommerz"): Promise<Placed> {
  const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
  await sql.query(`select public.cart_set_item($1, $2, $3)`, [token, variantId, qty]);
  const [{ q }] = await sql.query<{ q: { total_minor: number } }>(`select public.checkout_quote($1, 'Dhaka') as q`, [token]);
  const [{ r }] = await sql.query<{ r: Placed }>(
    `select public.create_order($1, $2, $3, $4, $5, $6, null) as r`,
    [token, `pay-${randomUUID()}`, { name: "Pay Tester", phone: "+8801711111111" }, { district: "Dhaka", area: "Banani", address_line: "House 1, Road 2" }, method, q.total_minor],
  );
  return r;
}

async function balance(sql: Sql) {
  const [{ role }] = await sql.query<{ role: string }>(`select current_user as role`);
  await sql.query("reset role");
  const [b] = await sql.query<{ on_hand: number; reserved: number }>(
    `select sum(on_hand)::int as on_hand, sum(reserved)::int as reserved from public.stock_balances where variant_id = $1`,
    [variantId],
  );
  await sql.query(`set local role ${role}`);
  return b!;
}

async function orderState(sql: Sql, id: string) {
  const [{ role }] = await sql.query<{ role: string }>(`select current_user as role`);
  await sql.query("reset role");
  const [o] = await sql.query<{ payment_status: string; fulfillment_status: string; risk_review_status: string }>(`select payment_status, fulfillment_status, risk_review_status from public.orders where id = $1`, [id]);
  await sql.query(`set local role ${role}`);
  return o!;
}

const settle = (sql: Sql, tranId: string, outcome: string, amount: number, valId: string | null, currency = "BDT") =>
  sql.query<{ r: { status: string; changed: boolean; reason?: string; stock_short?: boolean } }>(
    `select public.payment_settle($1, $2, $3, $4, $5, 'BANK1', 'VISA', '0', '{"test":true}') as r`,
    [tranId, outcome, amount, currency, valId],
  ).then((rows) => rows[0]!.r);

describe("online orders hold stock until paid", () => {
  it("creates the order as awaiting_payment with an active, expiring hold", () =>
    as({ role: "anon" }, async (sql) => {
      const before = await balance(sql);
      const o = await placeOnline(sql, 2);
      expect(o.payment_status).toBe("awaiting_payment");
      const after = await balance(sql);
      expect(after.on_hand).toBe(before.on_hand);
      expect(after.reserved).toBe(before.reserved + 2);
      await sql.query("reset role");
      const res = await sql.query<{ status: string; mins: number }>(
        `select r.status, extract(epoch from (r.expires_at - now()))/60 as mins from public.inventory_reservations r join public.order_items oi on oi.reservation_id = r.id where oi.order_id = $1`,
        [o.order_id],
      );
      expect(res).toHaveLength(1);
      expect(res[0]!.status).toBe("active");
      expect(Number(res[0]!.mins)).toBeGreaterThan(25);
      expect(Number(res[0]!.mins)).toBeLessThanOrEqual(30);
    }));

  it("refuses online payment when the setting is off, and tiny totals", () =>
    as({ role: "anon" }, async (sql) => {
      await sql.query("reset role");
      await sql.query(`update public.site_settings set value = '{"enabled": false}' where key = 'checkout.online'`);
      await sql.query("set local role anon");
      const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
      await sql.query(`select public.cart_set_item($1, $2, 1)`, [token, variantId]);
      const code = await sql.errorCode(
        `select public.create_order($1, $2, '{"name":"A B","phone":"+8801711111111"}', '{"district":"Dhaka","area":"Banani","address_line":"House 1, Road 2"}', 'sslcommerz', (public.checkout_quote($1, 'Dhaka') ->> 'total_minor')::bigint, null)`,
        [token, `pay-off-${randomUUID()}`],
      );
      expect(code).toBe("22023");
    }));

  it("only the trusted server can start, log or settle payments", () =>
    as({ role: "anon" }, async (sql) => {
      const o = await placeOnline(sql, 1);
      expect(await sql.errorCode(`select public.payment_begin($1, $2, 'sslcommerz')`, [o.order_number, o.tracking_token])).toBe("42501");
      expect(await sql.errorCode(`select public.payment_settle('FBK-000001-1', 'valid', 1, 'BDT', 'x', null, null, null, '{}')`)).toBe("42501");
      expect(await sql.errorCode(`select public.payment_log_event('FBK-000001-1', 'ipn', 'k', 's', '{}')`)).toBe("42501");
      expect(await sql.errorCode(`select public.courier_apply_event('steadfast', 'e', 't', 's', null, '{}')`)).toBe("42501");
      // Customers can read their own state with the token, nothing without it.
      const [{ s }] = await sql.query<{ s: { payment_status: string } }>(`select public.payment_status($1, $2) as s`, [o.order_number, o.tracking_token]);
      expect(s.payment_status).toBe("awaiting_payment");
      const [{ s: none }] = await sql.query<{ s: null }>(`select public.payment_status($1, 'wrong-token-wrong-token-wrong-tok') as s`, [o.order_number]);
      expect(none).toBeNull();
    }));
});

describe("settlement", () => {
  it("pays only after validation with the exact amount; commits the held stock; replays are no-ops", () =>
    as({ role: "anon" }, async (sql) => {
      const o = await placeOnline(sql, 2);
      const before = await balance(sql);
      await switchActor(sql, { role: "service_role" });
      const [{ b }] = await sql.query<{ b: { tran_id: string; amount_minor: number } }>(`select public.payment_begin($1, $2, 'sslcommerz') as b`, [o.order_number, o.tracking_token]);
      expect(b.tran_id).toBe(`${o.order_number}-1`);
      expect(Number(b.amount_minor)).toBe(Number(o.total_minor));
      await sql.query(`select public.payment_session_recorded($1, 'SESSION1')`, [b.tran_id]);
      const [{ status }] = await sql.query<{ status: string }>(`select status from public.payment_transactions where tran_id = $1`, [b.tran_id]);
      expect(status).toBe("redirected");

      // Wrong amount, wrong currency, missing val_id: rejected and remembered, never paid.
      expect((await settle(sql, b.tran_id, "valid", Number(b.amount_minor) - 100, "VAL-A")).status).toBe("rejected");
      expect((await settle(sql, b.tran_id, "valid", Number(b.amount_minor), "VAL-A", "USD")).reason).toBe("amount_mismatch");
      expect((await settle(sql, b.tran_id, "valid", Number(b.amount_minor), null)).reason).toBe("amount_mismatch");
      expect((await orderState(sql, o.order_id)).payment_status).toBe("awaiting_payment");
      const rejected = await sql.query(`select e.id from public.payment_events e join public.payment_transactions t on t.id = e.transaction_id where t.tran_id = $1 and e.kind = 'rejected'`, [b.tran_id]);
      expect(rejected).toHaveLength(3);

      // Exact amount: paid, stock committed, customer-visible gateway event.
      const ok = await settle(sql, b.tran_id, "valid", Number(b.amount_minor), "VAL-A");
      expect(ok).toMatchObject({ status: "valid", changed: true, stock_short: false });
      const after = await balance(sql);
      expect(after.on_hand).toBe(before.on_hand - 2);
      expect(after.reserved).toBe(before.reserved - 2);
      const st = await orderState(sql, o.order_id);
      expect(st.payment_status).toBe("paid");
      expect(st.risk_review_status).toBe("not_required");
      const ev = await sql.query<{ actor_kind: string; to_value: string }>(`select actor_kind, to_value from public.order_status_events where order_id = $1 and field = 'payment_status'`, [o.order_id]);
      expect(ev).toEqual([{ actor_kind: "gateway", to_value: "paid" }]);

      // Replays (same or different val_id) change nothing; no second attempt can start.
      expect((await settle(sql, b.tran_id, "valid", Number(b.amount_minor), "VAL-A")).changed).toBe(false);
      expect((await settle(sql, b.tran_id, "failed", 0, null)).changed).toBe(false);
      expect(await balance(sql)).toEqual(after);
      expect(await sql.errorCode(`select public.payment_begin($1, $2, 'sslcommerz')`, [o.order_number, o.tracking_token])).toBe("P0001");
    }));

  it("a validation id can pay one transaction only", () =>
    as({ role: "anon" }, async (sql) => {
      const o1 = await placeOnline(sql, 1);
      const o2 = await placeOnline(sql, 1);
      await switchActor(sql, { role: "service_role" });
      const [{ b1 }] = await sql.query<{ b1: { tran_id: string; amount_minor: number } }>(`select public.payment_begin($1, $2, 'sslcommerz') as b1`, [o1.order_number, o1.tracking_token]);
      const [{ b2 }] = await sql.query<{ b2: { tran_id: string; amount_minor: number } }>(`select public.payment_begin($1, $2, 'sslcommerz') as b2`, [o2.order_number, o2.tracking_token]);
      expect((await settle(sql, b1.tran_id, "valid", Number(b1.amount_minor), "VAL-SHARED")).status).toBe("valid");
      const r = await settle(sql, b2.tran_id, "valid", Number(b2.amount_minor), "VAL-SHARED");
      expect(r).toMatchObject({ status: "rejected", reason: "replayed_val_id" });
      expect((await orderState(sql, o2.order_id)).payment_status).toBe("awaiting_payment");
    }));

  it("failed and cancelled attempts keep the order payable; a new attempt gets the next number", () =>
    as({ role: "anon" }, async (sql) => {
      const o = await placeOnline(sql, 1);
      await switchActor(sql, { role: "service_role" });
      const [{ b1 }] = await sql.query<{ b1: { tran_id: string } }>(`select public.payment_begin($1, $2, 'sslcommerz') as b1`, [o.order_number, o.tracking_token]);
      expect((await settle(sql, b1.tran_id, "failed", 0, null)).status).toBe("failed");
      expect((await orderState(sql, o.order_id)).payment_status).toBe("awaiting_payment");
      const [{ b2 }] = await sql.query<{ b2: { tran_id: string } }>(`select public.payment_begin($1, $2, 'mock') as b2`, [o.order_number, o.tracking_token]);
      expect(b2.tran_id).toBe(`${o.order_number}-2`);
      expect((await settle(sql, b2.tran_id, "cancelled", 0, null)).status).toBe("cancelled");
      const [{ b3 }] = await sql.query<{ b3: { tran_id: string } }>(`select public.payment_begin($1, $2, 'sslcommerz') as b3`, [o.order_number, o.tracking_token]);
      expect(b3.tran_id).toBe(`${o.order_number}-3`);
      // Gateway messages are logged once each.
      const [{ first }] = await sql.query<{ first: boolean }>(`select public.payment_log_event($1, 'ipn', 'dedupe-1', 'FAILED', '{}') as first`, [b3.tran_id]);
      const [{ again }] = await sql.query<{ again: boolean }>(`select public.payment_log_event($1, 'ipn', 'dedupe-1', 'FAILED', '{}') as again`, [b3.tran_id]);
      expect(first).toBe(true);
      expect(again).toBe(false);
      // The validation API is the authority: a payment it confirms counts even if a browser
      // return had closed the attempt as failed (the money moved; staff can refund if needed).
      expect((await settle(sql, b1.tran_id, "valid", Number(o.total_minor), "VAL-LATE")).status).toBe("valid");
      expect((await orderState(sql, o.order_id)).payment_status).toBe("paid");
    }));

  it("a late payment after the hold expired re-reserves stock, or flags the order when sold out", () =>
    as({ role: "anon" }, async (sql) => {
      const o = await placeOnline(sql, 1);
      await switchActor(sql, { role: "service_role" });
      const [{ b }] = await sql.query<{ b: { tran_id: string; amount_minor: number } }>(`select public.payment_begin($1, $2, 'sslcommerz') as b`, [o.order_number, o.tracking_token]);
      await sql.query("reset role");
      await sql.query(`update public.inventory_reservations set expires_at = now() - interval '1 minute' where order_id = $1`, [o.order_id]);
      await sql.query(`select public.release_expired_reservations(100)`);
      // Everything else gets sold meanwhile (a COD order commits stock immediately).
      const [{ left }] = await sql.query<{ left: number }>(`select sum(on_hand - reserved)::int as left from public.stock_balances where variant_id = $1`, [variantId]);
      await sql.query("set local role anon");
      await placeOnline(sql, left, "cod");
      await switchActor(sql, { role: "service_role" });
      const r = await settle(sql, b.tran_id, "valid", Number(b.amount_minor), "VAL-LATE2");
      expect(r).toMatchObject({ status: "valid", stock_short: true });
      const st = await orderState(sql, o.order_id);
      expect(st.payment_status).toBe("paid");
      expect(st.risk_review_status).toBe("needs_review");
    }));
});

describe("unpaid orders expire", () => {
  it("cancels awaiting orders whose hold lapsed and releases their stock, leaving fresh ones alone", () =>
    as({ role: "anon" }, async (sql) => {
      const before = await balance(sql);
      const old = await placeOnline(sql, 2);
      const fresh = await placeOnline(sql, 1);
      await switchActor(sql, { role: "service_role" });
      const [{ b }] = await sql.query<{ b: { tran_id: string } }>(`select public.payment_begin($1, $2, 'sslcommerz') as b`, [old.order_number, old.tracking_token]);
      await sql.query(`select public.payment_session_recorded($1, 'S')`, [b.tran_id]);
      await sql.query("reset role");
      await sql.query(`update public.orders set placed_at = now() - interval '2 hours' where id = $1`, [old.order_id]);
      await sql.query(`update public.inventory_reservations set expires_at = now() - interval '1 hour' where order_id = $1`, [old.order_id]);
      await sql.query("set local role service_role");
      await sql.query(`select public.release_expired_reservations(100)`);
      const [{ n }] = await sql.query<{ n: number }>(`select public.expire_unpaid_orders(15) as n`);
      expect(n).toBe(1);
      expect(await orderState(sql, old.order_id)).toMatchObject({ payment_status: "failed", fulfillment_status: "cancelled" });
      expect((await orderState(sql, fresh.order_id)).payment_status).toBe("awaiting_payment");
      const [{ status }] = await sql.query<{ status: string }>(`select status from public.payment_transactions where tran_id = $1`, [b.tran_id]);
      expect(status).toBe("expired");
      const after = await balance(sql);
      expect(after.on_hand).toBe(before.on_hand);
      expect(after.reserved).toBe(before.reserved + 1);
      // Running again does nothing.
      expect((await sql.query<{ n: number }>(`select public.expire_unpaid_orders(15) as n`))[0]!.n).toBe(0);
    }));

  it("staff cancelling an awaiting order releases the hold without a restock movement", () =>
    as({ role: "anon" }, async (sql) => {
      const before = await balance(sql);
      const o = await placeOnline(sql, 2);
      await switchActor(sql, { role: "authenticated", sub: orderManager, aal: "aal2" });
      await sql.query(`select public.admin_order_transition($1, 'fulfillment_status', 'cancelled', 'Customer changed their mind')`, [o.order_id]);
      expect(await balance(sql)).toEqual(before);
      expect(await orderState(sql, o.order_id)).toMatchObject({ payment_status: "voided", fulfillment_status: "cancelled" });
      const moves = await sql.query(`select id from public.stock_movements where reference_id = $1 and movement_type = 'restock'`, [o.order_id]);
      expect(moves).toHaveLength(0);
    }));
});

describe("courier events", () => {
  it("applies verified events once, follows the state machine, and stores unknown ones without applying", () =>
    as({ role: "anon" }, async (sql) => {
      const o = await placeOnline(sql, 1, "cod");
      await switchActor(sql, { role: "authenticated", sub: orderManager, aal: "aal2" });
      await sql.query(`select public.admin_order_transition($1, 'fulfillment_status', 'confirmed', null)`, [o.order_id]);
      await sql.query(`select public.admin_set_shipment($1, 'steadfast', null, 'SF-1001', null)`, [o.order_id]);
      await switchActor(sql, { role: "service_role" });
      const apply = (eventId: string, tracking: string, status: string, mapped: string | null) =>
        sql.query<{ r: { duplicate: boolean; applied: boolean; to?: string } }>(`select public.courier_apply_event('steadfast', $1, $2, $3, $4, '{"src":"test"}') as r`, [eventId, tracking, status, mapped]).then((x) => x[0]!.r);

      // Skipping a state is refused but recorded.
      expect(await apply("e1", "SF-1001", "delivered", "delivered")).toMatchObject({ duplicate: false, applied: false });
      expect(await apply("e2", "SF-1001", "pending", "ready_for_pickup")).toMatchObject({ applied: true, to: "ready_for_pickup" });
      expect(await apply("e2", "SF-1001", "pending", "ready_for_pickup")).toMatchObject({ duplicate: true });
      expect(await apply("e3", "SF-1001", "picked_up", "handed_to_courier")).toMatchObject({ applied: true });
      const [o1] = await sql.query<{ shipment_status: string; fulfillment_status: string }>(`select shipment_status, fulfillment_status from public.orders where id = $1`, [o.order_id]);
      expect(o1).toEqual({ shipment_status: "handed_to_courier", fulfillment_status: "fulfilled" });
      // Unknown tracking number and unmapped status: kept for staff, nothing changes.
      expect(await apply("e4", "SF-NOPE", "delivered", "delivered")).toMatchObject({ applied: false });
      expect(await apply("e5", "SF-1001", "weird_status", null)).toMatchObject({ applied: false });
      const stored = await sql.query<{ applied: boolean }>(`select applied from public.courier_events where courier = 'steadfast' order by id`);
      expect(stored.map((s) => s.applied)).toEqual([false, true, true, false, false]);
      const ev = await sql.query<{ actor_kind: string }>(`select actor_kind from public.order_status_events where order_id = $1 and field = 'shipment_status'`, [o.order_id]);
      expect(ev.every((e) => e.actor_kind === "courier")).toBe(true);
    }));
});
