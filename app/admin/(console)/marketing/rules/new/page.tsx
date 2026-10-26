import { RuleForm } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { loadRuleFormData } from "../_data";

export default async function NewRulePage() {
  await requireStaff("automation.manage");
  const { templates, allowlist } = await loadRuleFormData();
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-semibold text-espresso">New automation rule</h1>
      <RuleForm rule={null} templates={templates} allowlist={allowlist} />
    </div>
  );
}
