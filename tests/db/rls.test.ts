import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, createUser, deleteUsers, oneVariant, pool } from "./helpers";

const DENIED = "42501"; // insufficient_privilege (also raised for RLS WITH CHECK failures)

let customerA: string;
let customerB: string;
const staff: Record<string, string> = {};
let suspendedCatalog: string;
let orderForA: string;
const users: string[] = [];

beforeAll(async () => {
  customerA = await createUser("customer-a");
  customerB = await createUser("customer-b");
  users.push(customerA, customerB);
  for (const role of [
    "super_admin",
    "admin",
    "catalog_manager",
    "inventory_manager",
    "order_manager",
    "support_agent",
    "marketing_manager",
    "content_editor",
    "analyst",
  ]) {
    staff[role] = await createStaff(role);
    users.push(staff[role]);
  }
  suspendedCatalog = await createStaff("catalog_manager", "suspended");
  users.push(suspendedCatalog);

  const rows = await admin<{ id: string }>(
    `insert into public.orders (user_id, idempotency_key, customer_name, customer_phone, shipping_address,
       subtotal_minor, total_minor, payment_method, payment_status, is_demo)
     values ($1, $2, 'Test A', '+8801712345678', '{"district":"Dhaka"}', 1000, 1000, 'cod', 'cod_pending', true)
     returning id`,
    [customerA, `test-${randomUUID()}`],
  );
  orderForA = rows[0].id;
});

afterAll(async () => {
  await admin(`set session_replication_role = replica`);
  await admin(`delete from public.order_status_events where order_id = $1`, [orderForA]);
  await admin(`delete from public.orders where id = $1`, [orderForA]);
  await admin(`set session_replication_role = origin`);
  await deleteUsers(users);
  await pool.end();
});

describe("anonymous visitors", () => {
  it("see only published products, never drafts", async () => {
    await as({ role: "anon" }, async (sql) => {
      const rows = await sql.query<{ slug: string; status: string }>(`select slug, status from public.products`);
      expect(rows.length).toBeGreaterThanOrEqual(20);
      expect(rows.every((r) => r.status === "active")).toBe(true);
      expect(rows.find((r) => r.slug === "unreleased-draft-jacket")).toBeUndefined();
      const draftVariants = await sql.query(
        `select v.id from public.product_variants v where v.sku ilike 'UNRELEAS%'`,
      );
      expect(draftVariants).toHaveLength(0);
    });
  });

  it.each([
    "variant_costs",
    "stock_balances",
    "stock_movements",
    "inventory_reservations",
    "orders",
    "order_items",
    "carts",
    "cart_items",
    "staff_members",
    "role_permissions",
    "audit_events",
    "profiles",
    "addresses",
    "tryon_jobs",
  ])("cannot read %s at all", async (table) => {
    await as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`select * from public.${table} limit 1`)).toBe(DENIED);
    });
  });

  it("cannot write catalog or call privileged functions", async () => {
    const v = await oneVariant("p.status = 'active'");
    await as({ role: "anon" }, async (sql) => {
      expect(await sql.errorCode(`insert into public.products (slug, title) values ('hack', 'Hack')`)).toBe(DENIED);
      expect(await sql.errorCode(`update public.product_variants set price_minor = 1`)).toBe(DENIED);
      expect(
        await sql.errorCode(
          `select public.admin_adjust_stock($1, (select id from public.warehouses limit 1), 5, 'adjust', 'test', 'idem-anon-1')`,
          [v.id],
        ),
      ).toBe(DENIED);
      expect(await sql.errorCode(`select public.release_expired_reservations(10)`)).toBe(DENIED);
      expect(await sql.errorCode(`select private.has_permission('products.write')`)).toBe(DENIED);
    });
  });

  it("sees public availability only for published variants", async () => {
    const pub = await oneVariant("p.status = 'active'");
    const draft = await oneVariant("p.status = 'draft'");
    await as({ role: "anon" }, async (sql) => {
      const rows = await sql.query<{ variant_id: string }>(
        `select * from public.get_variant_availability($1::uuid[])`,
        [[pub.id, draft.id]],
      );
      expect(rows.map((r) => r.variant_id)).toEqual([pub.id]);
    });
  });
});

