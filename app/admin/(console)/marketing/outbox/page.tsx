import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { OUTBOX_STATUSES } from "@/lib/marketing/constants";
import { notifyOffer } from "@/lib/notify/providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retryOutbox } from "../actions";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
type Row = { id: string; channel: string; message_class: string; recipient: string | null; template_key: string | null; status: string; suppressed_reason: string | null; attempts: number; max_attempts: number; next_attempt_at: string; last_error: string | null; provider: string | null; created_at: string; sent_at: string | null; payload: Record<string, unknown> };

export default async function OutboxPage({ searchParams }: PageProps<"/admin/marketing/outbox">) {
  const staff = await requireStaff("marketing.read");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (OUTBOX_STATUSES as readonly string[]).includes(sp.status) ? sp.status : "all";
  const focus = typeof sp.id === "string" && /^[0-9a-f-]{36}$/.test(sp.id) ? sp.id : null;
  const supabase = await createSupabaseServerClient();
  let q = supabase.from("notification_outbox").select("*").order("created_at", { ascending: false }).limit(100);
  if (focus) q = q.eq("id", focus);
  else if (status !== "all") q = q.eq("status", status);
  const [{ data }, { data: hooks }] = await Promise.all([q, supabase.from("webhook_events").select("outbox_id, attempt, status_code, ok, response_excerpt, created_at").order("id", { ascending: false }).limit(200)]);
  const rows = (data ?? []) as Row[];
  const hookMap = new Map<string, typeof hooks>();
  for (const h of hooks ?? []) hookMap.set(h.outbox_id, [...(hookMap.get(h.outbox_id) ?? []), h]);
  const canManage = staff.permissions.includes("automation.manage");
  const offer = notifyOffer();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-espresso">Outbox</h1>
      <p className="text-xs text-muted">
        Every outbound message, with retries (exponential backoff) and a dead-letter state after {5} attempts. Providers now: email <strong>{offer.email ?? "none"}</strong>, SMS <strong>{offer.sms ?? "none"}</strong>, WhatsApp <strong>{offer.whatsapp ?? "none"}</strong>.
        {[offer.email, offer.sms, offer.whatsapp].includes("mock") ? <span className="ml-1 rounded bg-danger/10 px-2 py-0.5 font-semibold text-danger">MOCK providers deliver nothing; the preview below is what would have been sent.</span> : null}
      </p>
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Status">
        {["all", ...OUTBOX_STATUSES].map((s) => (
          <Link key={s} href={`/admin/marketing/outbox?status=${s}`} className={`rounded-full px-3 py-1 ${s === status && !focus ? "bg-espresso text-cream" : "bg-sand"}`}>{s}</Link>
        ))}
      </nav>
      <table className="w-full text-xs" data-testid="outbox-table">
        <thead><tr className="text-left uppercase tracking-wide text-muted"><th className="py-2">Created</th><th>Channel</th><th>To</th><th>Template</th><th>Status</th><th>Attempts</th><th>Provider</th><th>Detail</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={9} className="py-6 text-center text-muted">Nothing here.</td></tr> : null}
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line align-top">
              <td className="py-1">{dateFmt.format(new Date(r.created_at))}</td>
              <td>{r.channel}<span className="block text-muted">{r.message_class}</span></td>
              <td className="max-w-[16rem] break-all">{r.recipient ?? "—"}</td>
              <td>{r.template_key ?? ""}</td>
              <td><span className={`rounded px-2 py-0.5 ${r.status === "sent" ? "bg-success/10 text-success" : r.status === "dead" || r.status === "failed" ? "bg-danger/10 text-danger" : r.status === "suppressed" ? "bg-bronze/15 text-bronze-strong" : "bg-sand"}`}>{r.status}</span>{r.suppressed_reason ? <span className="block text-muted">{r.suppressed_reason}</span> : null}</td>
              <td>{r.attempts}/{r.max_attempts}{r.status === "queued" && r.attempts > 0 ? <span className="block text-muted">next {dateFmt.format(new Date(r.next_attempt_at))}</span> : null}</td>
              <td>{r.provider ?? ""}</td>
              <td className="max-w-[20rem]">
                {r.last_error ? <p className="text-danger">{r.last_error}</p> : null}
                {typeof r.payload.preview === "string" ? <details><summary className="cursor-pointer">preview</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-sand p-2" data-testid="outbox-preview">{r.payload.preview}</pre></details> : null}
                {(hookMap.get(r.id) ?? []).map((h, i) => <p key={i} className="text-muted">attempt {h.attempt}: {h.status_code ?? "—"} {h.ok ? "ok" : h.response_excerpt}</p>)}
              </td>
              <td>{canManage && (r.status === "dead" || r.status === "failed") ? <form action={retryOutbox.bind(null, r.id)}><button type="submit" className="underline">Retry</button></form> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
