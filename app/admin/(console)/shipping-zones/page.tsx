import type { Metadata } from "next";
import { RatesConfirmForm, ZoneForm, type ZoneRow } from "@/components/admin/settings-forms";
import { Badge, PageHeader } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Shipping zones" };

export default async function ShippingZonesPage() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: zones }, { data: setup }] = await Promise.all([
    supabase.from("shipping_zones").select("id, code, name, districts, is_fallback, fee_minor, free_over_minor, cod_enabled, estimate_min_days, estimate_max_days, is_active").order("position"),
    supabase.from("site_settings").select("value").eq("key", "store.setup").maybeSingle(),
  ]);
  const ratesConfirmed = Boolean((setup?.value as { rates_confirmed?: boolean } | null)?.rates_confirmed ?? false);
  const zoneRows = (zones ?? []) as ZoneRow[];
  const taken = new Map<string, string>();
  for (const z of zoneRows) if (z.is_active) for (const d of z.districts) taken.set(d, z.code);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping Zones"
        description="A district belongs to one active zone; the fallback zone covers everything else. Fees are in taka and apply to new quotes immediately. Zones are deactivated, never deleted, so past orders keep their reference."
      />
      {!ratesConfirmed ? (
        <p role="status" className="rounded-xl border border-bronze/40 bg-cream p-4 text-sm" data-testid="demo-rates-warning">
          <strong>Demo values.</strong> The delivery fees are placeholders. Enter the real ones below, then tick the confirmation.
        </p>
      ) : null}
      <ul className="space-y-4" data-testid="zones-list">
        {zoneRows.map((z) => (
          <li key={z.id} className="rounded-xl border border-line bg-white p-5">
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <strong className="text-espresso">{z.name}</strong>
              <span className="text-muted">{formatBDT(z.fee_minor)}{z.free_over_minor ? ` · free over ${formatBDT(z.free_over_minor)}` : ""} · {z.is_fallback ? "fallback" : `${z.districts.length} districts`} · {z.estimate_min_days}–{z.estimate_max_days} days</span>
              <Badge tone={z.is_active ? "good" : "neutral"}>{z.is_active ? "Active" : "Inactive"}</Badge>
            </p>
            <ZoneForm zone={z} takenDistricts={taken} />
          </li>
        ))}
      </ul>
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="mb-3 font-semibold text-espresso">Add a zone</h2>
        <ZoneForm zone={null} takenDistricts={taken} />
      </section>
      <section className="rounded-xl border border-line bg-white p-5">
        <RatesConfirmForm confirmed={ratesConfirmed} />
      </section>
    </div>
  );
}