describe("customers", () => {
  it("read and edit only their own profile, and cannot flip protected columns", async () => {
    await as({ role: "authenticated", sub: customerA }, async (sql) => {
      const rows = await sql.query<{ id: string }>(`select id from public.profiles`);
      expect(rows.map((r) => r.id)).toEqual([customerA]);
      const updated = await sql.query(`update public.profiles set full_name = 'Renamed' where id = $1 returning id`, [
        customerB,
      ]);
      expect(updated).toHaveLength(0);
      expect(await sql.errorCode(`update public.profiles set is_disabled = true where id = $1`, [customerA])).toBe(
        DENIED,
      );
    });
  });

  it("cannot see or modify another customer's addresses", async () => {
    await admin(
      `insert into public.addresses (user_id, recipient_name, phone, division, district, area, address_line)
       values ($1, 'A Person', '+8801711111111', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 1, Road 2')`,
      [customerA],
    );
    await as({ role: "authenticated", sub: customerB }, async (sql) => {
      expect(await sql.query(`select * from public.addresses`)).toHaveLength(0);
      expect(await sql.query(`update public.addresses set area = 'x' where user_id = $1 returning id`, [customerA])).toHaveLength(0);
      expect(
        await sql.errorCode(
          `insert into public.addresses (user_id, recipient_name, phone, division, district, area, address_line)
           values ($1, 'Evil', '+8801711111111', 'Dhaka', 'Dhaka', 'Gulshan', 'Somewhere 123')`,
          [customerA],
        ),
      ).toBe(DENIED);
    });
    await as({ role: "authenticated", sub: customerA }, async (sql) => {
      expect(await sql.query(`select * from public.addresses`)).toHaveLength(1);
    });
    await admin(`delete from public.addresses where user_id = $1`, [customerA]);
  });

  it("see their own orders only", async () => {
    await as({ role: "authenticated", sub: customerA }, async (sql) => {
      expect((await sql.query(`select id from public.orders`)).map((r) => r.id)).toEqual([orderForA]);
    });
    await as({ role: "authenticated", sub: customerB }, async (sql) => {
      expect(await sql.query(`select id from public.orders`)).toHaveLength(0);
      expect(await sql.errorCode(`update public.orders set payment_status = 'paid'`)).toBe(DENIED);
    });
  });

  it("have no staff powers even with an aal2 session", async () => {
    await as({ role: "authenticated", sub: customerA, aal: "aal2" }, async (sql) => {
      expect(await sql.errorCode(`insert into public.products (slug, title) values ('cust-hack', 'Hack')`)).toBe(DENIED);
      expect(await sql.query(`select * from public.products where status = 'draft'`)).toHaveLength(0);
      expect(await sql.query(`select * from public.variant_costs`)).toHaveLength(0);
      expect(await sql.query(`select * from public.staff_members`)).toHaveLength(0);
      expect(
        await sql.errorCode(`insert into public.staff_members (user_id, role_code) values ($1, 'super_admin')`, [customerA]),
      ).toBe(DENIED);
      const ctx = await sql.query<{ c: { is_staff: boolean; permissions: string[] } }>(
        `select public.my_staff_context() as c`,
      );
      expect(ctx[0].c.is_staff).toBe(false);
      expect(ctx[0].c.permissions).toEqual([]);
    });
  });
});

