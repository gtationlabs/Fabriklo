"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Heart } from "lucide-react";
import { ProductCard } from "./product-card";
import { EmptyState, btnPrimary } from "./store-page";
import { useWishlist } from "./wishlist";

const noop = () => () => {};

/** Saved pieces, newest first. Rendered after mount because the list lives in localStorage. */
export function WishlistGrid() {
  const { list, clear } = useWishlist();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <p className="text-center text-[14px] text-neutral-500">Loading your wishlist…</p>;
  if (list.length === 0) {
    return (
      <EmptyState icon={<Heart aria-hidden className="h-5 w-5" strokeWidth={1.6} />} title="Your wishlist is empty" action={<Link href="/shop" className={btnPrimary}>Start shopping</Link>}>
        Tap the heart on any piece to save it here.
      </EmptyState>
    );
  }
  return (
    <div data-testid="wishlist-grid">
      <div className="mb-6 flex items-center justify-between text-[13px]">
        <p aria-live="polite">
          {list.length} saved {list.length === 1 ? "piece" : "pieces"}
        </p>
        <button type="button" onClick={clear} className="underline underline-offset-4 hover:no-underline">
          Clear all
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4">
        {list.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
      <p className="mt-10 text-center text-[12px] text-neutral-500">Prices and stock shown as they were when you saved each piece; the product page has the latest.</p>
    </div>
  );
}
