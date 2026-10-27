import type { Metadata } from "next";
import { CatalogListing } from "@/components/shop/catalog-listing";
import { parseFilters } from "@/lib/catalog/filters";

export const metadata: Metadata = { title: "Shop all", alternates: { canonical: "/shop" } };

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const filters = parseFilters(await searchParams);
  return <CatalogListing title="Shop all" description="Tees, shirts, trousers, polos, outerwear and accessories." filters={filters} basePath="/shop" />;
}
