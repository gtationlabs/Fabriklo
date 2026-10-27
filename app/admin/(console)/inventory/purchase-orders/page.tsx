import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUSES = ["draft", "ordered", "partially_received", "received", "cancelled"] as const;
const LABEL: Record<string, string> = { draft: "Draft", ordered: "Ordered", partially_received: "Partly received", received: "Received", cancelled: "Cancelled" };

export default async function PurchaseOrdersPage({ searchParams }: PageProps<"/admin/inventory/purchase-orders">) {
  const staff = await requireStaff("inventory.read");
  const { status } = await searchParams;
  const filter = typeof status === "string" && (STATUSES as readonly string[]).includes(status) ? status : null;
  const supabase = await createSupabaseServerClient();
  let q = supabase.from("purchase_orders").select("id, number, supplier_name, status, expected_at, created_at, warehouse:warehouses(name), lines:purchase_order_lines(quantity_ordered, quantity_received)").order("created_at", { ascending: false }).limit(100);
  if (filter) q = q.eq("status", filter);
  const { data } = await q;
  type Row = { id: string; number: string; supplier_name: string; status: string; expected_at: string | null; created_at: string; warehouse: { name: string } | null; lines: { quantity_ordered: number; quantity_received: number }[] };
  const rows = (data ?? []) as unknown as Row[];
  const canWrite = staff.permissions.includes("inventory.adjust");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/inventory" className="text-sm text-muted hover:underline">← Inventory</Link>
          <h1 className="font-display text-3xl font-semibold text-espresso">Purchase orders</h1>
          <p className="text-sm text-muted">Stock arrives through a purchase order: ordered → received, each receipt a ledger movement.</p>
        </div>
        {canWrite ? <Link href="/admin/inventory/purchase-orders/new" className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream">New purchase order</Link> : null}
      </header>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/inventory/purchase-orders" className={`rounded-full border px-3 py-1 ${!filter ? "border-espresso bg-espresso text-cream" : "border-line"}`}>All</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/inventory/purchase-orders?status=${s}`} className={`rounded-full border px-3 py-1 ${filter === s ? "border-espresso bg-espresso text-cream" : "border-line"}`}>{LABEL[s]}</Link>
        ))}
      </nav>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm" data-testid="po-table">
          <caption className="sr-only">Purchase orders</caption>
          <thead className="border-b border-line bg-cream text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Number</th>
              <th scope="col" className="px-4 py-3">Supplier</th>
              <th scope="col" className="px-4 py-3">Warehouse</th>
              <th scope="col" className="px-4 py-3">Units</th>
              <th scope="col" className="px-4 py-3">Expected</th>
              <th scope="col" className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No purchase orders yet.</td></tr>
            ) : rows.map((r) => {
              const ordered = r.lines.reduce((s, l) => s + l.quantity_ordered, 0);
              const received = r.lines.reduce((s, l) => s + l.quantity_received, 0);
              return (
                <tr key={r.id} data-number={r.number}>
                  <td className="px-4 py-2 font-mono text-xs"><Link href={`/admin/inventory/purchase-orders/${r.id}`} className="underline">{r.number}</Link></td>
                  <td className="px-4 py-2">{r.supplier_name}</td>
                  <td className="px-4 py-2">{r.warehouse?.name ?? "—"}</td>
                  <td className="px-4 py-2">{received} / {ordered}</td>
                  <td className="px-4 py-2">{r.expected_at ?? "—"}</td>
                  <td className="px-4 py-2">{LABEL[r.status] ?? r.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
