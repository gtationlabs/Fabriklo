import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader, SelectField, TextField } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { listCouriers } from "@/lib/couriers/registry";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveCourierSettings } from "./actions";

export const metadata: Metadata = { title: "Courier" };

const ENV: Record<string, string[]> = {
  pathao: ["PATHAO_WEBHOOK_SECRET", "PATHAO_CLIENT_ID", "PATHAO_CLIENT_SECRET"],
  steadfast: ["STEADFAST_WEBHOOK_SECRET", "STEADFAST_API_KEY", "STEADFAST_SECRET_KEY"],
  redx: ["REDX_WEBHOOK_SECRET", "REDX_API_TOKEN"],
};

export default async function CourierPage() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: setting }, { data: shipments }] = await Promise.all([
    supabase.from("site_settings").select("value").eq("key", "shipping.courier").maybeSingle(),
    supabase.from("shipments").select("courier, status"),
  ]);
  const v = (setting?.value ?? {}) as Record<string, string>;
  const site = publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const stats = new Map<string, { total: number; delivered: number; failed: number }>();
  for (const s of (shipments ?? []) as { courier: string; status: string }[]) {
    const e = stats.get(s.courier) ?? { total: 0, delivered: 0, failed: 0 };
    e.total += 1;
    if (s.status === "delivered") e.delivered += 1;
    if (s.status === "delivery_failed" || s.status === "rto" || s.status === "returned") e.failed += 1;
    stats.set(s.courier, e);
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Courier" description="Courier partners for delivery. Staff pick the courier and tracking number on each order; connected couriers then move the shipment status by signed webhook. Secrets live only in the server environment, never in the database." />
      <div className="grid gap-4 lg:grid-cols-2" data-testid="couriers">
        {listCouriers().map((c) => {
          const s = stats.get(c.id);
          const configured = c.isConfigured();
          return (
            <Card key={c.id} title={c.label}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={configured ? "good" : "warn"}>{c.id === "manual" ? "Always available" : configured ? "Webhook secret set" : "Needs credentials"}</Badge>
                {v.default_courier === c.id ? <Badge tone="info">Default</Badge> : null}
                <span className="text-muted">{s ? `${s.total} shipments · ${s.delivered} delivered · ${s.failed} failed/returned` : "No shipments yet"}</span>
              </div>
              {c.id !== "manual" ? (
                <div className="mt-3 space-y-1 text-xs text-muted">
                  <p>Webhook URL to give the courier: <code className="break-all rounded bg-mist px-1 py-0.5 text-charcoal">{site}/api/couriers/{c.id}</code></p>
                  <p>Server variables: {ENV[c.id]?.map((e) => <code key={e} className="mr-1 rounded bg-mist px-1 py-0.5 text-charcoal">{e}</code>)}</p>
                  <p>Booking parcels from the admin (creating the consignment through the courier API) is not built yet; it needs a live merchant account to test against.</p>
                </div>
              ) : <p className="mt-3 text-xs text-muted">Staff type the tracking number and move the status by hand on the order page.</p>}
            </Card>
          );
        })}
      </div>
      <Card title="Pickup details" description="Printed on packing slips and used as the default courier on new shipments.">
        <ActionForm action={saveCourierSettings} label="Courier settings" submitLabel="Save courier settings">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <SelectField label="Default courier" name="default_courier" defaultValue={v.default_courier ?? "manual"} options={listCouriers().map((c) => ({ value: c.id, label: c.label.replace(/ \(.*\)$/, "") }))} />
            <TextField label="Pickup contact name" name="pickup_name" defaultValue={v.pickup_name} maxLength={80} />
            <TextField label="Pickup phone" name="pickup_phone" defaultValue={v.pickup_phone} maxLength={20} placeholder="01XXXXXXXXX" />
            <TextField label="Parcel note" name="parcel_note" defaultValue={v.parcel_note} maxLength={120} placeholder="Fragile, handle with care" />
            <TextField label="Pickup address" name="pickup_address" defaultValue={v.pickup_address} maxLength={200} className="md:col-span-2 lg:col-span-4" />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
