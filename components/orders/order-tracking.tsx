import type { TrackedOrder } from "@/lib/checkout/service";
import { customerHeadline, label } from "@/lib/orders/labels";
import { formatBDT } from "@/lib/money";
import { DemoBadge } from "@/components/ui/demo-badge";

const dateFmt = new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

export function OrderTracking({ order }: { order: TrackedOrder }) {
  return (
    <section aria-labelledby="track-heading" className="rounded border border-line bg-cream p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="track-heading" className="font-display text-2xl font-semibold text-espresso">
          {order.order_number}
        </h2>
        <p className="rounded-full bg-espresso px-3 py-1 text-sm text-cream" data-testid="order-headline">
          {customerHeadline(order)}
        </p>
      </div>
      {order.is_demo ? <DemoBadge className="mt-2" /> : null}
      <p className="mt-2 text-sm text-muted">
        For {order.recipient} · {order.phone_masked} · {order.district}
        {order.estimate ? ` · usually ${order.estimate.min_days}–${order.estimate.max_days} days` : ""}
      </p>

      <ul className="mt-6 space-y-2 text-sm">
        {order.items.map((i, n) => (
          <li key={n} className="flex justify-between gap-3">
            <span>
              {i.title} <span className="text-muted">· {i.size} / {i.color} × {i.quantity}</span>
            </span>
            <span>{formatBDT(i.line_total_minor)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between"><dt>Delivery</dt><dd>{order.shipping_minor === 0 ? "Free" : formatBDT(order.shipping_minor)}</dd></div>
        <div className="flex justify-between font-semibold text-espresso"><dt>Total</dt><dd>{formatBDT(order.total_minor)}</dd></div>
        <div className="flex justify-between text-muted"><dt>Payment</dt><dd>{order.payment_method === "cod" ? "Cash on delivery" : "Online"} · {label(order.payment_status)}</dd></div>
      </dl>

      {order.shipment ? (
        <p className="mt-4 text-sm">
          Courier: {order.shipment.courier}
          {order.shipment.tracking_number ? ` · ${order.shipment.tracking_number}` : ""}
          {order.shipment.tracking_url ? (
            <>
              {" · "}
              <a href={order.shipment.tracking_url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                Courier tracking
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <h3 className="mt-6 font-semibold text-espresso">Timeline</h3>
      <ol className="mt-2 space-y-2 border-l-2 border-line pl-4 text-sm">
        {order.events.map((e, n) => (
          <li key={n}>
            <span className="font-medium">{label(e.status)}</span>{" "}
            <time className="text-muted" dateTime={e.at}>{dateFmt.format(new Date(e.at))}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
