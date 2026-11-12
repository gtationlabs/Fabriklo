import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, SettingsPanel, SettingsRow, TextField, Toggle } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deletePixel, savePixel } from "../hub-actions";

export const metadata: Metadata = { title: "Meta Pixels & Datasets" };

type Pixel = { id: string; pixel_id: string; name: string; is_active: boolean; notes: string };

export default async function MetaPixelsSettings() {
  const staff = await requireStaff("integrations.read");
  const canManage = staff.permissions.includes("integrations.manage");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("meta_pixels").select("*").order("created_at");
  const pixels = (data ?? []) as Pixel[];
  const env = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  return (
    <SettingsPanel title="Meta Pixels & Datasets" description="Facebook / Instagram pixels loaded on the shop, only after a visitor accepts marketing cookies." icon={<Radar className="size-5" aria-hidden />}>
      <SettingsRow title="What is tracked" description="Today: PageView on every shop page. Shopping events (ViewContent, AddToCart, Purchase) and the server-side Conversions API need a Meta access token and come later.">
        {env ? <p className="text-sm">Also loaded from the server environment: <code>{env}</code></p> : null}
        <p className="text-xs text-muted">Up to five active pixels load. Find the id in Meta Events Manager → Data sources (a “dataset” id works the same way).</p>
      </SettingsRow>
      <SettingsRow title="Pixels">
        <ul className="space-y-3" data-testid="pixels-list">
          {pixels.length === 0 ? <li className="text-sm text-muted">No pixels added.</li> : null}
          {pixels.map((p) => (
            <li key={p.id} className="rounded-xl border border-line bg-paper p-4">
              <p className="mb-3 flex items-center gap-2 text-sm"><strong>{p.name}</strong> <code className="text-xs">{p.pixel_id}</code> <Badge tone={p.is_active ? "good" : "neutral"}>{p.is_active ? "Loading" : "Paused"}</Badge></p>
              {canManage ? (
                <div className="space-y-2">
                  <ActionForm action={savePixel.bind(null, p.id)} label={`Pixel ${p.name}`} submitLabel="Save">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <TextField label="Name" name="name" defaultValue={p.name} required maxLength={60} />
                      <TextField label="Pixel / dataset id" name="pixel_id" defaultValue={p.pixel_id} required inputMode="numeric" maxLength={20} />
                      <Toggle label="Active" name="is_active" defaultChecked={p.is_active} />
                      <TextField label="Notes" name="notes" defaultValue={p.notes} maxLength={300} className="sm:col-span-3" />
                    </div>
                  </ActionForm>
                  <ActionForm action={deletePixel.bind(null, p.id)} label={`Remove pixel ${p.name}`} submitLabel="Remove" danger compact confirm="Remove this pixel?" />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </SettingsRow>
      {canManage ? (
        <SettingsRow title="Add a pixel">
          <ActionForm action={savePixel.bind(null, null)} label="Add pixel" submitLabel="Add pixel">
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Name" name="name" required maxLength={60} placeholder="Main shop pixel" />
              <TextField label="Pixel / dataset id" name="pixel_id" required inputMode="numeric" maxLength={20} placeholder="123456789012345" />
              <Toggle label="Active" name="is_active" defaultChecked />
              <TextField label="Notes" name="notes" maxLength={300} className="sm:col-span-3" />
            </div>
          </ActionForm>
        </SettingsRow>
      ) : <SettingsRow title="Changes"><p className="text-sm text-muted">Only a super admin (integrations permission) can add or change pixels.</p></SettingsRow>}
    </SettingsPanel>
  );
}
