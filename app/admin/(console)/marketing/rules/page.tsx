import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { TRIGGER_LABELS, type TriggerType } from "@/lib/marketing/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { toggleRule } from "../actions";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
type Row = { id: string; name: string; trigger_type: TriggerType; action: { type: string }; is_active: boolean; mode: string; version: number; quota_per_hour: number; last_triggered_at: string | null };

export default async function RulesPage() {
  const staff = await requireStaff("marketing.read");
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: recent }] = await Promise.all([
    supabase.from("automation_rules").select("id, name, trigger_type, action, is_active, mode, version, quota_per_hour, last_triggered_at").order("created_at", { ascending: false }),
    supabase.from("automation_executions").select("rule_id, status").gte("created_at", new Date(nowMs() - 24 * 3600_000).toISOString()).limit(2000),
  ]);
  const rows = (data ?? []) as Row[];
  const counts = new Map<string, Record<string, number>>();
  for (const e of recent ?? []) {
    const c = counts.get(e.rule_id) ?? {};
    c[e.status] = (c[e.status] ?? 0) + 1;
    counts.set(e.rule_id, c);
  }
  const canManage = staff.permissions.includes("automation.manage");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-espresso">Automation rules</h1>
        {canManage ? <Link href="/admin/marketing/rules/new" className="rounded bg-espresso px-4 py-2 text-sm text-cream">New rule</Link> : null}
      </div>
      <p className="text-xs text-muted">Trigger → conditions → one action. Each rule runs at most once per event; dry-run rules record decisions without sending. Marketing messages are suppressed for anyone not opted in.</p>
      <table className="w-full text-sm" data-testid="rules-table">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-2">Rule</th><th>Trigger</th><th>Action</th><th>Mode</th><th>Last 24h</th><th>Last triggered</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-muted">No rules yet.</td></tr> : null}
          {rows.map((r) => {
            const c = counts.get(r.id) ?? {};
            return (
              <tr key={r.id} className="border-t border-line">
                <td className="py-2"><Link href={`/admin/marketing/rules/${r.id}`} className="font-medium underline-offset-4 hover:underline">{r.name}</Link><span className="block text-xs text-muted">v{r.version} · {r.quota_per_hour}/h</span></td>
                <td>{TRIGGER_LABELS[r.trigger_type] ?? r.trigger_type}</td>
                <td>{r.action.type}</td>
                <td>{r.is_active ? (r.mode === "live" ? <span className="rounded bg-success/10 px-2 py-0.5 text-xs text-success">live</span> : <span className="rounded bg-bronze/15 px-2 py-0.5 text-xs text-bronze-strong">dry run</span>) : <span className="rounded bg-sand px-2 py-0.5 text-xs">paused</span>}</td>
                <td className="text-xs">{Object.entries(c).map(([k, v]) => `${v} ${k}`).join(" · ") || "—"}</td>
                <td className="text-xs">{r.last_triggered_at ? dateFmt.format(new Date(r.last_triggered_at)) : "never"}</td>
                <td>{canManage ? <form action={toggleRule.bind(null, r.id, !r.is_active)}><button type="submit" className="text-xs underline">{r.is_active ? "Pause" : "Resume"}</button></form> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
