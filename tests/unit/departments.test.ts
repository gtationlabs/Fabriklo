import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_CATEGORIES, DEMO_PRODUCTS, demoArtPath, demoProductCards } from "@/lib/catalog/demo-catalog";
import { buildDepartments, demoDepartments, groupDepartments } from "@/lib/catalog/departments";

const root = path.resolve(__dirname, "../..");

describe("demo catalogue", () => {
  it("matches the published products and categories in the dev seed", () => {
    const seed = readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const rows = [...seed.matchAll(/^\s+\('([^']+)', '([a-z0-9-]+)', '([a-z-]+)', '(men|women|unisex)', (\d+), (\d+|null)/gm)]
      .map((m) => ({ title: m[1], slug: m[2], category: m[3], audience: m[4], price: Number(m[5]) }))
      .filter((r) => r.slug !== "unreleased-draft-jacket");
    expect(rows.length).toBe(24);
    expect(DEMO_PRODUCTS.map((d) => ({ title: d.title, slug: d.slug, category: d.category, audience: d.audience, price: d.price_bdt }))).toEqual(rows);
    for (const c of DEMO_CATEGORIES) expect(seed).toContain(`('${c.slug}', '${c.name}'`);
  });

  it("has a generated illustration for every demo product and none for other slugs", () => {
    for (const d of DEMO_PRODUCTS) {
      const p = demoArtPath(d.slug)!;
      expect(p).toBe(`/assets/demo/products/${d.slug}.webp`);
      expect(existsSync(path.join(root, "public", p))).toBe(true);
    }
    expect(demoArtPath("unreleased-draft-jacket")).toBeNull();
    expect(demoArtPath("../etc/passwd")).toBeNull();
  });

  it("builds labelled demo cards with prices in minor units", () => {
    const cards = demoProductCards();
    expect(cards.every((c) => c.is_demo && c.image_path?.startsWith("/assets/demo/products/"))).toBe(true);
    const tee = cards.find((c) => c.slug === "heavyweight-pocket-tee")!;
    expect(tee).toMatchObject({ min_price_minor: 89000, max_compare_at_minor: 109000, category_slug: "t-shirts", category_name: "T-Shirts" });
  });
});

describe("home page department rows", () => {
  const categories = DEMO_CATEGORIES;

  it("falls back to the demo rows when the catalogue is empty or unreachable", () => {
    for (const input of [null, []]) {
      const d = buildDepartments(input, categories);
      expect(d.source).toBe("demo");
      expect(d.rows.map((r) => r.title)).toEqual(["Menswear", "Womenswear", "Accessories"]);
    }
  });

  it("splits clothing by audience (unisex in both) and keeps accessories as their own row", () => {
    const { rows } = demoDepartments();
    const men = rows.find((r) => r.key === "men")!;
    const women = rows.find((r) => r.key === "women")!;
    const acc = rows.find((r) => r.key === "accessories")!;
    // Category order follows the admin ordering; accessories never appear as a clothing tile.
    expect(men.tiles.map((t) => t.label)).toEqual(["T-Shirts", "Shirts", "Pants", "Polos", "Outerwear"]);
    expect(women.tiles.map((t) => t.label)).toEqual(["T-Shirts", "Shirts", "Pants", "Polos", "Outerwear"]);
    expect(men.tiles[0]).toMatchObject({ href: "/men?category=t-shirts", image: "/assets/demo/products/essential-crew-tee.webp" });
    expect(acc.tiles.map((t) => t.label)).toEqual(DEMO_PRODUCTS.filter((p) => p.category === "accessories").map((p) => p.title));
    // Demo pieces are not real listings, so their cards open the category instead of a product page.
    expect(acc.tiles.every((t) => t.href === "/category/accessories")).toBe(true);
  });

  it("uses live cards when any are published, leads with a featured piece and drops empty rows", () => {
    const cards = demoProductCards().filter((c) => c.audience === "men" && c.category_slug === "shirts");
    const d = buildDepartments(cards, categories);
    expect(d.source).toBe("catalog");
    expect(d.rows.map((r) => r.key)).toEqual(["men"]);
    expect(d.rows[0]!.tiles).toEqual([
      expect.objectContaining({ label: "Shirts", href: "/men?category=shirts", image: "/assets/demo/products/oxford-button-down-shirt.webp" }),
    ]);
    const acc = groupDepartments(demoProductCards().filter((c) => c.category_slug === "accessories"), categories);
    expect(acc[0]!.tiles[0]!.href).toBe("/product/canvas-baseball-cap");
  });
});

describe("department tile pictures", () => {
  it("uses the demo illustration for seeded demo products without a photo", () => {
    const card = { ...demoProductCards().find((c) => c.slug === "oxford-button-down-shirt")!, image_path: null };
    const [row] = groupDepartments([card], DEMO_CATEGORIES);
    expect(row!.tiles[0]!.image).toBe("/assets/demo/products/oxford-button-down-shirt.webp");
  });
});
