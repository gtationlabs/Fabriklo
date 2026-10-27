/**
 * Public URL for a `product_media.storage_path`. Paths starting with "/" are
 * same-origin assets (seeded placeholders); anything else is an object in the
 * public `product-media` bucket.
 */
export function mediaUrl(storagePath: string): string {
  if (storagePath.startsWith("/")) return storagePath;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/product-media/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}
