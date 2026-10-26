import type { Metadata } from "next";
import { CatalogListing } from "@/components/shop/catalog-listing";
import { parseFilters } from "@/lib/catalog/filters";

export const metadata: Metadata = { title: "Women", alternates: { canonical: "/women" } };

export default async function WomenPage({ searchParams }: PageProps<"/women">) {
  const filters = parseFilters(await searchParams, { audience: "women" });
  return <CatalogListing title="Women" filters={filters} basePath="/women" lockedKeys={["audience"]} />;
}
