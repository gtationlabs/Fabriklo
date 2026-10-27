import type { Metadata } from "next";
import { CatalogListing } from "@/components/shop/catalog-listing";
import { parseFilters } from "@/lib/catalog/filters";

export const metadata: Metadata = { title: "Men", alternates: { canonical: "/men" } };

export default async function MenPage({ searchParams }: PageProps<"/men">) {
  const filters = parseFilters(await searchParams, { audience: "men" });
  return <CatalogListing title="Men" filters={filters} basePath="/men" lockedKeys={["audience"]} />;
}
