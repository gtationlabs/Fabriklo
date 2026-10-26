import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";

const TABS = [
  ["/admin/marketing", "Overview"],
  ["/admin/marketing/coupons", "Coupons & discounts"],
  ["/admin/marketing/newsletter", "Newsletter"],
  ["/admin/marketing/templates", "Templates"],
  ["/admin/marketing/rules", "Automation rules"],
  ["/admin/marketing/outbox", "Outbox"],
  ["/admin/marketing/campaigns", "Campaigns"],
  ["/admin/marketing/integrations", "Integrations"],
] as const;

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireStaff("marketing.read");
  return (
    <div className="space-y-6">
      <nav aria-label="Marketing sections" className="flex flex-wrap gap-1 border-b border-line text-sm">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className="rounded-t px-3 py-2 hover:bg-cream">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