describe("staff RBAC and MFA", () => {
  it("catalog manager without MFA (aal1) has no write or draft access", async () => {
    await as({ role: "authenticated", sub: staff.catalog_manager, aal: "aal1" }, async (sql) => {
      expect(await sql.query(`select * from public.products where status = 'draft'`)).toHaveLength(0);
      expect(await sql.errorCode(`insert into public.products (slug, title) values ('aal1-try', 'AAL1 try')`)).toBe(DENIED);
    });
  });

  it("catalog manager with MFA can create products, see drafts and costs, but not adjust stock", async () => {
    const v = await oneVariant("p.status = 'active'");
    await as({ role: "authenticated", sub: staff.catalog_manager, aal: "aal2" }, async (sql) => {
      expect(await sql.query(`select * from public.products where slug = 'unreleased-draft-jacket'`)).toHaveLength(1);
      const created = await sql.query<{ created_by: string }>(
        `insert into public.products (slug, title, created_by) values ('rls-test-product', 'RLS test product', $1) returning created_by`,
        [customerA],
      );
      // created_by is stamped server-side; a forged value is ignored.
      expect(created[0].created_by).toBe(staff.catalog_manager);
      expect((await sql.query(`select * from public.variant_costs limit 1`)).length).toBe(1);
      expect(
        await sql.errorCode(
          `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), 5, 'adjust', 'cycle count', 'idem-catalog-1')`,
          [v.id],
        ),
      ).toBe(DENIED);
    });
  });

  it("suspended staff lose access immediately", async () => {
    await as({ role: "authenticated", sub: suspendedCatalog, aal: "aal2" }, async (sql) => {
      expect(await sql.errorCode(`insert into public.products (slug, title) values ('susp-try', 'Suspended')`)).toBe(DENIED);
    });
  });

  it("inventory manager adjusts stock through the RPC only, with ledger + audit", async () => {
    const v = await oneVariant("p.status = 'active'");
    await as({ role: "authenticated", sub: staff.inventory_manager, aal: "aal2" }, async (sql) => {
      expect(await sql.errorCode(`update public.stock_balances set on_hand = 999`)).toBe(DENIED);
      expect(
        await sql.errorCode(
          `insert into public.stock_movements (variant_id, warehouse_id, movement_type, on_hand_after, reserved_after) values ($1, (select id from public.warehouses limit 1), 'adjust', 1, 0)`,
          [v.id],
        ),
      ).toBe(DENIED);
      const key = `idem-${randomUUID()}`;
      const r1 = await sql.query<{ r: { movement_id: number } }>(
        `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), 5, 'receive', 'Supplier delivery', $2) as r`,
        [v.id, key],
      );
      const r2 = await sql.query<{ r: { movement_id: number } }>(
        `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), 5, 'receive', 'Supplier delivery', $2) as r`,
        [v.id, key],
      );
      // Replaying the same idempotency key does not apply twice.
      expect(r2[0].r.movement_id).toBe(r1[0].r.movement_id);
      // No reason → rejected; going negative → rejected; huge adjustment → needs approval permission.
      expect(
        await sql.errorCode(
          `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), 1, 'adjust', '', 'idem-noreason-1')`,
          [v.id],
        ),
      ).toBe("22023");
      expect(
        await sql.errorCode(
          `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), -100000, 'adjust', 'shrinkage', 'idem-neg-12345')`,
          [v.id],
        ),
      ).not.toBeNull();
      expect(
        await sql.errorCode(
          `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), 500, 'receive', 'Big delivery', 'idem-big-12345')`,
          [v.id],
        ),
      ).toBe(DENIED);
    });
    await as({ role: "authenticated", sub: staff.admin, aal: "aal2" }, async (sql) => {
      expect(
        await sql.errorCode(
          `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), 500, 'receive', 'Big delivery approved', 'idem-big-admin-1')`,
          [v.id],
        ),
      ).toBeNull();
      const audit = await sql.query(
        `select * from public.audit_events where action = 'inventory.adjust' and entity_id = $1 and reason = 'Big delivery approved'`,
        [v.id],
      );
      expect(audit).toHaveLength(1);
    });
  });

  it.each([
    ["support_agent", "update public.products set title = 'x'"],
    ["marketing_manager", "update public.products set title = 'x'"],
    ["content_editor", "select * from public.variant_costs"],
    ["analyst", "select * from public.orders"],
  ])("%s is limited by least privilege", async (role, stmt) => {
    await as({ role: "authenticated", sub: staff[role], aal: "aal2" }, async (sql) => {
      if (stmt.startsWith("select")) {
        expect(await sql.query(stmt)).toHaveLength(0);
      } else {
        expect(await sql.query(`${stmt} returning id`)).toHaveLength(0);
      }
    });
  });

  it("support agent cannot adjust stock; marketing cannot read orders or adjust stock", async () => {
    const v = await oneVariant("p.status = 'active'");
    for (const role of ["support_agent", "marketing_manager"]) {
      await as({ role: "authenticated", sub: staff[role], aal: "aal2" }, async (sql) => {
        expect(
          await sql.errorCode(
            `select public.admin_adjust_stock($1, (select id from public.warehouses where is_default), 1, 'adjust', 'test', 'idem-${role}-1')`,
            [v.id],
          ),
        ).toBe(DENIED);
      });
    }
    await as({ role: "authenticated", sub: staff.marketing_manager, aal: "aal2" }, async (sql) => {
      expect(await sql.query(`select * from public.orders`)).toHaveLength(0);
    });
    await as({ role: "authenticated", sub: staff.support_agent, aal: "aal2" }, async (sql) => {
      expect((await sql.query(`select * from public.orders where id = $1`, [orderForA])).length).toBe(1);
    });
  });

  it("staff cannot change their own role; admin cannot grant super_admin", async () => {
    await as({ role: "authenticated", sub: staff.admin, aal: "aal2" }, async (sql) => {
      expect(
        await sql.query(`update public.staff_members set role_code = 'super_admin' where user_id = $1 returning user_id`, [
          staff.admin,
        ]),
      ).toHaveLength(0);
      expect(
        await sql.errorCode(`update public.staff_members set role_code = 'super_admin' where user_id = $1`, [
          staff.analyst,
        ]),
      ).toBe(DENIED);
      expect(
        await sql.errorCode(`update public.staff_members set role_code = 'support_agent' where user_id = $1`, [
          staff.analyst,
        ]),
      ).toBeNull();
    });
    await as({ role: "authenticated", sub: staff.super_admin, aal: "aal2" }, async (sql) => {
      expect(
        await sql.errorCode(`update public.staff_members set role_code = 'super_admin' where user_id = $1`, [
          staff.analyst,
        ]),
      ).toBeNull();
    });
  });

  it("role changes are audited", async () => {
    await as({ role: "authenticated", sub: staff.super_admin, aal: "aal2" }, async (sql) => {
      await sql.query(`update public.staff_members set role_code = 'support_agent' where user_id = $1`, [staff.analyst]);
      const rows = await sql.query(
        `select * from public.audit_events where entity_type = 'staff_members' and entity_id = $1 and actor_id = $2`,
        [staff.analyst, staff.super_admin],
      );
      expect(rows.length).toBe(1);
    });
  });
});

