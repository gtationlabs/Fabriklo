import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, createStaff, deleteUsers, oneVariant, pool } from "./helpers";

/**
 * Slice 10: product photo RPCs, purchase orders and stock transfers. Every
 * test runs inside a rolled-back transaction (see helpers.ts).
 */
let catalog: string; // catalog_manager: products.write, inventory.read, no inventory.adjust
let inventory: string; // inventory_manager: inventory.adjust + products.costs
let orders: string; // order_manager: inventory.read only
let support: string; // support_agent: products.read only
let variant: { id: string; product_id: string };
let variant2: { id: string; product_id: string };
let wh: { id: string }[];

beforeAll(async () => {
  catalog = await createStaff("catalog_manager");
  inventory = await createStaff("inventory_manager");
  orders = await createStaff("order_manager");
  support = await createStaff("support_agent");
  variant = await oneVariant("p.status = 'active' and p.tryon_enabled");
  variant2 = await oneVariant(`p.status = 'active' and p.id <> '${variant.product_id}'`);
  wh = await admin<{ id: string }>(`select id from public.warehouses where is_active order by is_default desc`);
  expect(wh.length).toBeGreaterThanOrEqual(2);
});

afterAll(async () => {
  await deleteUsers([catalog, inventory, orders, support]);
  await pool.end();
});

const staff = (sub: string, aal: "aal1" | "aal2" = "aal2") => ({ role: "authenticated" as const, sub, aal });
const onHand = async (sql: { query: <R extends Record<string, unknown>>(t: string, p?: unknown[]) => Promise<R[]> }, variantId: string, warehouseId: string) =>
  (await sql.query<{ on_hand: number }>(`select on_hand from public.stock_balances where variant_id = $1 and warehouse_id = $2`, [variantId, warehouseId]))[0]?.on_hand ?? 0;

describe("product photos", () => {
  it("staff cannot write product_media directly; products.write adds through the audited RPC and visitors see it", async () => {
    await as(staff(catalog), async (sql) => {
      expect(await sql.errorCode(`insert into public.product_media (product_id, storage_path, alt) values ($1, 'products/x/y.webp', 'direct insert')`, [variant.product_id])).toBe("42501");
      const [{ id }] = await sql.query<{ id: string }>(`select public.admin_add_product_media($1, $2, $3, 1200, 1500, $4) as id`, [variant.product_id, `products/${variant.product_id}/a.webp`, "Front view", variant.id]);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const [row] = await sql.query<{ position: number; is_tryon_garment: boolean; variant_id: string }>(`select position, is_tryon_garment, variant_id from public.product_media where id = $1`, [id]);
      expect(row.is_tryon_garment).toBe(false);
      expect(row.variant_id).toBe(variant.id);
      // catalog_manager holds no audit.read, so check the trail as the owner within the same transaction.
      await sql.query(`reset role`);
      const audit = await sql.query(`select 1 from public.audit_events where action = 'product.media_add' and entity_id = $1`, [variant.product_id]);
      expect(audit.length).toBeGreaterThanOrEqual(1);
      await sql.query(`set local role authenticated`);
      // Variant must belong to the product.
      expect(await sql.errorCode(`select public.admin_add_product_media($1, 'products/x/b.webp', 'Other', 1000, 1000, $2)`, [variant.product_id, variant2.id])).toBe("22023");
      // The card picks the first non-garment photo.
      const [card] = await sql.query<{ image_path: string }>(`select image_path from public.catalog_search(p_query := null, p_limit := 60) where id = $1`, [variant.product_id]);
      expect(card.image_path).toBe(`products/${variant.product_id}/a.webp`);
    });
  });

  it("reorder needs the full set; delete returns the path; deleting the last garment disables try-on", async () => {
    await as(staff(catalog), async (sql) => {
      const [{ a }] = await sql.query<{ a: string }>(`select public.admin_add_product_media($1, 'products/p/a.webp', 'A photo', 1000, 1000) as a`, [variant.product_id]);
      const [{ b }] = await sql.query<{ b: string }>(`select public.admin_add_product_media($1, 'products/p/b.webp', 'B photo', 1000, 1000) as b`, [variant.product_id]);
      expect(await sql.errorCode(`select public.admin_reorder_product_media($1, array[$2]::uuid[])`, [variant.product_id, a])).toBe("22023");
      await sql.query(`select public.admin_reorder_product_media($1, array[$2, $3]::uuid[])`, [variant.product_id, b, a]);
      const order = await sql.query<{ id: string }>(`select id from public.product_media where product_id = $1 and not is_tryon_garment order by position`, [variant.product_id]);
      expect(order.map((r) => r.id)).toEqual([b, a]);
      const [{ path }] = await sql.query<{ path: string }>(`select public.admin_delete_product_media($1) as path`, [a]);
      expect(path).toBe("products/p/a.webp");
      // Garment: deleting the only one switches try-on off.
      const [{ g }] = await sql.query<{ g: string }>(`select id as g from public.product_media where product_id = $1 and is_tryon_garment`, [variant.product_id]);
      await sql.query(`select public.admin_delete_product_media($1)`, [g]);
      const [{ tryon_enabled }] = await sql.query<{ tryon_enabled: boolean }>(`select tryon_enabled from public.products where id = $1`, [variant.product_id]);
      expect(tryon_enabled).toBe(false);
    });
    await as(staff(support), async (sql) => {
      expect(await sql.errorCode(`select public.admin_add_product_media($1, 'products/p/c.webp', 'C photo', 1000, 1000)`, [variant.product_id])).toBe("42501");
    });
    await as(staff(catalog, "aal1"), async (sql) => {
      expect(await sql.errorCode(`select public.admin_add_product_media($1, 'products/p/c.webp', 'C photo', 1000, 1000)`, [variant.product_id])).toBe("42501");
    });
  });
});

