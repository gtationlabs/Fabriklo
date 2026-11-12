import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, createUser, deleteUsers, pool, switchActor } from "./helpers";

/**
 * Admin dashboard modules: checkout leads, slides, shipping methods, reviews,
 * customers, staff profiles, API keys and Meta pixels. Every test runs inside a
 * rolled-back transaction.
 */
let superAdmin: string;
let adminUser: string;
let support: string; // support_agent: orders.read + customers.read, no fulfil / manage
let editor: string; // content_editor: cms.edit + cms.publish, reviews.moderate
let analyst: string; // nothing relevant
let customer: string;

beforeAll(async () => {
  superAdmin = await createStaff("super_admin");
  adminUser = await createStaff("admin");
  support = await createStaff("support_agent");
  editor = await createStaff("content_editor");
  analyst = await createStaff("analyst");
  customer = await createUser("reviewer");
});
afterAll(async () => {
  await deleteUsers([superAdmin, adminUser, support, editor, analyst, customer]);
  await pool.end();
});

const staff = (sub: string, aal: "aal1" | "aal2" = "aal2") => ({ role: "authenticated" as const, sub, aal });

async function stockedVariant() {
  const [v] = await admin<{ id: string; product_id: string }>(
    `select v.id, v.product_id from public.product_variants v join public.products p on p.id = v.product_id join public.stock_balances b on b.variant_id = v.id
      where p.status = 'active' and v.is_active and v.price_minor > 10000 group by v.id, v.product_id having sum(b.on_hand - b.reserved) > 0 limit 1`,
  );
  return v!;
}

describe("checkout leads", () => {
  it("a shopper's cart becomes one lead; only order staff read it, only fulfilment staff update it", async () => {
    const v = await stockedVariant();
    await as({ role: "anon" }, async (sql) => {
      const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
      // Empty cart → nothing captured.
      const [{ r: empty }] = await sql.query<{ r: boolean }>(`select public.capture_checkout_lead($1, '{"phone":"+8801712345678"}') as r`, [token]);
      expect(empty).toBe(false);
      await sql.query(`select public.cart_set_item($1, $2, 2)`, [token, v.id]);
      expect(await sql.errorCode(`select public.capture_checkout_lead($1, '{"phone":"12345"}')`, [token])).toBe("22023");
      await sql.query(`select public.capture_checkout_lead($1, $2::jsonb)`, [token, JSON.stringify({ name: "Rahim <b>", phone: "+8801712345678", district: "Dhaka" })]);
      await sql.query(`select public.capture_checkout_lead($1, $2::jsonb)`, [token, JSON.stringify({ name: "Rahim Uddin", phone: "+8801712345678", district: "Dhaka", address_line: "House 4" })]);
      expect(await sql.errorCode(`select * from public.checkout_leads`)).toBe("42501"); // anon: no grant

      await switchActor(sql, staff(analyst));
      expect(await sql.query(`select id from public.checkout_leads`)).toHaveLength(0);

      await switchActor(sql, staff(support));
      const leads = await sql.query<{ id: string; name: string; item_count: number; status: string }>(`select id, name, item_count, status from public.checkout_leads where phone = '+8801712345678' and address_line = 'House 4'`);
      expect(leads).toHaveLength(1);
      expect(leads[0]!.name).toBe("Rahim Uddin");
      expect(leads[0]!.item_count).toBe(2);
      // support_agent has no orders.fulfill: the update silently matches nothing.
      await sql.query(`update public.checkout_leads set status = 'contacted' where id = $1`, [leads[0]!.id]);
      await switchActor(sql, staff(adminUser));
      expect((await sql.query<{ status: string }>(`select status from public.checkout_leads where id = $1`, [leads[0]!.id]))[0]!.status).toBe("open");
      await sql.query(`update public.checkout_leads set status = 'contacted', staff_note = 'Called' where id = $1`, [leads[0]!.id]);
      expect((await sql.query<{ status: string }>(`select status from public.checkout_leads where id = $1`, [leads[0]!.id]))[0]!.status).toBe("contacted");
      // Columns outside the grant cannot be changed.
      expect(await sql.errorCode(`update public.checkout_leads set phone = '+8801812345678' where id = $1`, [leads[0]!.id])).toBe("42501");
    });
  });
});

