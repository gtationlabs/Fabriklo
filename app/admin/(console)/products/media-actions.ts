"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { PRODUCT_PHOTOS_PER_UPLOAD, PRODUCT_PHOTO_MESSAGES, prepareProductPhoto } from "@/lib/media/images";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Product photo management. Every action re-checks products.write (+ MFA),
 * the file is validated and re-encoded on the server, the object is written
 * with the staff member's own session (storage RLS) and the row is created by
 * an audited RPC. Direct writes to product_media are not granted to staff.
 */
export type MediaState = { ok: boolean; message: string | null };
const uuid = z.uuid();

function revalidate(productId: string, slug?: string | null) {
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/shop");
  if (slug) revalidatePath(`/product/${slug}`);
}

export async function uploadProductMedia(productId: string, _prev: MediaState, fd: FormData): Promise<MediaState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!uuid.safeParse(productId).success) return { ok: false, message: "Unknown product." };
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, message: "Choose at least one photo." };
  if (files.length > PRODUCT_PHOTOS_PER_UPLOAD) return { ok: false, message: `Upload at most ${PRODUCT_PHOTOS_PER_UPLOAD} photos at a time.` };
  const altBase = String(fd.get("alt") ?? "").trim();
  if (altBase.length < 3 || altBase.length > 180) return { ok: false, message: "Describe the photos in 3–180 characters (used as alt text)." };
  const variantRaw = String(fd.get("variant_id") ?? "");
  const variantId = variantRaw && uuid.safeParse(variantRaw).success ? variantRaw : null;

  const supabase = await createSupabaseServerClient();
  const { data: product } = await supabase.from("products").select("slug").eq("id", productId).maybeSingle();
  if (!product) return { ok: false, message: "Unknown product." };

  let saved = 0;
  const problems: string[] = [];
  for (const [i, file] of files.entries()) {
    const prepared = await prepareProductPhoto(new Uint8Array(await file.arrayBuffer()));
    if (!prepared.ok) {
      problems.push(`${file.name}: ${PRODUCT_PHOTO_MESSAGES[prepared.code]}`);
      continue;
    }
    const objectPath = `products/${productId}/${randomUUID()}.webp`;
    const { error: upErr } = await supabase.storage.from("product-media").upload(objectPath, Buffer.from(prepared.photo.bytes), { contentType: "image/webp", cacheControl: "31536000" });
    if (upErr) {
      problems.push(`${file.name}: upload failed (${upErr.message})`);
      continue;
    }
    const alt = files.length > 1 ? `${altBase} (${i + 1})` : altBase;
    const { error } = await supabase.rpc("admin_add_product_media", {
      p_product_id: productId, p_storage_path: objectPath, p_alt: alt, p_width: prepared.photo.width, p_height: prepared.photo.height, p_variant_id: variantId,
    });
    if (error) {
      await supabase.storage.from("product-media").remove([objectPath]);
      problems.push(`${file.name}: ${friendlyDbError(error)}`);
      if (error.hint === "media_limit") break;
      continue;
    }
    saved += 1;
  }
  revalidate(productId, product.slug);
  if (!saved) return { ok: false, message: problems.join(" · ") };
  return { ok: true, message: `${saved} photo${saved === 1 ? "" : "s"} added.${problems.length ? " Skipped: " + problems.join(" · ") : ""}` };
}

export async function updateProductMedia(mediaId: string, productId: string, _prev: MediaState, fd: FormData): Promise<MediaState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!uuid.safeParse(mediaId).success || !uuid.safeParse(productId).success) return { ok: false, message: "Unknown photo." };
  const alt = String(fd.get("alt") ?? "").trim();
  if (alt.length < 3 || alt.length > 200) return { ok: false, message: "Alt text must be 3–200 characters." };
  const variantRaw = String(fd.get("variant_id") ?? "");
  const variantId = variantRaw && uuid.safeParse(variantRaw).success ? variantRaw : null;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_product_media", { p_media_id: mediaId, p_alt: alt, p_variant_id: variantId });
  if (error) return { ok: false, message: friendlyDbError(error) };
  const { data: product } = await supabase.from("products").select("slug").eq("id", productId).maybeSingle();
  revalidate(productId, product?.slug);
  return { ok: true, message: "Photo updated." };
}

export async function moveProductMedia(productId: string, _prev: MediaState, fd: FormData): Promise<MediaState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ok: false, message: auth.message };
  const mediaId = String(fd.get("media_id") ?? "");
  const dir = fd.get("direction") === "up" ? -1 : 1;
  if (!uuid.safeParse(mediaId).success || !uuid.safeParse(productId).success) return { ok: false, message: "Unknown photo." };
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase.from("product_media").select("id").eq("product_id", productId).eq("is_tryon_garment", false).order("position").order("created_at");
  const ids = (rows ?? []).map((r) => r.id as string);
  const i = ids.indexOf(mediaId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: false, message: "Nothing to move." };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const { error } = await supabase.rpc("admin_reorder_product_media", { p_product_id: productId, p_ids: ids });
  if (error) return { ok: false, message: friendlyDbError(error) };
  const { data: product } = await supabase.from("products").select("slug").eq("id", productId).maybeSingle();
  revalidate(productId, product?.slug);
  return { ok: true, message: "Order updated." };
}

export async function deleteProductMedia(mediaId: string, productId: string): Promise<MediaState> {
  const auth = await checkStaff("products.write");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!uuid.safeParse(mediaId).success || !uuid.safeParse(productId).success) return { ok: false, message: "Unknown photo." };
  const supabase = await createSupabaseServerClient();
  const { data: path, error } = await supabase.rpc("admin_delete_product_media", { p_media_id: mediaId });
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (typeof path === "string" && !path.startsWith("/")) {
    // Best effort: the row is gone; a stray object is harmless and can be swept later.
    await supabase.storage.from("product-media").remove([path]);
  }
  const { data: product } = await supabase.from("products").select("slug").eq("id", productId).maybeSingle();
  revalidate(productId, product?.slug);
  return { ok: true, message: "Photo removed." };
}
