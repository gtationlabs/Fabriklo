import type { Metadata } from "next";
import { CatalogListing } from "@/components/shop/catalog-listing";
import { parseFilters } from "@/lib/catalog/filters";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const filters = parseFilters(await searchParams);
  return <CatalogListing title={filters.q ? `Search results` : "Search"} filters={filters} basePath="/search" />;
}
