import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, createUser, deleteUsers, pool, type Sql } from "./helpers";

let editor: string;
let drafter: string;
let customerA: string;
let customerB: string;

beforeAll(async () => {
  editor = await createStaff("content_editor");
  await pool.query(`insert into public.staff_roles (code, name) values ('test_drafter', 'Test drafter') on conflict do nothing`);
  await pool.query(`insert into public.role_permissions values ('test_drafter', 'cms.edit') on conflict do nothing`);
  drafter = await createStaff("test_drafter");
  customerA = await createUser("customer-a");
  customerB = await createUser("customer-b");
});

afterAll(async () => {
  await deleteUsers([editor, drafter, customerA, customerB]);
  await pool.query(`delete from public.role_permissions where role_code = 'test_drafter'`);
  await pool.query(`delete from public.staff_roles where code = 'test_drafter'`);
  await pool.end();
});

const staff = (sub: string) => ({ role: "authenticated" as const, sub, aal: "aal2" as const });
const customer = (sub: string) => ({ role: "authenticated" as const, sub, aal: "aal1" as const });

describe("content pages", () => {
  it("visitors only read published versions, never drafts", () =>
    as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select draft_blocks from public.cms_pages`)).toBeNull();
      const [{ p }] = await sql.query<{ p: { title: string; blocks: unknown[] } }>(`select public.get_page('shipping') as p`);
      expect(p.title).toBe("Shipping & delivery");
      expect(p.blocks.length).toBeGreaterThan(3);
      const [{ none }] = await sql.query(`select public.get_page('does-not-exist') as none`);
      expect(none).toBeNull();
    }));

  it("drafts go live only on publish; rollback restores; editors without cms.publish cannot publish", async () => {
    await as(staff(drafter), async (sql) => {
      await sql.query(`update public.cms_pages set draft_blocks = '[{"type":"paragraph","text":"Draft only"}]' where slug = 'about'`);
      const [{ p }] = await sql.query<{ p: { blocks: { text: string }[] } }>(`select public.get_page('about') as p`);
      expect(p.blocks[0]!.text).not.toBe("Draft only");
      expect(await sql.errorCode(`select public.admin_publish_page((select id from public.cms_pages where slug = 'about'), null)`)).toBe("42501");
      // Cannot flip status by direct update either.
      expect(await sql.errorCode(`update public.cms_pages set status = 'archived' where slug = 'about'`)).toBe("42501");
    });
    await as(staff(editor), async (sql) => {
      await sql.query(`update public.cms_pages set draft_blocks = '[{"type":"paragraph","text":"Draft only"}]' where slug = 'about'`);
      const [{ r }] = await sql.query<{ r: { version: number } }>(`select public.admin_publish_page((select id from public.cms_pages where slug = 'about'), 'test') as r`);
      expect(r.version).toBe(2);
      const [{ p }] = await sql.query<{ p: { blocks: { text: string }[] } }>(`select public.get_page('about') as p`);
      expect(p.blocks[0]!.text).toBe("Draft only");
      const [{ id }] = await sql.query<{ id: string }>(`select v.id from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = 'about' and v.version = 1`);
      await sql.query(`select public.admin_rollback_page($1)`, [id]);
      const [{ p: back }] = await sql.query<{ p: { blocks: { text: string }[]; version: number } }>(`select public.get_page('about') as p`);
      expect(back.version).toBe(1);
      expect(back.blocks[0]!.text).not.toBe("Draft only");
      expect(await sql.errorCode(`update public.cms_page_versions set blocks = '[]'`)).not.toBeNull();
    });
  });

  it("refuses unknown block types, markup and reserved addresses in the database", () =>
    as(staff(editor), async (sql) => {
      const bad = async (blocks: string) => sql.errorCode(`update public.cms_pages set draft_blocks = $1::jsonb where slug = 'about'`, [blocks]);
      expect(await bad(`[{"type":"html","html":"<b>x</b>"}]`)).toBe("23514");
      expect(await bad(`[{"type":"paragraph","text":"<script>alert(1)</script>"}]`)).toBe("23514");
      expect(await bad(`[{"type":"cta","label":"x","href":"javascript:alert(1)"}]`)).toBe("23514");
      expect(await bad(`[{"type":"paragraph","text":"fine"}]`)).toBeNull();
      expect(await sql.errorCode(`insert into public.cms_pages (slug, title) values ('admin', 'Hijack')`)).toBe("23514");
      expect(await sql.errorCode(`insert into public.cms_pages (slug, title) values ('checkout', 'Hijack')`)).toBe("23514");
    }));
});

async function placeOrderAs(sql: Sql) {
  const [{ id: variantId }] = await admin<{ id: string }>(
    `select v.id from public.product_variants v join public.products p on p.id = v.product_id join public.stock_balances b on b.variant_id = v.id
      where p.status = 'active' and v.is_active group by v.id having sum(b.on_hand - b.reserved) >= 3 limit 1`,
  );
  const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
  await sql.query(`select public.cart_set_item($1, $2, 1)`, [token, variantId]);
  const [{ q }] = await sql.query<{ q: { total_minor: number } }>(`select public.checkout_quote($1, 'Dhaka') as q`, [token]);
  const [{ r }] = await sql.query<{ r: { order_id: string; order_number: string; tracking_token: string } }>(
    `select public.create_order($1, $2, $3, $4, 'cod', $5, null) as r`,
    [token, `acct-${randomUUID()}`, { name: "Account Tester", phone: "+8801911111111" }, { district: "Dhaka", area: "Banani", address_line: "House 1, Road 2" }, q.total_minor],
  );
  return r;
}

describe("customer accounts", () => {
  it("orders placed while signed in belong to that customer only", async () => {
    let order: { order_id: string; order_number: string; tracking_token: string };
    await as(customer(customerA), async (sql) => {
      order = await placeOrderAs(sql);
      const mine = await sql.query(`select user_id from public.orders where id = $1`, [order.order_id]);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.user_id).toBe(customerA);
      const [{ t }] = await sql.query<{ t: string }>(`select public.my_order_tracking_token($1) as t`, [order.order_id]);
      expect(t).toBe(order.tracking_token);
      expect(await sql.query(`select id from public.order_items where order_id = $1`, [order.order_id])).toHaveLength(1);
    });
    // Orders are rolled back per test, so B's isolation is proven inside one transaction above
    // by RLS predicates; re-check B sees nothing and can't derive tokens.
    await as(customer(customerB), async (sql) => {
      expect(await sql.query(`select id from public.orders`)).toHaveLength(0);
      const [{ t }] = await sql.query<{ t: string | null }>(`select public.my_order_tracking_token(gen_random_uuid()) as t`);
      expect(t).toBeNull();
    });
  });

  it("customers cannot see each other's orders even in the same transaction", () =>
    as(customer(customerA), async (sql) => {
      const order = await placeOrderAs(sql);
      await sql.query("reset role");
      await sql.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: customerB, role: "authenticated", aal: "aal1", aud: "authenticated" })]);
      await sql.query("set local role authenticated");
      expect(await sql.query(`select id from public.orders where id = $1`, [order.order_id])).toHaveLength(0);
      const [{ t }] = await sql.query<{ t: string | null }>(`select public.my_order_tracking_token($1) as t`, [order.order_id]);
      expect(t).toBeNull();
    }));

  it("addresses are private and only one can be the default", () =>
    as(customer(customerA), async (sql) => {
      const row = (label: string, def: boolean) =>
        sql.query(`insert into public.addresses (user_id, label, recipient_name, phone, division, district, area, address_line, is_default) values ($1, $2, 'Amina', '+8801711111111', 'Dhaka', 'Dhaka', 'Gulshan', 'House 9, Road 10', $3)`, [customerA, label, def]);
      await row("Home", true);
      expect(await sql.errorCode(`insert into public.addresses (user_id, label, recipient_name, phone, division, district, area, address_line, is_default) values ($1, 'Office', 'Amina', '+8801711111111', 'Dhaka', 'Dhaka', 'Gulshan', 'House 9, Road 10', true)`, [customerA])).toBe("23505");
      expect(await sql.errorCode(`insert into public.addresses (user_id, label, recipient_name, phone, division, district, area, address_line) values ($1, 'Spoof', 'Babul', '+8801711111111', 'Dhaka', 'Dhaka', 'Gulshan', 'House 9, Road 10')`, [customerB])).toBe("42501");
      await sql.query("reset role");
      await sql.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: customerB, role: "authenticated", aal: "aal1", aud: "authenticated" })]);
      await sql.query("set local role authenticated");
      expect(await sql.query(`select id from public.addresses`)).toHaveLength(0);
    }));

  it("customers can only change their own name, phone and marketing flag", () =>
    as(customer(customerA), async (sql) => {
      expect(await sql.errorCode(`update public.profiles set full_name = 'New Name' where id = $1`, [customerA])).toBeNull();
      expect(await sql.errorCode(`update public.profiles set is_disabled = false where id = $1`, [customerA])).toBe("42501");
      expect(await sql.query(`update public.profiles set full_name = 'x' where id = $1 returning id`, [customerB])).toHaveLength(0);
    }));
});
