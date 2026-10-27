import { BannerForm } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { notifyOffer } from "@/lib/notify/providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAutomationNow } from "./actions";

type Stats = {
  coupons_active: number; automatic_active: number; redemptions_30d: number; discount_30d_minor: number;
  newsletter: { subscribed: number; pending: number; unsubscribed: number }; opted_in_accounts: number; suppressed: number;
  rules: { active: number; dry_run: number; total: number }; events_unprocessed: number; events_24h: number;
  outbox: Record<string, number> | null;
  attribution_30d: { orders: number; attributed: number; by_source: { source: string; orders: number }[] };
};

export default async function MarketingOverviewPage() {
  const staff = await requireStaff("marketing.read");
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: bannerRow }] = await Promise.all([
    supabase.rpc("marketing_admin_stats"),
    supabase.from("site_settings").select("value").eq("key", "marketing.banner").maybeSingle(),
  ]);
  const s = data as Stats;
  const offer = notifyOffer();
  const canManage = staff.permissions.includes("marketing.manage");
  const canAutomate = staff.permissions.includes("automation.manage");
  const providerLabel = (p: string | null) => (p === null ? "none (messages dead-letter in production)" : p === "mock" ? "MOCK: nothing is delivered" : p);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-espresso">Marketing</h1>
        <p className="text-sm text-muted">Coupons, newsletter, automation and integrations. Every send respects opt-in and the suppression list.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="marketing-stats">
        <Stat label="Active promotions" value={`${s.coupons_active} coupons · ${s.automatic_active} automatic`} note={`${s.redemptions_30d} redemptions, ${formatBDT(s.discount_30d_minor)} discount in 30 days`} />
        <Stat label="Newsletter" value={`${s.newsletter.subscribed} subscribed`} note={`${s.newsletter.pending} awaiting confirmation · ${s.newsletter.unsubscribed} unsubscribed · ${s.opted_in_accounts} accounts opted in · ${s.suppressed} suppressed`} />
        <Stat label="Automation" value={`${s.rules.active} active rules`} note={`${s.rules.dry_run} in dry run · ${s.events_24h} events in 24h · ${s.events_unprocessed} waiting`} />
        <Stat label="Outbox (7 days)" value={Object.entries(s.outbox ?? {}).map(([k, v]) => `${v} ${k}`).join(" · ") || "empty"} note={`Email: ${providerLabel(offer.email)} · SMS: ${providerLabel(offer.sms)} · WhatsApp: ${providerLabel(offer.whatsapp)}`} />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-semibold text-espresso">Attribution (last 30 days)</h2>
          <p className="mt-1 text-xs text-muted">
            Attribution is recorded only for visitors who accepted analytics cookies. {s.attribution_30d.orders - s.attribution_30d.attributed} of {s.attribution_30d.orders} orders have no attribution data, so these numbers are a lower bound, not a share of all sales.
          </p>
          <ul className="mt-3 text-sm">
            {s.attribution_30d.by_source.length === 0 ? <li className="text-muted">No attributed orders yet.</li> : null}
            {s.attribution_30d.by_source.map((r) => (
              <li key={r.source} className="flex justify-between border-t border-line py-1"><span>{r.source}</span><strong>{r.orders}</strong></li>
            ))}
          </ul>
        </section>
        <section className="space-y-4">
          <div className="rounded-lg border border-line bg-white p-5">
            <h2 className="font-semibold text-espresso">Announcement banner</h2>
            {canManage ? <BannerForm banner={(bannerRow?.value ?? {}) as Parameters<typeof BannerForm>[0]["banner"]} /> : <p className="mt-2 text-sm text-muted">Read-only for your role.</p>}
          </div>
          {canAutomate ? (
            <form action={runAutomationNow} className="rounded-lg border border-line bg-white p-5 text-sm">
              <h2 className="font-semibold text-espresso">Automation worker</h2>
              <p className="mt-1 text-xs text-muted">Runs after each order and newsletter signup, and from the scheduler (`AUTOMATION_WORKER_SECRET`). Run it by hand to flush the queue.</p>
              <button type="submit" className="mt-3 rounded border border-espresso px-3 py-1.5">Run automation now</button>
            </form>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold text-espresso">{value}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}
