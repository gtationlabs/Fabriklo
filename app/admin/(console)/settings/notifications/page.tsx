import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Badge, SettingsPanel, SettingsRow } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { notifyOffer } from "@/lib/notify/providers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationSettings() {
  await requireStaff("marketing.read");
  const offer = notifyOffer();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("notification_outbox").select("status").limit(2000);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { status: string }[]) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const channel = (name: string, v: string | null | undefined) => (
    <li className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2 text-sm">
      <span>{name}</span>
      {!v ? <Badge tone="bad">Not configured</Badge> : v === "mock" ? <Badge tone="warn">Mock (delivers nothing)</Badge> : <Badge tone="good">{v}</Badge>}
    </li>
  );
  return (
    <SettingsPanel title="Notifications" description="Order confirmations, shipping updates and marketing messages to customers." icon={<Bell className="size-5" aria-hidden />}>
      <SettingsRow title="Channels" description="Providers are chosen from the server environment. Set them up under Integrations.">
        <ul className="space-y-2">{channel("Email", offer.email)}{channel("SMS", offer.sms)}{channel("WhatsApp", offer.whatsapp)}</ul>
        <Link href="/admin/marketing/integrations" className="text-sm underline">Open Integrations</Link>
      </SettingsRow>
      <SettingsRow title="Message templates" description="The wording of each email, SMS and WhatsApp message.">
        <Link href="/admin/marketing/templates" className="text-sm underline">Edit templates</Link>
      </SettingsRow>
      <SettingsRow title="Delivery log" description="Every message queued, with its status.">
        <p className="text-sm text-muted">{[...counts.entries()].map(([k, n]) => `${n} ${k}`).join(" · ") || "Nothing sent yet."}</p>
        <Link href="/admin/marketing/outbox" className="text-sm underline">Open the outbox</Link>
      </SettingsRow>
    </SettingsPanel>
  );
}
