import type { ProductCard } from "./queries";
import { DEMO_CATEGORIES, demoProductCards } from "./demo-catalog";

export const SHOWCASE_PER_CATEGORY = 8;

export type ShowcaseGroup = {
  slug: string;
  name: string;
  products: ProductCard[];
  /** Products in the category in the live catalogue (0 for the built-in demo groups). */
  total: number;
};

export type Showcase = { groups: ShowcaseGroup[]; source: "catalog" | "demo" };

/** Featured first, then the order the catalogue returned. */
function featuredFirst(products: ProductCard[]): ProductCard[] {
  return [...products].sort((a, b) => Number(b.featured) - Number(a.featured));
}

/** The built-in demo groups used when the catalogue has nothing published. */
export function demoShowcase(): Showcase {
  const cards = demoProductCards();
  return {
    source: "demo",
    groups: DEMO_CATEGORIES.map((c) => ({
      slug: c.slug,
      name: c.name,
      products: featuredFirst(cards.filter((p) => p.category_slug === c.slug)).slice(0, SHOWCASE_PER_CATEGORY),
      total: 0,
    })).filter((g) => g.products.length > 0),
  };
}

/**
 * Builds the home page category groups from live catalogue results. Empty
 * categories are dropped; if nothing is left (fresh database, or the catalogue
 * is unreachable) the labelled demo groups are used so the section still renders.
 */
export function buildShowcase(results: (ShowcaseGroup | null)[]): Showcase {
  const groups = results.filter((g): g is ShowcaseGroup => g !== null && g.products.length > 0);
  return groups.length ? { source: "catalog", groups } : demoShowcase();
}
