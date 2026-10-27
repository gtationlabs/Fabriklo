import { CampaignForm, SegmentForm } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendCampaign } from "../actions";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

export default async function CampaignsPage() {
  const staff = await requireStaff("marketing.read");
  const supabase = await createSupabaseServerClient();
  const [{ data: segments }, { data: campaigns }, { data: emailT }, { data: smsT }] = await Promise.all([
    supabase.from("customer_segments").select("id, name, definition").order("created_at", { ascending: false }),
    supabase.from("campaigns").select("id, name, channel, template_key, status, sent_count, suppressed_count, sent_at, created_at, customer_segments(name)").order("created_at", { ascending: false }).limit(100),
    supabase.from("email_templates").select("key").eq("message_class", "marketing").order("key"),
    supabase.from("sms_templates").select("key").eq("message_class", "marketing").order("key"),
  ]);
  const segs = (segments ?? []) as { id: string; name: string; definition: Record<string, unknown> }[];
  const counts = await Promise.all(segs.map(async (s) => {
    const { data } = await supabase.rpc("admin_segment_count", { p_definition: s.definition, p_channel: "email" });
    return [s.id, Number(data ?? 0)] as const;
  }));
  const countMap = new Map(counts);
  const canManage = staff.permissions.includes("marketing.manage");
  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold text-espresso">Campaigns</h1>
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-semibold text-espresso">Segments</h2>
          <ul className="text-sm" data-testid="segments-list">
            {segs.length === 0 ? <li className="text-muted">No segments yet.</li> : null}
            {segs.map((s) => (
              <li key={s.id} className="flex justify-between border-t border-line py-1"><span>{s.name} <span className="text-xs text-muted">{JSON.stringify(s.definition)}</span></span><span>{countMap.get(s.id) ?? 0} reachable by email</span></li>
            ))}
          </ul>
          {canManage ? <SegmentForm /> : null}
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold text-espresso">New campaign</h2>
          {canManage ? <CampaignForm segments={segs} templates={{ email: (emailT ?? []).map((t) => t.key), sms: (smsT ?? []).map((t) => t.key) }} /> : <p className="text-sm text-muted">Read-only for your role.</p>}
        </section>
      </div>
      <section>
        <h2 className="font-semibold text-espresso">Campaign history</h2>
        <table className="mt-2 w-full text-sm" data-testid="campaigns-table">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-2">Name</th><th>Channel</th><th>Segment</th><th>Template</th><th>Status</th><th>Queued / suppressed</th><th>Sent</th><th></th></tr></thead>
          <tbody>
            {(campaigns ?? []).length === 0 ? <tr><td colSpan={8} className="py-6 text-center text-muted">No campaigns yet.</td></tr> : null}
            {((campaigns ?? []) as unknown as { id: string; name: string; channel: string; template_key: string; status: string; sent_count: number; suppressed_count: number; sent_at: string | null; customer_segments: { name: string } | null }[]).map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="py-1">{c.name}</td><td>{c.channel}</td><td>{c.customer_segments?.name ?? "—"}</td><td className="font-mono text-xs">{c.template_key}</td><td>{c.status}</td><td>{c.sent_count} / {c.suppressed_count}</td><td>{c.sent_at ? dateFmt.format(new Date(c.sent_at)) : "—"}</td>
                <td>{canManage && c.status === "draft" ? <form action={sendCampaign.bind(null, c.id)}><button type="submit" className="rounded border border-espresso px-2 py-1 text-xs">Send now</button></form> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">Sending queues one message per reachable member (opted in, not suppressed, de-duplicated per campaign). Delivery then follows the outbox.</p>
      </section>
    </div>
  );
}
