"use server";

import { z } from "zod";
import { getCustomer } from "@/lib/account/session";
import type { ActionState } from "@/lib/admin/action-state";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  rating: z.coerce.number().int().min(1, "Choose a star rating").max(5),
  author_name: z.string().trim().min(1, "Enter the name to show").max(60).refine((s) => !/[<>]/.test(s), "No angle brackets"),
  title: z.string().trim().max(120).refine((s) => !/[<>]/.test(s), "No angle brackets"),
  body: z.string().trim().min(10, "Write at least 10 characters").max(2000).refine((s) => !/[<>]/.test(s), "No angle brackets"),
  fit: z.enum(["", "true", "small", "large"]),
  size: z.string().trim().max(20).refine((s) => !/[<>]/.test(s), "No angle brackets"),
});

export async function submitReview(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const customer = await getCustomer();
  if (!customer) return { ok: false, message: "Sign in to write a review." };
  const rl = await enforceRateLimit(`review:${customer.id}`, 5, 3_600_000);
  if (!rl.ok) return { ok: false, message: "Too many reviews in a short time. Please try again later." };
  const g = (k: string) => String(fd.get(k) ?? "");
  const parsed = schema.safeParse({ rating: g("rating"), author_name: g("author_name"), title: g("title"), body: g("body"), fit: g("fit"), size: g("size") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_product_review", {
    p_product_id: productId, p_rating: d.rating, p_title: d.title, p_body: d.body, p_author_name: d.author_name, p_fit: d.fit || null, p_size: d.size || null,
  });
  if (error) {
    if (error.hint === "duplicate") return { ok: false, message: "You have already reviewed this product." };
    if (error.hint === "sign_in" || error.hint === "disabled") return { ok: false, message: "Sign in to write a review." };
    return { ok: false, message: "We couldn't save your review. Please try again." };
  }
  return { ok: true, message: "Thank you! Your review will appear once our team has checked it." };
}
