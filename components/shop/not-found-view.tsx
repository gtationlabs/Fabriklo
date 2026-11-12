import Link from "next/link";
import { Search } from "lucide-react";
import { btnOutline, btnPrimary } from "./store-page";

const POPULAR = [
  ["/collections/new-arrivals", "New arrivals"],
  ["/men", "Men"],
  ["/women", "Women"],
  ["/category/accessories", "Accessories"],
  ["/faq", "Help & FAQ"],
] as const;

/** 404 body in the catalogue style, with search and ways back into the shop. */
export function NotFoundView() {
  return (
    <div className="catalog-skin bg-white">
      <div className="mx-auto max-w-xl px-4 pb-24 pt-20 text-center sm:px-6">
        <p className="text-[64px] font-light leading-none tracking-[0.1em] text-neutral-300 md:text-[88px]" aria-hidden>
          404
        </p>
        <h1 className="mt-6 text-[22px] font-medium uppercase tracking-[0.14em] md:text-[26px]">Page not found</h1>
        <p className="mt-3 text-[14px] text-neutral-600">The page you were looking for has moved, sold out or never existed. Try a search instead.</p>
        <form action="/search" role="search" className="mx-auto mt-8 flex max-w-md items-center gap-2">
          <label htmlFor="nf-search" className="sr-only">
            Search products
          </label>
          <div className="flex h-12 flex-1 items-center rounded-[4px] border border-neutral-300 px-3 focus-within:border-ink">
            <Search aria-hidden className="h-4 w-4 text-neutral-500" />
            <input id="nf-search" name="q" type="search" maxLength={80} placeholder="Search products" className="w-full bg-transparent px-2 text-[14px] focus:outline-none" />
          </div>
          <button type="submit" className={btnPrimary}>
            Search
          </button>
        </form>
        <ul className="mt-8 flex flex-wrap justify-center gap-2 text-[13px]" aria-label="Popular pages">
          {POPULAR.map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="block rounded-full border border-neutral-300 px-4 py-1.5 transition hover:border-ink">
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/" className={`${btnOutline} mt-10`}>
          Back to home
        </Link>
      </div>
    </div>
  );
}
