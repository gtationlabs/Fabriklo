import Link from "next/link";
import { Menu, Search, ShoppingBag, UserRound } from "lucide-react";
import { getCart } from "@/lib/cart/service";
import { getStoreIdentity } from "@/lib/settings/public";
import { WishlistLink } from "./wishlist";

const NAV = [
  { href: "/collections/new-arrivals", label: "New Arrivals" },
  { href: "/men", label: "Men" },
  { href: "/women", label: "Women" },
  { href: "/category/accessories", label: "Accessories" },
  { href: "/shop", label: "Shop all" },
];

const MORE = [
  { href: "/wishlist", label: "Wishlist" },
  { href: "/try-on", label: "AI try-on" },
  { href: "/stores", label: "Our store" },
  { href: "/orders/track", label: "Track an order" },
  { href: "/faq", label: "Help & FAQ" },
];

/**
 * Store header in the catalogue style: white bar, departments on the left,
 * the brand name centred, search / wishlist / account / bag on the right.
 */
export async function SiteHeader() {
  const [cart, identity] = await Promise.all([getCart(), getStoreIdentity()]);
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 font-catalog text-ink backdrop-blur">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-1">
          <details className="relative lg:hidden">
            <summary className="-ml-2 flex h-10 w-10 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden" aria-label="Open menu">
              <Menu aria-hidden className="h-5 w-5" strokeWidth={1.6} />
            </summary>
            <nav aria-label="Mobile" className="absolute left-0 top-12 w-64 rounded-[6px] border border-neutral-200 bg-white p-2 text-[14px] shadow-lg">
              <form action="/search" role="search" className="mb-2 sm:hidden">
                <label htmlFor="mobile-search" className="sr-only">
                  Search products
                </label>
                <div className="flex items-center rounded-[4px] border border-neutral-300 px-3">
                  <Search aria-hidden className="h-4 w-4 text-neutral-500" />
                  <input id="mobile-search" name="q" type="search" placeholder="Search products" maxLength={80} className="w-full bg-transparent px-2 py-2 text-[14px] focus:outline-none" />
                </div>
              </form>
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-[4px] px-3 py-2 hover:bg-mist">
                  {n.label}
                </Link>
              ))}
              <div className="my-2 border-t border-neutral-200" />
              {MORE.map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-[4px] px-3 py-2 text-neutral-600 hover:bg-mist hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </details>
          <nav aria-label="Primary" className="hidden items-center gap-6 text-[13px] lg:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap underline-offset-[6px] hover:underline">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>

        <Link href="/" className="justify-self-center text-[18px] font-semibold uppercase tracking-[0.28em] sm:text-[20px]" data-testid="brand-name">
          {identity.name}
        </Link>

        <div className="flex items-center justify-end gap-0.5 sm:gap-1">
          <form action="/search" role="search" className="mr-1 hidden md:block">
            <label htmlFor="site-search" className="sr-only">
              Search products
            </label>
            <div className="flex items-center rounded-full border border-neutral-300 px-3 transition focus-within:border-ink">
              <Search aria-hidden className="h-4 w-4 text-neutral-500" />
              <input
                id="site-search"
                name="q"
                type="search"
                placeholder="Search"
                maxLength={80}
                className="w-28 bg-transparent px-2 py-1.5 text-[13px] placeholder:text-neutral-500 focus:outline-none xl:w-40"
              />
            </div>
          </form>
          <Link href="/search" className="flex h-10 w-10 items-center justify-center md:hidden" aria-label="Search">
            <Search aria-hidden className="h-5 w-5" strokeWidth={1.6} />
          </Link>
          <WishlistLink className="hidden sm:flex" />
          <Link href="/account" className="flex h-10 w-10 items-center justify-center" aria-label="My account">
            <UserRound aria-hidden className="h-5 w-5" strokeWidth={1.6} />
          </Link>
          <Link href="/cart" className="relative flex h-10 w-10 items-center justify-center" aria-label={`Cart, ${cart.item_count} items`}>
            <ShoppingBag aria-hidden className="h-5 w-5" strokeWidth={1.6} />
            {cart.item_count > 0 ? (
              <span data-testid="cart-count" className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold text-white">
                {cart.item_count}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </header>
  );
}
