import type { ProductCard } from "./queries";
import { isCard } from "./product-page";

/**
 * Wishlist kept in this browser only (localStorage), like "Recently viewed":
 * no account or server involved. Entries are card snapshots, validated on
 * every read so a tampered value can't inject URLs.
 */
export const WISHLIST_KEY = "fabriklo.wishlist.v1";
export const WISHLIST_MAX = 60;

export function parseWishlist(raw: string | null): ProductCard[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data.filter((c): c is ProductCard => isCard(c) && !seen.has(c.id) && (seen.add(c.id), true)).slice(0, WISHLIST_MAX);
}

/** Adds the card (newest first) or removes it when it is already saved. */
export function toggleWishlist(list: ProductCard[], card: ProductCard): ProductCard[] {
  if (list.some((c) => c.id === card.id)) return list.filter((c) => c.id !== card.id);
  return [card, ...list].slice(0, WISHLIST_MAX);
}
