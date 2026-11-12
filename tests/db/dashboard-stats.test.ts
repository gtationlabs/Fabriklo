import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createStaff, createUser, deleteUsers } from "./helpers";

type Stats = {
  days: number;
  scope: Record<string, boolean>;
  sales?: { revenue_minor: number; daily: { d: string; revenue_minor: number }[] };
  orders?: { recent: { total_minor: number | null }[]; daily: unknown[] };
  activity?: unknown[];
  customers?: { total: number };
  inventory?: unknown;
};

const users: string[] = [];
const staff: Record<string, string> = {};
let customer: string;

beforeAll(async () => {
  for (const role of ["super_admin", "admin", "store_manager", "support_agent", "catalog_manager"]) {
    staff[role] = await createStaff(role);
    users.push(staff[role]);
  }
  customer = await createUser("dashboard-customer");
  users.push(customer);
});
afterAll(async () => {
  await deleteUsers(users);
});

async function statsFor(sub: string, days = 30): Promise<Stats> {
  return as({ role: "authenticated", sub, aal: "aal2" }, async (sql) => {
    const [{ s }] = await sql.query<{ s: Stats }>(`select public.admin_dashboard_stats($1) as s`, [days]);
    return s;
  });
}

describe("admin_dashboard_stats", () => {
  it("gives owners and admins every section", async () => {
    for (const role of ["super_admin", "admin"]) {
      const s = await statsFor(staff[role]);
      expect(Object.values(s.scope).every(Boolean)).toBe(true);
      for (const key of ["sales", "orders", "risk", "catalog", "inventory", "customers", "reviews", "activity"]) expect(s).toHaveProperty(key);
      expect(s.sales!.daily).toHaveLength(30);
    }
  });

  it("gives a store manager store figures but not the team audit log", async () => {
    const s = await statsFor(staff.store_manager);
    expect(s.sales).toBeDefined();
    expect(s.orders).toBeDefined();
    expect(s.inventory).toBeDefined();
    expect(s.activity).toBeUndefined();
    expect(s.scope.activity).toBe(false);
  });

  it("never shows money to support staff", async () => {
    const s = await statsFor(staff.support_agent);
    expect(s.scope.sales).toBe(false);
    expect(s.sales).toBeUndefined();
    expect(s.inventory).toBeUndefined();
    expect(s.activity).toBeUndefined();
    expect(s.orders).toBeDefined();
    expect(s.customers).toBeDefined();
    for (const r of s.orders!.recent) expect(r.total_minor).toBeNull();
  });

  it("shows a catalogue manager only catalogue and stock", async () => {
    const s = await statsFor(staff.catalog_manager);
    expect(Object.keys(s).filter((k) => !["days", "from", "to", "generated_at", "scope"].includes(k)).sort()).toEqual(["catalog", "inventory"]);
  });

  it("clamps the window and refuses non-staff", async () => {
    expect((await statsFor(staff.super_admin, 5000)).days).toBe(365);
    expect((await statsFor(staff.super_admin, 0)).days).toBe(1);
    await as({ role: "authenticated", sub: customer, aal: "aal2" }, async (sql) => {
      expect(await sql.errorCode(`select public.admin_dashboard_stats(30)`)).toBe("42501");
    });
    await as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select public.admin_dashboard_stats(30)`)).toBe("42501");
    });
  });
});