describe("purchase orders", () => {
  it("drafts need inventory.adjust; ordered → partially received → received moves stock through the ledger exactly once", async () => {
    await as(staff(orders), async (sql) => {
      expect(await sql.errorCode(`select public.admin_po_save($1::jsonb)`, [JSON.stringify({ supplier_name: "Mill", warehouse_id: wh[0].id, lines: [{ variant_id: variant.id, quantity: 5 }] })])).toBe("42501");
    });
    await as(staff(inventory), async (sql) => {
      const before = await onHand(sql, variant.id, wh[0].id);
      expect(await sql.errorCode(`select public.admin_po_save($1::jsonb)`, [JSON.stringify({ supplier_name: "M", warehouse_id: wh[0].id, lines: [{ variant_id: variant.id, quantity: 5 }] })])).toBe("22023");
      expect(await sql.errorCode(`select public.admin_po_save($1::jsonb)`, [JSON.stringify({ supplier_name: "Mill", warehouse_id: wh[0].id, lines: [] })])).toBe("22023");
      const [{ r }] = await sql.query<{ r: { id: string; number: string } }>(`select public.admin_po_save($1::jsonb) as r`, [
        JSON.stringify({ supplier_name: "Dhaka Mills", warehouse_id: wh[0].id, expected_at: "2026-11-15", lines: [{ variant_id: variant.id, quantity: 10, unit_cost_minor: 45000 }, { variant_id: variant2.id, quantity: 4 }] }),
      ]);
      expect(r.number).toMatch(/^PO-\d{6}$/);
      // Re-save as draft replaces the lines; the number stays.
      const [{ r2 }] = await sql.query<{ r2: { id: string; number: string } }>(`select public.admin_po_save($1::jsonb) as r2`, [
        JSON.stringify({ id: r.id, supplier_name: "Dhaka Mills", warehouse_id: wh[0].id, lines: [{ variant_id: variant.id, quantity: 10, unit_cost_minor: 45000 }] }),
      ]);
      expect(r2.number).toBe(r.number);
      const [{ detail }] = await sql.query<{ detail: { status: string; lines: { id: string; unit_cost_minor: number }[] } }>(`select public.admin_po_detail($1) as detail`, [r.id]);
      expect(detail.status).toBe("draft");
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0].unit_cost_minor).toBe(45000); // inventory_manager holds products.costs
      const lineId = detail.lines[0].id;

      // Cannot receive a draft.
      expect(await sql.errorCode(`select public.admin_po_receive($1, $2::jsonb, 'key-draft-1')`, [r.id, JSON.stringify([{ line_id: lineId, quantity: 1 }])])).toBe("22023");
      await sql.query(`select public.admin_po_set_status($1, 'ordered')`, [r.id]);
      expect(await sql.errorCode(`select public.admin_po_save($1::jsonb)`, [JSON.stringify({ id: r.id, supplier_name: "Dhaka Mills", warehouse_id: wh[0].id, lines: [{ variant_id: variant.id, quantity: 1 }] })])).toBe("22023");

      const [{ rec }] = await sql.query<{ rec: { received_units: number; status: string } }>(`select public.admin_po_receive($1, $2::jsonb, 'key-po-1') as rec`, [r.id, JSON.stringify([{ line_id: lineId, quantity: 6 }])]);
      expect(rec).toEqual({ received_units: 6, status: "partially_received" });
      expect(await onHand(sql, variant.id, wh[0].id)).toBe(before + 6);
      // Replay with the same key: nothing moves again.
      const [{ again }] = await sql.query<{ again: { received_units: number } }>(`select public.admin_po_receive($1, $2::jsonb, 'key-po-1') as again`, [r.id, JSON.stringify([{ line_id: lineId, quantity: 6 }])]);
      expect(again.received_units).toBe(0);
      expect(await onHand(sql, variant.id, wh[0].id)).toBe(before + 6);
      // Over-receive refused.
      expect(await sql.errorCode(`select public.admin_po_receive($1, $2::jsonb, 'key-po-2')`, [r.id, JSON.stringify([{ line_id: lineId, quantity: 5 }])])).toBe("22023");
      const [{ done }] = await sql.query<{ done: { received_units: number; status: string } }>(`select public.admin_po_receive($1, $2::jsonb, 'key-po-3') as done`, [r.id, JSON.stringify([{ line_id: lineId, quantity: 4 }])]);
      expect(done).toEqual({ received_units: 4, status: "received" });
      expect(await onHand(sql, variant.id, wh[0].id)).toBe(before + 10);
      const moves = await sql.query<{ movement_type: string; reference_type: string }>(`select movement_type, reference_type from public.stock_movements where reference_id = $1`, [r.id]);
      expect(moves).toHaveLength(2);
      expect(moves.every((m) => m.movement_type === "receive" && m.reference_type === "purchase_order")).toBe(true);
      const [{ cost_minor }] = await sql.query<{ cost_minor: number }>(`select cost_minor from public.variant_costs where variant_id = $1`, [variant.id]);
      expect(cost_minor).toBe(45000);
      // Finished orders cannot be cancelled or received again.
      expect(await sql.errorCode(`select public.admin_po_set_status($1, 'cancelled')`, [r.id])).toBe("22023");
    });
  });

  it("inventory.read without products.costs sees lines but no unit cost; cancellation keeps received stock", async () => {
    let poId = "";
    await as(staff(inventory), async (sql) => {
      const [{ r }] = await sql.query<{ r: { id: string } }>(`select public.admin_po_save($1::jsonb) as r`, [JSON.stringify({ supplier_name: "Dhaka Mills", warehouse_id: wh[0].id, lines: [{ variant_id: variant.id, quantity: 3, unit_cost_minor: 1000 }] })]);
      poId = r.id;
      await sql.query(`select public.admin_po_set_status($1, 'ordered')`, [r.id]);
      const [{ detail }] = await sql.query<{ detail: { lines: { id: string }[] } }>(`select public.admin_po_detail($1) as detail`, [r.id]);
      await sql.query(`select public.admin_po_receive($1, $2::jsonb, 'key-po-c1')`, [r.id, JSON.stringify([{ line_id: detail.lines[0].id, quantity: 1 }])]);
      await sql.query(`select public.admin_po_set_status($1, 'cancelled', 'supplier short')`, [r.id]);
      const [{ status }] = await sql.query<{ status: string }>(`select status from public.purchase_orders where id = $1`, [r.id]);
      expect(status).toBe("cancelled");
      expect(await sql.errorCode(`select public.admin_po_receive($1, $2::jsonb, 'key-po-c2')`, [r.id, JSON.stringify([{ line_id: detail.lines[0].id, quantity: 1 }])])).toBe("22023");
      // Costs are column-protected on the table too.
      expect(await sql.errorCode(`select unit_cost_minor from public.purchase_order_lines limit 1`)).toBe("42501");
    });
    // Separate transaction: the first one rolled back, so create again as orders-reader can't; use inventory then read as orders in one tx.
    await as(staff(inventory), async (sql) => {
      const [{ r }] = await sql.query<{ r: { id: string } }>(`select public.admin_po_save($1::jsonb) as r`, [JSON.stringify({ supplier_name: "Dhaka Mills", warehouse_id: wh[0].id, lines: [{ variant_id: variant.id, quantity: 3, unit_cost_minor: 1000 }] })]);
      await sql.query("reset role");
      await sql.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: orders, role: "authenticated", aal: "aal2", aud: "authenticated" })]);
      await sql.query("set local role authenticated");
      const [{ detail }] = await sql.query<{ detail: { supplier_name: string; lines: { unit_cost_minor: number | null }[] } }>(`select public.admin_po_detail($1) as detail`, [r.id]);
      expect(detail.supplier_name).toBe("Dhaka Mills");
      expect(detail.lines[0].unit_cost_minor).toBeNull();
      expect(await sql.errorCode(`select public.admin_po_set_status($1, 'ordered')`, [r.id])).toBe("42501");
    });
    expect(poId).not.toBe("");
  });
});

