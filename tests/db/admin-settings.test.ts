import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, createUser, deleteUsers, pool, switchActor } from "./helpers";

/**
 * Slice 8: theme versions, staff management guards, audit viewer RPCs and
 * validated store settings / shipping zones. Every test runs inside a rolled-back
 * transaction (see helpers.ts).
 */
let superAdmin: string;
let adminUser: string;
let editor: string; // content_editor: cms.edit, no theme.publish
let analyst: string;
let settingsless: string; // order_manager: no settings.manage, no audit.read

beforeAll(async () => {
  superAdmin = await createStaff("super_admin");
  adminUser = await createStaff("admin");
  editor = await createStaff("content_editor");
  analyst = await createStaff("analyst");
  settingsless = await createStaff("order_manager");
});
afterAll(async () => {
  await deleteUsers([superAdmin, adminUser, editor, analyst, settingsless]);
  await pool.end();
});

const staff = (sub: string, aal: "aal1" | "aal2" = "aal2") => ({ role: "authenticated" as const, sub, aal });
const DEFAULT = {
  colors: { cream: "#f6f0e6", paper: "#fbf8f3", sand: "#e7dccb", wood: "#7a5236", bronze: "#9c6b30", bronze_strong: "#7c521f", espresso: "#2b1d14", charcoal: "#2e2b28", muted: "#6b625a", line: "#d9cdbb", danger: "#a1301f", success: "#2f6b3a" },
  fonts: { display: "cormorant", body: "inter" },
  radius: "sm",
};

