import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { SORTS, filtersToQuery, type CatalogFilters } from "@/lib/catalog/filters";
import { LISTING_PROMO, itemRange, listingNav, tierPills } from "@/lib/catalog/listing";
import { getCollections, getFacets, searchProducts } from "@/lib/catalog/queries";
import { DropdownDismiss, StickyBar } from "./listing-client";
import { ProductCard } from "./product-card";

const SORT_LABELS: Record<CatalogFilters["sort"], string> = {
  newest: "Default",
  featured: "Featured",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

/** One filter button with its panel. A <details> menu: works without JavaScript. */
function Dropdown({ label, align = "left", wide = false, children }: { label: ReactNode; align?: "left" | "right"; wide?: boolean; children: ReactNode }) {
  return (
    <details name="listing-filter" data-dropdown className="group/dd relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-[4px] border border-neutral-300 bg-white px-3 md:gap-3 text-[13px] transition hover:border-neutral-500 group-open/dd:border-ink md:h-[38px] md:min-w-[88px] md:justify-between md:px-4 [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown aria-hidden className="h-3.5 w-3.5 transition group-open/dd:rotate-180" />
      </summary>
      <div
        className={`absolute top-full z-30 mt-2 rounded-[4px] border border-neutral-200 bg-white p-4 text-[13px] shadow-lg ${wide ? "w-72" : "w-60"} ${align === "right" ? "right-0" : "left-0"}`}
      >
        {children}
      </div>
    </details>
  );
}

function PanelActions({ clearHref }: { clearHref: string }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-neutral-100 pt-3">
      <Link href={clearHref} className="text-[12px] text-neutral-600 underline underline-offset-2">
        Clear
      </Link>
      <button type="submit" className="rounded-[4px] bg-ink px-4 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700">
        Apply
      </button>
    </div>
  );
}

/**
 * Listing page in the catalogue layout: department bar, tier pills,
 * breadcrumb with Color / Size / Price / Sort menus, a promo strip and a
 * four-column grid. Filters are a plain GET form, so state lives in the URL
 * and is shareable.
 */
