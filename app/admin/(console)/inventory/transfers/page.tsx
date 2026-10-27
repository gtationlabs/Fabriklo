import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LABEL: Record<string, string> = { draft: "Draft", sent: "In transit", received: "Received", cancelled: "Cancelled" };

export default async function TransfersPage() {
  const staff = await requireStaff("inventory.read");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("stock_transfers").select("id, number, status, created_at, from:warehouses!stock_transfers_from_warehouse_id_fkey(name), to:warehouses!stock_transfers_to_warehouse_id_fkey(name), lines:stock_transfer_lines(quantity)").order("created_at", { ascending: false }).limit(100);
  type Row = { id: string; number: string; status: string; created_at: string; from: { name: string } | null; to: { name: string } | null; lines: { quantity: number }[] };
  const rows = (data ?? []) as unknown as Row[];
  const canWrite = staff.permissions.includes("inventory.adjust");
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/inventory" className="text-sm text-muted hover:underline">← Inventory</Link>
          <h1 className="font-display text-3xl font-semibold text-espresso">Stock transfers</h1>
          <p className="text-sm text-muted">Move stock between warehouses: sent (leaves the source) → received (arrives at the destination).</p>
        </div>
        {canWrite ? <Link href="/admin/inventory/transfers/new" className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream">New transfer</Link> : null}
      </header>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm" data-testid="transfer-table">
          <caption className="sr-only">Transfers</caption>
          <thead className="border-b border-line bg-cream text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Number</th>
              <th scope="col" className="px-4 py-3">From</th>
              <th scope="col" className="px-4 py-3">To</th>
              <th scope="col" className="px-4 py-3">Units</th>
              <th scope="col" className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No transfers yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} data-number={r.number}>
                <td className="px-4 py-2 font-mono text-xs"><Link href={`/admin/inventory/transfers/${r.id}`} className="underline">{r.number}</Link></td>
                <td className="px-4 py-2">{r.from?.name ?? "—"}</td>
                <td className="px-4 py-2">{r.to?.name ?? "—"}</td>
                <td className="px-4 py-2">{r.lines.reduce((s, l) => s + l.quantity, 0)}</td>
                <td className="px-4 py-2">{LABEL[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
