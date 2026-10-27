import Link from "next/link";
import { Menu, Search, ShoppingBag, UserRound } from "lucide-react";
import { getCart } from "@/lib/cart/service";
import { getStoreIdentity } from "@/lib/settings/public";

const NAV = [
  { href: "/shop", label: "Shop all" },
  { href: "/men", label: "Men" },
  { href: "/women", label: "Women" },
  { href: "/category/outerwear", label: "Outerwear" },
  { href: "/category/accessories", label: "Accessories" },
];

export async function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const [cart, identity] = await Promise.all([getCart(), getStoreIdentity()]);
  const tone = overlay ? "text-cream" : "text-espresso";
  return (
    <header
      className={`${overlay ? "absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-espresso/70 to-transparent" : "sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur"}`}
    >
      <div className={`mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 ${tone}`}>
        <details className="relative lg:hidden">
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center" aria-label="Open menu">
            <Menu aria-hidden className="h-5 w-5" />
          </summary>
          <nav aria-label="Mobile" className="absolute left-0 top-12 w-56 rounded-md border border-line bg-paper p-2 text-espresso shadow-lg">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="block rounded px-3 py-2 text-sm hover:bg-cream">
                {n.label}
              </Link>
            ))}
          </nav>
        </details>
        <Link href="/" className="font-display text-2xl font-semibold tracking-wide" data-testid="brand-name">
          {identity.name}
        </Link>
        <nav aria-label="Primary" className="ml-6 hidden gap-6 text-sm lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:underline underline-offset-4">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <form action="/search" role="search" className="hidden sm:block">
            <label htmlFor="site-search" className="sr-only">
              Search products
            </label>
            <div className="flex items-center rounded-full border border-current/30 px-3">
              <Search aria-hidden className="h-4 w-4 opacity-70" />
              <input
                id="site-search"
                name="q"
                type="search"
                placeholder="Search"
                maxLength={80}
                className="w-32 bg-transparent px-2 py-1.5 text-sm placeholder:text-current/60 focus:outline-none md:w-48"
              />
            </div>
          </form>
          <Link href="/account" className="flex h-10 w-10 items-center justify-center" aria-label="My account">
            <UserRound aria-hidden className="h-5 w-5" />
          </Link>
          <Link href="/cart" className="relative flex h-10 w-10 items-center justify-center" aria-label={`Cart, ${cart.item_count} items`}>
            <ShoppingBag aria-hidden className="h-5 w-5" />
            {cart.item_count > 0 ? (
              <span data-testid="cart-count" className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bronze px-1 text-[10px] font-semibold text-white">
                {cart.item_count}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </header>
  );
}
