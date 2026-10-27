import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/account/forms";
import { signOutCustomer } from "./actions";
import { getAddresses, getCustomer } from "@/lib/account/session";
import { formatBDT } from "@/lib/money";
import { customerHeadline } from "@/lib/orders/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My account", robots: { index: false } };
const dateFmt = new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeZone: "Asia/Dhaka" });

export default async function AccountPage() {
  const customer = await getCustomer();
  if (!customer) redirect("/account/login?next=/account");
  const supabase = await createSupabaseServerClient();
  const [{ data: orders }, addresses] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, placed_at, total_minor, fulfillment_status, shipment_status, payment_status")
      .order("placed_at", { ascending: false })
      .limit(50),
    getAddresses(),
  ]);
  const defaultAddress = addresses.find((a) => a.is_default) ?? addresses[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-4xl font-semibold text-espresso">My account</h1>
        <form action={signOutCustomer}><button type="submit" className="text-sm underline">Sign out</button></form>
      </div>
      <p className="mt-1 text-muted">Hello {customer.fullName || customer.email}.</p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="orders-h">
          <h2 id="orders-h" className="font-semibold text-espresso">Your orders</h2>
          {(orders ?? []).length === 0 ? (
            <p className="mt-3 rounded border border-dashed border-line p-6 text-sm text-muted">
              No orders yet. Orders you place while signed in appear here. <Link href="/shop" className="underline">Start shopping</Link>
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded border border-line bg-white" data-testid="account-orders">
              {(orders ?? []).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span>
                    <Link href={`/account/orders/${o.order_number}`} className="font-medium hover:underline">{o.order_number}</Link>
                    <span className="ml-2 text-muted">{dateFmt.format(new Date(o.placed_at))}</span>
                  </span>
                  <span className="rounded-full bg-sand px-2 py-0.5 text-xs">{customerHeadline(o)}</span>
                  <span>{formatBDT(o.total_minor)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-8">
          <section aria-labelledby="addr-h" className="rounded border border-line bg-cream p-5 text-sm">
            <h2 id="addr-h" className="font-semibold text-espresso">Default address</h2>
            {defaultAddress ? (
              <address className="mt-2 not-italic text-muted">
                {defaultAddress.recipient_name}, {defaultAddress.phone}<br />
                {defaultAddress.address_line}, {defaultAddress.area}, {defaultAddress.district}
              </address>
            ) : (
              <p className="mt-2 text-muted">No saved address yet.</p>
            )}
            <Link href="/account/addresses" className="mt-3 inline-block underline">Manage addresses</Link>
          </section>
          <section aria-labelledby="tryon-h" className="rounded border border-line bg-white p-5 text-sm">
            <h2 id="tryon-h" className="font-semibold text-espresso">Virtual try-on</h2>
            <p className="mt-2 text-muted">Photos you upload for try-on stay private and expire automatically.</p>
            <Link href="/account/try-on" className="mt-3 inline-block underline">My try-ons</Link>
          </section>
          <section aria-labelledby="details-h" className="rounded border border-line bg-white p-5">
            <h2 id="details-h" className="mb-3 font-semibold text-espresso">Your details</h2>
            <ProfileForm customer={customer} />
          </section>
        </div>
      </div>
    </div>
  );
}
