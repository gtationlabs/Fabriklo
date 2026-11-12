import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function axeSerious(page: Page) {
  const r = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test.describe("storefront pages", () => {
  test("every header and footer link leads to a real page", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page.locator("header a[href^='/'], footer a[href^='/']").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")!))]);
    expect(hrefs.length).toBeGreaterThan(20);
    for (const href of hrefs) {
      const res = await request.get(href, { maxRedirects: 0 });
      expect([200, 307], `${href} → ${res.status()}`).toContain(res.status());
    }
  });

  test("help pages, store page, try-on and FAQ render in the new layout", async ({ page }) => {
    await page.goto("/faq");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Frequently asked questions");
    await page.getByText("How do I pay?").click();
    await expect(page.getByText(/Cash on delivery is available across Bangladesh/)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Help pages" }).getByRole("link", { name: "FAQ" })).toHaveAttribute("aria-current", "page");
    expect(await axeSerious(page)).toEqual([]);

    await page.goto("/size-guide");
    await expect(page.getByTestId("size-chart")).toContainText("Sample measurements");

    await page.goto("/stores");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Our store");
    await expect(page.getByTestId("store-details").or(page.getByTestId("store-placeholder")).first()).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);

    await page.goto("/try-on");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI try-on");
    await expect(page.getByText("Your photo, your control")).toBeVisible();
  });

  test("wishlist: save from a card, see it on the wishlist page, remove it", async ({ page }) => {
    await page.goto("/men");
    const card = page.getByTestId("product-card").first();
    const title = (await card.getByRole("heading").textContent())!.trim();
    await card.getByTestId("wishlist-toggle").click();
    await expect(card.getByTestId("wishlist-toggle")).toHaveAttribute("aria-pressed", "true");

    await page.goto("/wishlist");
    const grid = page.getByTestId("wishlist-grid");
    await expect(grid.getByText(title, { exact: true })).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
    await grid.getByTestId("wishlist-toggle").first().click();
    await expect(page.getByText("Your wishlist is empty")).toBeVisible();
  });

  test("unknown pages show the store 404 with search", async ({ page }) => {
    for (const url of ["/no-such-page", "/no/such/page"]) {
      const res = await page.goto(url);
      expect(res?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      await expect(page.getByRole("search").last()).toBeVisible();
    }
  });

  test("phone width: no sideways scroll on service pages", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/cart", "/account/login", "/faq", "/stores", "/orders/track", "/wishlist", "/try-on"]) {
      await page.goto(url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, url).toBeLessThanOrEqual(0);
    }
  });
});
