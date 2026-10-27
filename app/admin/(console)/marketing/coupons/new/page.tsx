import { PromotionForm } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { loadTargets } from "../_targets";

export default async function NewPromotionPage() {
  await requireStaff("marketing.manage");
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-semibold text-espresso">New promotion</h1>
      <PromotionForm promotion={null} targets={await loadTargets()} />
    </div>
  );
}
