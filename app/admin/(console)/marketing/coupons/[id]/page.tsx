import { notFound } from "next/navigation";
import { PromotionForm, type PromotionRow } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deletePromotion } from "../../actions";
import { loadTargets } from "../_targets";

export default async function PromotionPage({ params }: PageProps<"/admin/marketing/coupons/[id]">) {
  const staff = await requireStaff("marketing.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: redemptions }] = await Promise.all([
    supabase.from("promotions").select("*").eq("id", id).maybeSingle(),
    supabase.from("coupon_redemptions").select("id, discount_minor, free_shipping, created_at, orders(order_number)").eq("promotion_id", id).order("id", { ascending: false }).limit(50),
  ]);
  if (!data) notFound();
  const promotion = data as PromotionRow;
  const canManage = staff.permissions.includes("marketing.manage");
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-semibold text-espresso">{promotion.name}</h1>
      {canManage ? <PromotionForm promotion={promotion} targets={await loadTargets()} /> : <p className="text-sm text-muted">Read-only for your role.</p>}
      <section>
        <h2 className="font-semibold text-espresso">Redemptions</h2>
        <ul className="mt-2 text-sm">
          {(redemptions ?? []).length === 0 ? <li className="text-muted">None yet.</li> : null}
          {((redemptions ?? []) as unknown as { id: number; discount_minor: number; free_shipping: boolean; created_at: string; orders: { order_number: string } | null }[]).map((r) => (
            <li key={r.id} className="flex justify-between border-t border-line py-1"><span>{r.orders?.order_number ?? "order"}</span><span>{r.free_shipping ? "free delivery" : formatBDT(r.discount_minor)} · {new Date(r.created_at).toLocaleDateString("en-GB")}</span></li>
          ))}
        </ul>
      </section>
      {canManage ? (
        <form action={deletePromotion.bind(null, id)}>
          <button type="submit" className="text-sm text-danger underline underline-offset-4">Delete (deactivates instead when it has redemptions)</button>
        </form>
      ) : null}
    </div>
  );
}
