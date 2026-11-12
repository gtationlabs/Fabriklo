"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { flag, noAngle, str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/admin/reviews");
  revalidatePath("/");
  revalidatePath("/product/[slug]", "page");
}

const moderateSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  staff_reply: z.string().max(1000, "Reply: at most 1000 characters").refine(noAngle, "No angle brackets"),
});

export async function moderateReview(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("reviews.moderate");
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = moderateSchema.safeParse({ status: str(fd, "status"), staff_reply: str(fd, "staff_reply") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const featured = flag(fd, "is_featured");
  if (featured && parsed.data.status !== "approved") return { ok: false, message: "Only approved reviews can be featured on the home page." };
  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase.from("product_reviews").select("staff_reply").eq("id", id).maybeSingle();
  const reply = parsed.data.staff_reply || null;
  const { error } = await supabase.from("product_reviews").update({
    status: parsed.data.status,
    is_featured: featured,
    staff_reply: reply,
    replied_at: reply && reply !== before?.staff_reply ? new Date().toISOString() : undefined,
    moderated_by: auth.staff.userId,
    moderated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Review updated." };
}

const importSchema = z.object({
  product_id: z.uuid("Choose a product"),
  author_name: z.string().min(1, "Enter the customer's name").max(60).refine(noAngle, "No angle brackets"),
  author_city: z.string().max(40).refine(noAngle, "No angle brackets"),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().max(120).refine(noAngle, "No angle brackets"),
  body: z.string().min(10, "The review needs at least 10 characters").max(2000).refine(noAngle, "No angle brackets"),
  fit: z.enum(["", "true", "small", "large"]),
  size_bought: z.string().max(20).refine(noAngle, "No angle brackets"),
});

/** Adds a review the customer gave elsewhere (Facebook, WhatsApp, in store). Marked as imported. */
export async function importReview(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("reviews.moderate");
  if (!auth.ok) return { ok: false, message: auth.message };
  const keys = ["product_id", "author_name", "author_city", "rating", "title", "body", "fit", "size_bought"] as const;
  const parsed = importSchema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  if (!flag(fd, "confirm_real")) return { ok: false, message: "Confirm that a real customer wrote this review." };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("product_reviews").insert({
    ...d, fit: d.fit || null, size_bought: d.size_bought || null, source: "imported", status: "approved",
    moderated_by: auth.staff.userId, moderated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Review added and approved." };
}

export async function deleteReview(id: string): Promise<ActionState> {
  const auth = await checkStaff("reviews.moderate");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("product_reviews").delete().eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Deleted." };
}
