import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const section = (page: Page) => page.locator("#reviews");

async function axeSerious(page: Page) {
  const r = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] })
    .include("#reviews")
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test.describe("customer reviews", () => {
  test("renders sample reviews with a summary even on an empty database", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "What customers say" })).toBeAttached();
    await expect(section(page).locator("[data-tag]")).toHaveCount(7);
    await expect(section(page).getByText(/Sample reviews for preview/)).toBeAttached();
    await expect(section(page).getByRole("img", { name: /Rated 4\.\d out of 5/ }).first()).toBeAttached();
  });

  test("desktop: the deck pins and scrolling flicks through the tags and back", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "deck mode is wide screens only");
    await page.goto("/");
    await expect(section(page)).toHaveAttribute("data-mode", "deck");
    await page.getByRole("heading", { name: "What customers say" }).scrollIntoViewIfNeeded();
    await expect(section(page)).toHaveAttribute("data-active-review", "1");

    await page.getByRole("button", { name: "Next review" }).click();
    await expect(section(page)).toHaveAttribute("data-active-review", "2", { timeout: 8000 });
    await page.getByRole("button", { name: "Next review" }).click();
    await expect(section(page)).toHaveAttribute("data-active-review", "3", { timeout: 8000 });
    await page.getByRole("button", { name: "Previous review" }).click();
    await expect(section(page)).toHaveAttribute("data-active-review", "2", { timeout: 8000 });

    // Wheel all the way through: the last tag ends on top and the button disables.
    await page.mouse.move(400, 400);
    for (let i = 0; i < 40 && (await section(page).getAttribute("data-active-review")) !== "7"; i++) {
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(100);
    }
    await expect(section(page)).toHaveAttribute("data-active-review", "7");
    await expect(page.getByRole("button", { name: "Next review" })).toBeDisabled();
    expect(await axeSerious(page)).toEqual([]);
  });

  test("reduced motion shows every review as a static tag", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForTimeout(500);
    await expect(section(page)).toHaveAttribute("data-mode", "static");
    await expect(page.getByRole("button", { name: "Next review" })).toHaveCount(0);
    await page.getByRole("heading", { name: "What customers say" }).scrollIntoViewIfNeeded();
    await expect(section(page).locator("[data-score]")).toHaveText(/^4\.\d$/);
    expect(await axeSerious(page)).toEqual([]);
    await ctx.close();
  });
});