describe("home slides", () => {
  it("visitors see only switched-on slides inside their schedule; showing one needs cms.publish", async () => {
    await as(staff(editor), async (sql) => {
      await sql.query(`insert into public.home_slides (title, image_path, is_active, position) values ('Live', 'slides/a.webp', true, 900), ('Hidden', 'slides/b.webp', false, 901)`);
      await sql.query(`insert into public.home_slides (title, image_path, is_active, starts_at, position) values ('Later', 'slides/c.webp', true, now() + interval '1 day', 902)`);
      expect(await sql.errorCode(`insert into public.home_slides (title, link_url) values ('Bad', 'javascript:alert(1)')`)).toBe("23514");
      await switchActor(sql, { role: "anon" });
      const titles = (await sql.query<{ title: string }>(`select title from public.home_slides where position >= 900`)).map((r) => r.title);
      expect(titles).toEqual(["Live"]);
      await switchActor(sql, staff(analyst));
      expect(await sql.errorCode(`insert into public.home_slides (title) values ('Nope')`)).toBe("42501");
    });
  });
});

describe("shipping methods", () => {
  it("the cart's method adds its charge to the quote and can forbid cash on delivery", async () => {
    const v = await stockedVariant();
    await as(staff(adminUser), async (sql) => {
      await sql.query(`update public.shipping_methods set is_active = true, fee_adjust_minor = 10000, cod_allowed = false where code = 'express'`);
      await switchActor(sql, { role: "anon" });
      const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
      await sql.query(`select public.cart_set_item($1, $2, 1)`, [token, v.id]);
      const [{ q: base }] = await sql.query<{ q: { shipping_minor: number; shipping_method: string; shipping_methods: unknown[]; cod_available: boolean } }>(`select public.checkout_quote($1, 'Dhaka') as q`, [token]);
      expect(base.shipping_method).toBe("standard");
      expect(base.shipping_methods.length).toBeGreaterThanOrEqual(2);
      expect(await sql.errorCode(`select public.checkout_set_shipping_method($1, 'teleport')`, [token])).toBe("22023");
      await sql.query(`select public.checkout_set_shipping_method($1, 'express')`, [token]);
      const [{ q }] = await sql.query<{ q: { shipping_minor: number; shipping_method: string; cod_available: boolean } }>(`select public.checkout_quote($1, 'Dhaka') as q`, [token]);
      expect(q.shipping_method).toBe("express");
      expect(Number(q.shipping_minor)).toBe(Number(base.shipping_minor) + 10000);
      expect(q.cod_available).toBe(false);
      // Visitors cannot change methods.
      expect(await sql.errorCode(`update public.shipping_methods set fee_adjust_minor = 0`)).toBe("42501");
    });
  });
});

