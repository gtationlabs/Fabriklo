import Link from "next/link";
import { visibleNav } from "@/lib/auth/permissions";
import type { StaffContext } from "@/lib/auth/staff";
import { signOut } from "@/app/admin/login/actions";

export function AdminShell({ staff, children }: { staff: StaffContext; children: React.ReactNode }) {
  const nav = visibleNav(staff.permissions);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-espresso text-cream md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4">
          <Link href="/admin" className="font-display text-xl font-semibold">Fabriklo admin</Link>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-3 text-sm md:flex-col md:overflow-visible">
          {nav.map((item) =>
            item.ready ? (
              <Link key={item.href} href={item.href} className="whitespace-nowrap rounded px-3 py-2 hover:bg-cream/10">
                {item.label}
              </Link>
            ) : (
              <span key={item.href} className="whitespace-nowrap rounded px-3 py-2 text-cream/40" title="Arrives in a later milestone">
                {item.label} <span className="text-[10px] uppercase">soon</span>
              </span>
            ),
          )}
        </nav>
        <div className="hidden border-t border-cream/10 px-5 py-4 text-xs text-cream/70 md:block">
          <p className="truncate">{staff.displayName}</p>
          <p className="capitalize">{staff.role.replace(/_/g, " ")} · MFA verified</p>
          <form action={signOut} className="mt-2">
            <button className="underline">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1 p-4 sm:p-8">{children}</div>
    </div>
  );
}