describe("append-only ledgers", () => {
  it("stock movements and audit events cannot be edited even by the owner role", async () => {
    await expect(admin(`update public.stock_movements set reason = 'tamper' where id = (select min(id) from public.stock_movements)`)).rejects.toThrow(/append-only/);
    await expect(admin(`delete from public.stock_movements where id = (select min(id) from public.stock_movements)`)).rejects.toThrow(/append-only/);
  });
});

describe("guest carts (capability token)", () => {
  it("prices from the DB, validates stock, rejects drafts and bad tokens", async () => {
    const inStock = await admin<{ id: string; price_minor: number }>(
      `select v.id, v.price_minor from public.product_variants v join public.products p on p.id = v.product_id
       join public.stock_balances sb on sb.variant_id = v.id
       where p.status = 'active' and sb.on_hand - sb.reserved >= 3 limit 1`,
    );
    const draft = await oneVariant("p.status = 'draft'");
    await as({ role: "anon" }, async (sql) => {
      const [{ token }] = await sql.query<{ token: string }>(`select public.cart_create() as token`);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [{ cart }] = await sql.query<{ cart: { items: { unit_price_minor: number }[]; subtotal_minor: number } }>(
        `select public.cart_set_item($1, $2, 2) as cart`,
        [token, inStock[0].id],
      );
      expect(cart.items[0].unit_price_minor).toBe(inStock[0].price_minor);
      expect(cart.subtotal_minor).toBe(inStock[0].price_minor * 2);
      expect(await sql.errorCode(`select public.cart_set_item($1, $2, 1)`, [token, draft.id])).toBe("22023");
      expect(await sql.errorCode(`select public.cart_set_item($1, $2, 11)`, [token, inStock[0].id])).toBe("22023");
      const other = await sql.query<{ c: unknown }>(`select public.cart_get($1) as c`, ["A".repeat(43)]);
      expect(other[0].c).toBeNull();
      expect(await sql.errorCode(`select public.cart_set_item($1, $2, 1)`, ["nope", inStock[0].id])).toBe("P0002");
    });
  });
});

