import type { Metadata } from "next";
import { User } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Avatar } from "@/components/admin/admin-sidebar";
import { SelectField, SettingsPanel, SettingsRow, TextField, Toggle, fieldCls } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { siteMediaUrl } from "@/lib/media/url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveProfile } from "../hub-actions";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfileSettings() {
  const staff = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("staff_profiles").select("*").eq("user_id", staff.userId).maybeSingle();
  const p = (data ?? {}) as { full_name?: string; job_title?: string; phone?: string | null; language?: string; avatar_path?: string | null; show_on_invoices?: boolean };
  const avatar = p.avatar_path ? siteMediaUrl(p.avatar_path) : null;
  return (
    <ActionForm action={saveProfile} label="Profile details" submitLabel="Save profile" className="space-y-4">
      <SettingsPanel title="Profile details" description="You can change your profile details here." icon={<User className="size-5" aria-hidden />}>
        <SettingsRow title="Public profile" description="How you appear to the rest of the team, in the sidebar and the audit log.">
          <TextField label="Display name" name="display_name" defaultValue={staff.displayName} required minLength={2} maxLength={60} />
        </SettingsRow>
        <SettingsRow title="Profile picture" description="Shown in the sidebar and the user menu.">
          <div className="flex flex-wrap items-center gap-5">
            <Avatar user={{ name: staff.displayName, avatar }} size={80} />
            <label className="flex-1 cursor-pointer rounded-xl border-2 border-dashed border-line bg-paper p-6 text-center text-sm">
              <span className="font-medium text-espresso">Click to upload</span> a photo
              <span className="block text-xs text-muted">JPEG, PNG or WebP, up to 10 MB. Cropped to a square.</span>
              <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" className={`${fieldCls} mt-3`} />
            </label>
          </div>
          {avatar ? <Toggle label="Remove current photo" name="remove_avatar" /> : null}
        </SettingsRow>
        <SettingsRow title="Personal details" description="Your name, role and contact for internal records.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Full name" name="full_name" defaultValue={p.full_name} maxLength={120} />
            <TextField label="Job title" name="job_title" defaultValue={p.job_title} maxLength={80} placeholder="Store manager" />
            <TextField label="Phone" name="phone" defaultValue={p.phone} maxLength={20} placeholder="01XXXXXXXXX" />
            <SelectField label="Interface language" name="language" defaultValue={p.language ?? "en"} options={[{ value: "en", label: "English" }, { value: "bn", label: "বাংলা (Bangla) — coming later" }]} />
          </div>
          <Toggle label="Show my name on packing slips" name="show_on_invoices" defaultChecked={p.show_on_invoices ?? false} hint="Adds “Packed by” to slips you print." />
        </SettingsRow>
      </SettingsPanel>
    </ActionForm>
  );
}
