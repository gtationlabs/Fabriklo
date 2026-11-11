import { describe, expect, it } from "vitest";
import {
  RECENT_MAX,
  detailToCard,
  discountLabel,
  parseRecent,
  productBreadcrumb,
  pushRecent,
  shareLinks,
  styleCode,
} from "@/lib/catalog/product-page";
import type { ProductDetail } from "@/lib/catalog/queries";

const detail: ProductDetail = {
  id: "p1",
  slug: "oxford-button-down-shirt",
  title: "Oxford Button-Down Shirt",
  subtitle: "Classic oxford weave",
  description: "",
  materials: "",
  care: "",
  audience: "men",
  is_demo: true,
  tryon_enabled: false,
  seo_title: null,
  seo_description: null,
  category: { slug: "shirts", name: "Shirts" },
  collection: { slug: "office-edit", name: "The Office Edit" },
  style_code: "OXFORDBU",
  variants: [
    { id: "v1", sku: "OXFORDBU-M-SKY", size: "M", color: "Sky Blue", color_hex: "#87CEEB", price_minor: 189000, compare_at_minor: 229000, available: 4 },
    { id: "v2", sku: "OXFORDBU-L-WHT", size: "L", color: "White", color_hex: "#FFFFFF", price_minor: 179000, compare_at_minor: null, available: -1 },
  ],
  media: [],
};

describe("product page helpers", () => {
  it("takes the style code from the SKU stem", () => {
    expect(styleCode(["OXFORDBU-M-SKY", "OXFORDBU-L-WHT"])).toBe("OXFORDBU");
    expect(styleCode(["27500004"])).toBe("27500004");
    expect(styleCode([])).toBeNull();
  });

  it("builds the breadcrumb: home, department, category, collection, name - code", () => {
    expect(productBreadcrumb(detail)).toEqual([
      { href: "/", label: "Home" },
      { href: "/men", label: "Men" },
      { href: "/category/shirts", label: "Shirts" },
      { href: "/collections/office-edit", label: "The Office Edit" },
      { href: null, label: "Oxford Button-Down Shirt - OXFORDBU" },
    ]);
    const unisex = productBreadcrumb({ ...detail, audience: "unisex", category: null, collection: null, style_code: null });
    expect(unisex.map((c) => c.label)).toEqual(["Home", "Shop", "Oxford Button-Down Shirt"]);
  });

  it("labels discounts to two decimals, only when there is a saving", () => {
    expect(discountLabel(145500, 395000)).toBe("63.16% OFF");
    expect(discountLabel(150000, 200000)).toBe("25% OFF");
    expect(discountLabel(100, 100)).toBeNull();
    expect(discountLabel(100, null)).toBeNull();
  });

  it("encodes the product URL in every share link", () => {
    const links = shareLinks("https://shop.example/product/a?b=1", "Tee & co");
    expect(links.map((l) => l.network)).toEqual(["facebook", "messenger", "whatsapp", "x"]);
    for (const l of links) expect(l.href).toContain(encodeURIComponent("https://shop.example/product/a?b=1").slice(0, 20));
    expect(links[3].href).toContain("text=Tee%20%26%20co");
  });

  it("turns the detail record into a listing card", () => {
    const card = detailToCard(detail);
    expect(card).toMatchObject({ min_price_minor: 179000, max_compare_at_minor: 229000, available: 4, style_code: "OXFORDBU", image_path: null });
    expect(card.colors).toEqual([{ name: "Sky Blue", hex: "#87CEEB" }, { name: "White", hex: "#FFFFFF" }]);
  });

  it("keeps recently viewed short, newest first, without duplicates", () => {
    const a = detailToCard(detail);
    let list = pushRecent([], a);
    for (let i = 0; i < 12; i++) list = pushRecent(list, { ...a, id: `x${i}`, slug: `x-${i}` });
    list = pushRecent(list, a);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].id).toBe("p1");
    expect(list.filter((c) => c.id === "p1")).toHaveLength(1);
    expect(parseRecent(JSON.stringify(list))).toEqual(list);
  });

  it("drops anything malformed or pointing off-site from storage", () => {
    const a = detailToCard(detail);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([{ ...a, slug: "../x" }]))).toEqual([]);
    expect(parseRecent(JSON.stringify([{ ...a, image_path: "https://evil.example/x.png" }]))).toEqual([]);
    expect(parseRecent(JSON.stringify([{ ...a, image_path: "//evil.example/x.png" }]))).toEqual([]);
    expect(parseRecent(JSON.stringify([{ ...a, image_path: "/assets/demo/products/x.webp" }]))).toHaveLength(1);
  });
});
