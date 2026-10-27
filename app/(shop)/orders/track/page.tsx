import type { Metadata } from "next";
import { headers } from "next/headers";
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
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Track your order</h1>
      <p className="mt-2 text-sm text-muted">
        Use the private link from your order confirmation, or enter the order number and tracking code from it.
      </p>
      {result ? (
        <div className="mt-8">
          <OrderTracking order={result} />
        </div>
      ) : (
        <form method="get" className="mt-8 space-y-4 rounded border border-line bg-cream p-6">
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
          <button type="submit" className="rounded bg-espresso px-5 py-2.5 text-cream">Find order</button>
        </form>
      )}
    </div>
  );
}
