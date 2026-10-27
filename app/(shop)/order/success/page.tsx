import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { OrderTracking } from "@/components/orders/order-tracking";
import { CopyLink } from "@/components/orders/copy-link";
import { LAST_ORDER_COOKIE, trackOrder } from "@/lib/checkout/service";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Order placed", robots: { index: false } };

export default async function OrderSuccessPage() {
  const raw = (await cookies()).get(LAST_ORDER_COOKIE)?.value ?? "";
  const [orderNumber = "", token = ""] = raw.split(".");
  const order = raw ? await trackOrder(orderNumber, token) : null;

  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="font-display text-3xl font-semibold text-espresso">No recent order here</h1>
        <p className="mt-3 text-muted">If you placed an order, use the tracking link we showed you after checkout.</p>
        <Link href="/orders/track" className="mt-6 inline-block rounded bg-espresso px-5 py-2.5 text-cream">Track an order</Link>
      </div>
    );
  }

  const trackUrl = `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/orders/track?order=${encodeURIComponent(order.order_number)}&token=${encodeURIComponent(token)}`;
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-widest text-bronze">Thank you</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-espresso">Your order is placed</h1>
      <p className="mt-3 text-muted">
        We&apos;ll confirm by phone before dispatch. Pay in cash when the parcel arrives.
      </p>
      <div className="mt-6 rounded border border-bronze/40 bg-white p-4">
        <p className="text-sm font-medium text-espresso">Save your private tracking link</p>
        <p className="mt-1 text-xs text-muted">
          Anyone with this link can see the order status, so keep it to yourself. SMS and email confirmations are not switched on yet.
        </p>
        <CopyLink url={trackUrl} />
      </div>
      <div className="mt-8">
        <OrderTracking order={order} />
      </div>
      <Link href="/shop" className="mt-8 inline-block underline">Continue shopping</Link>
    </div>
  );
}
