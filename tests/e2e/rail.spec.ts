import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("home page clothes rail", () => {
  test("hover turns a garment, click opens the focused view with a front/back turn", async ({ page }) => {
    await page.goto("/");
    const rail = page.locator('section[aria-labelledby="rail-heading"]');
    await rail.scrollIntoViewIfNeeded();
    await expect(rail.getByRole("heading", { name: /On the rail/i })).toBeVisible();

    const garments = rail.getByTestId("rail-garment");
    await expect(garments).toHaveCount(10);

    const third = garments.nth(2);
    const before = (await third.boundingBox())!.width;
    await third.hover();
    await expect(third).toHaveAttribute("data-turned", "true");
    await expect.poll(async () => (await third.boundingBox())!.width).toBeGreaterThan(before * 2);
    const name = (await third.getAttribute("aria-label"))!.replace(/: open$/, "");
    await expect(rail.getByTestId("rail-label")).toHaveText(name);

    await third.click();
    const dialog = page.locator("dialog[open]");
    await expect(page.getByRole("dialog", { name })).toBeVisible();
    await expect(dialog.getByText("03 / 10")).toBeVisible();
    await expect(dialog.getByRole("link", { name: /View in the shop/ })).toHaveAttribute("href", /^\/product\//);

    const flip = dialog.getByTestId("rail-flip");
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(flip).toHaveAttribute("data-side", "back");
    await expect(dialog.getByRole("button", { name: "Back" })).toHaveAttribute("aria-pressed", "true");

    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] })
      .include("dialog")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByText("04 / 10")).toBeVisible();
    await expect(flip).toHaveAttribute("data-side", "front");

    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(garments.nth(3)).toBeFocused();
  });

  test("keyboard: focusing a garment turns it and Enter opens it", async ({ page }) => {
    await page.goto("/");
    const first = page.getByTestId("rail-garment").first();
    await first.focus();
    await expect(first).toHaveAttribute("data-turned", "true");
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Close/ }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });
});
