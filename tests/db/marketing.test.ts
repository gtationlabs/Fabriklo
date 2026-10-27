import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, createUser, deleteUsers, pool, switchActor, type Sql } from "./helpers";

/**
 * Slice 7 at the database level: coupon scope/limits/stacking committed
 * atomically by create_order, consent + suppression, the de-duplicated
 * marketing event stream, idempotent automation executions, outbox retry /
 * dead-letter, and the outbound webhook allowlist.
 */
let productId: string;
let variantId: string;
let categoryId: string;
let otherCategoryId: string;
let marketer: string;
let support: string;
let customer: string;
const PRICE = 150000; // ৳1,500.00
const STOCK = 40;

beforeAll(async () => {
  const s = randomUUID().slice(0, 8);
  [{ id: categoryId }] = await admin<{ id: string }>(`insert into public.categories (slug, name) values ($1, 'Mkt cat') returning id`, [`mkt-cat-${s}`]);
  [{ id: otherCategoryId }] = await admin<{ id: string }>(`insert into public.categories (slug, name) values ($1, 'Mkt other') returning id`, [`mkt-other-${s}`]);
  [{ id: productId }] = await admin<{ id: string }>(
    `insert into public.products (slug, title, status, published_at, is_demo, category_id) values ($1, 'Marketing test tee', 'active', now(), true, $2) returning id`,
    [`mkt-test-${s}`, categoryId],
  );
  [{ id: variantId }] = await admin<{ id: string }>(
    `insert into public.product_variants (product_id, sku, size, color, price_minor) values ($1, $2, 'M', 'Black', $3) returning id`,
    [productId, `MKT-${s}`, PRICE],
  );
  const [{ id: wh }] = await admin<{ id: string }>(`select id from public.warehouses where is_default`);
  await admin(`select private.apply_stock_movement($1, $2, 'receive', $3, 0, 'test stock', 'seed', null, $4)`, [variantId, wh, STOCK, `mkt-seed-${variantId}`]);
  marketer = await createStaff("marketing_manager");
  support = await createStaff("support_agent");
  customer = await createUser("mkt-customer");
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("set session_replication_role = replica");
    const variants = `(select id from public.product_variants where product_id = '${productId}')`;
    await c.query(`delete from public.stock_movements where variant_id in ${variants}`);
    await c.query(`delete from public.inventory_reservations where variant_id in ${variants}`);
    await c.query(`delete from public.stock_balances where variant_id in ${variants}`);
    await c.query(`delete from public.products where id = $1`, [productId]);
    await c.query(`delete from public.categories where id in ($1, $2)`, [categoryId, otherCategoryId]);
    await c.query("set session_replication_role = origin");
  } finally {
    c.release();
  }
  await deleteUsers([marketer, support, customer]);
  await pool.end();
});

