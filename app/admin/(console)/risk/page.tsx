import Link from "next/link";
import { DemoBadge } from "@/components/ui/demo-badge";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

type Row = {
  id: string;
  order_number: string;
  placed_at: string;
  customer_name: string;
  customer_phone: string;
  total_minor: number;
  risk_level: string;
  is_demo: boolean;
  signals: { rule_code: string; level: string; explanation: string }[];
};

export default async function RiskQueuePage() {
  await requireStaff("risk.review");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("orders")
    .select("id, order_number, placed_at, customer_name, customer_phone, total_minor, risk_level, is_demo, signals:risk_signals(rule_code, level, explanation)")
    .eq("risk_review_status", "needs_review")
    .neq("fulfillment_status", "cancelled")
    .order("placed_at", { ascending: true })
    .limit(100);
  const rows = (data ?? []) as Row[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-espresso">Risk review</h1>
        <p className="max-w-2xl text-sm text-muted">
          Orders that automatic rules held back for a quick check (oldest first). The rules only flag patterns such as several orders
          from one number; they never label anyone as fraud. Confirm with the customer, then approve or reject with a reason.
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-line p-8 text-center text-muted">Nothing waiting for review.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => (
            <li key={o.id} className="rounded-lg border border-line bg-white p-4" data-testid="risk-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:underline">{o.order_number}</Link>
                <span className="text-sm text-muted">{dateFmt.format(new Date(o.placed_at))} · {formatBDT(o.total_minor)} · {o.risk_level} risk</span>
              </div>
              <p className="text-sm">{o.customer_name} · {o.customer_phone} {o.is_demo ? <DemoBadge className="ml-1" /> : null}</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                {o.signals.map((s, n) => <li key={n}>{s.explanation}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
