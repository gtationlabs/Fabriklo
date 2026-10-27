import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseOrderForm, ReceiveForm, StatusForm, type LineDraft } from "@/components/admin/document-forms";
import { setPurchaseOrderStatus } from "@/app/admin/(console)/inventory/documents/actions";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Detail = {
  id: string; number: string; supplier_name: string; supplier_ref: string | null; warehouse_id: string; warehouse_name: string; status: string;
  expected_at: string | null; note: string | null; created_at: string; ordered_at: string | null; received_at: string | null; cancelled_at: string | null;
  lines: { id: string; variant_id: string; sku: string; size: string; color: string; product_title: string; quantity_ordered: number; quantity_received: number; unit_cost_minor: number | null }[];
};
const LABEL: Record<string, string> = { draft: "Draft", ordered: "Ordered", partially_received: "Partly received", received: "Received", cancelled: "Cancelled" };

export default async function PurchaseOrderPage({ params, searchParams }: PageProps<"/admin/inventory/purchase-orders/[id]">) {
  const staff = await requireStaff("inventory.read");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: warehouses }] = await Promise.all([
    supabase.rpc("admin_po_detail", { p_id: id }),
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("is_default", { ascending: false }),
  ]);
  const po = data as Detail | null;
  if (!po) notFound();
  const canWrite = staff.permissions.includes("inventory.adjust");
  const canCost = staff.permissions.includes("products.costs");
  const lines: LineDraft[] = po.lines.map((l) => ({ variant_id: l.variant_id, sku: l.sku, label: `${l.product_title} (${l.color} / ${l.size})`, quantity: l.quantity_ordered, unit_cost: l.unit_cost_minor != null ? String(l.unit_cost_minor / 100) : "" }));

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <Link href="/admin/inventory/purchase-orders" className="text-sm text-muted hover:underline">← Purchase orders</Link>
        <h1 className="font-display text-3xl font-semibold text-espresso">{po.number} <span className="ml-2 align-middle text-base font-normal text-muted" data-testid="po-status">{LABEL[po.status] ?? po.status}</span></h1>
        <p className="text-sm text-muted">{po.supplier_name}{po.supplier_ref ? ` · ref ${po.supplier_ref}` : ""} · to {po.warehouse_name}{po.expected_at ? ` · expected ${po.expected_at}` : ""}</p>
        {saved ? <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Draft created. Add or adjust lines, then mark it as ordered.</p> : null}
      </header>

      {po.status === "draft" && canWrite ? (
        <>
          <PurchaseOrderForm draft={{ id: po.id, supplier_name: po.supplier_name, supplier_ref: po.supplier_ref ?? "", warehouse_id: po.warehouse_id, expected_at: po.expected_at ?? "", note: po.note ?? "", lines }} warehouses={warehouses ?? []} canCost={canCost} />
          <div className="flex flex-wrap gap-6">
            <StatusForm label="Mark as ordered" action={setPurchaseOrderStatus.bind(null, po.id, "ordered")} testId="po-mark-ordered" />
            <StatusForm label="Cancel purchase order" danger confirm="Cancel this purchase order?" action={setPurchaseOrderStatus.bind(null, po.id, "cancelled")} reasonLabel="Reason (optional)" />
          </div>
        </>
      ) : (
        <section aria-labelledby="lines-heading" className="rounded border border-line bg-white p-5">
          <h2 id="lines-heading" className="mb-3 text-lg font-semibold text-espresso">Lines</h2>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Purchase order lines</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3">SKU</th>
                <th scope="col" className="py-2 pr-3">Item</th>
                <th scope="col" className="py-2 pr-3">Ordered</th>
                <th scope="col" className="py-2 pr-3">Received</th>
                {canCost ? <th scope="col" className="py-2">Unit cost</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3 font-mono text-xs">{l.sku}</td>
                  <td className="py-2 pr-3">{l.product_title} <span className="text-muted">({l.color} / {l.size})</span></td>
                  <td className="py-2 pr-3">{l.quantity_ordered}</td>
                  <td className="py-2 pr-3" data-testid="line-received">{l.quantity_received}</td>
                  {canCost ? <td className="py-2">{l.unit_cost_minor != null ? formatBDT(l.unit_cost_minor) : "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          {po.note ? <p className="mt-3 text-sm text-muted">Note: {po.note}</p> : null}
        </section>
      )}

      {(po.status === "ordered" || po.status === "partially_received") && canWrite ? (
        <section aria-labelledby="receive-heading" className="space-y-4">
          <h2 id="receive-heading" className="text-lg font-semibold text-espresso">Receive stock</h2>
          <ReceiveForm poId={po.id} canCost={canCost} idempotencyKey={randomUUID()} lines={po.lines.map((l) => ({ id: l.id, sku: l.sku, label: `${l.product_title} (${l.color} / ${l.size})`, quantity_ordered: l.quantity_ordered, quantity_received: l.quantity_received, unit_cost_minor: l.unit_cost_minor }))} />
          <StatusForm label="Cancel the remainder" danger confirm="Cancel this purchase order? Received units stay in stock." action={setPurchaseOrderStatus.bind(null, po.id, "cancelled")} reasonLabel="Reason (optional)" />
        </section>
      ) : null}

      <dl className="grid gap-2 text-xs text-muted sm:grid-cols-4">
        <div><dt>Created</dt><dd>{new Date(po.created_at).toLocaleString("en-GB")}</dd></div>
        {po.ordered_at ? <div><dt>Ordered</dt><dd>{new Date(po.ordered_at).toLocaleString("en-GB")}</dd></div> : null}
        {po.received_at ? <div><dt>Received</dt><dd>{new Date(po.received_at).toLocaleString("en-GB")}</dd></div> : null}
        {po.cancelled_at ? <div><dt>Cancelled</dt><dd>{new Date(po.cancelled_at).toLocaleString("en-GB")}</dd></div> : null}
      </dl>
    </div>
  );
}
