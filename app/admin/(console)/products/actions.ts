"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import {
  fieldErrors,
  productSchema,
  stockAdjustSchema,
  variantSchema,
  variantUpdateSchema,
  type FieldErrors,
} from "@/lib/catalog/admin-schemas";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Admin catalogue mutations. Each action: (1) re-checks staff + permission +
 * MFA on the server, (2) validates with Zod, (3) writes with the staff member's
 * own JWT so Postgres RLS enforces the same rule a third time.
 */
export type ActionState = {
  ok: boolean;
  message: string | null;
  errors: FieldErrors;
  /** Echo of submitted text fields so forms keep user input after a failed submit. */
  values?: Record<string, string>;
};
const idle: ActionState = { ok: false, message: null, errors: {} };

function echo(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, 8000);
  return out;
}

function productInput(fd: FormData) {
  return {
    title: fd.get("title") ?? "",
    slug: fd.get("slug") ?? "",
    subtitle: fd.get("subtitle") ?? "",
    description: fd.get("description") ?? "",
    materials: fd.get("materials") ?? "",
    care: fd.get("care") ?? "",
    category_id: fd.get("category_id") ?? "",
    audience: fd.get("audience") ?? "unisex",
    status: fd.get("status") ?? "draft",
    featured: fd.get("featured") === "on",
    tags: fd.get("tags") ?? "",
    seo_title: fd.get("seo_title") ?? "",
    seo_description: fd.get("seo_description") ?? "",
  };
}

export async function createProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ...idle, values: echo(fd), message: auth.message };
  const parsed = productSchema.safeParse({ ...productInput(fd), status: "draft" });
  if (!parsed.success) return { ...idle, values: echo(fd), errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("products").insert(parsed.data).select("id").single();
  if (error || !data) return { ...idle, values: echo(fd), message: friendlyDbError(error) };
  revalidatePath("/admin/products");
  redirect(`/admin/products/${data.id}?created=1`);
}

export async function updateProduct(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ...idle, values: echo(fd), message: auth.message };
  if (!z.uuid().safeParse(productId).success) return { ...idle, values: echo(fd), message: "Unknown product." };
  const parsed = productSchema.safeParse(productInput(fd));
  if (!parsed.success) return { ...idle, values: echo(fd), errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };

  const supabase = await createSupabaseServerClient();
  if (parsed.data.status === "active") {
    const { count } = await supabase
      .from("product_variants")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("is_active", true);
    if (!count) return { ...idle, values: echo(fd), message: "Add at least one active variant before publishing." };
  }
  const { data, error } = await supabase.from("products").update(parsed.data).eq("id", productId).select("slug").maybeSingle();
  if (error) return { ...idle, values: echo(fd), message: friendlyDbError(error) };
  if (!data) return { ...idle, values: echo(fd), message: "Product not found or you can't edit it." };
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/product/${data.slug}`);
  revalidatePath("/shop");
  return { ok: true, message: "Saved.", errors: {} };
}

export async function addVariant(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ...idle, values: echo(fd), message: auth.message };
  if (!z.uuid().safeParse(productId).success) return { ...idle, values: echo(fd), message: "Unknown product." };
  const parsed = variantSchema.safeParse({
    sku: fd.get("sku") ?? "",
    size: fd.get("size") ?? "",
    color: fd.get("color") ?? "",
    color_hex: fd.get("color_hex") ?? "",
    price: fd.get("price") ?? "",
    compare_at: fd.get("compare_at") ?? "",
    cost: (fd.get("cost") as string | null) ?? "",
  });
  if (!parsed.success) return { ...idle, values: echo(fd), errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };
  const { sku, size, color, color_hex, price, compare_at, cost } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_variants")
    .insert({ product_id: productId, sku, size, color, color_hex, price_minor: price, compare_at_minor: compare_at })
    .select("id")
    .single();
  if (error || !data) return { ...idle, values: echo(fd), message: friendlyDbError(error) };

  let message = "Variant added.";
  if (cost != null) {
    if (auth.staff.permissions.includes("products.costs")) {
      const { error: costError } = await supabase.from("variant_costs").insert({ variant_id: data.id, cost_minor: cost });
      if (costError) message = "Variant added, but the cost could not be saved.";
    } else {
      message = "Variant added. Cost was ignored (no cost permission).";
    }
  }
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message, errors: {} };
}

export async function updateVariant(variantId: string, productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ...idle, values: echo(fd), message: auth.message };
  if (!z.uuid().safeParse(variantId).success) return { ...idle, values: echo(fd), message: "Unknown variant." };
  const parsed = variantUpdateSchema.safeParse({
    price: fd.get("price") ?? "",
    compare_at: fd.get("compare_at") ?? "",
    is_active: fd.get("is_active") === "on",
  });
  if (!parsed.success) return { ...idle, values: echo(fd), errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_variants")
    .update({ price_minor: parsed.data.price, compare_at_minor: parsed.data.compare_at, is_active: parsed.data.is_active })
    .eq("id", variantId)
    .select("id")
    .maybeSingle();
  if (error) return { ...idle, values: echo(fd), message: friendlyDbError(error) };
  if (!data) return { ...idle, values: echo(fd), message: "Variant not found or you can't edit it." };
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: "Saved.", errors: {} };
}

export async function adjustStock(variantId: string, productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("inventory.adjust");
  if (!auth.ok) return { ...idle, values: echo(fd), message: auth.message };
  const parsed = stockAdjustSchema.safeParse({
    warehouse_id: fd.get("warehouse_id"),
    movement_type: fd.get("movement_type"),
    delta: fd.get("delta"),
    reason: fd.get("reason"),
    idempotency_key: fd.get("idempotency_key"),
  });
  if (!parsed.success) return { ...idle, values: echo(fd), errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_adjust_stock", {
    p_variant_id: variantId,
    p_warehouse_id: d.warehouse_id,
    p_delta: d.delta,
    p_movement_type: d.movement_type,
    p_reason: d.reason,
    p_idempotency_key: d.idempotency_key,
  });
  if (error) return { ...idle, values: echo(fd), message: friendlyDbError(error) };
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/inventory");
  return { ok: true, message: "Stock updated.", errors: {} };
}
