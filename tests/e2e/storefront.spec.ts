import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("storefront", () => {
  test("home renders the owner's first store scene with accessible CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Step inside the store" })).toBeVisible();
    const hero = page.locator("section[aria-labelledby=hero-heading] img").first();
    await expect(hero).toHaveAttribute("src", "/assets/store/store-01.webp");
    await expect(page.getByRole("link", { name: "Skip store tour" })).toBeVisible();
    await expect(page.getByTestId("product-card").first()).toBeVisible();
    // Cast: @axe-core/playwright types track a newer Playwright than the sandbox browser build.
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("home shows products grouped by category with keyboard-friendly tabs", async ({ page }) => {
    await page.goto("/");
    const section = page.getByTestId("category-showcase");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("heading", { level: 2, name: "Shop by category" })).toBeVisible();
    const tabs = section.getByRole("tab");
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

    await section.getByRole("tab", { name: "Pants" }).click();
    const panel = section.getByRole("tabpanel");
    await expect(panel).toHaveCount(1);
    const cards = panel.getByTestId("product-card");
    expect(await cards.count()).toBeGreaterThan(0);
    // Every card shows a picture (uploaded photo or the demo illustration), never the initials placeholder.
    await expect(panel.getByRole("img", { name: /Placeholder image/ })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: /View all Pants/ })).toHaveAttribute("href", "/category/pants");

    await section.getByRole("tab", { name: "Pants" }).press("ArrowRight");
    await expect(section.getByRole("tab", { name: "Polos" })).toHaveAttribute("aria-selected", "true");
    await expect(section.getByRole("tab", { name: "Polos" })).toBeFocused();
  });

  test("filters persist in the URL and narrow results", async ({ page }) => {
    await page.goto("/shop?size=32&category=pants");
    await expect(page.getByTestId("result-count")).toContainText("product");
    const cards = page.getByTestId("product-card");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(5);
    await page.goto("/shop?q=oxford");
    await expect(page.getByTestId("result-count")).toHaveText(/1 product/);
  });

  test("draft products are not reachable publicly", async ({ page }) => {
    const res = await page.goto("/product/unreleased-draft-jacket");
    expect(res?.status()).toBe(404);
  });

  test("guest can pick a size, add to cart, change quantity and remove", async ({ page }) => {
    await page.goto("/product/essential-crew-tee");
    await expect(page.getByRole("heading", { level: 1, name: "Essential Crew Tee" })).toBeVisible();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.locator("main [role=alert], form [role=alert], div[role=alert]:not(#__next-route-announcer__)").filter({ hasNotText: /^$/ }).first()).toHaveText("Please choose a size.");

    // Pick the first size with plenty of stock so quantity can be raised later.
    const sizes = page.locator('input[name="size"]:not([disabled])');
    const n = await sizes.count();
    for (let i = 0; i < n; i++) {
      await sizes.nth(i).locator("xpath=..").click();
      if ((await page.getByTestId("availability").textContent()) === "In stock") break;
    }
    await expect(page.getByTestId("availability")).toHaveText("In stock");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByRole("status")).toContainText("Added 1");
    await expect(page.getByTestId("cart-count")).toHaveText("1");

    await page.goto("/cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    const subtotal1 = await page.getByTestId("cart-subtotal").textContent();
    await page.getByLabel(/Quantity for Essential Crew Tee/).selectOption("2");
    await expect(page.getByTestId("cart-subtotal")).not.toHaveText(subtotal1 ?? "");
    await page.getByRole("button", { name: /Remove/ }).click();
    await expect(page.getByText("Your cart is empty.")).toBeVisible();
  });

  test("cart API rejects cross-site requests and bad input", async ({ request, baseURL }) => {
    const cross = await request.post("/api/cart/items", {
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      data: { variantId: "00000000-0000-0000-0000-000000000000", quantity: 1 },
    });
    expect(cross.status()).toBe(403);
    const bad = await request.post("/api/cart/items", {
      headers: { Origin: baseURL!, "Content-Type": "application/json" },
      data: { variantId: "not-a-uuid", quantity: 99 },
    });
    expect(bad.status()).toBe(422);
  });

  test("security headers are present", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    const csp = h["content-security-policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    // Nonce-based script policy: no inline-script allowance, a fresh nonce per response.
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    const again = (await request.get("/")).headers()["content-security-policy"];
    expect(again).not.toBe(csp);
    // The nonce is on the rendered page's scripts, so the policy actually applies.
    const html = await res.text();
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc)![1];
    expect(html).toContain(`nonce="${nonce}"`);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});
