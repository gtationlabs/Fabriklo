"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { flag, noAngle, str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(80).refine(noAngle, "No angle brackets"),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug: lower-case words joined by hyphens").max(80),
  parent_id: z.union([z.uuid(), z.literal("")]),
  description: z.string().max(2000).refine(noAngle, "No angle brackets"),
  position: z.coerce.number().int().min(0).max(9999),
});

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export async function saveCategory(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = schema.safeParse({
    name: str(fd, "name"),
    slug: str(fd, "slug") || slugify(str(fd, "name")),
    parent_id: str(fd, "parent_id"),
    description: str(fd, "description"),
    position: str(fd, "position") || "0",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  if (id && parsed.data.parent_id === id) return { ok: false, message: "A category cannot be its own parent." };
  const row = { ...parsed.data, parent_id: parsed.data.parent_id || null, is_active: flag(fd, "is_active") };
  const supabase = await createSupabaseServerClient();
  const { error } = id ? await supabase.from("categories").update(row).eq("id", id) : await supabase.from("categories").insert(row);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
  return { ok: true, message: id ? "Category saved." : "Category created." };
}

export async function deleteCategory(id: string): Promise<ActionState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const [{ count: products }, { count: children }] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("categories").select("id", { count: "exact", head: true }).eq("parent_id", id),
  ]);
  if ((products ?? 0) > 0) return { ok: false, message: `${products} product(s) use this category. Move them or hide the category instead.` };
  if ((children ?? 0) > 0) return { ok: false, message: "Delete or move its sub-categories first." };
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/categories");
  return { ok: true, message: "Deleted." };
}
