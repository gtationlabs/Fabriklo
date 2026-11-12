import type { Metadata } from "next";
import { KeyRound, UserCog } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, SettingsPanel, SettingsRow, TextField } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { changePassword } from "../hub-actions";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings() {
  const staff = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const { data: perms } = await supabase.from("permissions").select("code, description").in("code", staff.permissions).order("code");
  return (
    <div className="space-y-6">
      <SettingsPanel title="Account" description="Your sign-in and what your role allows." icon={<UserCog className="size-5" aria-hidden />}>
        <SettingsRow title="Sign-in email" description="Ask a super admin to change the email on a staff account.">
          <p className="rounded-lg border border-line bg-paper px-3 py-2 text-sm" data-testid="account-email">{staff.email}</p>
        </SettingsRow>
        <SettingsRow title="Role" description="Roles are assigned on the Staff page.">
          <Badge tone="info">{staff.role.replace(/_/g, " ")}</Badge>
          <ul className="grid gap-1 text-xs text-muted sm:grid-cols-2">
            {((perms ?? []) as { code: string; description: string }[]).map((p) => <li key={p.code}><code className="text-charcoal">{p.code}</code> · {p.description}</li>)}
          </ul>
        </SettingsRow>
      </SettingsPanel>
      <SettingsPanel title="Password" description="At least 12 characters. Other devices stay signed in; sign them out on the Security page." icon={<KeyRound className="size-5" aria-hidden />}>
        <SettingsRow title="Change password">
          <ActionForm action={changePassword} label="Change password" submitLabel="Change password">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="New password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
              <TextField label="Repeat new password" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
            </div>
          </ActionForm>
        </SettingsRow>
      </SettingsPanel>
    </div>
  );
}
