import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_CATEGORIES, DEMO_PRODUCTS, demoArtPath, demoProductCards } from "@/lib/catalog/demo-catalog";
import { SHOWCASE_PER_CATEGORY, buildShowcase, demoShowcase } from "@/lib/catalog/category-showcase";

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

describe("home page category showcase", () => {
  it("falls back to demo groups when the catalogue is empty or unreachable", () => {
    for (const input of [[], [null, null], [{ slug: "t-shirts", name: "T-Shirts", products: [], total: 0 }]]) {
      const s = buildShowcase(input);
      expect(s.source).toBe("demo");
      expect(s.groups.map((g) => g.slug)).toEqual(DEMO_CATEGORIES.map((c) => c.slug));
    }
  });

  it("demo groups put featured pieces first and cap each category", () => {
    const s = demoShowcase();
    for (const g of s.groups) {
      expect(g.products.length).toBeGreaterThan(0);
      expect(g.products.length).toBeLessThanOrEqual(SHOWCASE_PER_CATEGORY);
      expect(g.products.every((p) => p.category_slug === g.slug)).toBe(true);
      const firstPlain = g.products.findIndex((p) => !p.featured);
      if (firstPlain >= 0) expect(g.products.slice(firstPlain).some((p) => p.featured)).toBe(false);
    }
  });

  it("uses live groups when any category has products and drops empty or failed ones", () => {
    const [card] = demoProductCards();
    const s = buildShowcase([null, { slug: "shirts", name: "Shirts", products: [], total: 0 }, { slug: "t-shirts", name: "T-Shirts", products: [card!], total: 5 }]);
    expect(s.source).toBe("catalog");
    expect(s.groups).toEqual([{ slug: "t-shirts", name: "T-Shirts", products: [card], total: 5 }]);
  });
});
