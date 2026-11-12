import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/admin/print-button";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { getStoreContact, getStoreIdentity } from "@/lib/settings/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invoice" };

type Address = { recipient_name: string; phone: string; district: string; area: string; address_line: string; postal_code: string | null };
type InvoiceSettings = { legal_name?: string; bin?: string; header_note?: string; footer_note?: string; return_policy?: string; show_sku?: boolean; packing_slip_prices?: boolean };

/** Printable invoice, or packing slip with ?slip=1. Layout set in Settings → Invoice & packing slip. */
export default async function InvoicePage({ params, searchParams }: PageProps<"/admin/orders/[id]/invoice">) {
  const staff = await requireStaff("orders.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const slip = (await searchParams).slip === "1";
  const supabase = await createSupabaseServerClient();
  const [{ data: order }, { data: items }, { data: settings }, identity, contact] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).maybeSingle(),
    supabase.from("order_items").select("id, product_title, sku, size, color, unit_price_minor, quantity, line_total_minor").eq("order_id", id).order("created_at"),
    supabase.from("site_settings").select("key, value").in("key", ["store.invoice", "shipping.courier"]),
    getStoreIdentity(),
    getStoreContact(),
  ]);
  if (!order) notFound();
  const { data: me } = slip ? await supabase.from("staff_profiles").select("show_on_invoices").eq("user_id", staff.userId).maybeSingle() : { data: null };
  const packedBy = me?.show_on_invoices ? staff.displayName : null;
  const s = Object.fromEntries(((settings ?? []) as { key: string; value: Record<string, unknown> }[]).map((r) => [r.key, r.value]));
  const inv = (s["store.invoice"] ?? {}) as InvoiceSettings;
  const courier = (s["shipping.courier"] ?? {}) as { pickup_name?: string; pickup_phone?: string; pickup_address?: string; parcel_note?: string };
  const addr = order.shipping_address as Address;
  const prices = !slip || inv.packing_slip_prices;
  const date = new Date(order.placed_at).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[13px] text-ink print:max-w-none print:p-0" data-testid="invoice">
      <div className="mb-6 flex justify-end gap-2 print:hidden"><PrintButton /></div>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink pb-5">
        <div>
          <p className="font-display text-3xl font-semibold tracking-wide">{identity.name.toUpperCase()}</p>
          {inv.legal_name ? <p>{inv.legal_name}</p> : null}
          {contact?.address ? <p>{contact.address}</p> : null}
          <p>{[contact?.phone, contact?.email].filter(Boolean).join(" · ")}</p>
          {inv.bin ? <p>BIN: {inv.bin}</p> : null}
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-semibold uppercase tracking-widest">{slip ? "Packing slip" : "Invoice"}</h1>
          <p className="mt-1">Order <strong>{order.order_number}</strong></p>
          <p>{date}</p>
          <p>{order.payment_method === "cod" ? "Cash on delivery" : "Paid online"}</p>
        </div>
      </header>
      {inv.header_note ? <p className="mt-4 italic">{inv.header_note}</p> : null}
      <section className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Deliver to</h2>
          <p className="mt-1 font-medium">{addr.recipient_name || order.customer_name}</p>
          <p>{addr.address_line}</p>
          <p>{[addr.area, addr.district, addr.postal_code].filter(Boolean).join(", ")}</p>
          <p>{addr.phone || order.customer_phone}</p>
        </div>
        {slip && (courier.pickup_name || courier.pickup_address) ? (
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">From</h2>
            <p className="mt-1 font-medium">{courier.pickup_name}</p>
            <p>{courier.pickup_address}</p>
            <p>{courier.pickup_phone}</p>
            {courier.parcel_note ? <p className="mt-1 font-medium">{courier.parcel_note}</p> : null}
          </div>
        ) : null}
      </section>
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-ink text-left text-[11px] uppercase tracking-widest text-neutral-500">
            <th className="py-2">Item</th>{inv.show_sku !== false ? <th>SKU</th> : null}<th>Size / colour</th><th className="text-right">Qty</th>
            {prices ? <><th className="text-right">Price</th><th className="text-right">Total</th></> : null}
            {slip ? <th className="w-10 text-right">✓</th> : null}
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((i) => (
            <tr key={i.id} className="border-b border-neutral-200">
              <td className="py-2">{i.product_title}</td>{inv.show_sku !== false ? <td className="font-mono text-[12px]">{i.sku}</td> : null}<td>{i.size} / {i.color}</td><td className="text-right">{i.quantity}</td>
              {prices ? <><td className="text-right">{formatBDT(i.unit_price_minor)}</td><td className="text-right">{formatBDT(i.line_total_minor)}</td></> : null}
              {slip ? <td className="text-right">☐</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {prices ? (
        <dl className="ml-auto mt-4 w-64 space-y-1">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBDT(order.subtotal_minor)}</dd></div>
          {order.discount_minor ? <div className="flex justify-between"><dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ""}</dt><dd>−{formatBDT(order.discount_minor)}</dd></div> : null}
          <div className="flex justify-between"><dt>Delivery{order.shipping_method_code ? ` (${order.shipping_method_code})` : ""}</dt><dd>{formatBDT(order.shipping_minor)}</dd></div>
          <div className="flex justify-between border-t border-ink pt-1 text-base font-semibold"><dt>{order.payment_method === "cod" ? "To collect" : "Total"}</dt><dd>{formatBDT(order.total_minor)}</dd></div>
        </dl>
      ) : null}
      {order.customer_note ? <p className="mt-6"><strong>Customer note:</strong> {order.customer_note}</p> : null}
      <footer className="mt-10 space-y-2 border-t border-neutral-300 pt-4 text-[12px] text-neutral-600">
        {inv.return_policy ? <p>{inv.return_policy}</p> : null}
        {inv.footer_note ? <p className="font-medium text-ink">{inv.footer_note}</p> : null}
        {packedBy ? <p>Packed by {packedBy}</p> : null}
      </footer>
    </div>
  );
}
