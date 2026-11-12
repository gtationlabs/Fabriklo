import "server-only";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import type { FeaturedReviewRow } from "./testimonials";

export type PublicReview = {
  id: string; author_name: string; author_city: string; rating: number; title: string; body: string;
  verified_purchase: boolean; staff_reply: string | null; fit: "true" | "small" | "large" | null; size_bought: string | null; created_at: string;
};
export type ProductReviews = { count: number; average: number | null; reviews: PublicReview[] };

export async function getFeaturedReviews(): Promise<FeaturedReviewRow[]> {
  try {
    const { data, error } = await createSupabasePublicClient().rpc("featured_reviews", { p_limit: 12 });
    return error || !Array.isArray(data) ? [] : (data as FeaturedReviewRow[]);
  } catch {
    return [];
  }
}

export async function getProductReviews(productId: string): Promise<ProductReviews> {
  try {
    const { data, error } = await createSupabasePublicClient().rpc("product_reviews_public", { p_product_id: productId, p_limit: 20 });
    if (error || !data) return { count: 0, average: null, reviews: [] };
    const d = data as { count: number; average: number | string | null; reviews: PublicReview[] };
    return { count: Number(d.count) || 0, average: d.average == null ? null : Number(d.average), reviews: d.reviews ?? [] };
  } catch {
    return { count: 0, average: null, reviews: [] };
  }
}
