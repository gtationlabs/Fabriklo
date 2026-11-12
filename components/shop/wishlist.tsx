"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Heart } from "lucide-react";
import type { ProductCard as Card } from "@/lib/catalog/queries";
import { WISHLIST_KEY, parseWishlist, toggleWishlist } from "@/lib/catalog/wishlist";

/* A tiny external store over localStorage, shared by every heart on the page. */
const EVENT = "fabriklo:wishlist";
const EMPTY: Card[] = [];
let cacheRaw: string | null = null;
let cacheList: Card[] = EMPTY;

function read(): Card[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WISHLIST_KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheList = parseWishlist(raw);
  }
  return cacheList;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => e.key === WISHLIST_KEY && cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, cb);
  };
}

function write(list: Card[]) {
  try {
    window.localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: nothing is saved, the heart simply doesn't stick.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useWishlist() {
  const list = useSyncExternalStore(subscribe, read, () => EMPTY);
  return {
    list,
    has: (id: string) => list.some((c) => c.id === id),
    toggle: (card: Card) => write(toggleWishlist(read(), card)),
    clear: () => write([]),
  };
}

/** Heart toggle. `card` is the snapshot that the wishlist page will show. */
export function WishlistButton({ product, size = "sm", className = "" }: { product: Card; size?: "sm" | "lg"; className?: string }) {
  const { has, toggle } = useWishlist();
  const saved = has(product.id);
  const box = size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <button
      type="button"
      onClick={() => toggle(product)}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${product.title} from wishlist` : `Save ${product.title} to wishlist`}
      title={saved ? "Saved to wishlist" : "Save to wishlist"}
      data-testid="wishlist-toggle"
      className={`flex shrink-0 items-center justify-center rounded-full bg-white text-ink shadow-sm transition hover:scale-105 ${box} ${className}`}
    >
      <Heart aria-hidden className={size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]"} fill={saved ? "currentColor" : "none"} strokeWidth={1.6} />
    </button>
  );
}

/** Header link with the saved count. */
export function WishlistLink({ className = "" }: { className?: string }) {
  const { list } = useWishlist();
  return (
    <Link href="/wishlist" className={`relative flex h-10 w-10 items-center justify-center ${className}`} aria-label={`Wishlist, ${list.length} saved`}>
      <Heart aria-hidden className="h-5 w-5" strokeWidth={1.6} />
      {list.length > 0 ? (
        <span data-testid="wishlist-count" className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold text-white">
          {list.length}
        </span>
      ) : null}
    </Link>
  );
}
