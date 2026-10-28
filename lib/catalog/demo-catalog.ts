import type { ProductCard } from "./queries";

/**
 * Demo catalogue shared by three places:
 *  - `scripts/generate-demo-product-art.ts` draws one illustration per product
 *    into `public/assets/demo/products/<slug>.webp`;
 *  - demo products seeded by `supabase/seed.sql` (same slugs) show that
 *    illustration until staff upload a real photo;
 *  - the home page "Shop by category" section falls back to these cards when
 *    the database has no published products (e.g. a fresh production project),
 *    the same way the hero falls back to built-in scenes.
 *
 * Every entry is a labelled demo product, never a real listing.
 */
export type DemoCategory = { slug: string; name: string };

export const DEMO_CATEGORIES: DemoCategory[] = [
  { slug: "t-shirts", name: "T-Shirts" },
  { slug: "shirts", name: "Shirts" },
  { slug: "pants", name: "Pants" },
  { slug: "polos", name: "Polos" },
  { slug: "outerwear", name: "Outerwear" },
  { slug: "accessories", name: "Accessories" },
];

export type DemoProduct = {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  audience: "men" | "women" | "unisex";
  price_bdt: number;
  compare_bdt: number | null;
  featured: boolean;
  colors: { name: string; hex: string }[];
  sizes: string[];
};

const p = (
  title: string,
  slug: string,
  category: string,
  audience: DemoProduct["audience"],
  price_bdt: number,
  compare_bdt: number | null,
  sizes: string[],
  colors: [string, string][],
  featured: boolean,
  subtitle: string,
): DemoProduct => ({ title, slug, category, audience, price_bdt, compare_bdt, sizes, colors: colors.map(([name, hex]) => ({ name, hex })), featured, subtitle });