const staff = (sub: string) => ({ role: "authenticated" as const, sub, aal: "aal2" as const });
const uniquePhone = () => `+88017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

type Quote = { subtotal_minor: number; discount_minor: number; shipping_minor: number | null; total_minor: number | null; promotions: { code: string | null; name: string; discount_minor: number }[]; coupon: { code: string; status: string } | null };

async function cartWith(sql: Sql, qty: number) {
  const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
  await sql.query(`select public.cart_set_item($1, $2, $3)`, [token, variantId, qty]);
  return token;
}
async function quote(sql: Sql, token: string) {
  const [{ q }] = await sql.query<{ q: Quote }>(`select public.checkout_quote($1, 'Dhaka') as q`, [token]);
  return q;
}
async function applyCoupon(sql: Sql, token: string, code: string) {
  const [{ c }] = await sql.query<{ c: { code: string; status: string; discount_minor?: number } }>(`select public.cart_apply_coupon($1, $2) as c`, [token, code]);
  return c;
}
async function placeOrder(sql: Sql, token: string, opts: { phone?: string; email?: string; expected?: number } = {}) {
  const expected = opts.expected ?? Number((await quote(sql, token)).total_minor);
  const [{ r }] = await sql.query<{ r: { order_id: string; order_number: string; total_minor: number } }>(
    `select public.create_order($1, $2, $3, $4, 'cod', $5, null, $6) as r`,
    [token, `mkt-${randomUUID()}`, { name: "Karim Ahmed", phone: opts.phone ?? uniquePhone(), email: opts.email ?? null },
      { district: "Dhaka", area: "Banani", address_line: "House 9, Road 11" }, expected,
      { utm_source: "newsletter", utm_medium: "email", utm_campaign: "launch", landing_path: "/", first_seen_at: new Date().toISOString() }],
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
    const err = e as { hint?: string; code?: string; message?: string };
    return err.hint ?? err.code ?? "unknown";
  }
}
/** Insert a promotion as the superuser (fixtures), restoring the current role. */
async function promo(sql: Sql, row: Record<string, unknown>) {
  const [{ role }] = await sql.query<{ role: string }>(`select current_user as role`);
  await sql.query("reset role");
  const cols = Object.keys(row);
  const [{ id }] = await sql.query<{ id: string }>(
    `insert into public.promotions (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    cols.map((c) => row[c]),
  );
  await sql.query(`set local role ${role}`);
  return id;
}
async function asRoot<T>(sql: Sql, fn: () => Promise<T>) {
  const [{ role }] = await sql.query<{ role: string }>(`select current_user as role`);
  await sql.query("reset role");
  try {
    return await fn();
  } finally {
    await sql.query(`set local role ${role}`);
  }
}

