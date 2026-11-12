import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, PageHeader, TextField, Toggle } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveMethod } from "./actions";

export const metadata: Metadata = { title: "Shipping methods" };

type Method = { id: string; code: string; name: string; description: string; fee_adjust_minor: number; estimate_min_days: number | null; estimate_max_days: number | null; cod_allowed: boolean; is_default: boolean; is_active: boolean; position: number };

function MethodFields({ m }: { m: Method | null }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      <TextField label="Name" name="name" defaultValue={m?.name} required maxLength={60} placeholder="Express delivery" />
      <TextField label="Code" name="code" defaultValue={m?.code} required maxLength={40} placeholder="express" />
      <TextField label="Extra charge (৳)" name="fee_taka" defaultValue={m ? String(m.fee_adjust_minor / 100) : "0"} inputMode="decimal" hint="Added on top of the zone fee." />
      <TextField label="Position" name="position" type="number" min={0} max={999} defaultValue={m?.position ?? 0} />
      <TextField label="Description" name="description" defaultValue={m?.description} maxLength={200} className="md:col-span-2" />
      <TextField label="Min days" name="estimate_min_days" type="number" min={0} max={60} defaultValue={m?.estimate_min_days ?? ""} hint="Empty: use the zone estimate." />
      <TextField label="Max days" name="estimate_max_days" type="number" min={0} max={60} defaultValue={m?.estimate_max_days ?? ""} />
      <Toggle label="Active" name="is_active" defaultChecked={m?.is_active ?? true} />
      <Toggle label="Default option" name="is_default" defaultChecked={m?.is_default ?? false} />
      <Toggle label="Cash on delivery allowed" name="cod_allowed" defaultChecked={m?.cod_allowed ?? true} />
    </div>
  );
}

export default async function ShippingMethodsPage() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("shipping_methods").select("*").order("position").order("name");
  const methods = (data ?? []) as Method[];
  const active = methods.filter((m) => m.is_active).length;
  return (
    <div>
      <PageHeader
        title="Shipping Methods"
        description={<>Delivery options the shopper picks at checkout, charged on top of the zone fee. Free-delivery promotions and zone thresholds waive the zone fee, not the extra charge. With only one active option, checkout shows no choice. Currently <strong>{active}</strong> active.</>}
      />
      <ul className="space-y-4" data-testid="methods-list">
        {methods.map((m) => (
          <li key={m.id}>
            <Card title={m.name} description={`${m.code} · ${m.fee_adjust_minor ? `+${formatBDT(m.fee_adjust_minor)}` : "no extra charge"}${m.estimate_min_days != null ? ` · ${m.estimate_min_days}–${m.estimate_max_days ?? m.estimate_min_days} days` : ""}`}>
              <div className="mb-3 flex gap-2">
                <Badge tone={m.is_active ? "good" : "neutral"}>{m.is_active ? "Active" : "Inactive"}</Badge>
                {m.is_default ? <Badge tone="info">Default</Badge> : null}
                {!m.cod_allowed ? <Badge tone="warn">Online payment only</Badge> : null}
              </div>
              <ActionForm action={saveMethod.bind(null, m.id)} label={`Method: ${m.name}`} submitLabel="Save option">
                <MethodFields m={m} />
              </ActionForm>
            </Card>
          </li>
        ))}
      </ul>
      <Card title="Add a delivery option" className="mt-6">
        <ActionForm action={saveMethod.bind(null, null)} label="New delivery option" submitLabel="Create option">
          <MethodFields m={null} />
        </ActionForm>
      </Card>
    </div>
  );
}
