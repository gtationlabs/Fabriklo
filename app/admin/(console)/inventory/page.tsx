import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Row = { variant_id: string; product_id: string; product_title: string; product_status: string; sku: string; size: string; color: string; on_hand: number; reserved: number; available: number; reorder_point: number; alert: string | null };
type Move = { id: number; occurred_at: string; movement_type: string; on_hand_delta: number; reserved_delta: number; on_hand_after: number; reason: string | null; variant: { sku: string } | null };

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  await requireStaff("inventory.read");
  const { all } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: stock }, { data: moves }] = await Promise.all([
    supabase.rpc("admin_variant_stock", { p_only_alerts: all !== "1", p_limit: 300 }),
    supabase.from("stock_movements").select("id, occurred_at, movement_type, on_hand_delta, reserved_delta, on_hand_after, reason, variant:product_variants(sku)").order("id", { ascending: false }).limit(25),
  ]);
  const rows = (stock ?? []) as Row[];

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-3xl font-semibold text-espresso">Inventory</h1>
        <p className="text-sm text-muted">
          {all === "1" ? "All active SKUs." : "SKUs at or below their reorder point."}{" "}
          <Link href={all === "1" ? "/admin/inventory" : "/admin/inventory?all=1"} className="underline">
            {all === "1" ? "Show alerts only" : "Show all SKUs"}
          </Link>
        </p>
        <nav aria-label="Inventory operations" className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/admin/inventory/purchase-orders" className="rounded border border-line px-3 py-1 hover:bg-cream">Purchase orders</Link>
          <Link href="/admin/inventory/transfers" className="rounded border border-line px-3 py-1 hover:bg-cream">Transfers</Link>
        </nav>
      </header>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Stock levels</caption>
          <thead className="border-b border-line bg-cream text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Product</th>
              <th scope="col" className="px-4 py-3">SKU</th>
              <th scope="col" className="px-4 py-3">On hand</th>
              <th scope="col" className="px-4 py-3">Reserved</th>
              <th scope="col" className="px-4 py-3">Available</th>
              <th scope="col" className="px-4 py-3">Alert</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No stock alerts.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.variant_id}>
                <td className="px-4 py-2"><Link href={`/admin/products/${r.product_id}`} className="hover:underline">{r.product_title}</Link> <span className="text-muted">({r.color} / {r.size})</span></td>
                <td className="px-4 py-2 font-mono text-xs">{r.sku}</td>
                <td className="px-4 py-2">{r.on_hand}</td>
                <td className="px-4 py-2">{r.reserved}</td>
                <td className="px-4 py-2 font-semibold">{r.available}</td>
                <td className="px-4 py-2">{r.alert === "out" ? <span className="text-danger">Sold out</span> : r.alert === "low" ? <span className="text-bronze-strong">Low</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="mb-3 text-lg font-semibold text-espresso">Recent movements (append-only ledger)</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-white text-sm">
          {((moves ?? []) as unknown as Move[]).map((m) => (
            <li key={m.id} className="flex flex-wrap gap-x-4 px-4 py-2">
              <span className="text-muted">{new Date(m.occurred_at).toLocaleString("en-GB")}</span>
              <span className="font-mono text-xs">{m.variant?.sku}</span>
              <span>{m.movement_type}</span>
              <span>{m.on_hand_delta >= 0 ? "+" : ""}{m.on_hand_delta} on hand{m.reserved_delta ? `, ${m.reserved_delta >= 0 ? "+" : ""}${m.reserved_delta} reserved` : ""}</span>
              <span className="text-muted">{m.reason}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
