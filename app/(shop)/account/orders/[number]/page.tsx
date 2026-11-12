import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrderTracking } from "@/components/orders/order-tracking";
import { AccountShell } from "@/components/account/account-shell";
import { getCustomer } from "@/lib/account/session";
import { trackOrder } from "@/lib/checkout/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

export default async function AccountOrderPage({ params }: PageProps<"/account/orders/[number]">) {
  const customer = await getCustomer();
  const { number } = await params;
  if (!customer) redirect(`/account/login?next=/account/orders/${number}`);
  if (!/^FBK-\d{6,10}$/.test(number)) notFound();
  const supabase = await createSupabaseServerClient();
  // RLS: only the customer's own orders are visible; the token is re-derived server-side.
  const { data: order } = await supabase.from("orders").select("id").eq("order_number", number).maybeSingle();
  if (!order) notFound();
  const { data: token } = await supabase.rpc("my_order_tracking_token", { p_order_id: order.id });
  const tracked = typeof token === "string" ? await trackOrder(number, token) : null;
  if (!tracked) notFound();
  return (
    <AccountShell title={`Order ${number}`} current="/account" crumbs={[{ label: `Order ${number}` }]}>
      <div className="max-w-3xl">
        <OrderTracking order={tracked} />
        <Link href="/account" className="mt-6 inline-block text-[13px] underline underline-offset-4">Back to your orders</Link>
      </div>
    </AccountShell>
  );
}
