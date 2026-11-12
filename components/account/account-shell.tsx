import Link from "next/link";
import type { ReactNode } from "react";
import { Heart, MapPin, Package, Sparkles, UserRound } from "lucide-react";
import { StorePage, type Crumb } from "@/components/shop/store-page";
import { signOutCustomer } from "@/app/(shop)/account/actions";

const LINKS = [
  { href: "/account", label: "Overview", icon: UserRound },
  { href: "/account/addresses", label: "Address book", icon: MapPin },
  { href: "/account/try-on", label: "Try-on photos", icon: Sparkles },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/orders/track", label: "Track an order", icon: Package },
] as const;

/** Signed-in account frame: side menu on desktop, scrolling tabs on phones. */
export function AccountShell({ title, current, crumbs, intro, children }: { title: string; current: string; crumbs?: Crumb[]; intro?: ReactNode; children: ReactNode }) {
  return (
    <StorePage title={title} crumbs={[{ href: "/account", label: "My account" }, ...(crumbs ?? [])]} intro={intro} width="wide" align="left">
      <div className="grid gap-8 lg:grid-cols-[220px_1fr] lg:gap-12">
        <nav aria-label="Account" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex gap-2 text-[13px] lg:flex-col lg:gap-0.5">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = href === current;
              return (
                <li key={href} className="shrink-0">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 whitespace-nowrap rounded-[4px] border px-3 py-2.5 transition lg:border-0 ${active ? "border-ink bg-ink text-white" : "border-neutral-200 hover:bg-mist"}`}
                  >
                    <Icon aria-hidden className="h-4 w-4" strokeWidth={1.6} />
                    {label}
                  </Link>
                </li>
              );
            })}
            <li className="shrink-0 lg:mt-3 lg:border-t lg:border-neutral-200 lg:pt-3">
              <form action={signOutCustomer}>
                <button type="submit" className="w-full whitespace-nowrap rounded-[4px] border border-neutral-200 px-3 py-2.5 text-left text-neutral-600 hover:bg-mist hover:text-ink lg:border-0">
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </StorePage>
  );
}
