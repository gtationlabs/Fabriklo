import Link from "next/link";
import { notFound } from "next/navigation";
import { RuleForm, RuleTester, type RuleRow } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteRule } from "../../actions";
import { loadRuleFormData } from "../_data";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

export default async function RulePage({ params }: PageProps<"/admin/marketing/rules/[id]">) {
  const staff = await requireStaff("marketing.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: execs }, { data: versions }] = await Promise.all([
    supabase.from("automation_rules").select("*").eq("id", id).maybeSingle(),
    supabase.from("automation_executions").select("id, rule_version, event_id, status, reason, outbox_id, recipient_masked, created_at").eq("rule_id", id).order("id", { ascending: false }).limit(50),
    supabase.from("automation_rule_versions").select("version, changed_at, changed_by").eq("rule_id", id).order("version", { ascending: false }).limit(20),
  ]);
  if (!data) notFound();
  const rule = data as RuleRow;
  const canManage = staff.permissions.includes("automation.manage");
  const { templates, allowlist } = await loadRuleFormData();
  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="font-display text-2xl font-semibold text-espresso">{rule.name}</h1>
      {canManage ? <RuleForm rule={rule} templates={templates} allowlist={allowlist} /> : <pre className="whitespace-pre-wrap rounded border border-line bg-white p-3 text-xs">{JSON.stringify({ trigger: rule.trigger_type, conditions: rule.conditions, action: rule.action, mode: rule.mode }, null, 2)}</pre>}
      {canManage ? <RuleTester ruleId={id} /> : null}
      <section>
        <h2 className="font-semibold text-espresso">Execution history</h2>
        <table className="mt-2 w-full text-xs" data-testid="rule-executions">
          <thead><tr className="text-left text-muted"><th className="py-1">When</th><th>Event</th><th>Version</th><th>Decision</th><th>Reason</th><th>Recipient</th><th>Message</th></tr></thead>
          <tbody>
            {(execs ?? []).length === 0 ? <tr><td colSpan={7} className="py-4 text-center text-muted">Nothing yet.</td></tr> : null}
            {(execs ?? []).map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="py-1">{dateFmt.format(new Date(e.created_at))}</td><td>#{e.event_id}</td><td>v{e.rule_version}</td><td>{e.status}</td><td>{e.reason ?? ""}</td><td>{e.recipient_masked ?? ""}</td>
                <td>{e.outbox_id ? <Link href={`/admin/marketing/outbox?id=${e.outbox_id}`} className="underline">view</Link> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="text-xs text-muted">
        <h2 className="font-semibold text-espresso">Versions</h2>
        <p>{(versions ?? []).map((v) => `v${v.version} (${dateFmt.format(new Date(v.changed_at))})`).join(" · ")}</p>
      </section>
      {canManage ? <form action={deleteRule.bind(null, id)}><button type="submit" className="text-sm text-danger underline underline-offset-4">Delete rule</button></form> : null}
    </div>
  );
}
