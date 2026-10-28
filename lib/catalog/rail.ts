import { garmentKind } from "@/components/shop/garment-art";
import type { RailGarment } from "@/components/shop/garment-rail";
import { mediaUrl } from "@/lib/media/url";
import type { ProductCard } from "./queries";

/**
 * Picks up to `max` hangable products (no accessories) for the home page rail,
 * mixing categories so neighbouring garments differ.
 */
export function railGarments(products: ProductCard[], max = 10): RailGarment[] {
  const hangable = products.filter((p) => p.category_slug !== "accessories" && p.available > 0);
  const byCat = new Map<string, ProductCard[]>();
  for (const p of hangable) {
    const k = p.category_slug ?? "other";
    byCat.set(k, [...(byCat.get(k) ?? []), p]);
  }
  const picked: ProductCard[] = [];
  const queues = [...byCat.values()];
  while (picked.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && picked.length < max) picked.push(next);
    }
  }
  return picked.map((p) => {
    const colour = p.colors[0];
    return {
      slug: p.slug,
      title: p.title,
      detail: [p.category_name, colour?.name].filter(Boolean).join(" · "),
      kind: garmentKind(p.category_slug, p.title),
      hex: colour?.hex ?? null,
      photo: p.image_path ? mediaUrl(p.image_path) : null,
      photoAlt: p.image_alt,
    };
  });
}
