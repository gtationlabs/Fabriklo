import { LimitsForm } from "@/components/admin/tryon-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tryonOffer } from "@/lib/tryon";
import { runTryonWorkerNow } from "./actions";

type Stats = {
  limits: { enabled: boolean; per_user_daily: number; site_daily: number; daily_credit_cap: number; alert_threshold_pct: number; retention_hours: number; max_attempts: number; consent_version: string };
  credits_today: number;
  jobs_today: number;
  by_status: Record<string, number>;
  failed_24h: number;
  top_errors_24h: { code: string; count: number }[];
  queued: number;
  processing: number;
  oldest_queued_seconds: number;
  users_7d: number;
  garments: number;
  enabled_products: number;
};

/** Operational view only: counts, spend, failures. Never customer photos or paths. */
export default async function TryonAdminPage() {
  await requireStaff("tryon.manage");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("tryon_admin_stats");
  const stats = data as Stats;
  const offer = tryonOffer();
  const pct = stats.limits.daily_credit_cap > 0 ? Math.round((stats.credits_today / stats.limits.daily_credit_cap) * 100) : 0;
  const alert = pct >= stats.limits.alert_threshold_pct;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-espresso">AI try-on</h1>
        <p className="text-sm text-muted">
          Provider: <strong>{offer ? offer.label : "none configured (feature hidden on the store)"}</strong>
          {offer?.isMock ? <span className="ml-2 rounded bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">MOCK: no real try-on, no spend</span> : null}
        </p>
      </header>

      {alert ? (
        <p role="alert" className="rounded border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Today&apos;s credit use is at {pct}% of the daily cap ({stats.credits_today}/{stats.limits.daily_credit_cap}). New try-ons stop at 100%.
        </p>
      ) : null}

      <section aria-labelledby="stats-h" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="tryon-stats">
        <h2 id="stats-h" className="sr-only">Today</h2>
        <Stat label="Credits today" value={`${stats.credits_today} / ${stats.limits.daily_credit_cap}`} note={`${pct}% of cap`} />
        <Stat label="Jobs today" value={String(stats.jobs_today)} note={`${stats.users_7d} customers in 7 days`} />
        <Stat label="Queue" value={`${stats.queued} queued · ${stats.processing} running`} note={stats.oldest_queued_seconds > 0 ? `oldest waiting ${stats.oldest_queued_seconds}s` : "nothing waiting"} />
        <Stat label="Failures (24h)" value={String(stats.failed_24h)} note={stats.top_errors_24h.map((e) => `${e.code} ×${e.count}`).join(", ") || "none"} />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="limits-h" className="rounded-lg border border-line bg-white p-5">
          <h2 id="limits-h" className="font-semibold text-espresso">Limits and budget</h2>
          <p className="mt-1 text-xs text-muted">Enforced in the database for every request. Credits are the provider&apos;s unit (FASHN: 1 credit per generated image).</p>
          <LimitsForm limits={stats.limits} />
        </section>
        <section aria-labelledby="ops-h" className="space-y-4">
          <div className="rounded-lg border border-line bg-white p-5 text-sm">
            <h2 id="ops-h" className="font-semibold text-espresso">Jobs by status</h2>
            <ul className="mt-2 grid grid-cols-2 gap-1">
              {Object.entries(stats.by_status).length === 0 ? <li className="text-muted">No jobs yet.</li> : null}
              {Object.entries(stats.by_status).map(([k, v]) => (
                <li key={k}>{k}: <strong>{v}</strong></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{stats.enabled_products} active products have try-on switched on; {stats.garments} garment reference photos. Garment photos are added on each product&apos;s page.</p>
            <form action={runTryonWorkerNow} className="mt-3">
              <button type="submit" className="rounded border border-espresso px-3 py-1.5 text-sm">Run queue now</button>
              <span className="ml-2 text-xs text-muted">Normally run by the scheduler every minute (`TRYON_WORKER_SECRET`).</span>
            </form>
          </div>
          <div className="rounded-lg border border-line bg-cream p-5 text-xs text-muted">
            Privacy: customer photos and results live in private per-customer storage, are never shown here, and are purged {stats.limits.retention_hours} hours after upload or when the customer deletes them. The provider receives images as data, not links.
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-espresso">{value}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}
