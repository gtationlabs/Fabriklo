import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogListing } from "@/components/shop/catalog-listing";
import { parseFilters } from "@/lib/catalog/filters";
import { createSupabasePublicClient } from "@/lib/supabase/public";

async function findCollection(slug: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const { data } = await createSupabasePublicClient()
    .from("collections")
    .select("slug, name, description")
    .eq("slug", slug)
    .maybeSingle();
  return data as { slug: string; name: string; description: string } | null;
}

export async function generateMetadata({ params }: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const c = await findCollection((await params).slug);
  return c ? { title: c.name, description: c.description, alternates: { canonical: `/collections/${c.slug}` } } : { title: "Not found" };
}

export default async function CollectionPage({ params, searchParams }: PageProps<"/collections/[slug]">) {
  const c = await findCollection((await params).slug);
  if (!c) notFound();
  const filters = parseFilters(await searchParams, { collection: c.slug });
  return <CatalogListing title={c.name} description={c.description} filters={filters} basePath={`/collections/${c.slug}`} lockedKeys={["collection"]} />;
}
