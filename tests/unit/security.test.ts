import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_SITE_URL: "https://shop.example" } }));

import { __resetRateLimitsForTests, rateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";
import { visibleNav } from "@/lib/auth/permissions";
import { friendlyDbError } from "@/lib/db-errors";

describe("rate limiter", () => {
  beforeEach(() => __resetRateLimitsForTests());
  it("allows up to the limit per window, then blocks with retry-after", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000, now).ok).toBe(true);
    const blocked = rateLimit("k", 3, 60_000, now + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(59);
    expect(rateLimit("k", 3, 60_000, now + 61_000).ok).toBe(true);
    expect(rateLimit("other", 3, 60_000, now).ok).toBe(true);
  });
});

describe("request origin checks", () => {
  it("accepts same-origin and rejects cross-site", () => {
    expect(isSameOrigin(new Headers({ origin: "https://shop.example" }), "https://shop.example/api/cart/items")).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example" }), "https://shop.example/api/cart/items")).toBe(false);
    expect(isSameOrigin(new Headers({ "sec-fetch-site": "same-origin" }), "https://shop.example/x")).toBe(true);
    expect(isSameOrigin(new Headers({ "sec-fetch-site": "cross-site" }), "https://shop.example/x")).toBe(false);
    expect(isSameOrigin(new Headers(), "https://shop.example/x")).toBe(false);
  });
  it("derives client IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "cf-connecting-ip": "5.6.7.8", "x-forwarded-for": "1.2.3.4" }))).toBe("5.6.7.8");
  });
});

describe("admin navigation", () => {
  it("is filtered by permission (cosmetic; server re-checks)", () => {
    const labels = visibleNav(["orders.read", "customers.read", "products.read"]).map((n) => n.label);
    expect(labels).toContain("Products");
    expect(labels).toContain("Orders");
    expect(labels).not.toContain("Inventory");
    expect(labels).not.toContain("Staff");
  });
});

describe("db error mapping", () => {
  it("never leaks raw SQL messages", () => {
    expect(friendlyDbError({ code: "23505", message: 'duplicate key value violates unique constraint "product_variants_sku_key"' })).toBe("That SKU is already used.");
    expect(friendlyDbError({ code: "42501", message: "permission denied for table x" })).toMatch(/permission/);
    expect(friendlyDbError({ code: "XX000", message: "internal: select * from secrets" })).toBe("Something went wrong. Please try again.");
  });
});