export async function CatalogListing({
  title,
  description,
  filters,
  basePath,
  lockedKeys = [],
}: {
  title: string;
  description?: string;
  filters: CatalogFilters;
  basePath: string;
  lockedKeys?: (keyof CatalogFilters)[];
}) {
  const [{ products, total, pageSize }, facets, collections] = await Promise.all([searchProducts(filters), getFacets(), getCollections()]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const locked = new Set(lockedKeys);
  const href = (f: Partial<CatalogFilters>) => `${basePath}${filtersToQuery({ ...filters, page: 1, ...f }, [...lockedKeys])}`;
  const pageHref = (page: number) => `${basePath}${filtersToQuery({ ...filters, page }, [...lockedKeys])}`;

  const nav = listingNav(facets.categories, collections);
  const pills = tierPills(collections, filters, basePath, lockedKeys);
  const categoryName = filters.category && !locked.has("category") ? facets.categories.find((c) => c.slug === filters.category)?.name : null;
  const collectionName = filters.collection && !locked.has("collection") ? collections.find((c) => c.slug === filters.collection)?.name : null;
  const crumbs = [
    { href: "/", label: "Home" },
    { href: basePath, label: title },
    ...(categoryName ? [{ href: href({ collection: null }), label: categoryName }] : []),
    ...(collectionName ? [{ href: href({}), label: collectionName }] : []),
  ];
  const range = itemRange(filters.page, pageSize, total);
  const priceSet = filters.minPriceMinor != null || filters.maxPriceMinor != null || filters.inStock;

  const countEl = (
    <p className="text-[12px] text-neutral-700" aria-live="polite" data-testid="result-count">
      {range}
      {filters.q ? <> for “{filters.q}”</> : null}
    </p>
  );

  return (
    <div className="min-h-[60vh] bg-mist font-catalog text-ink" data-testid="catalog-listing">
      <DropdownDismiss />
      <h1 className="sr-only">{title}</h1>
      {description ? <p className="sr-only">{description}</p> : null}

      <nav aria-label="Departments" className="border-b border-neutral-200 bg-white">
        <ul className="mx-auto flex max-w-7xl items-center gap-6 overflow-x-auto px-4 py-4 text-[13px] [scrollbar-width:none] sm:px-6 md:justify-center md:gap-8">
          {nav.map((n) => {
            const active = n.href === basePath;
            return (
              <li key={n.href} className="shrink-0">
                <Link href={n.href} aria-current={active ? "page" : undefined} className={`underline-offset-[6px] hover:underline ${active ? "underline" : ""}`}>
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <StickyBar className="sticky top-16 z-20">
        {pills.length > 1 ? (
          <nav aria-label="Collections" className="border-b border-neutral-200 bg-white/95 backdrop-blur">
            <ul className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2.5 text-[12px] [scrollbar-width:none] sm:px-6 md:justify-center md:gap-4">
              {pills.map((p) => (
                <li key={p.label} className="shrink-0">
                  <Link
                    href={p.href}
                    aria-current={p.active ? "true" : undefined}
                    className={`block rounded-full px-3.5 py-1.5 transition ${p.active ? "bg-ink font-semibold text-white ring-2 ring-ink ring-offset-2 ring-offset-white" : "hover:bg-neutral-100"}`}
                  >
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="bg-mist/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 md:py-5">
            <div className="min-w-0">
              <nav aria-label="Breadcrumb" className="group-data-[stuck=true]/bar:hidden">
                <ol className="flex flex-wrap items-center gap-2 text-[12px]">
                  {crumbs.map((c, i) => (
                    <li key={`${c.href}-${i}`} className="flex items-center gap-2">
                      {i > 0 ? <span aria-hidden className="text-neutral-400">/</span> : null}
                      <Link href={c.href} aria-current={i === crumbs.length - 1 ? "page" : undefined} className="underline underline-offset-2 hover:no-underline">
                        {c.label}
                      </Link>
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="mt-1 group-data-[stuck=false]/bar:sr-only group-data-[stuck=true]/bar:mt-0">{countEl}</div>
            </div>

            <form action={basePath} method="get" aria-label="Filter products" className="flex flex-wrap items-center gap-2 md:gap-3">
              {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
              {filters.category && !locked.has("category") ? <input type="hidden" name="category" value={filters.category} /> : null}
              {filters.audience && !locked.has("audience") ? <input type="hidden" name="audience" value={filters.audience} /> : null}
              {filters.collection && !locked.has("collection") ? <input type="hidden" name="collection" value={filters.collection} /> : null}
              {filters.sort !== "newest" ? <input type="hidden" name="sort" value={filters.sort} /> : null}

              <Dropdown label={<>Color{filters.colors.length ? <span className="text-neutral-600"> ({filters.colors.length})</span> : null}</>} wide>
                <fieldset>
                  <legend className="mb-3 font-semibold">Color</legend>
                  <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
                    {facets.colors.map((c) => (
                      <label key={c.name} className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" name="color" value={c.name} defaultChecked={filters.colors.includes(c.name)} className="accent-ink" />
                        <span className="h-3.5 w-3.5 rounded-full border border-neutral-300" style={{ backgroundColor: c.hex ?? "#ccc" }} aria-hidden />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <PanelActions clearHref={href({ colors: [] })} />
              </Dropdown>

              <Dropdown label={<>Size{filters.sizes.length ? <span className="text-neutral-600"> ({filters.sizes.length})</span> : null}</>}>
                <fieldset>
                  <legend className="mb-3 font-semibold">Size</legend>
                  <div className="flex flex-wrap gap-2">
                    {facets.sizes.map((s) => (
                      <label key={s} className="cursor-pointer">
                        <input type="checkbox" name="size" value={s} defaultChecked={filters.sizes.includes(s)} className="peer sr-only" />
                        <span className="inline-block min-w-10 rounded-[4px] border border-neutral-300 px-2 py-1.5 text-center peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-ink">
                          {s}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <PanelActions clearHref={href({ sizes: [] })} />
              </Dropdown>

              <Dropdown label={<>Price{priceSet ? <span aria-label="(set)" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-ink" /> : null}</>} align="right">
                <fieldset>
                  <legend className="mb-3 font-semibold">Price (BDT)</legend>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor="price-min">Minimum price</label>
                    <input id="price-min" name="min" inputMode="numeric" defaultValue={filters.minPriceMinor != null ? filters.minPriceMinor / 100 : ""} placeholder="Min" className="w-full rounded-[4px] border border-neutral-300 px-2 py-1.5" />
                    <span aria-hidden>–</span>
                    <label className="sr-only" htmlFor="price-max">Maximum price</label>
                    <input id="price-max" name="max" inputMode="numeric" defaultValue={filters.maxPriceMinor != null ? filters.maxPriceMinor / 100 : ""} placeholder="Max" className="w-full rounded-[4px] border border-neutral-300 px-2 py-1.5" />
                  </div>
                </fieldset>
                <label className="mt-3 flex items-center gap-2">
                  <input type="checkbox" name="in_stock" value="1" defaultChecked={filters.inStock} className="accent-ink" />
                  In stock only
                </label>
                <PanelActions clearHref={href({ minPriceMinor: null, maxPriceMinor: null, inStock: false })} />
              </Dropdown>

              <div className="md:ml-6">
                <Dropdown
                  align="right"
                  label={
                    <span>
                      <span className="hidden text-neutral-600 sm:inline">Sort: </span>{SORT_LABELS[filters.sort]}
                    </span>
                  }
                >
                  <ul className="-m-1">
                    {SORTS.map((s) => (
                      <li key={s}>
                        <Link
                          href={href({ sort: s })}
                          aria-current={filters.sort === s ? "true" : undefined}
                          className={`block rounded-[3px] px-2 py-1.5 hover:bg-neutral-100 ${filters.sort === s ? "font-semibold" : ""}`}
                        >
                          {SORT_LABELS[s]}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Dropdown>
              </div>
            </form>
          </div>
        </div>
      </StickyBar>

      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <p className="rounded-[3px] bg-ink px-4 py-2.5 text-center text-[13px] font-semibold text-white" data-testid="listing-promo">
          {LISTING_PROMO}
        </p>

        <section aria-label="Products" className="mt-5">
          {products.length === 0 ? (
            <div className="rounded-[4px] border border-dashed border-neutral-300 bg-white p-10 text-center">
              <p className="font-medium">No products match these filters.</p>
              <Link href={basePath} className="mt-3 inline-block underline">
                Clear filters
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4 lg:gap-y-14">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
          {pages > 1 ? (
            <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-2 text-[13px]">
              {filters.page > 1 ? (
                <Link href={pageHref(filters.page - 1)} className="rounded-[4px] border border-neutral-300 bg-white px-3 py-1.5" rel="prev">
                  Previous
                </Link>
              ) : null}
              <span className="px-2">
                Page {filters.page} of {pages}
              </span>
              {filters.page < pages ? (
                <Link href={pageHref(filters.page + 1)} className="rounded-[4px] border border-neutral-300 bg-white px-3 py-1.5" rel="next">
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
