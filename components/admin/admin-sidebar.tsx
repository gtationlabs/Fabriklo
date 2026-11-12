"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Boxes, ChevronRight, ChevronsUpDown, CreditCard, FolderOpen, Image as ImageIcon, LayoutDashboard,
  LayoutTemplate, LogOut, MapPin, Megaphone, Menu, MessageSquare, Package, ScrollText, Settings, Shield, ShieldAlert,
  PackageCheck, ShoppingCart, Shirt, Store, Tag, Truck, User, UserCog, Users, X, type LucideIcon,
} from "lucide-react";
import type { AdminNavIcon } from "@/lib/auth/permissions";
import { signOut } from "@/app/admin/login/actions";

const ICONS: Record<AdminNavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, products: Package, categories: FolderOpen, inventory: Boxes, orders: ShoppingCart,
  leads: Users, risk: ShieldAlert, slider: ImageIcon, content: LayoutTemplate, reviews: MessageSquare, tryon: Shirt,
  coupons: Tag, marketing: Megaphone, zones: MapPin, methods: Truck, courier: PackageCheck, payments: CreditCard,
  users: Shield, staff: UserCog, audit: ScrollText, settings: Settings,
};

type NavLink = { href: string; label: string; icon: AdminNavIcon; group: string };
type ShellUser = { name: string; email: string; role: string; avatar: string | null };

function isActive(pathname: string, href: string, all: NavLink[]) {
  if (href === "/admin") return pathname === "/admin";
  if (!(pathname === href || pathname.startsWith(href + "/"))) return false;
  // The most specific match wins (Coupons inside Marketing).
  return !all.some((o) => o.href.length > href.length && (pathname === o.href || pathname.startsWith(o.href + "/")));
}

export function Avatar({ user, size = 36 }: { user: Pick<ShellUser, "name" | "avatar">; size?: number }) {
  const initial = (user.name.trim()[0] ?? "?").toUpperCase();
  return user.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element -- tiny staff avatar from our own bucket
    <img src={user.avatar} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-espresso font-semibold text-cream" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initial}
    </span>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {open ? (
        <div role="menu" aria-label="Account" className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-line bg-white text-sm shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="font-semibold text-espresso">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="py-1">
            <Link role="menuitem" href="/admin/settings/profile" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2 hover:bg-mist">
              <User className="size-4" aria-hidden /> View Profile
            </Link>
            <Link role="menuitem" href="/admin/settings/account" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2 hover:bg-mist">
              <Settings className="size-4" aria-hidden /> Account Settings
            </Link>
          </div>
          <form action={signOut} className="border-t border-line py-1">
            <button role="menuitem" className="flex w-full items-center gap-3 px-4 py-2 text-danger hover:bg-danger/5">
              <LogOut className="size-4" aria-hidden /> Logout
            </button>
          </form>
        </div>
      ) : null}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-mist"
        data-testid="user-menu-button"
      >
        <Avatar user={user} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-espresso">{user.name}</span>
          <span className="block truncate text-xs capitalize text-muted">{user.role}</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted" aria-hidden />
      </button>
    </div>
  );
}

export function AdminSidebar({ nav, user }: { nav: NavLink[]; user: ShellUser }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawer(false);
  }
  const groups = [...new Set(nav.map((n) => n.group))];

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden print:hidden">
        <Link href="/admin" className="flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-espresso">
          FABRIKLO <span className="rounded bg-espresso px-1.5 py-0.5 font-sans text-[10px] font-medium text-cream">Admin</span>
        </Link>
        <button type="button" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} aria-controls="admin-sidebar" className="rounded p-2 hover:bg-mist">
          {drawer ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          <span className="sr-only">{drawer ? "Close menu" : "Open menu"}</span>
        </button>
      </div>
      <aside
        id="admin-sidebar"
        className={`${drawer ? "flex" : "hidden"} fixed inset-x-0 bottom-0 top-[57px] z-20 flex-col border-r border-line bg-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 print:hidden`}
      >
        <div className="hidden items-center gap-2 border-b border-line px-6 py-5 md:flex">
          <Link href="/admin" className="font-display text-xl font-semibold tracking-wide text-espresso">FABRIKLO</Link>
          <span className="rounded bg-espresso px-1.5 py-0.5 text-[10px] font-medium text-cream">Admin</span>
        </div>
        <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4 text-sm">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/80">{g}</p>
              <ul className="space-y-0.5">
                {nav.filter((n) => n.group === g).map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = isActive(pathname, item.href, nav);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${active ? "bg-espresso font-medium text-cream" : "text-charcoal/80 hover:bg-mist hover:text-espresso"}`}
                      >
                        <Icon className="size-[18px] shrink-0" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        {active ? <ChevronRight className="size-4" aria-hidden /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-line px-3 py-3 text-sm">
          <div className="px-3 pb-1">
            <p className="truncate text-xs text-muted" data-testid="admin-email">{user.email}</p>
            <span className="mt-1 inline-block rounded-full border border-line px-2 py-0.5 text-[11px] capitalize text-espresso">{user.role}</span>
          </div>
          <Link href="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-charcoal/80 hover:bg-mist">
            <Store className="size-[18px]" aria-hidden /> Back to Store
          </Link>
          <form action={signOut}>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-danger hover:bg-danger/5">
              <LogOut className="size-[18px]" aria-hidden /> Logout
            </button>
          </form>
          <div className="border-t border-line pt-2">
            <UserMenu user={user} />
          </div>
        </div>
      </aside>
    </>
  );
}
