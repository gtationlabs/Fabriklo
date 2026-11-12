import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Check } from "lucide-react";
import { StorePage, btnOutline, btnPrimary } from "@/components/shop/store-page";
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
      <StorePage title="No recent order here" width="text" crumbs={[{ label: "Order confirmation" }]} intro="If you placed an order, use the tracking link we showed you after checkout.">
        <p className="text-center"><Link href="/orders/track" className={btnPrimary}>Track an order</Link></p>
      </StorePage>
    );
  }

  const trackUrl = `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/orders/track?order=${encodeURIComponent(order.order_number)}&token=${encodeURIComponent(token)}`;
  return (
    <StorePage eyebrow="Thank you" title="Your order is placed" width="text" crumbs={[{ label: "Order confirmation" }]} intro="We'll confirm by phone before dispatch. Pay in cash when the parcel arrives.">
      <div className="mx-auto -mt-4 mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white"><Check aria-hidden className="h-7 w-7" strokeWidth={2} /></div>
      <div className="rounded-[6px] border border-neutral-200 bg-mist p-4">
        <p className="text-sm font-medium text-espresso">Save your private tracking link</p>
        <p className="mt-1 text-xs text-muted">
          Anyone with this link can see the order status, so keep it to yourself. SMS and email confirmations are not switched on yet.
        </p>
        <CopyLink url={trackUrl} />
      </div>
      <div className="mt-8">
        <OrderTracking order={order} />
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/shop" className={btnPrimary}>Continue shopping</Link>
        <Link href="/account" className={btnOutline}>My account</Link>
      </div>
    </StorePage>
  );
}
