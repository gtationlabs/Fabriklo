import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters } from "@/lib/catalog/filters";
import { sortSizes } from "@/lib/catalog/sizes";

describe("catalog filters", () => {
  it("parses valid params and drops junk instead of throwing", () => {
    const f = parseFilters({
      q: "  oxford ",
      category: "shirts",
      size: "M,L,<script>",
      color: ["Black", "Navy"],
      min: "500",
      max: "2,000",
      sort: "price_asc",
      page: "2",
      in_stock: "1",
    });
    expect(f).toMatchObject({
      q: "oxford",
      category: "shirts",
      sizes: ["M", "L"],
      colors: ["Black", "Navy"],
      minPriceMinor: 50000,
      maxPriceMinor: 200000,
      sort: "price_asc",
      page: 2,
      inStock: true,
    });
  });

  it("rejects injection-shaped and out-of-range values", () => {
    const f = parseFilters({ category: "../../etc", sort: "drop table", page: "-3", audience: "admin", min: "9", max: "1" });
    expect(f.category).toBeNull();
    expect(f.sort).toBe("newest");
    expect(f.page).toBe(1);
    expect(f.audience).toBeNull();
    expect(f.maxPriceMinor).toBeNull();
  });

  it("round-trips through the URL", () => {
    const f = parseFilters({ size: "M", color: "Black", sort: "price_desc", page: "3" });
    expect(filtersToQuery(f)).toBe("?size=M&color=Black&sort=price_desc&page=3");
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f).slice(1))))).toEqual(f);
    expect(filtersToQuery(parseFilters({}))).toBe("");
  });

  it("sorts apparel sizes naturally", () => {
    expect(sortSizes(["XL", "S", "34", "One Size", "M", "30", "XS"])).toEqual(["XS", "S", "M", "XL", "30", "34", "One Size"]);
  });
});
