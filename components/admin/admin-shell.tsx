import { visibleNav } from "@/lib/auth/permissions";
import type { StaffContext } from "@/lib/auth/staff";
import { siteMediaUrl } from "@/lib/media/url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminSidebar } from "./admin-sidebar";

export async function AdminShell({ staff, children }: { staff: StaffContext; children: React.ReactNode }) {
  const nav = visibleNav(staff.permissions).map(({ href, label, icon, group }) => ({ href, label, icon, group }));
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from("staff_profiles").select("avatar_path").eq("user_id", staff.userId).maybeSingle();
  const avatar = profile?.avatar_path ? siteMediaUrl(profile.avatar_path as string) : null;
  return (
    <div className="min-h-screen bg-mist md:flex print:bg-white">
      <AdminSidebar
        nav={nav}
        user={{ name: staff.displayName, email: staff.email ?? "", role: staff.role.replace(/_/g, " "), avatar }}
      />
      <div className="min-w-0 flex-1 p-4 sm:p-8 print:p-0">{children}</div>
    </div>
  );
}
