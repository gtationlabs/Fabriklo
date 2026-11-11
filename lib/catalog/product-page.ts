import type { ProductCard, ProductDetail } from "./queries";

/**
 * Pure helpers for the product page: style code, breadcrumb, discount label,
 * share links and the card snapshot kept for "Recently viewed". No server or
 * browser APIs here, so they are unit-tested directly.
 */

/** SKU stem shared by the variants ("OXFORDBU-M-WHT" → "OXFORDBU"), same rule as listing cards. */
export function styleCode(skus: string[]): string | null {
  if (skus.length === 0) return null;
  const first = [...skus].sort()[0];
  return first.split("-")[0] || null;
}

export type Crumb = { href: string | null; label: string };

const DEPARTMENTS: Record<string, Crumb> = {
  men: { href: "/men", label: "Men" },
  women: { href: "/women", label: "Women" },
};

/** Home / Men / Shirts / Office Edit / Oxford Button-Down Shirt - OXFORDBU */
export function productBreadcrumb(p: {
  title: string;
  audience: string;
  category: { slug: string; name: string } | null;
  collection: { slug: string; name: string } | null;
  style_code: string | null;
}): Crumb[] {
  const crumbs: Crumb[] = [{ href: "/", label: "Home" }];
  crumbs.push(DEPARTMENTS[p.audience] ?? { href: "/shop", label: "Shop" });
  if (p.category) crumbs.push({ href: `/category/${p.category.slug}`, label: p.category.name });
  if (p.collection) crumbs.push({ href: `/collections/${p.collection.slug}`, label: p.collection.name });
  crumbs.push({ href: null, label: p.style_code ? `${p.title} - ${p.style_code}` : p.title });
  return crumbs;
}

/** "63.16% OFF" for a sale price, null when there is no saving. */
export function discountLabel(priceMinor: number, compareAtMinor: number | null | undefined): string | null {
  if (compareAtMinor == null || compareAtMinor <= priceMinor || compareAtMinor <= 0) return null;
  const pct = Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 10000) / 100;
  return `${pct}% OFF`;
}

export type ShareLink = { network: "facebook" | "messenger" | "whatsapp" | "x"; label: string; href: string };

export function shareLinks(url: string, title: string): ShareLink[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { network: "facebook", label: "Share on Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { network: "messenger", label: "Send with Messenger", href: `fb-messenger://share/?link=${u}` },
    { network: "whatsapp", label: "Share on WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}` },
    { network: "x", label: "Share on X", href: `https://x.com/intent/post?url=${u}&text=${t}` },
  ];
}

/** The listing-card shape of a product, built from its detail record. */
export function detailToCard(p: ProductDetail): ProductCard {
  const prices = p.variants.map((v) => v.price_minor);
  const compares = p.variants.map((v) => v.compare_at_minor).filter((c): c is number => c != null);
  const colors = [...new Map(p.variants.map((v) => [v.color, v.color_hex])).entries()].map(([name, hex]) => ({ name, hex }));
  const photo = p.media.find((m) => !m.is_tryon_garment);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    subtitle: p.subtitle,
    audience: p.audience,
    category_slug: p.category?.slug ?? null,
    category_name: p.category?.name ?? null,
    is_demo: p.is_demo,
    featured: false,
    tryon_enabled: p.tryon_enabled,
    min_price_minor: prices.length ? Math.min(...prices) : 0,
    max_compare_at_minor: compares.length ? Math.max(...compares) : null,
    colors,
    sizes: [...new Set(p.variants.map((v) => v.size))],
    available: p.variants.reduce((sum, v) => sum + Math.max(0, v.available), 0),
    image_path: photo?.storage_path ?? null,
    image_alt: photo?.alt ?? null,
    style_code: p.style_code,
  };
}

/* ---------------------------------------------------------------- recently viewed */

export const RECENT_KEY = "fabriklo.recently-viewed.v1";
export const RECENT_MAX = 8;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validates whatever came out of localStorage; anything malformed is dropped. */
export function parseRecent(raw: string | null): ProductCard[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(isCard).slice(0, RECENT_MAX);
}

function isCard(x: unknown): x is ProductCard {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.slug === "string" &&
    SLUG.test(c.slug) &&
    typeof c.title === "string" &&
    typeof c.min_price_minor === "number" &&
    Array.isArray(c.colors) &&
    typeof c.available === "number" &&
    // Images come from our own bucket paths or same-origin assets, never full URLs.
    (c.image_path === null || (typeof c.image_path === "string" && !/^[a-z]+:|^\/\//i.test(c.image_path)))
  );
}

/** Puts `card` first, removes its older copy and keeps the list short. */
export function pushRecent(list: ProductCard[], card: ProductCard): ProductCard[] {
  return [card, ...list.filter((c) => c.id !== card.id)].slice(0, RECENT_MAX);
}