describe("storage policies for private try-on photos", () => {
  it("only the owner can read their try-on input; nobody can write into another user's folder", async () => {
    const path = `${customerA}/portrait-test.jpg`;
    await admin(
      `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('tryon-inputs', $1, $2, '{"mimetype":"image/jpeg","size":10}')`,
      [path, customerA],
    );
    try {
      await as({ role: "authenticated", sub: customerA }, async (sql) => {
        expect(await sql.query(`select name from storage.objects where bucket_id = 'tryon-inputs'`)).toHaveLength(1);
      });
      await as({ role: "authenticated", sub: customerB }, async (sql) => {
        expect(await sql.query(`select name from storage.objects where bucket_id = 'tryon-inputs'`)).toHaveLength(0);
        expect(
          await sql.errorCode(
            `insert into storage.objects (bucket_id, name, owner_id) values ('tryon-inputs', $1, $2)`,
            [`${customerA}/evil.jpg`, customerB],
          ),
        ).toBe(DENIED);
        expect(
          await sql.errorCode(
            `insert into storage.objects (bucket_id, name, owner_id) values ('tryon-outputs', $1, $2)`,
            [`${customerB}/self-made-result.jpg`, customerB],
          ),
        ).toBe(DENIED);
      });
      await as({ role: "anon" }, async (sql) => {
        expect(await sql.query(`select name from storage.objects where bucket_id like 'tryon-%'`)).toHaveLength(0);
      });
      await as({ role: "authenticated", sub: staff.super_admin, aal: "aal2" }, async (sql) => {
        // Even super admins do not browse customer photos by default.
        expect(await sql.query(`select name from storage.objects where bucket_id = 'tryon-inputs'`)).toHaveLength(0);
      });
    } finally {
      const c = await pool.connect();
      try {
        await c.query("set session_replication_role = replica");
        await c.query(`delete from storage.objects where bucket_id = 'tryon-inputs' and name = $1`, [path]);
        await c.query("set session_replication_role = origin");
      } finally {
        c.release();
      }
    }
  });

  it("only catalog editors with MFA can upload product media", async () => {
    await as({ role: "authenticated", sub: customerA, aal: "aal2" }, async (sql) => {
      expect(
        await sql.errorCode(`insert into storage.objects (bucket_id, name, owner_id) values ('product-media', 'x/evil.png', $1)`, [
          customerA,
        ]),
      ).toBe(DENIED);
    });
    await as({ role: "authenticated", sub: staff.catalog_manager, aal: "aal2" }, async (sql) => {
      expect(
        await sql.errorCode(`insert into storage.objects (bucket_id, name, owner_id) values ('product-media', 'x/ok.png', $1)`, [
          staff.catalog_manager,
        ]),
      ).toBeNull();
    });
  });
});