describe("coupons", () => {
  it("applies a percent code above the minimum basket, records the redemption and enforces the redemption limit", () =>
    as({ role: "anon" }, async (sql) => {
      await promo(sql, { kind: "coupon", code: "save10", name: "Ten off", discount_type: "percent", discount_value: 10, min_subtotal_minor: 200000, max_redemptions: 1 });
      const small = await cartWith(sql, 1);
      expect((await applyCoupon(sql, small, "SAVE10")).status).toBe("min_subtotal");
      expect((await quote(sql, small)).discount_minor).toBe(0);

      const token = await cartWith(sql, 2);
      expect((await applyCoupon(sql, token, "save10")).status).toBe("applied"); // case-insensitive
      const q = await quote(sql, token);
      expect(q.discount_minor).toBe(30000);
      expect(q.total_minor).toBe(300000 - 30000 + Number(q.shipping_minor));
      const order = await placeOrder(sql, token);
      const [o] = await asRoot(sql, () => sql.query<{ discount_minor: number; total_minor: number; coupon_code: string; redemptions: number; count: number; attributed: number }>(
        `select o.discount_minor::int, o.total_minor::int, o.coupon_code,
                (select count(*)::int from public.coupon_redemptions r where r.order_id = o.id) as redemptions,
                (select redemption_count from public.promotions where code = 'SAVE10') as count,
                (select count(*)::int from public.attribution_events a where a.order_id = o.id) as attributed
           from public.orders o where o.id = $1`, [order.order_id]));
      expect(o).toMatchObject({ discount_minor: 30000, coupon_code: "SAVE10", redemptions: 1, count: 1, attributed: 1 });

      // Limit reached: a second cart cannot apply it any more.
      const again = await cartWith(sql, 2);
      expect((await applyCoupon(sql, again, "SAVE10")).status).toBe("exhausted");
      expect((await quote(sql, again)).discount_minor).toBe(0);
    }));

  it("one use per customer and first-order rules are re-checked with the order's phone, and the order is refused with a clear hint", () =>
    as({ role: "anon" }, async (sql) => {
      await promo(sql, { kind: "coupon", code: "ONCE", name: "Once", discount_type: "fixed", discount_value: 20000, once_per_customer: true });
      await promo(sql, { kind: "coupon", code: "WELCOME", name: "Welcome", discount_type: "fixed", discount_value: 10000, first_order_only: true });
      const phone = uniquePhone();
      const t1 = await cartWith(sql, 1);
      expect((await applyCoupon(sql, t1, "ONCE")).status).toBe("applied");
      await placeOrder(sql, t1, { phone });

      // Anonymous quote still says "applied" (identity unknown), but the order with the same phone is refused.
      const t2 = await cartWith(sql, 1);
      expect((await applyCoupon(sql, t2, "ONCE")).status).toBe("applied");
      const total = Number((await quote(sql, t2)).total_minor);
      expect(await hintOf(sql, () => placeOrder(sql, t2, { phone, expected: total }))).toBe("coupon_invalid");
      // Removing the code lets the same customer order at full price.
      await sql.query(`select public.cart_remove_coupon($1)`, [t2]);
      expect((await quote(sql, t2)).discount_minor).toBe(0);
      await placeOrder(sql, t2, { phone });

      // First-order-only: this phone already ordered.
      const t3 = await cartWith(sql, 1);
      expect((await applyCoupon(sql, t3, "WELCOME")).status).toBe("applied");
      const t3total = Number((await quote(sql, t3)).total_minor);
      expect(await hintOf(sql, () => placeOrder(sql, t3, { phone, expected: t3total }))).toBe("coupon_invalid");
      const fresh = await cartWith(sql, 1);
      expect((await applyCoupon(sql, fresh, "WELCOME")).status).toBe("applied");
      const freshQuote = await quote(sql, fresh);
      expect(freshQuote.discount_minor).toBe(10000);
      const o = await placeOrder(sql, fresh, { phone: uniquePhone() });
      expect(Number(o.total_minor)).toBe(PRICE - 10000 + Number(freshQuote.shipping_minor));
    }));

  it("category scope, deterministic stacking, free shipping and the attempt limit", () =>
    as({ role: "anon" }, async (sql) => {
      await promo(sql, { kind: "coupon", code: "OTHERCAT", name: "Other category", discount_type: "percent", discount_value: 50, scope: "categories", target_ids: [otherCategoryId] });
      await promo(sql, { kind: "coupon", code: "THISCAT", name: "This category", discount_type: "percent", discount_value: 20, scope: "categories", target_ids: [categoryId], max_discount_minor: 25000, stackable: true });
      const token = await cartWith(sql, 1);
      expect((await applyCoupon(sql, token, "OTHERCAT")).status).toBe("not_eligible");
      expect((await applyCoupon(sql, token, "THISCAT")).status).toBe("applied");
      expect((await quote(sql, token)).discount_minor).toBe(25000); // 20% of 1,500 capped at 250

      // A non-stackable automatic promotion loses to the coupon that was applied first; a stackable one adds up.
      await promo(sql, { kind: "automatic", name: "Site-wide 5%", discount_type: "percent", discount_value: 5, priority: 10, stackable: false });
      let q = await quote(sql, token);
      expect(q.promotions.map((p) => p.name)).toEqual(["This category"]);
      await promo(sql, { kind: "automatic", name: "Free delivery", discount_type: "free_shipping", discount_value: 0, priority: 20, stackable: true });
      q = await quote(sql, token);
      expect(q.promotions.map((p) => p.name)).toEqual(["This category", "Free delivery"]);
      expect(q.shipping_minor).toBe(0);
      expect(q.total_minor).toBe(PRICE - 25000);
      // Without the coupon, the highest-priority automatic promotion wins and blocks the rest (not stackable).
      await sql.query(`select public.cart_remove_coupon($1)`, [token]);
      q = await quote(sql, token);
      expect(q.promotions.map((p) => p.name)).toEqual(["Site-wide 5%"]);
      expect(q.discount_minor).toBe(7500);

      // Guessing codes is throttled per cart.
      for (let i = 0; i < 13; i++) await applyCoupon(sql, token, `NOPE${i}`); // 15 attempts in total on this cart
      expect(await hintOf(sql, () => applyCoupon(sql, token, "NOPE99"))).toBe("too_many_attempts");
    }));

  it("staff access: marketing manages promotions with MFA, support cannot, and nobody edits redemption counts by hand", () =>
    as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select * from public.promotions`)).toBe("42501");
      await switchActor(sql, { role: "authenticated", sub: marketer, aal: "aal1" });
      expect(await sql.errorCode(`insert into public.promotions (kind, code, name, discount_type, discount_value) values ('coupon', 'MFA', 'x', 'fixed', 100)`)).toBe("42501");
      await switchActor(sql, staff(marketer));
      const [{ id }] = await sql.query<{ id: string }>(`insert into public.promotions (kind, code, name, discount_type, discount_value) values ('coupon', ' hello ', 'Hello', 'fixed', 100) returning id`);
      expect((await sql.query<{ code: string }>(`select code from public.promotions where id = $1`, [id]))[0]!.code).toBe("HELLO");
      await sql.query(`update public.promotions set redemption_count = 99 where id = $1`, [id]);
      expect((await sql.query<{ c: number }>(`select redemption_count as c from public.promotions where id = $1`, [id]))[0]!.c).toBe(0);
      expect(await sql.errorCode(`insert into public.promotions (kind, code, name, discount_type, discount_value) values ('coupon', 'BAD', 'x', 'percent', 150)`)).toBe("23514");
      expect(await sql.errorCode(`insert into public.promotions (kind, name, discount_type, discount_value, scope) values ('automatic', 'x', 'fixed', 100, 'categories')`)).toBe("23514");
      await switchActor(sql, staff(support));
      expect(await sql.errorCode(`select * from public.promotions`)).toBeNull();
      expect((await sql.query(`select * from public.promotions`)).length).toBe(0); // RLS hides, no permission
      expect(await sql.errorCode(`insert into public.promotions (kind, code, name, discount_type, discount_value) values ('coupon', 'SUP', 'x', 'fixed', 100)`)).toBe("42501");
    }));
});

describe("consent and suppression", () => {
  it("newsletter is double opt-in; marketing mail is suppressed until confirmed and after unsubscribing; transactional mail still flows", () =>
    as({ role: "service_role" }, async (sql) => {
      const email = `news-${randomUUID().slice(0, 8)}@example.com`;
      const [{ r }] = await sql.query<{ r: { status: string; sent: boolean } }>(`select public.newsletter_subscribe($1, 'footer', 'iphash') as r`, [email]);
      expect(r).toEqual({ status: "pending", sent: true });
      const [confirmMail] = await sql.query<{ status: string; message_class: string; token: string }>(
        `select status, message_class, payload ->> 'confirm_token' as token from public.notification_outbox where template_key = 'newsletter_confirm' and recipient = $1`, [email]);
      expect(confirmMail).toMatchObject({ status: "queued", message_class: "transactional" });
      // Not confirmed yet: a marketing message is stored as suppressed, never queued.
      const enqueue = (cls: string, key: string) => asRoot(sql, async () => (await sql.query<{ status: string; reason: string | null }>(
        `select status, suppressed_reason as reason from private.outbox_enqueue('email', $1, $2, null, 'abandoned_cart', '{}', $3)`, [cls, email, key]))[0]!);
      expect(await enqueue("marketing", `k1-${email}`)).toEqual({ status: "suppressed", reason: "no_consent" });
      expect((await enqueue("transactional", `k2-${email}`)).status).toBe("queued");

      // Subscribing twice does not send twice within the hour (de-duplicated).
      await sql.query(`select public.newsletter_subscribe($1, 'footer', 'iphash')`, [email]);
      expect((await sql.query(`select 1 from public.notification_outbox where template_key = 'newsletter_confirm' and recipient = $1`, [email])).length).toBe(1);

      await switchActor(sql, { role: "anon" });
      expect((await sql.query<{ r: { ok: boolean } }>(`select public.newsletter_confirm('deadbeef') as r`))[0]!.r.ok).toBe(false);
      expect((await sql.query<{ r: { ok: boolean } }>(`select public.newsletter_confirm($1) as r`, [confirmMail!.token]))[0]!.r.ok).toBe(true);
      await switchActor(sql, { role: "service_role" });
      expect((await enqueue("marketing", `k3-${email}`)).status).toBe("queued");
      const [{ n }] = await sql.query<{ n: number }>(`select count(*)::int as n from public.consent_events where email = $1 and action = 'granted'`, [email]);
      expect(n).toBeGreaterThanOrEqual(2);

      // Unsubscribe link → suppression list; marketing suppressed, transactional allowed.
      const t = "ab".repeat(24);
      await sql.query(`select public.newsletter_unsubscribe_token_set($1, $2)`, [email, t]);
      await switchActor(sql, { role: "anon" });
      expect((await sql.query<{ r: { ok: boolean } }>(`select public.newsletter_unsubscribe($1) as r`, [t]))[0]!.r.ok).toBe(true);
      await switchActor(sql, { role: "service_role" });
      expect(await enqueue("marketing", `k4-${email}`)).toEqual({ status: "suppressed", reason: "no_consent" });
      expect((await enqueue("transactional", `k5-${email}`)).status).toBe("queued");
      expect((await sql.query(`select 1 from public.unsubscribes where identifier = $1 and channel = 'email'`, [email])).length).toBe(1);
    }));

  it("an account's opt-out writes a consent event and suppresses every channel; opting in again lifts it", () =>
    as({ role: "authenticated", sub: customer }, async (sql) => {
      const [{ email }] = await asRoot(sql, () => sql.query<{ email: string }>(`select email from auth.users where id = $1`, [customer]));
      await sql.query(`update public.profiles set marketing_opt_in = true where id = $1`, [customer]);
      const allowed = () => asRoot(sql, async () => (await sql.query<{ a: boolean }>(`select private.marketing_allowed('email', $1, $2) as a`, [email, customer]))[0]!.a);
      expect(await allowed()).toBe(true);
      await sql.query(`update public.profiles set marketing_opt_in = false where id = $1`, [customer]);
      expect(await allowed()).toBe(false);
      const rows = await asRoot(sql, () => sql.query<{ action: string }>(`select action from public.consent_events where user_id = $1 order by id`, [customer]));
      expect(rows.map((r) => r.action)).toEqual(["granted", "revoked"]);
      expect((await asRoot(sql, () => sql.query(`select 1 from public.unsubscribes where identifier = $1 and channel = 'all'`, [email]))).length).toBe(1);
      await sql.query(`update public.profiles set marketing_opt_in = true where id = $1`, [customer]);
      expect(await allowed()).toBe(true);
    }));
});

describe("events and automation", () => {
  async function rule(sql: Sql, row: Record<string, unknown>) {
    return asRoot(sql, async () => {
      const cols = Object.keys(row);
      const [{ id }] = await sql.query<{ id: string }>(
        `insert into public.automation_rules (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        cols.map((c) => (typeof row[c] === "object" && row[c] !== null ? JSON.stringify(row[c]) : row[c])),
      );
      return id;
    });
  }

  it("an order emits each event once; a live rule queues exactly one message per event, re-processing never sends twice", () =>
    as({ role: "anon" }, async (sql) => {
      const ruleId = await rule(sql, { name: "Confirm orders", trigger_type: "order.placed", action: { type: "email", template_key: "order_confirmation", to: "customer" }, is_active: true, mode: "live" });
      const token = await cartWith(sql, 1);
      const email = `buyer-${randomUUID().slice(0, 8)}@example.com`;
      const order = await placeOrder(sql, token, { email });
      await switchActor(sql, { role: "service_role" });
      const events = await sql.query<{ event_type: string }>(`select event_type from public.marketing_events where order_id = $1 order by id`, [order.order_id]);
      expect(events.map((e) => e.event_type)).toEqual(["order.placed", "cod.awaiting_verification"]);
      // The same status event cannot produce a second marketing event (dedupe key).
      await sql.query(`insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind) values ($1, 'created', null, 'placed', 'system')`, [order.order_id]);
      expect((await sql.query(`select 1 from public.marketing_events where order_id = $1`, [order.order_id])).length).toBe(2);

      await sql.query(`update public.marketing_events set processed_at = now() where processed_at is null and order_id is distinct from $1`, [order.order_id]);
      const [{ n }] = await sql.query<{ n: number }>(`select public.automation_process_events(50) as n`);
      expect(n).toBe(2);
      const outbox = await sql.query<{ status: string; recipient: string; message_class: string; dedupe_key: string }>(
        `select status, recipient, message_class, dedupe_key from public.notification_outbox where rule_id = $1`, [ruleId]);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({ status: "queued", recipient: email, message_class: "transactional" });
      const exec = await sql.query<{ status: string; recipient_masked: string }>(`select status, recipient_masked from public.automation_executions where rule_id = $1`, [ruleId]);
      expect(exec).toHaveLength(1);
      expect(exec[0]!.recipient_masked).not.toContain(email.split("@")[0]!.slice(2));
      // Re-run: nothing new (events are processed, executions unique per rule+event).
      await sql.query(`update public.marketing_events set processed_at = null where order_id = $1`, [order.order_id]);
      await sql.query(`select public.automation_process_events(50)`);
      expect((await sql.query(`select 1 from public.notification_outbox where rule_id = $1`, [ruleId])).length).toBe(1);
      expect((await sql.query(`select 1 from public.automation_executions where rule_id = $1`, [ruleId])).length).toBe(1);
    }));

  it("conditions, dry-run, hourly quota, consent-aware marketing actions and review tasks", () =>
    as({ role: "anon" }, async (sql) => {
      const big = await rule(sql, { name: "Big orders only", trigger_type: "order.placed", conditions: [{ field: "total_minor", op: "gte", value: 10_000_000 }], action: { type: "internal_alert", title: "Big order" }, is_active: true, mode: "live" });
      const dry = await rule(sql, { name: "Dry", trigger_type: "order.placed", action: { type: "internal_alert", title: "Dry alert" }, is_active: true, mode: "dry_run" });
      const quota = await rule(sql, { name: "Quota 1", trigger_type: "order.placed", action: { type: "internal_alert", title: "Quota" }, is_active: true, mode: "live", quota_per_hour: 1 });
      const promoRule = await rule(sql, { name: "Promo mail", trigger_type: "order.placed", action: { type: "email", template_key: "abandoned_cart", to: "customer", message_class: "marketing" }, is_active: true, mode: "live" });
      const review = await rule(sql, { name: "Review Dhaka COD", trigger_type: "cod.awaiting_verification", conditions: [{ field: "district", op: "eq", value: "dhaka" }], action: { type: "review_task", title: "Check COD" }, is_active: true, mode: "live" });
      const t1 = await cartWith(sql, 1);
      const o1 = await placeOrder(sql, t1, { email: `c-${randomUUID().slice(0, 6)}@example.com` });
      const t2 = await cartWith(sql, 1);
      const o2 = await placeOrder(sql, t2);
      await switchActor(sql, { role: "service_role" });
      await sql.query(`update public.marketing_events set processed_at = now() where processed_at is null and (order_id is null or order_id <> all (array[$1::uuid, $2::uuid]))`, [o1.order_id, o2.order_id]);
      await sql.query(`select public.automation_process_events(50)`);
      const execs = async (id: string) => sql.query<{ status: string; reason: string | null }>(`select status, reason from public.automation_executions where rule_id = $1 order by id`, [id]);
      expect((await execs(big)).map((e) => e.reason)).toEqual(["conditions_not_met", "conditions_not_met"]);
      expect((await execs(dry)).map((e) => e.status)).toEqual(["dry_run", "dry_run"]);
      expect((await sql.query(`select 1 from public.notification_outbox where rule_id = $1`, [dry])).length).toBe(0);
      expect((await execs(quota)).map((e) => e.status + ":" + (e.reason ?? ""))).toEqual(["queued:", "skipped:quota_exceeded"]);
      // Marketing to someone who never opted in is suppressed, and visible as such.
      expect((await execs(promoRule)).map((e) => e.reason)).toEqual(["suppressed:no_consent", "suppressed:no_recipient"]);
      expect((await sql.query<{ s: string }>(`select status as s from public.notification_outbox where rule_id = $1`, [promoRule])).map((r) => r.s)).toEqual(["suppressed", "suppressed"]);
      // Review task flagged both COD orders (condition compares case-insensitively).
      expect((await execs(review)).map((e) => e.status)).toEqual(["queued", "queued"]);
      const flagged = await sql.query<{ s: string }>(`select risk_review_status as s from public.orders where id in ($1, $2)`, [o1.order_id, o2.order_id]);
      expect(flagged.map((f) => f.s)).toEqual(["needs_review", "needs_review"]);
    }));

  it("rule validation: unknown templates, bad conditions and webhooks to hosts outside the allowlist are refused; versions are kept", () =>
    as(staff(marketer), async (sql) => {
      const bad = (cols: string, vals: string) => sql.errorCode(`insert into public.automation_rules (${cols}) values (${vals})`);
      expect(await bad(`name, trigger_type, action`, `'bad', 'order.placed', '{"type":"email","template_key":"nope"}'`)).toBe("22023");
      expect(await bad(`name, trigger_type, action, conditions`, `'bad', 'order.placed', '{"type":"internal_alert","title":"Test"}', '[{"field":"total_minor","op":"between","value":1}]'`)).toBe("22023");
      expect(await bad(`name, trigger_type, action`, `'bad', 'order.placed', '{"type":"webhook","url":"https://hooks.example.com/a"}'`)).toBe("22023");
      expect(await bad(`name, trigger_type, action`, `'bad', 'order.placed', '{"type":"webhook","url":"http://hooks.example.com/a"}'`)).toBe("22023");
      expect(await bad(`name, trigger_type, action`, `'bad', 'stock.low', '{"type":"email","template_key":"staff_alert","to":"customer"}'`)).toBe("22023");
      // Allowlist the host (automation.manage), then the same rule is accepted; IPs and localhost never are.
      await sql.query(`select public.admin_update_marketing_setting('automation.webhook_allowlist', '{"hosts":["hooks.example.com"]}')`);
      expect(await sql.errorCode(`select public.admin_update_marketing_setting('automation.webhook_allowlist', '{"hosts":["localhost"]}')`)).toBe("22023");
      const [{ id }] = await sql.query<{ id: string }>(`insert into public.automation_rules (name, trigger_type, action) values ('hook', 'order.placed', '{"type":"webhook","url":"https://hooks.example.com/a"}') returning id`);
      expect(await bad(`name, trigger_type, action`, `'bad', 'order.placed', '{"type":"webhook","url":"https://10.0.0.1/a"}'`)).toBe("22023");
      expect(await bad(`name, trigger_type, action`, `'bad', 'order.placed', '{"type":"webhook","url":"https://hooks.example.com.evil.net/a"}'`)).toBe("22023");
      await sql.query(`update public.automation_rules set is_active = true, mode = 'live' where id = $1`, [id]);
      const versions = await sql.query<{ version: number }>(`select version from public.automation_rule_versions where rule_id = $1 order by version`, [id]);
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      expect((await sql.query<{ v: number }>(`select version as v from public.automation_rules where id = $1`, [id]))[0]!.v).toBe(2);
      // Support cannot touch rules.
      await switchActor(sql, staff(support));
      expect(await sql.errorCode(`insert into public.automation_rules (name, trigger_type, action) values ('support rule', 'order.placed', '{"type":"internal_alert","title":"Test"}')`)).toBe("42501");
    }));

  it("outbox: claim, retry with backoff, dead-letter after max attempts, staff retry; suppressed rows are never claimed", () =>
    as({ role: "service_role" }, async (sql) => {
      const id = await asRoot(sql, async () => {
        const [{ id }] = await sql.query<{ id: string }>(
          `select id from private.outbox_enqueue('email', 'transactional', 'ops@example.com', null, 'staff_alert', '{"title":"t"}', $1)`, [`t-${randomUUID()}`]);
        await sql.query(`select id from private.outbox_enqueue('email', 'marketing', 'nobody@example.com', null, 'abandoned_cart', '{}', $1)`, [`s-${randomUUID()}`]);
        return id;
      });
      await sql.query(`update public.notification_outbox set max_attempts = 2 where id = $1`, [id]);
      const claimed = await sql.query<{ id: string; status: string; attempts: number }>(`select id, status, attempts from public.outbox_claim(50)`);
      expect(claimed.some((c) => c.id === id)).toBe(true);
      expect(claimed.every((c) => c.status === "sending")).toBe(true);
      expect(claimed.map((c) => c.id)).not.toContain((await sql.query<{ id: string }>(`select id from public.notification_outbox where recipient = 'nobody@example.com'`))[0]!.id);
      expect((await sql.query<{ s: string }>(`select public.outbox_mark_failed($1, 'smtp timeout', true) as s`, [id]))[0]!.s).toBe("queued");
      const [row] = await sql.query<{ next: Date; attempts: number }>(`select next_attempt_at as next, attempts from public.notification_outbox where id = $1`, [id]);
      expect(row!.next.getTime()).toBeGreaterThan(Date.now() + 60_000);
      await sql.query(`update public.notification_outbox set next_attempt_at = now() where id = $1`, [id]);
      expect((await sql.query<{ id: string }>(`select id from public.outbox_claim(50)`)).map((c) => c.id)).toContain(id);
      expect((await sql.query<{ s: string }>(`select public.outbox_mark_failed($1, 'smtp timeout', true) as s`, [id]))[0]!.s).toBe("dead");
      // A non-retryable error is dead at once.
      await switchActor(sql, staff(marketer));
      expect((await sql.query<{ s: string }>(`select public.admin_outbox_retry($1) as s`, [id]))[0]!.s).toBe("queued");
      expect(await sql.errorCode(`select public.admin_outbox_retry($1)`, [id])).toBe("P0001");
      await switchActor(sql, staff(support));
      expect(await sql.errorCode(`select public.admin_outbox_retry($1)`, [id])).toBe("42501");
    }));

  it("stock crossing the reorder point emits one low-stock event per day; a campaign reaches only opted-in people", () =>
    as({ role: "service_role" }, async (sql) => {
      const [{ wh }] = await sql.query<{ wh: string }>(`select id as wh from public.warehouses where is_default`);
      await sql.query(`update public.stock_balances set reorder_point = 100 where variant_id = $1`, [variantId]);
      // Dropping from well above to below the point (via a reservation) crosses it.
      await sql.query(`update public.stock_balances set reorder_point = 3 where variant_id = $1`, [variantId]);
      await asRoot(sql, () => sql.query(`select private.apply_stock_movement($1, $2, 'adjust', 2, 0, 'test', 'adjustment', null, $3)`, [variantId, wh, `mkt-adj-${randomUUID()}`]));
      await sql.query(`update public.stock_balances set reserved = on_hand - 1 where variant_id = $1`, [variantId]);
      await sql.query(`update public.stock_balances set reserved = on_hand - 2 where variant_id = $1`, [variantId]);
      const low = await sql.query(`select 1 from public.marketing_events where event_type = 'stock.low' and variant_id = $1`, [variantId]);
      expect(low).toHaveLength(1);

      // Campaign: one opted-in account, one who never opted in.
      const optIn = await asRoot(sql, async () => {
        const id = randomUUID();
        await sql.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
          values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{}', '{}', now(), now())`, [id, `camp-${id.slice(0, 8)}@example.com`]);
        await sql.query(`update public.profiles set marketing_opt_in = true where id = $1`, [id]);
        return id;
      });
      await switchActor(sql, staff(marketer));
      const [{ sid }] = await sql.query<{ sid: string }>(`insert into public.customer_segments (name, definition) values ('Everyone opted in', '{}') returning id as sid`);
      const [{ cid }] = await sql.query<{ cid: string }>(`insert into public.campaigns (name, channel, segment_id, template_key) values ('Launch', 'email', $1, 'abandoned_cart') returning id as cid`, [sid]);
      const [{ r }] = await sql.query<{ r: { queued: number; suppressed: number } }>(`select public.admin_campaign_send($1) as r`, [cid]);
      expect(r.queued).toBeGreaterThanOrEqual(1);
      const recipients = await asRoot(sql, () => sql.query<{ recipient: string; status: string }>(`select recipient, status from public.notification_outbox where campaign_id = $1`, [cid]));
      expect(recipients.every((x) => x.status === "queued")).toBe(true);
      expect(recipients.some((x) => x.recipient.startsWith("camp-"))).toBe(true);
      expect(recipients.some((x) => x.recipient.startsWith("mkt-customer"))).toBe(false); // the fixture customer is opted out by now
      expect(await sql.errorCode(`select public.admin_campaign_send($1)`, [cid])).toBe("P0001");
      expect(optIn).toBeTruthy();
    }));
});
