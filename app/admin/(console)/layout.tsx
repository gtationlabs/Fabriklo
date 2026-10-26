import { AdminShell } from "@/components/admin/admin-shell";
import { requireStaff } from "@/lib/auth/staff";

/** Every console route requires an active staff member with an aal2 (MFA) session. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return <AdminShell staff={staff}>{children}</AdminShell>;
}
