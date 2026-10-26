import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { filtersToQuery, type CatalogFilters } from "@/lib/catalog/filters";
import { getFacets, searchProducts } from "@/lib/catalog/queries";
import { ProductCard } from "./product-card";

const SORT_LABELS: Record<CatalogFilters["sort"], string> = {
  newest: "Newest",
  featured: "Featured",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

/**
 * Server-rendered listing. Filters are a plain GET form, so state lives in the
 * URL, works without JavaScript, and is shareable/bookmarkable.
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
  const [{ products, total, pageSize }, facets] = await Promise.all([searchProducts(filters), getFacets()]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const locked = new Set(lockedKeys);

  const filterForm = (
    <form action={basePath} method="get" className="space-y-6 text-sm" aria-label="Filter products">
      {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
      {!locked.has("category") ? (
        <fieldset>
          <legend className="mb-2 font-semibold text-espresso">Category</legend>
          <select name="category" defaultValue={filters.category ?? ""} className="w-full rounded border border-line bg-white px-2 py-1.5">
            <option value="">All categories</option>
            {facets.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </fieldset>
      ) : null}
      <fieldset>
        <legend className="mb-2 font-semibold text-espresso">Size</legend>
        <div className="flex flex-wrap gap-2">
          {facets.sizes.map((s) => (
            <label key={s} className="cursor-pointer">
              <input type="checkbox" name="size" value={s} defaultChecked={filters.sizes.includes(s)} className="peer sr-only" />
              <span className="inline-block min-w-10 rounded border border-line px-2 py-1 text-center peer-checked:border-espresso peer-checked:bg-espresso peer-checked:text-cream peer-focus-visible:outline-2 peer-focus-visible:outline-bronze">
                {s}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold text-espresso">Colour</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {facets.colors.map((c) => (
            <label key={c.name} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" name="color" value={c.name} defaultChecked={filters.colors.includes(c.name)} className="accent-bronze" />
              <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: c.hex ?? "#ccc" }} aria-hidden />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold text-espresso">Price (৳)</legend>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`min-${basePath}`}>Minimum price</label>
          <input id={`min-${basePath}`} name="min" inputMode="numeric" defaultValue={filters.minPriceMinor != null ? filters.minPriceMinor / 100 : ""} placeholder="Min" className="w-full rounded border border-line bg-white px-2 py-1.5" />
          <span aria-hidden>–</span>
          <label className="sr-only" htmlFor={`max-${basePath}`}>Maximum price</label>
          <input id={`max-${basePath}`} name="max" inputMode="numeric" defaultValue={filters.maxPriceMinor != null ? filters.maxPriceMinor / 100 : ""} placeholder="Max" className="w-full rounded border border-line bg-white px-2 py-1.5" />
        </div>
      </fieldset>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="in_stock" value="1" defaultChecked={filters.inStock} className="accent-bronze" />
        In stock only
      </label>
      <fieldset>
        <legend className="mb-2 font-semibold text-espresso">Sort by</legend>
        <select name="sort" defaultValue={filters.sort} className="w-full rounded border border-line bg-white px-2 py-1.5">
          {Object.entries(SORT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded bg-espresso px-3 py-2 font-medium text-cream hover:bg-charcoal">
          Apply
        </button>
        <Link href={basePath} className="rounded border border-line px-3 py-2 text-center">
          Reset
        </Link>
      </div>
    </form>
  );

  const pageHref = (page: number) => `${basePath}${filtersToQuery({ ...filters, page }, [...lockedKeys])}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-semibold text-espresso">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-muted">{description}</p> : null}
        <p className="mt-2 text-sm text-muted" aria-live="polite" data-testid="result-count">
          {total} {total === 1 ? "product" : "products"}
          {filters.q ? <> for “{filters.q}”</> : null}
        </p>
      </header>
      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside>
          <details className="rounded border border-line p-3 lg:hidden">
            <summary className="flex cursor-pointer items-center gap-2 font-medium">
              <SlidersHorizontal aria-hidden className="h-4 w-4" /> Filters & sort
            </summary>
            <div className="mt-4">{filterForm}</div>
          </details>
          <div className="hidden lg:block">{filterForm}</div>
        </aside>
        <section aria-label="Products">
          {products.length === 0 ? (
            <div className="rounded border border-dashed border-line p-10 text-center">
              <p className="font-medium text-espresso">No products match these filters.</p>
              <Link href={basePath} className="mt-3 inline-block text-bronze-strong underline">
                Clear filters
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
          {pages > 1 ? (
            <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-2 text-sm">
              {filters.page > 1 ? (
                <Link href={pageHref(filters.page - 1)} className="rounded border border-line px-3 py-1.5" rel="prev">
                  Previous
                </Link>
              ) : null}
              <span className="px-2">
                Page {filters.page} of {pages}
              </span>
              {filters.page < pages ? (
                <Link href={pageHref(filters.page + 1)} className="rounded border border-line px-3 py-1.5" rel="next">
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
