import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/account/forms";
import { Package } from "lucide-react";
import { AccountShell } from "@/components/account/account-shell";
import { EmptyState, Panel, btnPrimary } from "@/components/shop/store-page";
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
    <AccountShell title="My account" current="/account" intro={<>Hello {customer.fullName || customer.email}.</>}>
      <div className="grid gap-8 xl:grid-cols-[1fr_340px]">
        <section aria-labelledby="orders-h">
          <h2 id="orders-h" className="text-[13px] font-semibold uppercase tracking-[0.14em]">Your orders</h2>
          {(orders ?? []).length === 0 ? (
            <div className="mt-4">
              <EmptyState icon={<Package aria-hidden className="h-5 w-5" strokeWidth={1.6} />} title="No orders yet" action={<Link href="/shop" className={btnPrimary}>Start shopping</Link>}>
                Orders you place while signed in appear here.
              </EmptyState>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-[6px] border border-neutral-200">
              <table className="w-full text-left text-[13px]" data-testid="account-orders">
                <thead className="bg-mist text-[11px] uppercase tracking-[0.12em] text-neutral-600">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Order</th>
                    <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Date</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {(orders ?? []).map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-3.5">
                        <Link href={`/account/orders/${o.order_number}`} className="font-medium underline underline-offset-2 hover:no-underline">{o.order_number}</Link>
                        <span className="mt-0.5 block text-neutral-500 sm:hidden">{dateFmt.format(new Date(o.placed_at))}</span>
                      </td>
                      <td className="hidden px-4 py-3.5 text-neutral-600 sm:table-cell">{dateFmt.format(new Date(o.placed_at))}</td>
                      <td className="px-4 py-3.5"><span className="rounded-full bg-mist px-2.5 py-1 text-[12px]">{customerHeadline(o)}</span></td>
                      <td className="px-4 py-3.5 text-right font-medium">{formatBDT(o.total_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <div className="space-y-6">
          <Panel title="Default address" tone="mist">
            {defaultAddress ? (
              <address className="text-[14px] not-italic leading-relaxed text-neutral-700">
                {defaultAddress.recipient_name}, {defaultAddress.phone}<br />
                {defaultAddress.address_line}, {defaultAddress.area}, {defaultAddress.district}
              </address>
            ) : (
              <p className="text-[14px] text-neutral-600">No saved address yet.</p>
            )}
            <Link href="/account/addresses" className="mt-3 inline-block text-[13px] underline underline-offset-4">Manage addresses</Link>
          </Panel>
          <Panel title="Your details">
            <ProfileForm customer={customer} />
          </Panel>
        </div>
      </div>
    </AccountShell>
  );
}