// Mirrors the published products in supabase/seed.sql (a unit test keeps them in step).
export const DEMO_PRODUCTS: DemoProduct[] = [
  p("Essential Crew Tee", "essential-crew-tee", "t-shirts", "men", 690, null, ["S", "M", "L", "XL"], [["Charcoal", "#36454F"], ["Cream", "#F3EBDD"], ["Espresso", "#4B3621"]], true, "Soft combed cotton, regular fit"),
  p("Heavyweight Pocket Tee", "heavyweight-pocket-tee", "t-shirts", "men", 890, 1090, ["M", "L", "XL", "XXL"], [["Black", "#111111"], ["Sand", "#C2B280"]], false, "240 GSM cotton with chest pocket"),
  p("Relaxed Graphic Tee", "relaxed-graphic-tee", "t-shirts", "women", 790, null, ["XS", "S", "M", "L"], [["Blush", "#E8B4B8"], ["White", "#FFFFFF"]], true, "Oversized fit with original print"),
  p("Ribbed Fitted Tee", "ribbed-fitted-tee", "t-shirts", "women", 650, null, ["XS", "S", "M", "L"], [["Olive", "#708238"], ["Ivory", "#FFFFF0"], ["Black", "#111111"]], false, "Stretch rib, slim fit"),
  p("Oxford Button-Down Shirt", "oxford-button-down-shirt", "shirts", "men", 1890, null, ["S", "M", "L", "XL"], [["Sky Blue", "#87CEEB"], ["White", "#FFFFFF"]], true, "Classic oxford weave"),
  p("Checked Flannel Shirt", "checked-flannel-shirt", "shirts", "men", 1690, 1990, ["M", "L", "XL"], [["Green Check", "#2F4F2F"], ["Navy Check", "#1F2A44"]], false, "Brushed cotton flannel"),
  p("Linen Blend Shirt", "linen-blend-shirt", "shirts", "women", 1790, null, ["XS", "S", "M", "L"], [["Natural", "#E5D3B3"], ["Terracotta", "#C66A4A"]], false, "Breathable linen-cotton blend"),
  p("Poplin Tunic Shirt", "poplin-tunic-shirt", "shirts", "women", 1590, null, ["S", "M", "L"], [["White", "#FFFFFF"], ["Bronze", "#9C6B30"]], true, "Crisp poplin, longline cut"),
  p("Slim Stretch Chino", "slim-stretch-chino", "pants", "men", 1990, null, ["30", "32", "34", "36"], [["Khaki", "#C3B091"], ["Navy", "#1F2A44"], ["Charcoal", "#36454F"]], true, "Stretch twill, slim tapered"),
  p("Herringbone Trouser", "herringbone-trouser", "pants", "men", 2490, 2890, ["30", "32", "34", "36"], [["Grey", "#808080"], ["Olive", "#556B2F"]], false, "Textured herringbone weave"),
  p("Wide-Leg Trouser", "wide-leg-trouser", "pants", "women", 2290, null, ["XS", "S", "M", "L"], [["Espresso", "#4B3621"], ["Cream", "#F3EBDD"]], false, "High rise, fluid drape"),
  p("Everyday Jogger", "everyday-jogger", "pants", "unisex", 1490, null, ["S", "M", "L", "XL"], [["Heather Grey", "#B6B6B4"], ["Black", "#111111"]], false, "Brushed fleece interior"),
  p("Classic Pique Polo", "classic-pique-polo", "polos", "men", 1290, null, ["S", "M", "L", "XL"], [["Navy", "#1F2A44"], ["White", "#FFFFFF"], ["Bottle Green", "#006A4E"]], true, "Breathable cotton pique"),
  p("Knit Resort Polo", "knit-resort-polo", "polos", "men", 1590, null, ["M", "L", "XL"], [["Camel", "#C19A6B"], ["Black", "#111111"]], false, "Open collar knit"),
  p("Cropped Polo Top", "cropped-polo-top", "polos", "women", 1190, 1390, ["XS", "S", "M"], [["Sage", "#9CAF88"], ["White", "#FFFFFF"]], false, "Cropped fit, ribbed collar"),
  p("Long Sleeve Polo", "long-sleeve-polo", "polos", "unisex", 1490, null, ["S", "M", "L", "XL"], [["Charcoal", "#36454F"], ["Burgundy", "#800020"]], false, "Fine-gauge long sleeve"),
  p("Quilted Bomber Jacket", "quilted-bomber-jacket", "outerwear", "men", 3990, 4590, ["M", "L", "XL"], [["Black", "#111111"], ["Olive", "#556B2F"]], true, "Light quilted fill"),
  p("Zip Hoodie", "zip-hoodie", "outerwear", "unisex", 2290, null, ["S", "M", "L", "XL"], [["Charcoal", "#36454F"], ["Cream", "#F3EBDD"]], false, "Midweight brushed fleece"),
  p("Wool Blend Overshirt", "wool-blend-overshirt", "outerwear", "men", 3290, null, ["M", "L", "XL"], [["Brown Check", "#6F4E37"], ["Grey", "#808080"]], false, "Shirt-jacket in wool blend"),
  p("Belted Trench Coat", "belted-trench-coat", "outerwear", "women", 4890, null, ["S", "M", "L"], [["Stone", "#B9B4A6"], ["Black", "#111111"]], true, "Water-resistant cotton twill"),
  p("Canvas Baseball Cap", "canvas-baseball-cap", "accessories", "unisex", 590, null, ["One Size"], [["Black", "#111111"], ["Khaki", "#C3B091"]], false, "Adjustable strap"),
  p("Leather Belt", "leather-belt", "accessories", "men", 1190, null, ["32", "34", "36", "38"], [["Brown", "#6F4E37"], ["Black", "#111111"]], false, "Full-grain leather"),
  p("Everyday Tote Bag", "everyday-tote-bag", "accessories", "women", 990, null, ["One Size"], [["Natural", "#E5D3B3"], ["Espresso", "#4B3621"]], false, "Heavy canvas tote"),
  p("Cotton Crew Socks 3-Pack", "cotton-crew-socks-3-pack", "accessories", "unisex", 450, null, ["One Size"], [["Mixed Neutrals", "#B6B6B4"]], false, "Combed cotton blend"),
];

const DEMO_SLUGS = new Set(DEMO_PRODUCTS.map((d) => d.slug));

/** Illustration path for a demo product, or null for anything that is not one. */
export function demoArtPath(slug: string): string | null {
  return DEMO_SLUGS.has(slug) ? `/assets/demo/products/${slug}.webp` : null;
}

/** Built-in demo cards (same shape as catalog_search rows) for the empty-database fallback. */
export function demoProductCards(): ProductCard[] {
  const categoryName = new Map(DEMO_CATEGORIES.map((c) => [c.slug, c.name]));
  return DEMO_PRODUCTS.map((d) => ({
    id: `demo-${d.slug}`,
    slug: d.slug,
    title: d.title,
    subtitle: d.subtitle,
    audience: d.audience,
    category_slug: d.category,
    category_name: categoryName.get(d.category) ?? null,
    is_demo: true,
    featured: d.featured,
    tryon_enabled: false,
    min_price_minor: d.price_bdt * 100,
    max_compare_at_minor: d.compare_bdt != null ? d.compare_bdt * 100 : null,
    colors: d.colors,
    sizes: d.sizes,
    available: 1,
    image_path: demoArtPath(d.slug),
    image_alt: `Illustration of the ${d.title} (demo product)`,
  }));
}
