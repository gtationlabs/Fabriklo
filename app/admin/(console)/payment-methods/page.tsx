import type { Metadata } from "next";
import { Banknote, CreditCard } from "lucide-react";
import { CodForm, OnlineForm } from "@/components/admin/settings-forms";
import { Badge, Card, PageHeader } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { onlinePaymentOffer } from "@/lib/payments";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";

export const metadata: Metadata = { title: "Payment methods" };

export default async function PaymentMethodsPage() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const today = new Date(nowMs());
  const [{ data: settings }, { data: orders }] = await Promise.all([
    supabase.from("site_settings").select("key, value").in("key", ["checkout.cod", "checkout.online"]),
    supabase.from("orders").select("payment_method, total_minor").gte("placed_at", new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString()),
  ]);
  const s = Object.fromEntries(((settings ?? []) as { key: string; value: Record<string, unknown> }[]).map((r) => [r.key, r.value]));
  const cod = { enabled: Boolean(s["checkout.cod"]?.enabled ?? true), max_order_minor: Number(s["checkout.cod"]?.max_order_minor ?? 2000000) };
  const online = { enabled: Boolean(s["checkout.online"]?.enabled ?? true), hold_minutes: Number(s["checkout.online"]?.hold_minutes ?? 30) };
  const offer = onlinePaymentOffer();
  const month = (m: string) => {
    const rows = ((orders ?? []) as { payment_method: string; total_minor: number }[]).filter((o) => o.payment_method === m);
    return `${rows.length} orders · ${formatBDT(rows.reduce((t, o) => t + o.total_minor, 0))} this month`;
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Payment Methods" description="How customers can pay at checkout. Gateway credentials are set in the server environment, never here." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Cash on delivery" icon={<Banknote className="size-5" aria-hidden />} description={month("cod")}>
          <div className="mb-4"><Badge tone={cod.enabled ? "good" : "neutral"}>{cod.enabled ? "Offered at checkout" : "Switched off"}</Badge></div>
          <CodForm cod={cod} />
        </Card>
        <Card title="Online payment (SSLCOMMERZ)" icon={<CreditCard className="size-5" aria-hidden />} description={month("sslcommerz")}>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone={online.enabled ? "good" : "neutral"}>{online.enabled ? "Switched on" : "Switched off"}</Badge>
            {!offer ? <Badge tone="bad">No gateway configured</Badge> : offer.isMock ? <Badge tone="warn">Sandbox mock: no real money</Badge> : offer.isLive ? <Badge tone="good">Live gateway</Badge> : <Badge tone="warn">SSLCOMMERZ sandbox</Badge>}
          </div>
          <p className="mb-4 text-xs text-muted">Cards, bKash, Nagad, Rocket and bank transfer through SSLCOMMERZ. Needs <code>SSLCOMMERZ_STORE_ID</code> and <code>SSLCOMMERZ_STORE_PASSWORD</code> on the server; <code>SSLCOMMERZ_SANDBOX=false</code> switches to live.</p>
          <OnlineForm online={online} />
        </Card>
      </div>
    </div>
  );
}