describe("product reviews", () => {
  it("customers submit (held for moderation), the public sees only approved reviews without user ids", async () => {
    const v = await stockedVariant();
    await as(staff(customer), async (sql) => {
      expect(await sql.errorCode(`select public.submit_product_review($1, 9, '', 'Out of range rating here.', 'Rahim U.')`, [v.product_id])).toBe("23514");
      const [{ s }] = await sql.query<{ s: string }>(`select public.submit_product_review($1, 5, 'Great', 'Lovely fabric and neat stitching.', 'Rahim U.', 'true', 'M') as s`, [v.product_id]);
      expect(s).toBe("pending");
      expect(await sql.errorCode(`select public.submit_product_review($1, 4, '', 'Second review on the same item.', 'Rahim U.')`, [v.product_id])).toBe("23505");
      // A customer cannot approve their own review.
      await sql.query(`update public.product_reviews set status = 'approved' where user_id = $1`, [customer]);

      await switchActor(sql, { role: "anon" });
      const [{ r }] = await sql.query<{ r: { count: number; reviews: Record<string, unknown>[] } }>(`select public.product_reviews_public($1) as r`, [v.product_id]);
      expect(r.reviews.find((x) => x.author_name === "Rahim U.")).toBeUndefined();
      expect(await sql.errorCode(`select * from public.product_reviews`)).toBe("42501");
      expect(await sql.errorCode(`select public.submit_product_review($1, 5, '', 'Anonymous review attempt.', 'Anon')`, [v.product_id])).toBe("42501");

      await switchActor(sql, staff(editor));
      await sql.query(`update public.product_reviews set status = 'approved', is_featured = true where user_id = $1`, [customer]);
      // Featured needs approved (table check).
      expect(await sql.errorCode(`update public.product_reviews set status = 'rejected' where user_id = $1`, [customer])).toBe("23514");

      await switchActor(sql, { role: "anon" });
      const [{ r: after }] = await sql.query<{ r: { reviews: Record<string, unknown>[] } }>(`select public.product_reviews_public($1) as r`, [v.product_id]);
      const mine = after.reviews.find((x) => x.author_name === "Rahim U.")!;
      expect(mine).toBeTruthy();
      expect(mine.fit).toBe("true");
      expect(Object.keys(mine)).not.toContain("user_id");
      const [{ f }] = await sql.query<{ f: Record<string, unknown>[] }>(`select public.featured_reviews() as f`);
      expect(f.some((x) => x.author_name === "Rahim U.")).toBe(true);
    });
  });

  it("staff without reviews.moderate cannot read or import reviews; imported reviews are labelled", async () => {
    const v = await stockedVariant();
    await as(staff(analyst), async (sql) => {
      expect(await sql.query(`select id from public.product_reviews`)).toHaveLength(0);
      expect(await sql.errorCode(`insert into public.product_reviews (product_id, author_name, rating, body, source) values ($1, 'X', 5, 'Imported text here.', 'imported')`, [v.product_id])).toBe("42501");
      await switchActor(sql, staff(editor));
      // Moderators cannot forge a customer review.
      expect(await sql.errorCode(`insert into public.product_reviews (product_id, author_name, rating, body, source) values ($1, 'X', 5, 'Pretending to be a customer.', 'customer')`, [v.product_id])).toBe("42501");
      await sql.query(`insert into public.product_reviews (product_id, author_name, rating, body, source, status) values ($1, 'Facebook fan', 5, 'Sent us a message about it.', 'imported', 'approved')`, [v.product_id]);
    });
  });
});

describe("customers", () => {
  it("listing needs customers.read; disabling needs customers.manage and never touches staff", async () => {
    await as(staff(analyst), async (sql) => {
      expect(await sql.errorCode(`select * from public.admin_list_customers()`)).toBe("42501");
      await switchActor(sql, staff(support));
      const rows = await sql.query<{ id: string; is_staff: boolean }>(`select id, is_staff from public.admin_list_customers(null, 200, 0)`);
      expect(rows.some((r) => r.id === customer && !r.is_staff)).toBe(true);
      expect(await sql.errorCode(`select public.admin_set_customer_disabled($1, true, 'spam orders')`, [customer])).toBe("42501");
      await switchActor(sql, staff(adminUser));
      expect(await sql.errorCode(`select public.admin_set_customer_disabled($1, true, 'x')`, [customer])).toBe("22023");
      expect(await sql.errorCode(`select public.admin_set_customer_disabled($1, true, 'not a customer')`, [support])).toBe("22023");
      await sql.query(`select public.admin_set_customer_disabled($1, true, 'repeated fake orders')`, [customer]);
      const [{ d }] = await sql.query<{ d: boolean }>(`select is_disabled as d from public.profiles where id = $1`, [customer]);
      expect(d).toBe(true);
      const audit = await sql.query(`select 1 from public.audit_events where action = 'customer.disable' and entity_id = $1`, [customer]);
      expect(audit).toHaveLength(1);
    });
  });
});

describe("staff profiles", () => {
  it("staff edit only their own profile, with MFA, and the display name follows", async () => {
    await as(staff(support, "aal1"), async (sql) => {
      expect(await sql.errorCode(`select public.staff_save_my_profile('{"display_name":"Sneaky"}')`)).toBe("42501");
      await switchActor(sql, staff(support));
      await sql.query(`select public.staff_save_my_profile($1::jsonb)`, [JSON.stringify({ display_name: "Shila", job_title: "Support", language: "bn" })]);
      expect(await sql.errorCode(`select public.staff_save_my_profile($1::jsonb)`, [JSON.stringify({ display_name: "Shila", avatar_path: `avatars/${adminUser}/x.webp` })])).not.toBeNull();
      const [{ n }] = await sql.query<{ n: string }>(`select display_name as n from public.staff_members where user_id = $1`, [support]);
      expect(n).toBe("Shila");
      expect(await sql.errorCode(`update public.staff_profiles set job_title = 'Owner' where user_id = $1`, [adminUser])).toBe("42501");
      await switchActor(sql, staff(customer));
      expect(await sql.query(`select * from public.staff_profiles`)).toHaveLength(0);
    });
  });
});

