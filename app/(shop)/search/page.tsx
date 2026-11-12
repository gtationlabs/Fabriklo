import type { Metadata } from "next";
import { Search } from "lucide-react";
import { CatalogListing } from "@/components/shop/catalog-listing";
import { parseFilters } from "@/lib/catalog/filters";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const filters = parseFilters(await searchParams);
  return (
    <>
      <div className="border-b border-neutral-200 bg-white font-catalog text-ink">
        <form action="/search" role="search" className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-6 sm:px-6">
          <label htmlFor="search-page-q" className="sr-only">
            Search products
          </label>
          <div className="flex h-12 flex-1 items-center rounded-[4px] border border-neutral-300 px-4 focus-within:border-ink">
            <Search aria-hidden className="h-4 w-4 text-neutral-500" />
            <input
              id="search-page-q"
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              maxLength={80}
              placeholder="Search shirts, denim, colours…"
              className="w-full bg-transparent px-3 text-[15px] focus:outline-none"
            />
          </div>
          <button type="submit" className="h-12 rounded-[4px] bg-ink px-6 text-[14px] font-medium text-white hover:bg-neutral-800">
            Search
          </button>
        </form>
      </div>
      <CatalogListing title={filters.q ? `Search results` : "Search"} filters={filters} basePath="/search" />
    </>
  );
}
