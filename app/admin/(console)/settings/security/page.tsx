import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, SettingsPanel, SettingsRow } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setStaffMfaRequired, signOutOtherSessions } from "../hub-actions";

export const metadata: Metadata = { title: "Security" };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function SecuritySettings() {
  const staff = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const [{ data: factors }, { data: events }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    staff.permissions.includes("audit.read")
      ? supabase.from("audit_events").select("id, action, entity_type, occurred_at").eq("actor_id", staff.userId).order("occurred_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: null }),
  ]);
  const totp = (factors?.totp ?? []).filter((f) => f.status === "verified");
  return (
    <SettingsPanel title="Security" description="Two-step sign-in and your active sessions." icon={<ShieldCheck className="size-5" aria-hidden />}>
      <SettingsRow
        title="Two-step sign-in for staff"
        description="When on, every staff sign-in also needs a 6-digit code from an authenticator app. When off, email and password are enough. Only a super admin can change this."
      >
        <p className="text-sm" data-testid="staff-mfa-status">
          {staff.mfaRequired ? <Badge tone="good">On: authenticator code required</Badge> : <Badge tone="warn">Off: password only</Badge>}
        </p>
        {staff.role === "super_admin" ? (
          <ActionForm
            action={setStaffMfaRequired}
            label="Two-step sign-in for staff"
            submitLabel={staff.mfaRequired ? "Turn off authenticator codes" : "Turn on authenticator codes"}
            danger={staff.mfaRequired}
            confirm={staff.mfaRequired
              ? "Turn off authenticator codes for every staff account? A stolen password alone will then open the admin."
              : "Require an authenticator code for every staff sign-in? You and every other staff member will be asked to set one up straight away."}
          >
            <input type="hidden" name="required" value={staff.mfaRequired ? "off" : "on"} />
          </ActionForm>
        ) : null}
      </SettingsRow>
      <SettingsRow title="Authenticator app" description="Used when two-step sign-in is on. A super admin can reset it from the Staff page if you lose your phone.">
        {totp.length ? (
          <ul className="space-y-2 text-sm">
            {totp.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2">
                <span>{f.friendly_name || "Authenticator app"} <span className="text-xs text-muted">added {when(f.created_at)}</span></span>
                <Badge tone="good">Active</Badge>
              </li>
            ))}
          </ul>
        ) : <Badge tone="bad">No verified authenticator</Badge>}
      </SettingsRow>
      <SettingsRow title="Sessions" description="Signed in on a shared or lost device? Sign out everywhere except here.">
        <ActionForm action={signOutOtherSessions} label="Sign out other sessions" submitLabel="Sign out other devices" danger confirm="Sign out every other device?" />
      </SettingsRow>
      {events ? (
        <SettingsRow title="Your recent activity" description="From the audit log.">
          <ul className="space-y-1 text-sm">
            {(events as { id: number; action: string; entity_type: string; occurred_at: string }[]).map((e) => (
              <li key={e.id} className="flex justify-between gap-3"><span><code>{e.action}</code> <span className="text-muted">{e.entity_type}</span></span><span className="text-xs text-muted">{when(e.occurred_at)}</span></li>
            ))}
            {events.length === 0 ? <li className="text-muted">Nothing yet.</li> : null}
          </ul>
        </SettingsRow>
      ) : null}
    </SettingsPanel>
  );
}
