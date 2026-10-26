import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagForm, NoteForm, ShipmentForm, TransitionForm } from "@/components/admin/order-forms";
import { StatusPill } from "@/components/admin/status-pill";
import { DemoBadge } from "@/components/ui/demo-badge";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { label, NEXT_STATES } from "@/lib/orders/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

type Address = { recipient_name: string; phone: string; division: string; district: string; area: string; address_line: string; postal_code: string | null; zone: { name: string } | null };

export default async function OrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const staff = await requireStaff("orders.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const can = (p: string) => staff.permissions.includes(p as never);
  const supabase = await createSupabaseServerClient();

  const [{ data: order }, { data: items }, { data: events }, { data: notes }, { data: shipment }, { data: signals }, { data: payments }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).maybeSingle(),
    supabase.from("order_items").select("id, product_title, sku, size, color, unit_price_minor, quantity, line_total_minor").eq("order_id", id).order("created_at"),
    supabase.from("order_status_events").select("id, occurred_at, field, from_value, to_value, actor_kind, reason, customer_visible").eq("order_id", id).order("id"),
    supabase.from("order_notes").select("id, body, created_at").eq("order_id", id).order("id"),
    supabase.from("shipments").select("courier, courier_name, tracking_number, tracking_url").eq("order_id", id).maybeSingle(),
    can("risk.review")
      ? supabase.from("risk_signals").select("id, rule_code, level, explanation, created_at").eq("order_id", id).order("id")
      : Promise.resolve({ data: [] as { id: number; rule_code: string; level: string; explanation: string; created_at: string }[] }),
    supabase.from("payment_transactions").select("id, provider, tran_id, attempt, status, amount_minor, currency, gateway_val_id, bank_tran_id, card_type, gateway_risk_level, settled_at, created_at").eq("order_id", id).order("attempt"),
  ]);
  const txIds = (payments ?? []).map((t) => t.id);
  const { data: payEvents } = txIds.length
    ? await supabase.from("payment_events").select("id, transaction_id, kind, status, created_at").in("transaction_id", txIds).order("id")
    : { data: [] as { id: number; transaction_id: string | null; kind: string; status: string | null; created_at: string }[] };
  if (!order) notFound();
  const addr = order.shipping_address as Address;
  const next = (field: string) => NEXT_STATES[field]?.[order[field] as string] ?? [];
  const cancelled = order.fulfillment_status === "cancelled";

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm"><Link href="/admin/orders" className="underline">Orders</Link></p>
          <h1 className="font-display text-3xl font-semibold text-espresso">
            {order.order_number} {order.is_demo ? <DemoBadge className="align-middle" /> : null}
          </h1>
          <p className="text-sm text-muted">Placed {dateFmt.format(new Date(order.placed_at))} · {order.payment_method === "cod" ? "Cash on delivery" : (payments ?? []).some((t) => t.provider === "mock") ? "Online payment (sandbox mock, not a real payment)" : "Online payment"}</p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="order-statuses">
          <StatusPill status={order.fulfillment_status} />
          <StatusPill status={order.shipment_status} />
          <StatusPill status={order.payment_status} />
          {order.risk_review_status !== "not_required" ? <StatusPill status={order.risk_review_status} /> : null}
        </div>
      </header>

      {order.risk_review_status === "needs_review" ? (
        <p role="status" className="rounded border border-bronze/40 bg-bronze/10 p-3 text-sm text-bronze-strong">
          Automatic checks flagged this order. Signals are hints, not proof: call the customer, then approve, verify or reject with a reason.
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <section aria-labelledby="items-h" className="rounded-lg border border-line bg-white p-5">
            <h2 id="items-h" className="font-semibold text-espresso">Items</h2>
            <ul className="mt-3 divide-y divide-line text-sm">
              {(items ?? []).map((i) => (
                <li key={i.id} className="flex justify-between gap-3 py-2">
                  <span>{i.product_title} <span className="text-muted">· {i.color} / {i.size} · {i.sku} · {formatBDT(i.unit_price_minor)} × {i.quantity}</span></span>
                  <span>{formatBDT(i.line_total_minor)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBDT(order.subtotal_minor)}</dd></div>
              <div className="flex justify-between"><dt>Delivery {addr.zone ? `(${addr.zone.name})` : ""}</dt><dd>{formatBDT(order.shipping_minor)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatBDT(order.total_minor)}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="cust-h" className="rounded-lg border border-line bg-white p-5 text-sm">
            <h2 id="cust-h" className="font-semibold text-espresso">Customer & delivery</h2>
            <p className="mt-2">{order.customer_name} · <a href={`tel:${order.customer_phone}`} className="underline">{order.customer_phone}</a>{order.customer_email ? ` · ${order.customer_email}` : ""}</p>
            <address className="mt-2 not-italic text-muted">
              {addr.address_line}, {addr.area}, {addr.district} ({addr.division} division){addr.postal_code ? ` ${addr.postal_code}` : ""}
            </address>
            {order.customer_note ? <p className="mt-2"><span className="font-medium">Customer note:</span> {order.customer_note}</p> : null}
          </section>

          {order.payment_method !== "cod" || (payments ?? []).length > 0 ? (
            <section aria-labelledby="payments-h" className="rounded-lg border border-line bg-white p-5 text-sm" data-testid="order-payments">
              <h2 id="payments-h" className="font-semibold text-espresso">Payment attempts</h2>
              {(payments ?? []).length === 0 ? <p className="mt-2 text-muted">No payment attempt was started.</p> : null}
              <ul className="mt-3 divide-y divide-line">
                {(payments ?? []).map((t) => (
                  <li key={t.id} className="py-2">
                    <p>
                      <span className="font-medium">Attempt {t.attempt}</span> · {t.provider === "mock" ? "sandbox mock" : t.provider} · {formatBDT(Number(t.amount_minor))} · <StatusPill status={t.status} />
                    </p>
                    <p className="text-xs text-muted">
                      {t.tran_id}{t.gateway_val_id ? ` · val ${t.gateway_val_id}` : ""}{t.bank_tran_id ? ` · bank ${t.bank_tran_id}` : ""}{t.card_type ? ` · ${t.card_type}` : ""}
                      {t.gateway_risk_level === "1" ? " · gateway risk: HIGH" : ""}{t.settled_at ? ` · settled ${dateFmt.format(new Date(t.settled_at))}` : ""}
                    </p>
                    <ul className="mt-1 text-xs text-muted">
                      {(payEvents ?? []).filter((e) => e.transaction_id === t.id).map((e) => (
                        <li key={e.id}>{dateFmt.format(new Date(e.created_at))} · {e.kind}{e.status ? ` · ${e.status}` : ""}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="timeline-h">
            <h2 id="timeline-h" className="mb-2 font-semibold text-espresso">Timeline</h2>
            <ol className="space-y-2 border-l-2 border-line pl-4 text-sm" data-testid="order-timeline">
              {(events ?? []).map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{e.field === "created" ? "Order placed" : `${label(e.field.replace("_status", ""))}: ${label(e.from_value)} → ${label(e.to_value)}`}</span>{" "}
                  <span className="text-muted">· {dateFmt.format(new Date(e.occurred_at))} · {e.actor_kind}{e.customer_visible ? "" : " · internal"}</span>
                  {e.reason ? <span className="block text-muted">“{e.reason}”</span> : null}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="notes-h" className="space-y-3">
            <h2 id="notes-h" className="font-semibold text-espresso">Internal notes</h2>
            <ul className="space-y-2 text-sm">
              {(notes ?? []).map((n) => (
                <li key={n.id} className="rounded border border-line bg-white p-3">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{dateFmt.format(new Date(n.created_at))}</p>
                </li>
              ))}
            </ul>
            <NoteForm orderId={order.id} />
          </section>
        </div>

        <aside className="space-y-4">
          {can("risk.review") && (signals ?? []).length > 0 ? (
            <section aria-labelledby="risk-h" className="rounded border border-line bg-white p-4 text-sm">
              <h2 id="risk-h" className="font-semibold text-espresso">Risk signals ({order.risk_level})</h2>
              <ul className="mt-2 space-y-1">
                {(signals ?? []).map((s) => (
                  <li key={s.id}><span className="font-medium">{s.level}</span>: {s.explanation}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {can("risk.review") ? (
            <TransitionForm orderId={order.id} field="risk_review_status" title="Risk review" current={order.risk_review_status} options={next("risk_review_status")} />
          ) : null}
          {can("orders.fulfill") || can("orders.cancel") ? (
            <TransitionForm
              orderId={order.id}
              field="fulfillment_status"
              title="Fulfilment"
              current={order.fulfillment_status}
              options={next("fulfillment_status").filter((s) => (s === "cancelled" ? can("orders.cancel") : can("orders.fulfill")))}
            />
          ) : null}
          {can("orders.fulfill") && !cancelled ? (
            <>
              <TransitionForm orderId={order.id} field="shipment_status" title="Shipment" current={order.shipment_status} options={next("shipment_status")} />
              <ShipmentForm orderId={order.id} shipment={shipment} />
              <TransitionForm orderId={order.id} field="payment_status" title="Payment" current={order.payment_status} options={next("payment_status")} />
            </>
          ) : null}
          {can("risk.review") && order.risk_review_status === "not_required" && !cancelled ? <FlagForm orderId={order.id} /> : null}
        </aside>
      </div>
    </div>
  );
}
