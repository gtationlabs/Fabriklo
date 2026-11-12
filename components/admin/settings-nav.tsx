"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell, Building2, ChevronRight, Code2, Megaphone, MessageCircle, Palette, Plug, Radar, ReceiptText, Search,
  Share2, ShieldCheck, User, UserCog, Workflow, type LucideIcon,
} from "lucide-react";
import type { SettingsNavIcon } from "@/lib/admin/settings-nav";

const ICONS: Record<SettingsNavIcon, LucideIcon> = {
  profile: User, account: UserCog, security: ShieldCheck, store: Building2, invoice: ReceiptText, appearance: Palette,
  notifications: Bell, social: Share2, campaigns: Megaphone, whatsapp: MessageCircle, automations: Workflow,
  integrations: Plug, pixels: Radar, api: Code2,
};

type Item = { href: string; label: string; icon: SettingsNavIcon; group: string; keywords: string; badge?: string };

export function SettingsNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => `${i.label} ${i.group} ${i.keywords}`.toLowerCase().includes(needle)) : items;
  const groups = [...new Set(shown.map((i) => i.group))];
  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">Search settings</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings..." className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-espresso" />
      </label>
      <nav aria-label="Settings" className="space-y-4 text-sm">
        {groups.length === 0 ? <p className="px-2 text-xs text-muted">No settings match “{q}”.</p> : null}
        {groups.map((g) => (
          <div key={g}>
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{g}</p>
            <ul className="space-y-0.5">
              {shown.filter((i) => i.group === g).map((i) => {
                const Icon = ICONS[i.icon];
                const active = pathname === i.href || pathname.startsWith(i.href + "/");
                return (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${active ? "bg-cream font-medium text-espresso" : "text-charcoal/80 hover:bg-white"}`}>
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">{i.label}</span>
                      {i.badge ? <span className="rounded-full bg-sand px-2 py-0.5 text-[10px] font-medium">{i.badge}</span> : null}
                      {active ? <ChevronRight className="size-4" aria-hidden /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
