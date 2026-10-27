import { describe, expect, it } from "vitest";
import { productSchema, slugify, stockAdjustSchema, variantSchema } from "@/lib/catalog/admin-schemas";

describe("admin catalogue validation", () => {
  it("slugifies titles", () => {
    expect(slugify("  Oxford Button-Down Shirt! ")).toBe("oxford-button-down-shirt");
    expect(slugify("Café Crème")).toBe("cafe-creme");
  });

  it("validates products and derives slug", () => {
    const ok = productSchema.parse({ title: "Linen Shirt", category_id: "", audience: "men", tags: "Summer, linen ,summer" });
    expect(ok.slug).toBe("linen-shirt");
    expect(ok.tags).toEqual(["summer", "linen"]);
    expect(ok.category_id).toBeNull();
    expect(productSchema.safeParse({ title: "x", category_id: "", audience: "men" }).success).toBe(false);
    expect(productSchema.safeParse({ title: "Shirt", slug: "Bad Slug!", category_id: "", audience: "men" }).success).toBe(false);
    expect(productSchema.safeParse({ title: "Shirt", category_id: "", audience: "robots" }).success).toBe(false);
    expect(productSchema.safeParse({ title: "Shirt", category_id: "", audience: "men", tags: "<b>x</b>" }).success).toBe(false);
  });

  it("validates variants with money in minor units and price rules", () => {
    const v = variantSchema.parse({ sku: "tee-blk-m", size: "M", color: "Black", color_hex: "#111111", price: "1290", compare_at: "" });
    expect(v).toMatchObject({ sku: "TEE-BLK-M", price: 129000, compare_at: null });
    expect(variantSchema.safeParse({ sku: "T", size: "M", color: "B", color_hex: "", price: "10", compare_at: "" }).success).toBe(false);
    expect(variantSchema.safeParse({ sku: "TEE-1", size: "M", color: "B", color_hex: "red", price: "10", compare_at: "" }).success).toBe(false);
    expect(variantSchema.safeParse({ sku: "TEE-1", size: "M", color: "B", color_hex: "", price: "100", compare_at: "90" }).success).toBe(false);
  });

  it("requires a reason, non-zero whole quantity and an idempotency key for stock changes", () => {
    const base = { warehouse_id: crypto.randomUUID(), movement_type: "receive", idempotency_key: crypto.randomUUID() };
    expect(stockAdjustSchema.safeParse({ ...base, delta: "5", reason: "Delivery" }).success).toBe(true);
    expect(stockAdjustSchema.safeParse({ ...base, delta: "0", reason: "Delivery" }).success).toBe(false);
    expect(stockAdjustSchema.safeParse({ ...base, delta: "1.5", reason: "Delivery" }).success).toBe(false);
    expect(stockAdjustSchema.safeParse({ ...base, delta: "5", reason: "" }).success).toBe(false);
    expect(stockAdjustSchema.safeParse({ ...base, movement_type: "teleport", delta: "5", reason: "x y z" }).success).toBe(false);
  });
});
