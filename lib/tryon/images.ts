import sharp, { type Metadata } from "sharp";

/**
 * Server-side checks for customer photos. The browser's checks are a courtesy;
 * these are the ones that count: magic bytes (not the declared type), decode,
 * dimensions, and a re-encode that drops EXIF/GPS and other metadata.
 */
export const TRYON_MAX_BYTES = 10 * 1024 * 1024;
export const TRYON_MIN_SIDE = 256;
export const TRYON_MAX_SIDE = 1296; // FASHN processes at 864 × 1296

export type PreparedPhoto = { bytes: Uint8Array; mime: "image/jpeg"; width: number; height: number };

export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export type PrepareError = "too_large" | "unsupported_type" | "undecodable" | "too_small" | "bad_aspect";

export async function preparePhoto(input: Uint8Array): Promise<{ ok: true; photo: PreparedPhoto } | { ok: false; code: PrepareError }> {
  if (input.length > TRYON_MAX_BYTES) return { ok: false, code: "too_large" };
  if (!sniffImageType(input)) return { ok: false, code: "unsupported_type" };
  let meta: Metadata;
  try {
    meta = await sharp(Buffer.from(input), { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    return { ok: false, code: "undecodable" };
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  // Orientation tags can swap the sides; check the smaller one.
  if (Math.min(w, h) < TRYON_MIN_SIDE) return { ok: false, code: "too_small" };
  const ratio = Math.max(w, h) / Math.min(w, h);
  if (ratio > 4) return { ok: false, code: "bad_aspect" };
  try {
    // rotate() applies the EXIF orientation, then the re-encode carries no metadata at all.
    const out = await sharp(Buffer.from(input), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: TRYON_MAX_SIDE, height: TRYON_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, photo: { bytes: new Uint8Array(out.data), mime: "image/jpeg", width: out.info.width, height: out.info.height } };
  } catch {
    return { ok: false, code: "undecodable" };
  }
}

export const PREPARE_MESSAGES: Record<PrepareError, string> = {
  too_large: "That photo is over 10 MB. Please use a smaller one.",
  unsupported_type: "Please upload a JPEG, PNG or WebP photo.",
  undecodable: "We couldn't read that file as a photo.",
  too_small: "That photo is too small. Use one at least 256 pixels on each side.",
  bad_aspect: "That photo is an unusual shape. Use a normal portrait or landscape photo.",
};
