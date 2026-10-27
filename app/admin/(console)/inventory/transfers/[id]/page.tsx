import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusForm, TransferForm, type LineDraft } from "@/components/admin/document-forms";
import { setTransferStatus } from "@/app/admin/(console)/inventory/documents/actions";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LABEL: Record<string, string> = { draft: "Draft", sent: "In transit", received: "Received", cancelled: "Cancelled" };

export default async function TransferPage({ params, searchParams }: PageProps<"/admin/inventory/transfers/[id]">) {
  const staff = await requireStaff("inventory.read");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: warehouses }] = await Promise.all([
    supabase
      .from("stock_transfers")
      .select("id, number, status, note, from_warehouse_id, to_warehouse_id, created_at, sent_at, received_at, cancelled_at, from:warehouses!stock_transfers_from_warehouse_id_fkey(name), to:warehouses!stock_transfers_to_warehouse_id_fkey(name), lines:stock_transfer_lines(id, variant_id, quantity, position, variant:product_variants(sku, size, color, product:products(title)))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("is_default", { ascending: false }),
  ]);
  type T = {
    id: string; number: string; status: string; note: string | null; from_warehouse_id: string; to_warehouse_id: string; created_at: string; sent_at: string | null; received_at: string | null; cancelled_at: string | null;
    from: { name: string } | null; to: { name: string } | null;
    lines: { id: string; variant_id: string; quantity: number; position: number; variant: { sku: string; size: string; color: string; product: { title: string } | null } | null }[];
  };
  const t = data as unknown as T | null;
  if (!t) notFound();
  const canWrite = staff.permissions.includes("inventory.adjust");
  const lines: LineDraft[] = [...t.lines].sort((a, b) => a.position - b.position).map((l) => ({ variant_id: l.variant_id, sku: l.variant?.sku ?? "", label: `${l.variant?.product?.title ?? ""} (${l.variant?.color ?? ""} / ${l.variant?.size ?? ""})`, quantity: l.quantity, unit_cost: "" }));
  const units = t.lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <Link href="/admin/inventory/transfers" className="text-sm text-muted hover:underline">← Transfers</Link>
        <h1 className="font-display text-3xl font-semibold text-espresso">{t.number} <span className="ml-2 align-middle text-base font-normal text-muted" data-testid="transfer-status">{LABEL[t.status] ?? t.status}</span></h1>
        <p className="text-sm text-muted">{t.from?.name} → {t.to?.name} · {units} units</p>
        {saved ? <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Draft created. Check the lines, then send it.</p> : null}
      </header>

      {t.status === "draft" && canWrite ? (
        <>
          <TransferForm draft={{ id: t.id, from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id, note: t.note ?? "", lines }} warehouses={warehouses ?? []} />
          <div className="flex flex-wrap gap-6">
            <StatusForm label="Send (stock leaves source)" action={setTransferStatus.bind(null, t.id, "sent")} idempotencyKey={randomUUID()} testId="transfer-send" />
            <StatusForm label="Cancel transfer" danger confirm="Cancel this draft transfer?" action={setTransferStatus.bind(null, t.id, "cancelled")} idempotencyKey={randomUUID()} reasonLabel="Reason (optional)" />
          </div>
        </>
      ) : (
        <section className="rounded border border-line bg-white p-5">
          <h2 className="mb-3 text-lg font-semibold text-espresso">Lines</h2>
          <ul className="divide-y divide-line text-sm">
            {lines.map((l) => (
              <li key={l.variant_id} className="flex justify-between gap-3 py-2"><span><span className="font-mono text-xs">{l.sku}</span> {l.label}</span><span>{l.quantity}</span></li>
            ))}
          </ul>
          {t.note ? <p className="mt-3 text-sm text-muted">Note: {t.note}</p> : null}
        </section>
      )}

      {t.status === "sent" && canWrite ? (
        <div className="flex flex-wrap gap-6">
          <StatusForm label="Mark as received" action={setTransferStatus.bind(null, t.id, "received")} idempotencyKey={randomUUID()} testId="transfer-receive" />
          <StatusForm label="Cancel (return to source)" danger confirm="Cancel this transfer and return the stock to the source warehouse?" action={setTransferStatus.bind(null, t.id, "cancelled")} idempotencyKey={randomUUID()} reasonLabel="Reason (optional)" />
        </div>
      ) : null}

      <dl className="grid gap-2 text-xs text-muted sm:grid-cols-4">
        <div><dt>Created</dt><dd>{new Date(t.created_at).toLocaleString("en-GB")}</dd></div>
        {t.sent_at ? <div><dt>Sent</dt><dd>{new Date(t.sent_at).toLocaleString("en-GB")}</dd></div> : null}
        {t.received_at ? <div><dt>Received</dt><dd>{new Date(t.received_at).toLocaleString("en-GB")}</dd></div> : null}
        {t.cancelled_at ? <div><dt>Cancelled</dt><dd>{new Date(t.cancelled_at).toLocaleString("en-GB")}</dd></div> : null}
      </dl>
    </div>
  );
}
