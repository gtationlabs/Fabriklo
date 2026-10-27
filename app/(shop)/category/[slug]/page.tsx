import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogListing } from "@/components/shop/catalog-listing";
import { parseFilters } from "@/lib/catalog/filters";
import { getFacets } from "@/lib/catalog/queries";

async function findCategory(slug: string) {
  const facets = await getFacets();
  return facets.categories.find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/category/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const cat = await findCategory(slug);
  return cat ? { title: cat.name, alternates: { canonical: `/category/${cat.slug}` } } : { title: "Not found" };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/category/[slug]">) {
  const { slug } = await params;
  const cat = await findCategory(slug);
  if (!cat) notFound();
  const filters = parseFilters(await searchParams, { category: cat.slug });
  return <CatalogListing title={cat.name} filters={filters} basePath={`/category/${cat.slug}`} lockedKeys={["category"]} />;
}
