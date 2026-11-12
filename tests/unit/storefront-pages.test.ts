import { describe, expect, it } from "vitest";
import { WISHLIST_MAX, parseWishlist, toggleWishlist } from "@/lib/catalog/wishlist";
import type { ProductCard } from "@/lib/catalog/queries";
import { FALLBACK_SLUGS, HELP_NAV, fallbackPage } from "@/lib/cms/fallback-pages";
import { blocksSchema } from "@/lib/cms/blocks";
import { orderStep } from "@/lib/orders/labels";

const card = (id: string, extra: Partial<ProductCard> = {}): ProductCard => ({
  id,
  slug: `piece-${id}`,
  title: `Piece ${id}`,
  subtitle: "",
  audience: "men",
  category_slug: null,
  category_name: null,
  is_demo: true,
  featured: false,
  tryon_enabled: false,
  min_price_minor: 129000,
  max_compare_at_minor: null,
  colors: [],
  sizes: [],
  available: 3,
  image_path: null,
  image_alt: null,
  style_code: null,
  ...extra,
});

describe("wishlist", () => {
  it("toggles a piece in and out, newest first", () => {
    let list = toggleWishlist([], card("a"));
    list = toggleWishlist(list, card("b"));
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    expect(toggleWishlist(list, card("a")).map((c) => c.id)).toEqual(["b"]);
  });

  it("caps the list", () => {
    let list: ProductCard[] = [];
    for (let i = 0; i < WISHLIST_MAX + 5; i++) list = toggleWishlist(list, card(String(i)));
    expect(list).toHaveLength(WISHLIST_MAX);
  });

  it("drops malformed, duplicate and external-image entries from storage", () => {
    const raw = JSON.stringify([card("a"), card("a"), card("x", { image_path: "https://evil.example/x.png" }), { id: 1 }, card("y", { slug: "Bad Slug" })]);
    expect(parseWishlist(raw).map((c) => c.id)).toEqual(["a"]);
    expect(parseWishlist("{not json")).toEqual([]);
    expect(parseWishlist(null)).toEqual([]);
  });
});

describe("built-in help pages", () => {
  it("cover every help/legal link and pass the CMS block allow-list", () => {
    const linked = HELP_NAV.flatMap((g) => g.links.map(([href]) => href.slice(1))).filter((s) => !["orders/track", "stores"].includes(s));
    for (const slug of linked) expect(FALLBACK_SLUGS).toContain(slug);
    for (const slug of FALLBACK_SLUGS) {
      const page = fallbackPage(slug)!;
      expect(blocksSchema.safeParse(page.blocks).success).toBe(true);
      expect(page.builtIn).toBe(true);
      expect(page.published_at).toBeNull();
      // Every built-in page says it is a template.
      expect(page.blocks[0]).toMatchObject({ type: "callout" });
    }
    expect(fallbackPage("nope")).toBeNull();
  });
});

describe("order progress", () => {
  it("maps statuses to the four milestones", () => {
    expect(orderStep({ fulfillment_status: "unfulfilled", shipment_status: "not_shipped" })).toBe(0);
    expect(orderStep({ fulfillment_status: "packed", shipment_status: "ready_for_pickup" })).toBe(1);
    expect(orderStep({ fulfillment_status: "fulfilled", shipment_status: "in_transit" })).toBe(2);
    expect(orderStep({ fulfillment_status: "fulfilled", shipment_status: "delivered" })).toBe(3);
  });
  it("hides the bar off the happy path", () => {
    expect(orderStep({ fulfillment_status: "cancelled", shipment_status: "not_shipped" })).toBeNull();
    expect(orderStep({ fulfillment_status: "fulfilled", shipment_status: "rto" })).toBeNull();
  });
});
