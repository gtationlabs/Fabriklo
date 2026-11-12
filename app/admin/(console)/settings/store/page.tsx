import type { Metadata } from "next";
import { Building2, Phone } from "lucide-react";
import { ContactForm, IdentityForm } from "@/components/admin/settings-forms";
import { SettingsPanel, SettingsRow } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Store details" };

export default async function StoreSettings() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("site_settings").select("key, value").in("key", ["store.identity", "store.contact"]);
  const s = Object.fromEntries(((data ?? []) as { key: string; value: Record<string, unknown> }[]).map((r) => [r.key, r.value]));
  const identity = { name: String(s["store.identity"]?.name ?? "Fabriklo"), tagline: String(s["store.identity"]?.tagline ?? ""), locale: String(s["store.identity"]?.locale ?? "en-BD") };
  const contact = {
    email: String(s["store.contact"]?.email ?? ""), phone: String(s["store.contact"]?.phone ?? ""), address: String(s["store.contact"]?.address ?? ""),
    hours: String(s["store.contact"]?.hours ?? ""), note: String(s["store.contact"]?.note ?? ""),
  };
  return (
    <div className="space-y-6">
      <SettingsPanel title="Store details" description="Brand name, tagline and language. Every change is validated in the database and audited." icon={<Building2 className="size-5" aria-hidden />}>
        <SettingsRow title="Store identity" description="Shown in the header, footer, page titles and invoices.">
          <IdentityForm identity={identity} />
        </SettingsRow>
      </SettingsPanel>
      <SettingsPanel title="Contact" description="Shown in the footer, on the Stores page and on invoices." icon={<Phone className="size-5" aria-hidden />}>
        <SettingsRow title="Contact details">
          <ContactForm contact={contact} />
        </SettingsRow>
      </SettingsPanel>
    </div>
  );
}