describe("theme drafts and versions", () => {
  it("visitors see only the published version; the draft is private to editors", () =>
    as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select * from public.themes`)).toBe("42501"); // drafts: no anon grant at all
      // Fresh database: nothing published → null. After a browser run a version may be live: then exactly that one row is readable.
      const [{ published }] = await admin<{ published: string | null }>(`select published_version_id as published from public.themes where key = 'default'`);
      const [{ t }] = await sql.query<{ t: unknown }>(`select public.get_theme() as t`);
      const visible = await sql.query<{ id: string }>(`select id from public.theme_versions`);
      if (published) {
        expect(t).not.toBeNull();
        expect(visible.map((v) => v.id)).toEqual([published]);
      } else {
        expect(t).toBeNull();
        expect(visible).toHaveLength(0);
      }
    }));

  it("rejects invalid tokens (extra keys, bad hex, unknown font) in SQL even from an editor", () =>
    as(staff(editor), async (sql) => {
      const bad = [
        { ...DEFAULT, custom_css: "body{}" },
        { ...DEFAULT, colors: { ...DEFAULT.colors, paper: "#fff" } },
        { ...DEFAULT, colors: { ...DEFAULT.colors, paper: "red" } },
        { ...DEFAULT, fonts: { display: "comic", body: "inter" } },
        { ...DEFAULT, radius: "huge" },
        { ...DEFAULT, colors: { ...DEFAULT.colors, extra: "#000000" } },
      ];
      for (const b of bad) {
        expect(await sql.errorCode(`select public.admin_save_theme_draft($1::jsonb)`, [JSON.stringify(b)])).toBe("22023");
      }
      expect(await sql.errorCode(`select public.admin_save_theme_draft($1::jsonb)`, [JSON.stringify({ ...DEFAULT, radius: "lg" })])).toBeNull();
    }));

  it("editors draft, only theme.publish publishes and rolls back; versions are immutable and audited", () =>
    as(staff(editor), async (sql) => {
      const draft = { ...DEFAULT, colors: { ...DEFAULT.colors, paper: "#ffffff" }, fonts: { display: "playfair", body: "manrope" } };
      await sql.query(`select public.admin_save_theme_draft($1::jsonb)`, [JSON.stringify(draft)]);
      expect(await sql.errorCode(`select public.admin_publish_theme('nope')`)).toBe("42501");

      await switchActor(sql, staff(adminUser));
      const [{ base }] = await sql.query<{ base: number }>(`select coalesce(max(version), 0)::int as base from public.theme_versions where theme_key = 'default'`);
      const [{ r }] = await sql.query<{ r: { version: number; version_id: string } }>(`select public.admin_publish_theme('brighter paper') as r`);
      expect(r.version).toBe(base + 1);
      await switchActor(sql, { role: "anon" });
      const [{ t }] = await sql.query<{ t: typeof DEFAULT }>(`select public.get_theme() as t`);
      expect(t.colors.paper).toBe("#ffffff");
      expect(t.fonts.display).toBe("playfair");

      await switchActor(sql, staff(adminUser));
      await sql.query(`select public.admin_save_theme_draft($1::jsonb)`, [JSON.stringify(DEFAULT)]);
      const [{ r: r2 }] = await sql.query<{ r: { version: number } }>(`select public.admin_publish_theme() as r`);
      expect(r2.version).toBe(base + 2);
      await sql.query(`select public.admin_rollback_theme($1)`, [r.version_id]);
      const [{ live, draftNow }] = await sql.query<{ live: typeof DEFAULT; draftNow: typeof DEFAULT }>(
        `select public.get_theme() as live, (select draft_tokens from public.themes where key = 'default') as "draftNow"`,
      );
      expect(live.colors.paper).toBe("#ffffff");
      expect(draftNow.colors.paper).toBe("#ffffff");
      expect(await sql.errorCode(`update public.theme_versions set note = 'x'`)).not.toBeNull();
      expect(await sql.errorCode(`delete from public.theme_versions`)).not.toBeNull();
      const audit = await sql.query<{ action: string }>(`select action from public.audit_events where entity_type = 'theme' order by id desc limit 5`);
      expect(audit.map((a) => a.action).reverse()).toEqual(["theme.draft", "theme.publish", "theme.draft", "theme.publish", "theme.rollback"]);
    }));

  it("an aal1 session cannot save or publish", () =>
    as(staff(adminUser, "aal1"), async (sql) => {
      expect(await sql.errorCode(`select public.admin_save_theme_draft($1::jsonb)`, [JSON.stringify(DEFAULT)])).toBe("42501");
      expect(await sql.errorCode(`select public.admin_publish_theme()`)).toBe("42501");
    }));
});

describe("staff management guards", () => {
  it("only staff.manage lists staff; the list has emails and MFA facts but no secrets", () =>
    as(staff(analyst), async (sql) => {
      expect(await sql.query(`select * from public.admin_list_staff()`)).toHaveLength(0);
      await switchActor(sql, staff(superAdmin));
      const rows = await sql.query<{ user_id: string; email: string; mfa_enrolled: boolean; is_self: boolean }>(`select * from public.admin_list_staff()`);
      expect(rows.length).toBeGreaterThanOrEqual(5);
      const me = rows.find((r) => r.user_id === superAdmin)!;
      expect(me.is_self).toBe(true);
      expect(me.email).toMatch(/@test\.fabriklo\.local$/);
      expect(me.mfa_enrolled).toBe(false);
      const [{ id }] = await sql.query<{ id: string | null }>(`select public.admin_find_user_by_email($1) as id`, [me.email.toUpperCase()]);
      expect(id).toBe(superAdmin);
      await switchActor(sql, staff(analyst));
      const [{ id: hidden }] = await sql.query<{ id: string | null }>(`select public.admin_find_user_by_email($1) as id`, [me.email]);
      expect(hidden).toBeNull();
    }));

  it("the last active super admin cannot be suspended, demoted or deleted", async () => {
    // Superuser transaction (rolled back): leave exactly one active super admin, then try to remove it.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`update public.staff_members set status = 'suspended' where role_code = 'super_admin' and user_id <> $1`, [superAdmin]);
      for (const stmt of [
        `update public.staff_members set status = 'suspended' where user_id = $1`,
        `update public.staff_members set role_code = 'admin' where user_id = $1`,
        `delete from public.staff_members where user_id = $1`,
      ]) {
        await client.query("savepoint s");
        const code = await client.query(stmt, [superAdmin]).then(() => null, (e: { code?: string; hint?: string }) => `${e.code}:${e.hint}`);
        expect(code).toBe("22023:last_super_admin");
        await client.query("rollback to savepoint s");
      }
      // With a second active super admin the same change is allowed.
      await client.query(`update public.staff_members set status = 'active' where user_id = $1`, [adminUser]);
      await client.query(`update public.staff_members set role_code = 'super_admin' where user_id = $1`, [adminUser]);
      await client.query(`update public.staff_members set status = 'suspended' where user_id = $1`, [superAdmin]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it("an admin cannot touch super admins or their own row; a super admin can; nobody edits self", () =>
    as(staff(adminUser), async (sql) => {
      // role change to super_admin needs a super admin
      expect(await sql.errorCode(`update public.staff_members set role_code = 'super_admin' where user_id = $1`, [analyst])).toBe("42501");
      const self = await sql.query<{ user_id: string }>(`update public.staff_members set role_code = 'analyst' where user_id = $1 returning user_id`, [adminUser]);
      expect(self).toHaveLength(0);
      const ok = await sql.query<{ user_id: string }>(`update public.staff_members set status = 'suspended' where user_id = $1 returning user_id`, [analyst]);
      expect(ok).toHaveLength(1);
      expect(await sql.errorCode(`select public.admin_record_staff_event('staff.mfa_reset', $1)`, [superAdmin])).toBe("42501");
      const [{ can }] = await sql.query<{ can: boolean }>(`select public.admin_can_reset_mfa($1) as can`, [superAdmin]);
      expect(can).toBe(false);
      const [{ can2 }] = await sql.query<{ can2: boolean }>(`select public.admin_can_reset_mfa($1) as can2`, [analyst]);
      expect(can2).toBe(true);
      expect(await sql.errorCode(`select public.admin_record_staff_event('staff.mfa_reset', $1)`, [adminUser])).toBe("22023");
      expect(await sql.errorCode(`select public.admin_record_staff_event('staff.whatever', $1)`, [analyst])).toBe("22023");
      await sql.query(`select public.admin_record_staff_event('staff.mfa_reset', $1, '{"factors_removed": 1}'::jsonb)`, [analyst]);
      const audit = await sql.query<{ actor_id: string; after_data: { factors_removed: number } }>(`select actor_id, after_data from public.audit_events where action = 'staff.mfa_reset' and entity_id = $1`, [analyst]);
      expect(audit[0]!.actor_id).toBe(adminUser);
      expect(audit[0]!.after_data.factors_removed).toBe(1);
    }));

  it("an invited member is staff for the sign-in flow but has no permissions until first aal2 session activates them", async () => {
    const invitee = await createUser("invited");
    await admin(`insert into public.staff_members (user_id, role_code, status, display_name) values ($1, 'admin', 'invited', 'Invited')`, [invitee]);
    try {
      await as(staff(invitee, "aal1"), async (sql) => {
        const [{ ctx }] = await sql.query<{ ctx: { is_staff: boolean; status: string; permissions: string[] } }>(`select public.my_staff_context() as ctx`);
        expect(ctx.is_staff).toBe(true);
        expect(ctx.status).toBe("invited");
        expect(ctx.permissions).toEqual([]);
        const [{ a }] = await sql.query<{ a: boolean }>(`select public.staff_activate_self() as a`);
        expect(a).toBe(false); // aal1: not yet
        expect(await sql.query(`select * from public.products`).then(() => true)).toBe(true);
        expect(await sql.errorCode(`select public.admin_list_staff()`)).toBeNull();
      });
      await as(staff(invitee, "aal2"), async (sql) => {
        const [{ a }] = await sql.query<{ a: boolean }>(`select public.staff_activate_self() as a`);
        expect(a).toBe(true);
        const [{ ctx }] = await sql.query<{ ctx: { status: string; permissions: string[] } }>(`select public.my_staff_context() as ctx`);
        expect(ctx.status).toBe("active");
        expect(ctx.permissions).toContain("staff.manage");
        const [{ again }] = await sql.query<{ again: boolean }>(`select public.staff_activate_self() as again`);
        expect(again).toBe(false);
        expect(await sql.query(`select 1 from public.audit_events where action = 'staff.activate' and entity_id = $1`, [invitee])).toHaveLength(1);
      });
    } finally {
      await deleteUsers([invitee]);
    }
  });
});

describe("audit viewer RPCs", () => {
  it("facets and actors need audit.read", () =>
    as(staff(settingsless), async (sql) => {
      const [{ f }] = await sql.query<{ f: unknown }>(`select public.admin_audit_facets() as f`);
      expect(f).toBeNull();
      expect(await sql.query(`select * from public.admin_audit_actors()`)).toHaveLength(0);
      expect(await sql.query(`select * from public.audit_events limit 1`)).toHaveLength(0);
      await switchActor(sql, staff(adminUser));
      const [{ f: facets }] = await sql.query<{ f: { entity_types: string[]; actions: string[]; total: number } }>(`select public.admin_audit_facets() as f`);
      expect(facets.entity_types).toContain("staff_members");
      expect(facets.total).toBeGreaterThan(0);
      const actors = await sql.query<{ user_id: string; display_name: string }>(`select * from public.admin_audit_actors()`);
      expect(actors.some((a) => a.user_id === adminUser)).toBe(true);
      expect(Object.keys(actors[0]!)).toEqual(["user_id", "display_name", "role_code", "status"]);
    }));
});

describe("store settings and shipping zones", () => {
  it("validates each key in SQL, audits the change and keeps secrets out", () =>
    as(staff(settingsless), async (sql) => {
      expect(await sql.errorCode(`select public.admin_update_site_setting('store.identity', '{"name":"X Store","tagline":"","currency":"BDT","locale":"en-BD"}')`)).toBe("42501");
      await switchActor(sql, staff(adminUser));
      const bad: [string, string][] = [
        ["store.identity", '{"name":"X","tagline":"","currency":"BDT","locale":"en-BD"}'],
        ["store.identity", '{"name":"X Store","tagline":"","currency":"USD","locale":"en-BD"}'],
        ["store.identity", '{"name":"<b>Store</b>","tagline":"","currency":"BDT","locale":"en-BD"}'],
        ["store.contact", '{"email":"nope","phone":"+8801711111111","address":"","hours":"","note":""}'],
        ["store.contact", '{"email":"a@b.co","phone":"01711111111","address":"","hours":"","note":""}'],
        ["checkout.cod", '{"enabled":true,"max_order_minor":100}'],
        ["checkout.cod", '{"enabled":"yes","max_order_minor":500000}'],
        ["checkout.cod", '{"enabled":true,"max_order_minor":500000,"api_key":"x"}'],
        ["checkout.online", '{"enabled":true,"hold_minutes":1000}'],
        ["tryon.limits", '{"enabled":true}'],
        ["automation.webhook_allowlist", '{"hosts":["evil.example"]}'],
      ];
      for (const [k, v] of bad) {
        expect(await sql.errorCode(`select public.admin_update_site_setting($1, $2::jsonb)`, [k, v]), `${k} ${v}`).toBe("22023");
      }
      await sql.query(`select public.admin_update_site_setting('store.identity', '{"name":"Alvic Store","tagline":"Everyday","currency":"BDT","locale":"en-BD"}')`);
      await sql.query(`select public.admin_update_site_setting('checkout.cod', '{"enabled":true,"max_order_minor":1500000}')`);
      await switchActor(sql, { role: "anon" });
      const [{ name }] = await sql.query<{ name: string }>(`select value ->> 'name' as name from public.site_settings where key = 'store.identity'`);
      expect(name).toBe("Alvic Store");
      expect(await sql.query(`select 1 from public.site_settings where key = 'checkout.cod'`)).toHaveLength(0); // not public
      await switchActor(sql, staff(adminUser));
      const audit = await sql.query<{ entity_id: string; before_data: { name: string }; after_data: { name: string } }>(
        `select entity_id, before_data, after_data from public.audit_events where action = 'settings.update' and entity_id = 'store.identity' order by id desc limit 1`,
      );
      expect(audit[0]!.before_data.name).toBe("Fabriklo");
      expect(audit[0]!.after_data.name).toBe("Alvic Store");
    }));

  it("the COD limit setting is what checkout enforces", async () => {
    const [v] = await admin<{ id: string }>(
      `select v.id from public.product_variants v join public.products p on p.id = v.product_id join public.stock_balances b on b.variant_id = v.id
        where p.status = 'active' and v.is_active and v.price_minor > 10000 group by v.id having sum(b.on_hand - b.reserved) > 0 limit 1`,
    );
    await as(staff(adminUser), async (sql) => {
      await sql.query(`select public.admin_update_site_setting('checkout.cod', '{"enabled":true,"max_order_minor":10000}')`);
      await switchActor(sql, { role: "anon" });
      const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
      await sql.query(`select public.cart_set_item($1, $2, 1)`, [token, v!.id]);
      const [{ q }] = await sql.query<{ q: { cod_max_order_minor: number } }>(`select public.checkout_quote($1, 'Dhaka') as q`, [token]);
      expect(Number(q.cod_max_order_minor)).toBe(10000);
    });
  });

  it("saves zones atomically: fallback swap, district uniqueness, validation", () =>
    as(staff(adminUser), async (sql) => {
      const zones = await sql.query<{ id: string; code: string; is_fallback: boolean; districts: string[] }>(`select id, code, is_fallback, districts from public.shipping_zones where is_active order by position`);
      const fallback = zones.find((z) => z.is_fallback)!;
      const dhaka = zones.find((z) => z.districts.includes("Dhaka"))!;
      expect(fallback && dhaka).toBeTruthy();

      // District already covered → refused with a hint.
      let code = await sql.errorCode(`select public.admin_save_shipping_zone($1::jsonb)`, [JSON.stringify({ code: "dup", name: "Dup zone", districts: ["Dhaka"], fee_minor: 5000 })]);
      expect(code).toBe("22023");
      // Active non-fallback zone without districts → refused.
      code = await sql.errorCode(`select public.admin_save_shipping_zone($1::jsonb)`, [JSON.stringify({ code: "empty", name: "Empty zone", districts: [], fee_minor: 5000 })]);
      expect(code).toBe("22023");
      // Bad district characters → refused.
      code = await sql.errorCode(`select public.admin_save_shipping_zone($1::jsonb)`, [JSON.stringify({ code: "x1", name: "Bad", districts: ["<script>"], fee_minor: 5000 })]);
      expect(code).toBe("22023");
      // Fee out of range → table CHECK.
      code = await sql.errorCode(`select public.admin_save_shipping_zone($1::jsonb)`, [JSON.stringify({ code: "x2", name: "Pricey", districts: ["Sylhet"], fee_minor: 99999999 })]);
      expect(code).toBe("23514");

      // New zone that takes over as fallback: the old fallback is demoted in the same statement.
      const [{ z }] = await sql.query<{ z: { id: string; is_fallback: boolean } }>(
        `select to_jsonb(public.admin_save_shipping_zone($1::jsonb)) as z`,
        [JSON.stringify({ code: "rest-of-bd", name: "Rest of Bangladesh", districts: [], is_fallback: true, fee_minor: 15000, free_over_minor: 800000, estimate_min_days: 2, estimate_max_days: 5 })],
      );
      expect(z.is_fallback).toBe(true);
      const fallbacks = await sql.query<{ id: string }>(`select id from public.shipping_zones where is_fallback and is_active`);
      expect(fallbacks.map((f) => f.id)).toEqual([z.id]);
      // Turning the only fallback off is refused.
      code = await sql.errorCode(`select public.admin_save_shipping_zone($1::jsonb)`, [JSON.stringify({ id: z.id, code: "rest-of-bd", name: "Rest of Bangladesh", districts: [], is_fallback: false, fee_minor: 15000 })]);
      expect(code).toBe("22023");
      // Fee change is what the public quote uses.
      await sql.query(`select public.admin_save_shipping_zone($1::jsonb)`, [JSON.stringify({ id: dhaka.id, code: dhaka.code, name: "Inside Dhaka", districts: dhaka.districts, fee_minor: 9900, free_over_minor: null })]);
      await switchActor(sql, { role: "anon" });
      const [{ fee }] = await sql.query<{ fee: number }>(`select fee_minor as fee from public.shipping_zones where id = $1`, [dhaka.id]);
      expect(Number(fee)).toBe(9900);
      await switchActor(sql, staff(settingsless));
      expect(await sql.errorCode(`select public.admin_save_shipping_zone($1::jsonb)`, [JSON.stringify({ id: dhaka.id, code: dhaka.code, name: "Hack", districts: dhaka.districts, fee_minor: 0 })])).toBe("42501");
    }));
});
