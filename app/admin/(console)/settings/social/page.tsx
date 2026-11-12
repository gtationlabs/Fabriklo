import type { Metadata } from "next";
import { Share2 } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { SettingsPanel, SettingsRow, TextField } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveSocial } from "../hub-actions";

export const metadata: Metadata = { title: "Social profiles" };

export default async function SocialSettings() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("site_settings").select("value").eq("key", "store.social").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, string>;
  return (
    <ActionForm action={saveSocial} label="Social profiles" submitLabel="Save social profiles">
      <SettingsPanel title="Social profiles" description="Links shown as icons in the shop footer. Leave a field empty to hide it." icon={<Share2 className="size-5" aria-hidden />}>
        <SettingsRow title="Profiles">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Facebook page" name="facebook" defaultValue={v.facebook} placeholder="https://facebook.com/yourbrand" maxLength={240} />
            <TextField label="Instagram" name="instagram" defaultValue={v.instagram} placeholder="https://instagram.com/yourbrand" maxLength={240} />
            <TextField label="TikTok" name="tiktok" defaultValue={v.tiktok} placeholder="https://tiktok.com/@yourbrand" maxLength={240} />
            <TextField label="YouTube" name="youtube" defaultValue={v.youtube} placeholder="https://youtube.com/@yourbrand" maxLength={240} />
          </div>
        </SettingsRow>
        <SettingsRow title="WhatsApp chat" description="Adds a “Chat on WhatsApp” link to the footer.">
          <TextField label="WhatsApp number" name="whatsapp" defaultValue={v.whatsapp} placeholder="01XXXXXXXXX" maxLength={20} />
        </SettingsRow>
      </SettingsPanel>
    </ActionForm>
  );
}
