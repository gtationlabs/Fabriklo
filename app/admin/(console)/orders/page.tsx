import Link from "next/link";
import { StatusPill } from "@/components/admin/status-pill";
import { DemoBadge } from "@/components/ui/demo-badge";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VIEWS = {
  open: { label: "To fulfil", apply: (q: Q) => q.in("fulfillment_status", ["unfulfilled", "confirmed", "picking", "packed"]).not("risk_review_status", "in", "(needs_review)") },
  review: { label: "Risk review", apply: (q: Q) => q.eq("risk_review_status", "needs_review") },
  shipping: { label: "On the way", apply: (q: Q) => q.in("shipment_status", ["ready_for_pickup", "handed_to_courier", "in_transit", "out_for_delivery", "delivery_failed", "rto"]) },
  cod: { label: "Cash to collect", apply: (q: Q) => q.eq("shipment_status", "delivered").eq("payment_status", "cod_pending") },
  done: { label: "Completed", apply: (q: Q) => q.eq("shipment_status", "delivered").neq("payment_status", "cod_pending") },
  cancelled: { label: "Cancelled", apply: (q: Q) => q.eq("fulfillment_status", "cancelled") },
  all: { label: "All", apply: (q: Q) => q },
} as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
type Row = {
  id: string;
  order_number: string;
  placed_at: string;
  customer_name: string;
  customer_phone: string;
  total_minor: number;
  payment_method: string;
  payment_status: string;
  fulfillment_status: string;
  shipment_status: string;
  risk_review_status: string;
  is_demo: boolean;
  shipping_address: { district?: string };
};

const PAGE = 50;
const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireStaff("orders.read");
  const sp = await searchParams;
  const view = (typeof sp.view === "string" && sp.view in VIEWS ? sp.view : "open") as keyof typeof VIEWS;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 40) : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select("id, order_number, placed_at, customer_name, customer_phone, total_minor, payment_method, payment_status, fulfillment_status, shipment_status, risk_review_status, is_demo, shipping_address", { count: "exact" })
    .order("placed_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  query = VIEWS[view].apply(query);
  if (q) {
    const digits = q.replace(/\D/g, "");
    if (/^FBK-?\d+$/i.test(q)) query = query.ilike("order_number", `%${q.replace(/\D/g, "")}%`);
    else if (digits.length >= 6) query = query.ilike("customer_phone", `%${digits.slice(-10)}%`);
    else query = query.ilike("customer_name", `%${q.replace(/[%_,()]/g, "")}%`);
  }
  const { data, count, error } = await query;
  const rows = (data ?? []) as Row[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (p: Record<string, string | number>) =>
    "/admin/orders?" + new URLSearchParams({ view, ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-espresso">Orders</h1>
          <p className="text-sm text-muted">{count ?? 0} in “{VIEWS[view].label}”.</p>
        </div>
        <form method="get" className="flex gap-2" role="search">
          <input type="hidden" name="view" value={view} />
          <label htmlFor="order-q" className="sr-only">Search orders</label>
          <input id="order-q" name="q" defaultValue={q} placeholder="Order no., phone or name" className="rounded border border-line bg-white px-3 py-2 text-sm" />
          <button className="rounded bg-espresso px-3 py-2 text-sm text-cream">Search</button>
        </form>
      </header>
      <nav aria-label="Order views" className="flex flex-wrap gap-2">
        {Object.entries(VIEWS).map(([key, v]) => (
          <Link
            key={key}
            href={`/admin/orders?view=${key}`}
            aria-current={key === view ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${key === view ? "border-espresso bg-espresso text-cream" : "border-line bg-white"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {error ? <p role="alert" className="text-danger">Could not load orders.</p> : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Orders</caption>
          <thead className="border-b border-line bg-cream text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Order</th>
              <th scope="col" className="px-4 py-3">Placed</th>
              <th scope="col" className="px-4 py-3">Customer</th>
              <th scope="col" className="px-4 py-3">Total</th>
              <th scope="col" className="px-4 py-3">Fulfilment</th>
              <th scope="col" className="px-4 py-3">Shipment</th>
              <th scope="col" className="px-4 py-3">Payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No orders here.</td></tr>
            ) : rows.map((o) => (
              <tr key={o.id} data-testid="order-row">
                <td className="px-4 py-2">
                  <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">{o.order_number}</Link>
                  {o.risk_review_status === "needs_review" ? <span className="ml-2"><StatusPill status="needs_review" /></span> : null}
                  {o.is_demo ? <DemoBadge className="ml-2" /> : null}
                </td>
                <td className="px-4 py-2 text-muted">{dateFmt.format(new Date(o.placed_at))}</td>
                <td className="px-4 py-2">{o.customer_name}<span className="block text-xs text-muted">{o.customer_phone} · {o.shipping_address?.district}</span></td>
                <td className="px-4 py-2">{formatBDT(o.total_minor)}</td>
                <td className="px-4 py-2"><StatusPill status={o.fulfillment_status} /></td>
                <td className="px-4 py-2"><StatusPill status={o.shipment_status} /></td>
                <td className="px-4 py-2"><StatusPill status={o.payment_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex gap-3 text-sm">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="underline">Previous</Link> : null}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="underline">Next</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
