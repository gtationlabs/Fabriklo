import type { ProductCard } from "./queries";
import { DEMO_CATEGORIES, demoArtPath, demoProductCards } from "./demo-catalog";

/**
 * Home page department rows ("Menswear", "Womenswear", "Accessories"): one
 * large picture card per category, laid out like a store's department
 * signage. Built from live catalogue cards; when nothing is published the
 * labelled demo catalogue is used so the section still renders.
 */
export type DepartmentTile = {
  key: string;
  label: string;
  href: string;
  /** Photo or demo illustration of the lead piece, null when none exists yet. */
  image: string | null;
  imageAlt: string;
  /** Colour of the lead piece, for the placeholder when there is no image. */
  hex: string | null;
};

export type DepartmentRow = { key: string; title: string; href: string; tiles: DepartmentTile[] };

export type Departments = { rows: DepartmentRow[]; source: "catalog" | "demo" };

/** Category that gets its own row; every other category is split by audience. */
export const ACCESSORIES_SLUG = "accessories";

const ROWS: { key: "men" | "women" | "accessories"; title: string; href: string }[] = [
  { key: "men", title: "Menswear", href: "/men" },
  { key: "women", title: "Womenswear", href: "/women" },
  { key: "accessories", title: "Accessories", href: `/category/${ACCESSORIES_SLUG}` },
];

/** Uploaded photo, or the generated illustration for a seeded demo product. */
function pictureOf(p: ProductCard): string | null {
  return p.image_path ?? (p.is_demo ? demoArtPath(p.slug) : null);
}

/** Featured first, then pieces with a picture, then the order the catalogue returned. */
function lead(products: ProductCard[]): ProductCard {
  return [...products].sort((a, b) => Number(b.featured) - Number(a.featured) || Number(!!pictureOf(b)) - Number(!!pictureOf(a)))[0]!;
}

function tileFor(key: string, label: string, href: string, products: ProductCard[]): DepartmentTile {
  const p = lead(products);
  return {
    key,
    label,
    href,
    image: pictureOf(p),
    imageAlt: p.image_alt ?? p.title,
    hex: p.colors[0]?.hex ?? null,
  };
}

function inAudience(p: ProductCard, audience: "men" | "women") {
  return p.audience === audience || p.audience === "unisex";
}

/**
 * Groups product cards into department rows. Category order follows
 * `categories` (the admin's ordering); empty categories and rows are dropped.
 * Accessories show one card per piece, since that category has no sub-groups.
 */
export function groupDepartments(products: ProductCard[], categories: { slug: string; name: string }[], demo = false): DepartmentRow[] {
  const rows: DepartmentRow[] = [];
  for (const row of ROWS) {
    let tiles: DepartmentTile[];
    if (row.key === "accessories") {
      tiles = products
        .filter((p) => p.category_slug === ACCESSORIES_SLUG)
        .map((p) => tileFor(p.slug, p.title, demo ? row.href : `/product/${p.slug}`, [p]));
    } else {
      const audience = row.key;
      tiles = categories
        .filter((c) => c.slug !== ACCESSORIES_SLUG)
        .map((c) => {
          const items = products.filter((p) => p.category_slug === c.slug && inAudience(p, audience));
          return items.length ? tileFor(`${audience}-${c.slug}`, c.name, `${row.href}?category=${c.slug}`, items) : null;
        })
        .filter((t): t is DepartmentTile => t !== null);
    }
    if (tiles.length) rows.push({ ...row, tiles });
  }
  return rows;
}

export function demoDepartments(): Departments {
  return { source: "demo", rows: groupDepartments(demoProductCards(), DEMO_CATEGORIES, true) };
}

/** Live rows when the catalogue has any published product, otherwise the demo rows. */
export function buildDepartments(products: ProductCard[] | null, categories: { slug: string; name: string }[]): Departments {
  const rows = products?.length ? groupDepartments(products, categories) : [];
  return rows.length ? { source: "catalog", rows } : demoDepartments();
}
