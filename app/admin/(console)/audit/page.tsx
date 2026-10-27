import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { changedKeys, maskSensitive, parseAuditFilters } from "@/lib/admin/audit";
import { auditActors, queryAudit } from "@/lib/admin/audit-query";
import { inputCls } from "@/components/admin/form-bits";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };
const PAGE = 50;
const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Dhaka" });

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireStaff("audit.read");
  const filters = parseAuditFilters(await searchParams);
  const supabase = await createSupabaseServerClient();
  const [rows, actors, { data: facets }] = await Promise.all([queryAudit(filters, PAGE + 1), auditActors(), supabase.rpc("admin_audit_facets")]);
  const f = (facets ?? { entity_types: [], actions: [], total: 0 }) as { entity_types: string[]; actions: string[]; total: number };
  const hasMore = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, before: undefined, ...extra })) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-espresso">Audit log</h1>
          <p className="max-w-2xl text-sm text-muted">
            Every privileged change, append-only. {f.total.toLocaleString("en-GB")} events in total. Times are Asia/Dhaka. Secrets and hashes are masked.
          </p>
        </div>
        <Link href={`/admin/audit/export${qs({})}`} prefetch={false} className="rounded border border-line bg-white px-4 py-2 text-sm">Download CSV (filtered, up to 5,000)</Link>
      </header>

      <form method="get" aria-label="Filter audit log" className="grid gap-3 rounded-lg border border-line bg-white p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <label>
          <span className="block text-xs font-medium">Entity</span>
          <select name="entity_type" defaultValue={filters.entity_type} className={inputCls}>
            <option value="">All</option>
            {f.entity_types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium">Action</span>
          <select name="action" defaultValue={filters.action} className={inputCls}>
            <option value="">All</option>
            {f.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium">Staff member</span>
          <select name="actor" defaultValue={filters.actor} className={inputCls}>
            <option value="">Anyone</option>
            {[...actors.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium">Entity id</span>
          <input name="entity_id" defaultValue={filters.entity_id} maxLength={120} className={inputCls} />
        </label>
        <label>
          <span className="block text-xs font-medium">From</span>
          <input name="from" type="date" defaultValue={filters.from} className={inputCls} />
        </label>
        <label>
          <span className="block text-xs font-medium">To</span>
          <input name="to" type="date" defaultValue={filters.to} className={inputCls} />
        </label>
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream">Filter</button>
          <Link href="/admin/audit" className="rounded border border-line px-4 py-2 text-sm">Clear</Link>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm" data-testid="audit-table">
          <thead className="bg-cream text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Changed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {page.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No events match.</td></tr>
            ) : null}
            {page.map((r) => {
              const keys = changedKeys(r.before_data, r.after_data);
              return (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{dateFmt.format(new Date(r.occurred_at))}<br />#{r.id}</td>
                  <td className="px-3 py-2">
                    {r.actor_id ? (actors.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : <span className="text-muted">system</span>}
                    {r.actor_role ? <span className="block text-xs text-muted">{r.actor_role}</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{r.entity_type}</span>
                    {r.entity_id ? <span className="block max-w-56 truncate font-mono text-xs text-muted" title={r.entity_id}>{r.entity_id}</span> : null}
                    {r.reason ? <span className="block text-xs">Reason: {r.reason}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {keys.length ? <span className="text-xs">{keys.slice(0, 6).join(", ")}{keys.length > 6 ? ` +${keys.length - 6}` : ""}</span> : null}
                    {r.before_data != null || r.after_data != null ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-bronze-strong">Details</summary>
                        <div className="mt-1 grid gap-2 md:grid-cols-2">
                          {(["before_data", "after_data"] as const).map((k) => (
                            <div key={k}>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{k === "before_data" ? "Before" : "After"}</p>
                              <pre className="max-h-64 overflow-auto rounded bg-cream p-2 text-[11px]">{r[k] == null ? "—" : JSON.stringify(maskSensitive(r[k]), null, 1)}</pre>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <Link href={qs({ before: String(page[page.length - 1]!.id) })} className="inline-block rounded border border-line bg-white px-4 py-2 text-sm">Older events →</Link>
      ) : null}
    </div>
  );
}
