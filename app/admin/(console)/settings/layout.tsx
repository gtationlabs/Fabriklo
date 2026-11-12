import { Download } from "lucide-react";
import { SettingsNav } from "@/components/admin/settings-nav";
import { visibleSettingsNav } from "@/lib/admin/settings-nav";
import { requireStaff } from "@/lib/auth/staff";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const items = visibleSettingsNav(staff.permissions).map(({ href, label, icon, group, keywords, badge }) => ({ href, label, icon, group, keywords, badge }));
  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-espresso">Settings</h1>
          <p className="mt-1 text-sm text-muted">Everything about your account, the store and its growth tools.</p>
        </div>
        {staff.permissions.includes("settings.manage") ? (
          <a href="/admin/settings/export" download className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-espresso hover:bg-mist">
            <Download className="size-4" aria-hidden /> Export config
          </a>
        ) : null}
      </header>
      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        <aside><SettingsNav items={items} /></aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
