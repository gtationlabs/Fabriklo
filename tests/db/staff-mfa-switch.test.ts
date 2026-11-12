import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, createUser, deleteUsers } from "./helpers";

const DENIED = "42501";
const users: string[] = [];
let catalog: string;
let owner: string;
let customer: string;

beforeAll(async () => {
  catalog = await createStaff("catalog_manager");
  owner = await createStaff("super_admin");
  customer = await createUser("mfa-switch-customer");
  users.push(catalog, owner, customer);
});
afterAll(async () => {
  await deleteUsers(users);
});

describe("staff MFA switch", () => {
  it("while off, an aal1 staff session has its role's permissions and my_staff_context says so", async () => {
    await as({ role: "authenticated", sub: catalog, aal: "aal1", staffMfa: false }, async (sql) => {
      const [{ c }] = await sql.query<{ c: { mfa_required: boolean; aal: string; permissions: string[] } }>(`select public.my_staff_context() as c`);
      expect(c.mfa_required).toBe(false);
      expect(c.aal).toBe("aal1");
      expect(c.permissions).toContain("products.write");
      expect(await sql.errorCode(`insert into public.products (slug, title) values ('mfa-off-try', 'MFA off try')`)).toBeNull();
      // Still only what the role allows.
      expect(await sql.errorCode(`select public.admin_set_staff_mfa_required(true)`)).toBe(DENIED);
    });
  });

  it("while off, customers still have no staff powers", async () => {
    await as({ role: "authenticated", sub: customer, aal: "aal1", staffMfa: false }, async (sql) => {
      expect(await sql.errorCode(`insert into public.products (slug, title) values ('mfa-off-cust', 'Nope')`)).toBe(DENIED);
      const [{ c }] = await sql.query<{ c: { is_staff: boolean; permissions: string[] } }>(`select public.my_staff_context() as c`);
      expect(c.is_staff).toBe(false);
      expect(c.permissions).toEqual([]);
    });
  });

  it("while on, the same aal1 session is refused and my_staff_context reports it", async () => {
    await as({ role: "authenticated", sub: catalog, aal: "aal1" }, async (sql) => {
      const [{ c }] = await sql.query<{ c: { mfa_required: boolean } }>(`select public.my_staff_context() as c`);
      expect(c.mfa_required).toBe(true);
      expect(await sql.errorCode(`insert into public.products (slug, title) values ('mfa-on-try', 'MFA on try')`)).toBe(DENIED);
    });
  });

  it("only a super admin can flip it, and the change is audited", async () => {
    await as({ role: "authenticated", sub: owner, aal: "aal2" }, async (sql) => {
      expect((await sql.query<{ r: boolean }>(`select public.admin_set_staff_mfa_required(false) as r`))[0].r).toBe(false);
      // A no-op write is not audited twice.
      await sql.query(`select public.admin_set_staff_mfa_required(false)`);
      const [{ c }] = await sql.query<{ c: { mfa_required: boolean } }>(`select public.my_staff_context() as c`);
      expect(c.mfa_required).toBe(false);
      const audit = await sql.query<{ action: string; before_data: unknown; after_data: unknown }>(
        `select action, before_data, after_data from public.audit_events where actor_id = $1 and action = 'settings.staff_mfa'`, [owner]);
      expect(audit).toEqual([{ action: "settings.staff_mfa", before_data: { staff_mfa_required: true }, after_data: { staff_mfa_required: false } }]);
    });
    // Rolled back: still on for everyone else.
    const [{ v }] = await admin<{ v: boolean }>(`select staff_mfa_required as v from private.security_settings`);
    expect(v).toBe(true);
    await as({ role: "authenticated", sub: catalog, aal: "aal2" }, async (sql) => {
      expect(await sql.errorCode(`select public.admin_set_staff_mfa_required(false)`)).toBe(DENIED);
    });
    await as({ role: "authenticated", sub: owner, aal: "aal1" }, async (sql) => {
      // While on, even a super admin needs aal2 to change it.
      expect(await sql.errorCode(`select public.admin_set_staff_mfa_required(false)`)).toBe(DENIED);
    });
  });

  it("the settings row is not readable or writable through the API roles", async () => {
    await as({ role: "authenticated", sub: owner, aal: "aal2" }, async (sql) => {
      expect(await sql.errorCode(`update private.security_settings set staff_mfa_required = false`)).toBe(DENIED);
    });
    await as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select public.admin_set_staff_mfa_required(false)`)).toBe(DENIED);
    });
  });
});
