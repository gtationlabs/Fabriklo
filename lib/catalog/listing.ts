import { filtersToQuery, type CatalogFilters } from "./filters";

/** Black strip above the product grid on listing pages. */
export const LISTING_PROMO = "Cash on delivery available across Bangladesh";

export type NavLink = { href: string; label: string };

/** Department bar across the top of listing pages. */
export function listingNav(categories: { slug: string; name: string }[], collections: { slug: string; name: string }[]): NavLink[] {
  const newIn = collections.find((c) => c.slug === "new-arrivals");
  return [
    ...(newIn ? [{ href: `/collections/${newIn.slug}`, label: newIn.name }] : []),
    { href: "/shop", label: "Shop all" },
    { href: "/men", label: "Men" },
    { href: "/women", label: "Women" },
    ...categories.map((c) => ({ href: `/category/${c.slug}`, label: c.name })),
  ];
}

/** "1 - 40 of 806 Items" */
export function itemRange(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 Items";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return `${from} - ${to} of ${total} ${total === 1 ? "Item" : "Items"}`;
}

/**
 * Tier pills ("All" plus each collection). On a collection's own page the
 * collection is fixed in the path, so the pills move between collection pages;
 * elsewhere they add or clear `?collection=` and keep the other filters.
 */
export function tierPills(
  collections: { slug: string; name: string }[],
  filters: CatalogFilters,
  basePath: string,
  lockedKeys: (keyof CatalogFilters)[],
): (NavLink & { active: boolean })[] {
  const locked = lockedKeys.includes("collection");
  const keep = { ...filters, page: 1 };
  const all = locked ? "/shop" : `${basePath}${filtersToQuery({ ...keep, collection: null }, lockedKeys)}`;
  return [
    { href: all, label: "All", active: !filters.collection },
    ...collections.map((c) => ({
      href: locked ? `/collections/${c.slug}` : `${basePath}${filtersToQuery({ ...keep, collection: c.slug }, lockedKeys)}`,
      label: c.name,
      active: filters.collection === c.slug,
    })),
  ];
}
