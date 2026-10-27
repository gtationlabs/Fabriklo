"use client";

import { useActionState } from "react";
import { changeStaffRole, inviteStaff, passwordResetLink, resetStaffMfa, setStaffStatus, type StaffActionState } from "@/app/admin/(console)/staff/actions";
import { FormMessage, inputCls } from "@/components/admin/form-bits";

const idle: StaffActionState = { ok: false, message: null };
export type RoleOption = { code: string; name: string; description: string };

export function InviteForm({ roles, canAssignSuper }: { roles: RoleOption[]; canAssignSuper: boolean }) {
  const [state, action, pending] = useActionState(inviteStaff, idle);
  return (
    <form action={action} key={String(state.ok)} aria-label="Invite staff" className="space-y-3 rounded-lg border border-line bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="block font-medium">Email</span>
          <input name="email" type="email" required maxLength={254} defaultValue={state.values?.email ?? ""} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Display name</span>
          <input name="display_name" required minLength={2} maxLength={120} defaultValue={state.values?.display_name ?? ""} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Role</span>
          <select name="role_code" defaultValue={state.values?.role_code ?? "support_agent"} className={inputCls}>
            {roles
              .filter((r) => canAssignSuper || r.code !== "super_admin")
              .map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">
        A new email gets an invitation link that you send yourself (nothing is emailed from here). An existing account is simply given the role.
        Every member must set up an authenticator app before they can use the admin.
      </p>
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">
        {pending ? "Working…" : "Add staff member"}
      </button>
      <FormMessage state={state} />
      {state.link ? <OnceLink link={state.link} label="Invitation link" /> : null}
    </form>
  );
}

function OnceLink({ link, label }: { link: string; label: string }) {
  return (
    <div className="rounded border border-bronze/40 bg-cream p-3 text-sm" data-testid="once-link">
      <p className="font-medium text-espresso">{label} (shown once)</p>
      <input readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full rounded border border-line bg-white px-2 py-1 font-mono text-xs" />
    </div>
  );
}

export type StaffRow = {
  user_id: string;
  email: string;
  role_code: string;
  status: string;
  display_name: string;
  created_at: string;
  last_sign_in_at: string | null;
  mfa_enrolled: boolean;
  is_self: boolean;
  can_reset_mfa: boolean;
};

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function StaffTable({ rows, roles, canAssignSuper, actorIsSuper }: { rows: StaffRow[]; roles: RoleOption[]; canAssignSuper: boolean; actorIsSuper: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm" data-testid="staff-table">
        <thead className="bg-cream text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Member</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">MFA</th>
            <th className="px-3 py-2">Last sign-in</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <StaffRowView key={r.user_id} row={r} roles={roles} canAssignSuper={canAssignSuper} actorIsSuper={actorIsSuper} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffRowView({ row, roles, canAssignSuper, actorIsSuper }: { row: StaffRow; roles: RoleOption[]; canAssignSuper: boolean; actorIsSuper: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(changeStaffRole, idle);
  const [statusState, statusAction, statusPending] = useActionState(setStaffStatus, idle);
  const [mfaState, mfaAction, mfaPending] = useActionState(resetStaffMfa, idle);
  const [pwState, pwAction, pwPending] = useActionState(passwordResetLink, idle);
  const locked = row.is_self || (row.role_code === "super_admin" && !actorIsSuper);
  const roleName = roles.find((x) => x.code === row.role_code)?.name ?? row.role_code;
  return (
    <>
      <tr data-testid="staff-row" data-email={row.email}>
        <td className="px-3 py-2">
          <span className="block font-medium text-espresso">{row.display_name}{row.is_self ? " (you)" : ""}</span>
          <span className="block text-xs text-muted">{row.email}</span>
        </td>
        <td className="px-3 py-2">
          {locked ? (
            roleName
          ) : (
            <form action={roleAction} className="flex items-center gap-1">
              <input type="hidden" name="user_id" value={row.user_id} />
              <select name="role_code" defaultValue={row.role_code} aria-label={`Role for ${row.display_name}`} className="rounded border border-line px-2 py-1 text-sm">
                {roles
                  .filter((x) => canAssignSuper || x.code !== "super_admin")
                  .map((x) => (
                    <option key={x.code} value={x.code}>{x.name}</option>
                  ))}
              </select>
              <button type="submit" disabled={rolePending} className="rounded border border-line px-2 py-1 text-xs">Change</button>
            </form>
          )}
        </td>
        <td className="px-3 py-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${row.status === "active" ? "bg-success/10 text-success" : row.status === "invited" ? "bg-bronze/10 text-bronze-strong" : "bg-danger/10 text-danger"}`}>{row.status}</span>
        </td>
        <td className="px-3 py-2">{row.mfa_enrolled ? "Enrolled" : "Not yet"}</td>
        <td className="px-3 py-2 text-xs text-muted">{row.last_sign_in_at ? dateFmt.format(new Date(row.last_sign_in_at)) : "never"}</td>
        <td className="px-3 py-2">
          {locked ? (
            <span className="text-xs text-muted">{row.is_self ? "Ask another admin" : "Super admin only"}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              <form action={statusAction}>
                <input type="hidden" name="user_id" value={row.user_id} />
                <input type="hidden" name="status" value={row.status === "suspended" ? "active" : "suspended"} />
                <button type="submit" disabled={statusPending} className="rounded border border-line px-2 py-1 text-xs">
                  {row.status === "suspended" ? "Reactivate" : "Suspend"}<span className="sr-only"> {row.display_name}</span>
                </button>
              </form>
              {row.can_reset_mfa && row.mfa_enrolled ? (
                <form action={mfaAction} onSubmit={(e) => { if (!confirm(`Reset ${row.display_name}'s authenticator? They will enrol a new one at next sign-in.`)) e.preventDefault(); }}>
                  <input type="hidden" name="user_id" value={row.user_id} />
                  <button type="submit" disabled={mfaPending} className="rounded border border-line px-2 py-1 text-xs">
                    Reset authenticator<span className="sr-only"> for {row.display_name}</span>
                  </button>
                </form>
              ) : null}
              <form action={pwAction}>
                <input type="hidden" name="user_id" value={row.user_id} />
                <input type="hidden" name="email" value={row.email} />
                <button type="submit" disabled={pwPending} className="rounded border border-line px-2 py-1 text-xs">
                  Password reset link<span className="sr-only"> for {row.display_name}</span>
                </button>
              </form>
            </div>
          )}
        </td>
      </tr>
      {[roleState, statusState, mfaState, pwState].some((s) => s.message) ? (
        <tr>
          <td colSpan={6} className="px-3 pb-2">
            {[roleState, statusState, mfaState, pwState].filter((s) => s.message).map((s, i) => (
              <div key={i}>
                <FormMessage state={s} />
                {s.link ? <OnceLink link={s.link} label="Password reset link" /> : null}
              </div>
            ))}
          </td>
        </tr>
      ) : null}
    </>
  );
}
