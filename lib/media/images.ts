import sharp, { type Metadata } from "sharp";
import { sniffImageType } from "@/lib/tryon/images";

/**
 * Server-side preparation of product photos uploaded by staff. Same rules as
 * customer photos (magic bytes, decode, bounds) plus a re-encode to WebP that
 * strips every metadata block, so nothing from the photographer's camera or
 * editing software ends up on the public bucket.
 */
export const PRODUCT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_PHOTO_MIN_SIDE = 400;
export const PRODUCT_PHOTO_MAX_SIDE = 2000;
export const PRODUCT_PHOTOS_PER_UPLOAD = 8;

export type PreparedProductPhoto = { bytes: Uint8Array; mime: "image/webp"; width: number; height: number };
export type ProductPhotoError = "too_large" | "unsupported_type" | "undecodable" | "too_small" | "bad_aspect";

export async function prepareProductPhoto(input: Uint8Array): Promise<{ ok: true; photo: PreparedProductPhoto } | { ok: false; code: ProductPhotoError }> {
  if (input.length > PRODUCT_PHOTO_MAX_BYTES) return { ok: false, code: "too_large" };
  if (!sniffImageType(input)) return { ok: false, code: "unsupported_type" };
  let meta: Metadata;
  try {
    meta = await sharp(Buffer.from(input), { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    return { ok: false, code: "undecodable" };
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.min(w, h) < PRODUCT_PHOTO_MIN_SIDE) return { ok: false, code: "too_small" };
  if (Math.max(w, h) / Math.min(w, h) > 3) return { ok: false, code: "bad_aspect" };
  try {
    const out = await sharp(Buffer.from(input), { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: PRODUCT_PHOTO_MAX_SIDE, height: PRODUCT_PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, photo: { bytes: new Uint8Array(out.data), mime: "image/webp", width: out.info.width, height: out.info.height } };
  } catch {
    return { ok: false, code: "undecodable" };
  }
}

export const PRODUCT_PHOTO_MESSAGES: Record<ProductPhotoError, string> = {
  too_large: "That file is over 10 MB. Export a smaller version.",
  unsupported_type: "Use JPEG, PNG or WebP photos.",
  undecodable: "We couldn't read that file as a photo.",
  too_small: "That photo is too small. Use one at least 400 pixels on each side.",
  bad_aspect: "That photo is an unusual shape (more than 3:1). Crop it first.",
};
