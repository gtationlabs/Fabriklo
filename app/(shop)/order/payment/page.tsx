import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyLink } from "@/components/orders/copy-link";
import { OrderTracking } from "@/components/orders/order-tracking";
import { lastOrderFromCookie, trackOrder } from "@/lib/checkout/service";
import { publicEnv } from "@/lib/env";
import { onlinePaymentOffer } from "@/lib/payments";
import { getPaymentState } from "@/lib/payments/service";
import { formatBDT } from "@/lib/money";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

/**
 * Lands the customer after the gateway (or the mock). It shows whatever the
 * database says, never what the redirect claimed.
 */
export default async function PaymentResultPage({ searchParams }: PageProps<"/order/payment">) {
  const { error } = await searchParams;
  const receipt = await lastOrderFromCookie();
  const state = receipt ? await getPaymentState(receipt.orderNumber, receipt.token) : null;

  if (!receipt || !state) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="font-display text-3xl font-semibold text-espresso">No recent order here</h1>
        <p className="mt-3 text-muted">If you placed an order, use the tracking link we showed you after checkout, or check your account.</p>
        <Link href="/orders/track" className="mt-6 inline-block rounded bg-espresso px-5 py-2.5 text-cream">Track an order</Link>
      </div>
    );
  }
  if (state.payment_method === "cod") redirect("/order/success");

  const trackUrl = `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/orders/track?order=${encodeURIComponent(state.order_number)}&token=${encodeURIComponent(receipt.token)}`;
  const offer = onlinePaymentOffer();
  const attempt = state.last_attempt?.status ?? null;
  const cancelled = state.fulfillment_status === "cancelled" || state.payment_status === "failed";

  if (state.payment_status === "paid" || state.payment_status === "refunded" || state.payment_status === "partially_refunded") {
    const order = await trackOrder(receipt.orderNumber, receipt.token);
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="text-sm font-medium uppercase tracking-widest text-bronze">Thank you</p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-espresso" data-testid="payment-headline">Payment received</h1>
        <p className="mt-3 text-muted">
          {formatBDT(state.total_minor)} was paid{state.last_attempt?.provider === "mock" ? " through the sandbox mock gateway (no real money moved)" : ""}. We&apos;ll confirm your order and dispatch it soon.
        </p>
        <div className="mt-6 rounded border border-bronze/40 bg-white p-4">
          <p className="text-sm font-medium text-espresso">Save your private tracking link</p>
          <p className="mt-1 text-xs text-muted">Anyone with this link can see the order status, so keep it to yourself.</p>
          <CopyLink url={trackUrl} />
        </div>
        {order ? <div className="mt-8"><OrderTracking order={order} /></div> : null}
        <Link href="/shop" className="mt-8 inline-block underline">Continue shopping</Link>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-4xl font-semibold text-espresso" data-testid="payment-headline">This order has expired</h1>
        <p className="mt-3 text-muted">
          Order {state.order_number} was not paid in time, so the items were released back to stock. Nothing was charged. You can order again from the shop.
        </p>
        <Link href="/shop" className="mt-6 inline-block rounded bg-espresso px-5 py-2.5 text-cream">Back to the shop</Link>
      </div>
    );
  }

  const pending = attempt === "initiated" || attempt === "redirected";
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso" data-testid="payment-headline">
        {pending ? "Waiting for your payment" : "Payment not completed"}
      </h1>
      <p className="mt-3 text-muted">
        Order {state.order_number} ({formatBDT(state.total_minor)}) is reserved for you while payment is pending.{" "}
        {pending
          ? "If you just paid, give it a moment and refresh this page: we confirm every payment with the gateway before marking it paid."
          : attempt === "cancelled"
            ? "You cancelled on the gateway page. Nothing was charged."
            : "The gateway reported the payment as failed. Nothing was charged."}
      </p>
      {error ? <p role="alert" className="mt-4 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {offer ? (
          <form method="post" action="/order/payment/retry">
            <button type="submit" className="rounded bg-espresso px-5 py-2.5 font-medium text-cream hover:bg-charcoal">
              {pending ? "Start payment again" : "Try paying again"}
            </button>
          </form>
        ) : null}
        <Link href="/order/payment" className="rounded border border-line px-5 py-2.5 font-medium text-espresso hover:bg-cream">Refresh status</Link>
      </div>
      {offer?.isMock ? <p className="mt-3 text-xs text-danger">Payments run through a sandbox mock here: no real money moves.</p> : null}
      <p className="mt-6 text-sm text-muted">
        Your tracking link: <Link href={trackUrl} className="underline break-all">{trackUrl}</Link>
      </p>
    </div>
  );
}
