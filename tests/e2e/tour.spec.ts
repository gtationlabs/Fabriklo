import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const tour = (page: Page) => page.locator("#store-tour");

/** Scrolls in small wheel steps and records every scene the indicator passes through. */
async function wheelUntil(page: Page, scene: number, dir: 1 | -1) {
  await page.mouse.move(400, 400);
  const seen: number[] = [];
  for (let i = 0; i < 80; i++) {
    const a = Number(await tour(page).getAttribute("data-active-scene"));
    if (seen.at(-1) !== a) seen.push(a);
    if (a === scene) return seen;
    await page.mouse.wheel(0, 120 * dir);
    await page.waitForTimeout(120);
  }
  throw new Error(`never reached scene ${scene}; saw ${seen.join(",")}`);
}

async function axeSerious(page: Page) {
  const r = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test.describe("store tour", () => {
  test("scroll walks forward through all five scenes and back in reverse", async ({ page }) => {
    await page.goto("/");
    await expect(tour(page)).toHaveAttribute("data-mode", "tour");
    await expect(tour(page)).toHaveAttribute("data-active-scene", "1");
    expect(await wheelUntil(page, 5, 1)).toEqual([1, 2, 3, 4, 5]);
    await page.waitForTimeout(800);
    await expect(page.locator('[data-scene="5"] h2')).toBeVisible();
    expect(await wheelUntil(page, 1, -1)).toEqual([5, 4, 3, 2, 1]);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("hidden scenes are not focusable; dots and skip work from the keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(tour(page)).toHaveAttribute("data-mode", "tour");
    await page.evaluate(() => window.scrollTo(0, 70));
    await expect(page.locator('[data-scene="2"]')).toHaveAttribute("inert", "");
    await page.getByRole("button", { name: /Go to scene 3/ }).click();
    await expect(tour(page)).toHaveAttribute("data-active-scene", "3", { timeout: 8000 });
    await expect(page.getByRole("link", { name: "Shop pants" })).toBeVisible();

    await page.getByRole("link", { name: "Skip store tour" }).click();
    await expect(page.locator("#featured")).toBeFocused();
    await expect(page.getByRole("heading", { name: "Featured" })).toBeInViewport();
  });

  test("reduced motion shows the scenes as static panels", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForTimeout(500);
    await expect(tour(page)).toHaveAttribute("data-mode", "static");
    await expect(page.locator("[data-scene]")).toHaveCount(5);
    for (let s = 1; s <= 5; s++) await expect(page.locator(`[data-scene="${s}"]`)).not.toHaveAttribute("inert", "");
    await page.locator('[data-scene="4"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-scene="4"] h2')).toBeInViewport();
    expect(await axeSerious(page)).toEqual([]);
    await ctx.close();
  });

  test("without JavaScript every scene is still readable", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Step inside the store");
    await expect(page.locator("[data-scene] h2")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Skip store tour" })).toBeVisible();
    await ctx.close();
  });

  test("tour mode has no serious accessibility violations", async ({ page }) => {
    await page.goto("/");
    await expect(tour(page)).toHaveAttribute("data-mode", "tour");
    expect(await axeSerious(page)).toEqual([]);
  });
});
