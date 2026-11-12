import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { StorePage, btnPrimary } from "@/components/shop/store-page";
import { OrderTracking } from "@/components/orders/order-tracking";
import { trackOrder } from "@/lib/checkout/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";

export const metadata: Metadata = { title: "Track your order", robots: { index: false, follow: false } };

export default async function TrackOrderPage({ searchParams }: PageProps<"/orders/track">) {
  const sp = await searchParams;
  const orderNumber = typeof sp.order === "string" ? sp.order.trim().toUpperCase() : "";
  const token = typeof sp.token === "string" ? sp.token.trim() : "";
  let result: Awaited<ReturnType<typeof trackOrder>> = null;
  let message: string | null = null;

  if (orderNumber || token) {
    const rl = await enforceRateLimit(`track:${clientIp(await headers())}`, 20, 10 * 60_000);
    if (!rl.ok) message = "Too many lookups. Please wait a few minutes and try again.";
    else {
      result = await trackOrder(orderNumber, token);
      if (!result) message = "We couldn't find an order with that number and tracking code.";
    }
  }

  return (
    <StorePage title="Track your order" width="text" crumbs={[{ label: "Track an order" }]} intro="Use the private link from your order confirmation, or enter the order number and tracking code from it.">
      {result ? (
        <div>
          <OrderTracking order={result} />
        </div>
      ) : (
        <form method="get" className="mx-auto max-w-md space-y-4 rounded-[6px] border border-neutral-200 bg-mist p-6">
          {message ? (
            <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{message}</p>
          ) : null}
          <div>
            <label htmlFor="order" className="text-sm font-medium">Order number</label>
            <input id="order" name="order" defaultValue={orderNumber} placeholder="FBK-100001" required
              className="mt-1 w-full rounded border border-line bg-white px-3 py-2.5" />
          </div>
          <div>
            <label htmlFor="token" className="text-sm font-medium">Tracking code</label>
            <input id="token" name="token" defaultValue="" autoComplete="off" required
              className="mt-1 w-full rounded border border-line bg-white px-3 py-2.5 font-mono text-sm" />
          </div>
          <button type="submit" className={`${btnPrimary} w-full`}>Find order</button>
          <p className="text-center text-[12px] text-neutral-600">Signed in? Your orders are also in <Link href="/account" className="underline">My account</Link>.</p>
        </form>
      )}
    </StorePage>
  );
}