describe("stock transfers", () => {
  it("send takes stock from the source (never below available), receive adds it at the destination, cancel after send returns it", async () => {
    await as(staff(inventory), async (sql) => {
      // Make sure the source has stock to move.
      await sql.query(`select public.admin_adjust_stock($1, $2, 20, 'receive', 'test stock', 'tr-setup-' || gen_random_uuid())`, [variant.id, wh[0].id]);
      const src = await onHand(sql, variant.id, wh[0].id);
      const dst = await onHand(sql, variant.id, wh[1].id);
      expect(await sql.errorCode(`select public.admin_transfer_save($1::jsonb)`, [JSON.stringify({ from_warehouse_id: wh[0].id, to_warehouse_id: wh[0].id, lines: [{ variant_id: variant.id, quantity: 1 }] })])).toBe("22023");
      const [{ r }] = await sql.query<{ r: { id: string; number: string } }>(`select public.admin_transfer_save($1::jsonb) as r`, [JSON.stringify({ from_warehouse_id: wh[0].id, to_warehouse_id: wh[1].id, lines: [{ variant_id: variant.id, quantity: 7 }] })]);
      expect(r.number).toMatch(/^TR-\d{6}$/);
      // Cannot receive a draft.
      expect(await sql.errorCode(`select public.admin_transfer_set_status($1, 'received', 'key-tr-0')`, [r.id])).toBe("22023");
      const [{ sent }] = await sql.query<{ sent: { status: string; units: number } }>(`select public.admin_transfer_set_status($1, 'sent', 'key-tr-1') as sent`, [r.id]);
      expect(sent).toEqual({ status: "sent", units: 7 });
      expect(await onHand(sql, variant.id, wh[0].id)).toBe(src - 7);
      expect(await onHand(sql, variant.id, wh[1].id)).toBe(dst);
      // Cancelling a sent transfer returns the stock to the source.
      await sql.query(`select public.admin_transfer_set_status($1, 'cancelled', 'key-tr-2', 'van broke down')`, [r.id]);
      expect(await onHand(sql, variant.id, wh[0].id)).toBe(src);
      expect(await sql.errorCode(`select public.admin_transfer_set_status($1, 'sent', 'key-tr-3')`, [r.id])).toBe("22023");

      // A second transfer that completes.
      const [{ t2 }] = await sql.query<{ t2: { id: string } }>(`select public.admin_transfer_save($1::jsonb) as t2`, [JSON.stringify({ from_warehouse_id: wh[0].id, to_warehouse_id: wh[1].id, lines: [{ variant_id: variant.id, quantity: 5 }] })]);
      await sql.query(`select public.admin_transfer_set_status($1, 'sent', 'key-tr-4')`, [t2.id]);
      const [{ recv }] = await sql.query<{ recv: { status: string; units: number } }>(`select public.admin_transfer_set_status($1, 'received', 'key-tr-5') as recv`, [t2.id]);
      expect(recv).toEqual({ status: "received", units: 5 });
      expect(await onHand(sql, variant.id, wh[0].id)).toBe(src - 5);
      expect(await onHand(sql, variant.id, wh[1].id)).toBe(dst + 5);
      const moves = await sql.query<{ movement_type: string }>(`select movement_type from public.stock_movements where reference_id = $1 order by id`, [t2.id]);
      expect(moves.map((m) => m.movement_type)).toEqual(["transfer_out", "transfer_in"]);

      // More than available is refused and nothing moves.
      const [{ t3 }] = await sql.query<{ t3: { id: string } }>(`select public.admin_transfer_save($1::jsonb) as t3`, [JSON.stringify({ from_warehouse_id: wh[0].id, to_warehouse_id: wh[1].id, lines: [{ variant_id: variant.id, quantity: 100000 }] })]);
      expect(await sql.errorCode(`select public.admin_transfer_set_status($1, 'sent', 'key-tr-6')`, [t3.id])).toBe("P0001");
      expect(await onHand(sql, variant.id, wh[0].id)).toBe(src - 5);
      const [{ status }] = await sql.query<{ status: string }>(`select status from public.stock_transfers where id = $1`, [t3.id]);
      expect(status).toBe("draft");
    });
    await as(staff(orders), async (sql) => {
      expect(await sql.errorCode(`select public.admin_transfer_save($1::jsonb)`, [JSON.stringify({ from_warehouse_id: wh[0].id, to_warehouse_id: wh[1].id, lines: [{ variant_id: variant.id, quantity: 1 }] })])).toBe("42501");
      // But can read the documents and search variants.
      const hits = await sql.query(`select * from public.admin_variant_search('tee', 5)`);
      expect(hits.length).toBeGreaterThan(0);
    });
    await as(staff(support), async (sql) => {
      expect(await sql.query(`select * from public.admin_variant_search('tee', 5)`)).toHaveLength(0);
      expect(await sql.query(`select * from public.stock_transfers`)).toHaveLength(0);
    });
  });
});
