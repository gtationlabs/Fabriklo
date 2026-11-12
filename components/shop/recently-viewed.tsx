"use client";

import { useEffect, useState } from "react";
import type { ProductCard as Card } from "@/lib/catalog/queries";
import { RECENT_KEY, parseRecent, pushRecent } from "@/lib/catalog/product-page";
import { ProductCard } from "./product-card";
import { CarouselItem, ProductCarousel } from "./product-carousel";

/**
 * Remembers the product being viewed in this browser only (localStorage, no
 * account or server involved) and shows the shopper's earlier products.
 */
export function RecentlyViewed({ current }: { current: Card }) {
  const [items, setItems] = useState<Card[]>([]);

  useEffect(() => {
    let list: Card[] = [];
    try {
      list = parseRecent(window.localStorage.getItem(RECENT_KEY));
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(list, current)));
    } catch {
      // Storage blocked (private mode): the row simply stays hidden.
    }
    // Reading storage has to wait for the browser, so this sets state once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(list.filter((c) => c.id !== current.id));
  }, [current]);

  if (items.length === 0) return null;
  return (
    <ProductCarousel id="recently-viewed" title="Recently Viewed">
      {items.map((p) => (
        <CarouselItem key={p.id}>
          <ProductCard product={p} />
        </CarouselItem>
      ))}
    </ProductCarousel>
  );
}
