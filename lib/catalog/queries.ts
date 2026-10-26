import "server-only";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { PAGE_SIZE, type CatalogFilters } from "./filters";
import { sortSizes } from "./sizes";

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  audience: string;
  category_slug: string | null;
  category_name: string | null;
  is_demo: boolean;
  featured: boolean;
  tryon_enabled: boolean;
  min_price_minor: number;
  max_compare_at_minor: number | null;
  colors: { name: string; hex: string | null }[];
  sizes: string[];
  available: number;
};

export type Facets = {
  sizes: string[];
  colors: { name: string; hex: string | null }[];
  categories: { slug: string; name: string }[];
  price: { min: number | null; max: number | null };
};

export async function searchProducts(f: CatalogFilters, pageSize = PAGE_SIZE) {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("catalog_search", {
    p_query: f.q,
    p_category: f.category,
    p_audience: f.audience,
    p_collection: f.collection,
    p_sizes: f.sizes.length ? f.sizes : null,
    p_colors: f.colors.length ? f.colors : null,
    p_min_price_minor: f.minPriceMinor,
    p_max_price_minor: f.maxPriceMinor,
    p_in_stock: f.inStock,
    p_sort: f.sort,
    p_limit: pageSize,
    p_offset: (f.page - 1) * pageSize,
  });
  if (error) throw new Error("Catalog search failed");
  const rows = (data ?? []) as (ProductCard & { total_count: number })[];
  return {
    products: rows.map((r) => ({ ...r, sizes: sortSizes(r.sizes ?? []), colors: r.colors ?? [] })) as ProductCard[],
    total: rows[0]?.total_count ?? 0,
    pageSize,
  };
}

export async function getFacets(): Promise<Facets> {
  const { data, error } = await createSupabasePublicClient().rpc("catalog_facets");
  if (error || !data) return { sizes: [], colors: [], categories: [], price: { min: null, max: null } };
  const facets = data as Facets;
  return { ...facets, sizes: sortSizes(facets.sizes) };
}

export type ProductDetail = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  materials: string;
  care: string;
  audience: string;
  is_demo: boolean;
  tryon_enabled: boolean;
  seo_title: string | null;
  seo_description: string | null;
  category: { slug: string; name: string } | null;
  variants: {
    id: string;
    sku: string;
    size: string;
    color: string;
    color_hex: string | null;
    price_minor: number;
    compare_at_minor: number | null;
    available: number;
  }[];
  media: { id: string; storage_path: string; alt: string; position: number }[];
};

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, title, subtitle, description, materials, care, audience, is_demo, tryon_enabled, seo_title, seo_description, category:categories(slug, name), variants:product_variants(id, sku, size, color, color_hex, price_minor, compare_at_minor, position), media:product_media(id, storage_path, alt, position)",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;

  type Row = Omit<ProductDetail, "variants" | "category"> & {
    category: { slug: string; name: string } | { slug: string; name: string }[] | null;
    variants: (Omit<ProductDetail["variants"][number], "available"> & { position: number })[];
  };
  const row = data as unknown as Row;
  const ids = row.variants.map((v) => v.id);
  const { data: avail } = await supabase.rpc("get_variant_availability", { p_variant_ids: ids });
  const byId = new Map(((avail ?? []) as { variant_id: string; available: number }[]).map((a) => [a.variant_id, a.available]));

  return {
    ...row,
    category: Array.isArray(row.category) ? (row.category[0] ?? null) : row.category,
    variants: row.variants
      .sort((a, b) => a.position - b.position)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        color_hex: v.color_hex,
        price_minor: v.price_minor,
        compare_at_minor: v.compare_at_minor,
        available: byId.get(v.id) ?? 0,
      })),
    media: [...row.media].sort((a, b) => a.position - b.position),
  };
}
