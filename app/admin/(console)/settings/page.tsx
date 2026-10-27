import type { Metadata } from "next";
import { CodForm, ContactForm, IdentityForm, OnlineForm, RatesConfirmForm, ZoneForm, type ZoneRow } from "@/components/admin/settings-forms";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

type Settings = Record<string, Record<string, unknown>>;

export default async function SettingsPage() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: settings }, { data: zones }] = await Promise.all([
    supabase.from("site_settings").select("key, value, updated_at").in("key", ["store.identity", "store.contact", "checkout.cod", "checkout.online", "store.setup"]),
    supabase.from("shipping_zones").select("id, code, name, districts, is_fallback, fee_minor, free_over_minor, cod_enabled, estimate_min_days, estimate_max_days, is_active").order("position"),
  ]);
  const s: Settings = Object.fromEntries(((settings ?? []) as { key: string; value: Record<string, unknown> }[]).map((r) => [r.key, r.value]));
  const identity = { name: String(s["store.identity"]?.name ?? "Fabriklo"), tagline: String(s["store.identity"]?.tagline ?? ""), locale: String(s["store.identity"]?.locale ?? "en-BD") };
  const contact = {
    email: String(s["store.contact"]?.email ?? ""),
    phone: String(s["store.contact"]?.phone ?? ""),
    address: String(s["store.contact"]?.address ?? ""),
    hours: String(s["store.contact"]?.hours ?? ""),
    note: String(s["store.contact"]?.note ?? ""),
  };
  const cod = { enabled: Boolean(s["checkout.cod"]?.enabled ?? true), max_order_minor: Number(s["checkout.cod"]?.max_order_minor ?? 2000000) };
  const online = { enabled: Boolean(s["checkout.online"]?.enabled ?? true), hold_minutes: Number(s["checkout.online"]?.hold_minutes ?? 30) };
  const ratesConfirmed = Boolean(s["store.setup"]?.rates_confirmed ?? false);
  const zoneRows = (zones ?? []) as ZoneRow[];
  const taken = new Map<string, string>();
  for (const z of zoneRows) if (z.is_active) for (const d of z.districts) taken.set(d, z.code);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-3xl font-semibold text-espresso">Settings</h1>
        <p className="max-w-2xl text-sm text-muted">
          Non-secret store configuration. Every change is validated in the database and written to the audit log. API keys and passwords
          are never stored here: they live in the deployment secret store.
        </p>
      </header>

      {!ratesConfirmed ? (
        <p role="status" className="rounded border border-bronze/40 bg-cream p-4 text-sm" data-testid="demo-rates-warning">
          <strong>Demo values.</strong> The delivery fees and the cash on delivery limit are placeholders. Enter the real ones below, then tick the confirmation.
        </p>
      ) : null}

      <section aria-labelledby="identity-h" className="space-y-4 rounded-lg border border-line bg-white p-5">
        <h2 id="identity-h" className="font-semibold text-espresso">Store identity</h2>
        <IdentityForm identity={identity} />
      </section>

      <section aria-labelledby="contact-h" className="space-y-4 rounded-lg border border-line bg-white p-5">
        <h2 id="contact-h" className="font-semibold text-espresso">Contact details (shown in the footer)</h2>
        <ContactForm contact={contact} />
      </section>

      <section aria-labelledby="payments-h" className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-line bg-white p-5">
          <h2 id="payments-h" className="font-semibold text-espresso">Cash on delivery</h2>
          <CodForm cod={cod} />
        </div>
        <div className="space-y-4 rounded-lg border border-line bg-white p-5">
          <h2 className="font-semibold text-espresso">Online payment</h2>
          <OnlineForm online={online} />
        </div>
      </section>

      <section aria-labelledby="zones-h" className="space-y-4">
        <div>
          <h2 id="zones-h" className="font-semibold text-espresso">Shipping zones</h2>
          <p className="text-sm text-muted">
            A district can belong to one active zone; the fallback zone covers everything else. Fees are in taka and apply to new quotes
            immediately. Zones are deactivated, never deleted, so past orders keep their reference.
          </p>
        </div>
        <ul className="space-y-4" data-testid="zones-list">
          {zoneRows.map((z) => (
            <li key={z.id}>
              <p className="mb-1 text-xs text-muted">
                {z.code} · {formatBDT(z.fee_minor)}{z.free_over_minor ? ` · free over ${formatBDT(z.free_over_minor)}` : ""} · {z.is_fallback ? "fallback" : `${z.districts.length} districts`} · {z.is_active ? "active" : "inactive"}
              </p>
              <ZoneForm zone={z} takenDistricts={taken} />
            </li>
          ))}
        </ul>
        <h3 className="font-medium text-espresso">Add a zone</h3>
        <ZoneForm zone={null} takenDistricts={taken} />
        <RatesConfirmForm confirmed={ratesConfirmed} />
      </section>
    </div>
  );
}
