import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { nowMs } from "@/lib/time";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PromotionRow } from "@/components/admin/marketing-forms";

export function describeDiscount(p: Pick<PromotionRow, "discount_type" | "discount_value" | "max_discount_minor">) {
  if (p.discount_type === "percent") return `${p.discount_value}% off${p.max_discount_minor ? ` (max ${formatBDT(p.max_discount_minor)})` : ""}`;
  if (p.discount_type === "fixed") return `${formatBDT(p.discount_value)} off`;
  return "Free delivery";
}

export default async function CouponsPage() {
  const staff = await requireStaff("marketing.read");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("promotions").select("*").order("kind").order("priority").order("created_at", { ascending: false });
  const rows = (data ?? []) as PromotionRow[];
  const canManage = staff.permissions.includes("marketing.manage");
  const now = nowMs();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-espresso">Coupons &amp; automatic discounts</h1>
        {canManage ? <Link href="/admin/marketing/coupons/new" className="rounded bg-espresso px-4 py-2 text-sm text-cream">New promotion</Link> : null}
      </div>
      <p className="text-xs text-muted">Discounts are calculated and committed in the database at checkout. A coupon is considered before automatic discounts; non-stackable promotions win by priority, then creation order.</p>
      <table className="w-full text-sm" data-testid="promotions-table">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-2">Name</th><th>Code</th><th>Discount</th><th>Scope</th><th>Rules</th><th>Used</th><th>Status</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-muted">No promotions yet.</td></tr> : null}
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="py-2"><Link href={`/admin/marketing/coupons/${p.id}`} className="font-medium underline-offset-4 hover:underline">{p.name}</Link><span className="block text-xs text-muted">{p.kind}</span></td>
              <td className="font-mono">{p.code ?? "—"}</td>
              <td>{describeDiscount(p)}</td>
              <td>{p.scope}{p.scope !== "order" ? ` (${p.target_ids.length})` : ""}</td>
              <td className="text-xs text-muted">
                {p.min_subtotal_minor ? `min ${formatBDT(p.min_subtotal_minor)} · ` : ""}{p.first_order_only ? "first order · " : ""}{p.once_per_customer ? "once per customer · " : ""}{p.stackable ? "stackable" : "exclusive"}
              </td>
              <td>{p.redemption_count}{p.max_redemptions ? ` / ${p.max_redemptions}` : ""}</td>
              <td>{p.is_active ? (p.ends_at && Date.parse(p.ends_at) < now ? "expired" : "active") : "inactive"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
