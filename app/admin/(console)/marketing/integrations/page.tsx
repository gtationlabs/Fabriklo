import { AllowlistForm, IntegrationForm, type IntegrationRow } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { notifyOffer } from "@/lib/notify/providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TITLES: Record<string, string> = { smtp: "Email (SMTP)", sms: "SMS gateway", whatsapp: "WhatsApp Business", meta_pixel: "Meta Pixel + Conversions API", ga4: "Google Analytics 4", webhook_signing: "Outbound webhook signing" };

export default async function IntegrationsPage() {
  const staff = await requireStaff("marketing.read");
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: allow }] = await Promise.all([
    supabase.from("integration_connections").select("*").order("provider"),
    supabase.from("site_settings").select("value").eq("key", "automation.webhook_allowlist").maybeSingle(),
  ]);
  const rows = ((data ?? []) as Omit<IntegrationRow, "secret_present">[]).map((r) => ({
    ...r,
    public_config: (r.public_config ?? {}) as Record<string, string>,
    // Presence only: the value never leaves the server environment.
    secret_present: Boolean(r.secret_env && process.env[r.secret_env]),
  }));
  const hosts = (((allow?.value as { hosts?: string[] } | null)?.hosts) ?? []).filter((h) => typeof h === "string");
  const offer = notifyOffer();
  const canManage = staff.permissions.includes("integrations.manage");
  const canAutomate = staff.permissions.includes("automation.manage");
  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold text-espresso">Integrations</h1>
      <p className="text-xs text-muted">Secrets live only in the server environment; this page stores their variable <em>names</em> and public ids. Selected providers right now: email <strong>{offer.email ?? "none"}</strong>, SMS <strong>{offer.sms ?? "none"}</strong>, WhatsApp <strong>{offer.whatsapp ?? "none"}</strong> (a <em>mock</em> delivers nothing and is never used in production unless `NOTIFY_ALLOW_MOCK=true`). GA4 and the Meta Pixel load only after cookie consent and only when `NEXT_PUBLIC_GA4_MEASUREMENT_ID` / `NEXT_PUBLIC_META_PIXEL_ID` are set.</p>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="integrations">
        {rows.map((r) => (
          <section key={r.provider} className="rounded-lg border border-line bg-white p-4">
            <h2 className="font-semibold text-espresso">{TITLES[r.provider] ?? r.provider} <span className={`ml-2 rounded px-2 py-0.5 text-xs ${r.status === "configured" ? "bg-success/10 text-success" : "bg-sand"}`}>{r.status.replace("_", " ")}</span></h2>
            <div className="mt-3"><IntegrationForm row={r} canManage={canManage} /></div>
          </section>
        ))}
      </div>
      <section className="max-w-xl rounded-lg border border-line bg-white p-4">
        <h2 className="font-semibold text-espresso">Webhook allowlist</h2>
        {canAutomate ? <AllowlistForm hosts={hosts} /> : <p className="mt-2 text-sm text-muted">{hosts.join(", ") || "No hosts allowed yet."}</p>}
      </section>
    </div>
  );
}
