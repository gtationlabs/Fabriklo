import type { Metadata } from "next";
import { InviteForm, StaffTable, type RoleOption, type StaffRow } from "@/components/admin/staff-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const staff = await requireStaff("staff.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: rows }, { data: roles }] = await Promise.all([
    supabase.rpc("admin_list_staff"),
    supabase.from("staff_roles").select("code, name, description").order("rank", { ascending: false }),
  ]);
  const members = (rows ?? []) as Omit<StaffRow, "can_reset_mfa">[];
  const resettable = await Promise.all(
    members.map(async (m) => {
      if (m.is_self) return false;
      const { data } = await supabase.rpc("admin_can_reset_mfa", { p_user_id: m.user_id });
      return Boolean(data);
    }),
  );
  const list: StaffRow[] = members.map((m, i) => ({ ...m, can_reset_mfa: resettable[i] ?? false }));
  const actorIsSuper = staff.role === "super_admin";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-espresso">Staff</h1>
        <p className="max-w-2xl text-sm text-muted">
          Roles are checked in the database on every request, and every staff member needs an authenticator app (MFA). Suspending someone
          takes effect on their next request. The last active super admin cannot be removed.
        </p>
      </header>
      <InviteForm roles={(roles ?? []) as RoleOption[]} canAssignSuper={actorIsSuper} />
      <StaffTable rows={list} roles={(roles ?? []) as RoleOption[]} canAssignSuper={actorIsSuper} actorIsSuper={actorIsSuper} />
      <section className="rounded-lg border border-line bg-white p-5 text-sm">
        <h2 className="font-semibold text-espresso">Roles</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {((roles ?? []) as RoleOption[]).map((r) => (
            <li key={r.code}><span className="font-medium">{r.name}</span> <span className="text-muted">— {r.description}</span></li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">The full permission matrix is in docs/ADMIN_RBAC_MATRIX.md.</p>
      </section>
    </div>
  );
}
