import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPaymentProvider } from "@/lib/payments";
import { formatBDT } from "@/lib/money";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Sandbox mock gateway", robots: { index: false, follow: false } };

/**
 * Stand-in for the hosted gateway page, used only when the mock provider is
 * selected. It is deliberately loud about being a mock: no money moves here.
 */
export default async function MockGatewayPage({ params }: PageProps<"/pay/mock/[tranId]">) {
  const provider = getPaymentProvider();
  if (!provider?.isMock) notFound();
  const { tranId } = await params;
  if (!/^FBK-\d{6,10}-\d{1,3}$/.test(tranId)) notFound();
  const { data: tx } = await createSupabaseServiceClient()
    .from("payment_transactions")
    .select("tran_id, amount_minor, currency, status")
    .eq("tran_id", tranId)
    .maybeSingle();
  if (!tx) notFound();
  const open = tx.status === "initiated" || tx.status === "redirected";

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <div role="status" className="rounded border-2 border-dashed border-danger bg-danger/5 p-3 text-sm font-semibold text-danger">
        SANDBOX MOCK GATEWAY — this is not a real payment page and no money moves. It appears only because no SSLCOMMERZ credentials are configured.
      </div>
      <h1 className="mt-6 font-display text-3xl font-semibold text-espresso">Simulate a payment</h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Transaction</dt>
        <dd data-testid="mock-tran-id">{tx.tran_id}</dd>
        <dt className="text-muted">Amount</dt>
        <dd>{formatBDT(Number(tx.amount_minor))} {tx.currency}</dd>
        <dt className="text-muted">State</dt>
        <dd>{tx.status}</dd>
      </dl>
      {!open ? <p className="mt-4 text-sm text-muted">This attempt is already closed.</p> : null}
      <div className="mt-6 grid gap-3">
        <OutcomeButton tranId={tx.tran_id} open={open} outcome="valid" label="Simulate successful payment" cls="bg-espresso text-cream hover:bg-charcoal" />
        <OutcomeButton tranId={tx.tran_id} open={open} outcome="failed" label="Simulate failed payment" cls="border border-line bg-white text-espresso hover:bg-cream" />
        <OutcomeButton tranId={tx.tran_id} open={open} outcome="cancelled" label="Simulate cancel (go back)" cls="border border-line bg-white text-espresso hover:bg-cream" />
      </div>
      <p className="mt-6 text-xs text-muted">
        Each button sends a fake gateway notification through the same server-side validation and settlement path a real SSLCOMMERZ IPN would take.
      </p>
    </div>
  );
}

function OutcomeButton({ tranId, open, outcome, label, cls }: { tranId: string; open: boolean; outcome: string; label: string; cls: string }) {
  return (
    <form method="post" action="/api/payments/mock/complete">
      <input type="hidden" name="tran_id" value={tranId} />
      <input type="hidden" name="outcome" value={outcome} />
      <button type="submit" disabled={!open} className={`w-full rounded px-4 py-3 font-medium disabled:opacity-50 ${cls}`}>
        {label}
      </button>
    </form>
  );
}
