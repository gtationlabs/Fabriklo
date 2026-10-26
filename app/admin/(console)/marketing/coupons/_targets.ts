import "server-only";
import type { TargetOptions } from "@/components/admin/marketing-forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function loadTargets(): Promise<TargetOptions> {
  const supabase = await createSupabaseServerClient();
  const [cats, cols, vars] = await Promise.all([
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("collections").select("id, name").order("name"),
    supabase.from("product_variants").select("id, sku, size, color, products(title)").order("sku").limit(500),
  ]);
  return {
    categories: (cats.data ?? []) as { id: string; name: string }[],
    collections: (cols.data ?? []) as { id: string; name: string }[],
    variants: ((vars.data ?? []) as unknown as { id: string; sku: string; size: string; color: string; products: { title: string } | null }[]).map((v) => ({ id: v.id, label: `${v.sku} · ${v.products?.title ?? ""} ${v.size}/${v.color}` })),
  };
}