describe("API keys and the read-only API", () => {
  it("only super admins create keys; the API checks hash, scope, revocation and expiry", async () => {
    const key = "fbk_test_" + "a".repeat(32);
    const hash = createHash("sha256").update(key).digest("hex");
    await as(staff(adminUser), async (sql) => {
      // admin lacks integrations.manage
      expect(await sql.errorCode(`insert into public.api_keys (name, prefix, key_hash, scopes) values ('x', 'fbk_test', $1, '{products.read}')`, [hash])).toBe("42501");
      await switchActor(sql, staff(superAdmin));
      expect(await sql.errorCode(`insert into public.api_keys (name, prefix, key_hash, scopes) values ('x', 'fbk_test', $1, '{users.write}')`, [hash])).toBe("23514");
      const [{ id }] = await sql.query<{ id: string }>(`insert into public.api_keys (name, prefix, key_hash, scopes) values ('Sheet', 'fbk_test', $1, '{products.read}') returning id`, [hash]);
      await switchActor(sql, { role: "anon" });
      expect(await sql.errorCode(`select * from public.api_keys`)).toBe("42501");
      const [{ d }] = await sql.query<{ d: unknown[] }>(`select public.api_v1_read($1, 'products', null, 5) as d`, [hash]);
      expect(Array.isArray(d)).toBe(true);
      expect(await sql.errorCode(`select public.api_v1_read($1, 'orders')`, [hash])).toBe("42501");
      expect(await sql.errorCode(`select public.api_v1_read($1, 'products')`, ["0".repeat(64)])).toBe("42501");
      await switchActor(sql, staff(superAdmin));
      await sql.query(`update public.api_keys set revoked_at = now() where id = $1`, [id]);
      // A revoked key cannot be revived.
      expect(await sql.query(`update public.api_keys set revoked_at = null where id = $1 returning id`, [id])).toHaveLength(0);
      await switchActor(sql, { role: "anon" });
      expect(await sql.errorCode(`select public.api_v1_read($1, 'products')`, [hash])).toBe("42501");
    });
  });
});

describe("meta pixels and new settings keys", () => {
  it("pixel ids are public through the RPC only; settings keys are validated", async () => {
    await as(staff(superAdmin), async (sql) => {
      expect(await sql.errorCode(`insert into public.meta_pixels (pixel_id, name) values ('abc', 'Bad')`)).toBe("23514");
      await sql.query(`insert into public.meta_pixels (pixel_id, name) values ('123456789012', 'Main')`);
      expect(await sql.errorCode(`select public.admin_update_site_setting('store.social', '{"facebook":"https://evil.example/x"}')`)).toBe("22023");
      expect(await sql.errorCode(`select public.admin_update_site_setting('store.social', '{"twitter":""}')`)).toBe("22023");
      await sql.query(`select public.admin_update_site_setting('store.social', '{"facebook":"https://facebook.com/fabriklo","instagram":"","tiktok":"","youtube":"","whatsapp":"+8801712345678"}')`);
      expect(await sql.errorCode(`select public.admin_update_site_setting('store.invoice', '{"bin":"12","show_sku":true,"packing_slip_prices":false}')`)).toBe("22023");
      expect(await sql.errorCode(`select public.admin_update_site_setting('shipping.courier', '{"default_courier":"dhl"}')`)).toBe("22023");
      // Old keys still go through the original validator.
      expect(await sql.errorCode(`select public.admin_update_site_setting('store.identity', '{"name":"X"}')`)).toBe("22023");
      await switchActor(sql, { role: "anon" });
      const [{ ids }] = await sql.query<{ ids: string[] }>(`select public.active_meta_pixel_ids() as ids`);
      expect(ids).toContain("123456789012");
      expect(await sql.errorCode(`select * from public.meta_pixels`)).toBe("42501");
      const social = await sql.query<{ value: { facebook: string } }>(`select value from public.site_settings where key = 'store.social'`);
      expect(social[0]!.value.facebook).toBe("https://facebook.com/fabriklo");
      expect(await sql.query(`select 1 from public.site_settings where key = 'store.invoice'`)).toHaveLength(0);
      // Order staff can read the invoice settings to print.
      await switchActor(sql, staff(support));
      expect(await sql.query(`select 1 from public.site_settings where key = 'store.invoice'`)).toHaveLength(1);
    });
  });
});
