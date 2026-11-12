import type { Metadata } from "next";
import Link from "next/link";
import { Code2 } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, SettingsPanel, SettingsRow, SelectField, TextField, Toggle } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createApiKey, revokeApiKey } from "../hub-actions";

export const metadata: Metadata = { title: "API & Webhooks" };

type Key = { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "never");

export default async function ApiSettings() {
  const staff = await requireStaff("integrations.read");
  const canManage = staff.permissions.includes("integrations.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: allow }, { count: hooks }] = await Promise.all([
    supabase.from("api_keys").select("id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at").order("created_at", { ascending: false }),
    supabase.from("site_settings").select("value").eq("key", "automation.webhook_allowlist").maybeSingle(),
    supabase.from("automation_rules").select("id", { count: "exact", head: true }),
  ]);
  const keys = (data ?? []) as Key[];
  const site = publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const hosts = ((allow?.value as { hosts?: string[] } | null)?.hosts ?? []).filter((h) => typeof h === "string");
  return (
    <SettingsPanel title="API & Webhooks" description="Read-only access for your other tools (accounting, a warehouse sheet, a dashboard), and webhooks that tell them when something happens." icon={<Code2 className="size-5" aria-hidden />}>
      <SettingsRow title="Endpoints" description="Send the key as a Bearer token. 60 requests a minute per key.">
        <ul className="space-y-1 font-mono text-xs">
          <li>GET {site}/api/v1/products <span className="text-muted">(products.read)</span></li>
          <li>GET {site}/api/v1/orders?since=2026-11-01 <span className="text-muted">(orders.read)</span></li>
          <li>GET {site}/api/v1/inventory <span className="text-muted">(inventory.read)</span></li>
        </ul>
        <pre className="overflow-x-auto rounded-lg bg-espresso p-3 text-xs text-cream">curl -H &quot;Authorization: Bearer fbk_…&quot; {site}/api/v1/orders</pre>
      </SettingsRow>
      <SettingsRow title="API keys" description="Only a fingerprint is stored; the full key is shown once when you create it.">
        <ul className="space-y-2" data-testid="api-keys">
          {keys.length === 0 ? <li className="text-sm text-muted">No keys yet.</li> : null}
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              <strong>{k.name}</strong>
              <code className="text-xs">{k.prefix}…</code>
              <span className="text-xs text-muted">{k.scopes.join(", ")} · created {day(k.created_at)} · last used {day(k.last_used_at)}{k.expires_at ? ` · expires ${day(k.expires_at)}` : ""}</span>
              <span className="ml-auto">{k.revoked_at ? <Badge tone="neutral">Revoked</Badge> : <Badge tone="good">Active</Badge>}</span>
              {canManage && !k.revoked_at ? <ActionForm action={revokeApiKey.bind(null, k.id)} label={`Revoke ${k.name}`} submitLabel="Revoke" danger compact confirm="Revoke this key? Anything using it stops working." /> : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <ActionForm action={createApiKey} label="Create API key" submitLabel="Create key" className="space-y-3 rounded-xl border border-line p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Key name" name="name" required maxLength={60} placeholder="Accounting export" />
              <SelectField label="Expires" name="expires_days" defaultValue="365" options={[{ value: "30", label: "In 30 days" }, { value: "90", label: "In 90 days" }, { value: "365", label: "In a year" }, { value: "0", label: "Never" }]} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Toggle label="Products" name="scope_products.read" defaultChecked />
              <Toggle label="Orders" name="scope_orders.read" hint="Includes customer names and phones." />
              <Toggle label="Stock levels" name="scope_inventory.read" />
            </div>
          </ActionForm>
        ) : <p className="text-sm text-muted">Only a super admin can create or revoke keys.</p>}
      </SettingsRow>
      <SettingsRow title="Webhooks" description="Outgoing webhooks are automation rules with a “webhook” action, signed with WEBHOOK_SIGNING_SECRET and sent only to allow-listed hosts.">
        <p className="text-sm">{hooks ?? 0} automation rule(s) · allowed hosts: {hosts.length ? hosts.map((h) => <code key={h} className="mr-1 text-xs">{h}</code>) : "none yet"}</p>
        <p className="flex gap-4 text-sm"><Link href="/admin/marketing/rules/new" className="underline">New webhook rule</Link><Link href="/admin/marketing/integrations" className="underline">Edit allowed hosts</Link></p>
      </SettingsRow>
    </SettingsPanel>
  );
}
