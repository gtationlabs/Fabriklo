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

  test("home shows department rows of category cards that scroll and link to listings", async ({ page }, info) => {
    await page.goto("/");
    const rows = page.getByTestId("department-rows");
    await rows.scrollIntoViewIfNeeded();
    for (const name of ["Menswear", "Womenswear", "Accessories"]) {
      await expect(rows.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    }
    const men = page.getByTestId("department-men");
    await expect(men.getByRole("link", { name: /Explore All/ })).toHaveAttribute("href", "/men");
    const shirts = men.getByTestId("department-tile").filter({ has: page.getByText("Shirts", { exact: true }) }).first();
    await expect(shirts).toHaveAttribute("href", "/men?category=shirts");
    // Every card shows a picture (uploaded photo or the demo illustration).
    expect(await men.getByTestId("department-tile").locator("img").count()).toBe(await men.getByTestId("department-tile").count());

    if (info.project.name === "desktop") {
      const track = men.getByRole("list", { name: "Menswear" });
      const before = await track.evaluate((el) => el.scrollLeft);
      await men.getByRole("button", { name: "Scroll Menswear forward" }).click();
      await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
      await expect(men.getByRole("button", { name: "Scroll Menswear back" })).toBeVisible();
    }

    await shirts.click();
    await expect(page).toHaveURL(/\/men\?category=shirts/);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Shirts");
  });

  test("listing page has departments, collection pills, filter menus and catalogue cards", async ({ page }, info) => {
    await page.goto("/men");
    await expect(page.getByRole("navigation", { name: "Departments" }).getByRole("link", { name: "Men", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("listing-promo")).toBeVisible();
    await expect(page.getByTestId("result-count")).toHaveText(/^1 - \d+ of \d+ Items$/);

    const card = page.getByTestId("product-card").first();
    await expect(card.getByText(/BDT [\d,]+/).first()).toBeVisible();
    await expect(card.getByText(/^\d+ colors?$/)).toBeVisible();
    await expect(card.getByRole("link", { name: /^Add .+ to bag/ })).toBeVisible();

    // Collection pills keep the department and add the collection.
    const pills = page.getByRole("navigation", { name: "Collections" });
    await expect(pills.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
    await pills.getByRole("link", { name: "Winter Layers" }).click();
    await expect(page).toHaveURL(/\/men\?collection=winter-layers/);
    await expect(pills.getByRole("link", { name: "Winter Layers" })).toHaveAttribute("aria-current", "true");

    if (info.project.name === "desktop") {
      // Size menu: pick a size and apply; the choice is kept in the URL.
      await page.locator("summary").filter({ hasText: /^Size/ }).click();
      await page.locator("label").filter({ hasText: /^L$/ }).click();
      await page.getByRole("button", { name: "Apply" }).filter({ visible: true }).click();
      await expect(page).toHaveURL(/size=L/);
      await expect(page).toHaveURL(/collection=winter-layers/);
      // Sort menu links keep the filters.
      await page.locator("summary").filter({ hasText: /Default|Featured|Price:/ }).last().click();
      await page.getByRole("link", { name: "Price: low to high" }).click();
      await expect(page).toHaveURL(/sort=price_asc/);
      await expect(page).toHaveURL(/size=L/);
    }
  });

  test("filters persist in the URL and narrow results", async ({ page }) => {
    await page.goto("/shop?size=32&category=pants");
    await expect(page.getByTestId("result-count")).toContainText("Items");
    const cards = page.getByTestId("product-card");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(5);
    await page.goto("/shop?q=oxford");
    await expect(page.getByTestId("result-count")).toHaveText(/^1 - 1 of 1 Item for/);
  });

  test("product page: breadcrumb, code, gallery, sizes, share, also-like and recently viewed", async ({ page }) => {
    await page.goto("/product/linen-blend-shirt");
    await page.goto("/product/oxford-button-down-shirt");
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Men" })).toHaveAttribute("href", "/men");
    await expect(crumbs.getByText("Oxford Button-Down Shirt - OXFORDBU")).toBeVisible();
    await expect(page.getByTestId("product-code")).toHaveText("Product Code: OXFORDBU");
    await expect(page.getByTestId("gallery-position")).toHaveText("1 / 3");
    await page.getByRole("button", { name: "Next photo" }).click();
    await expect(page.getByTestId("gallery-position")).toHaveText("2 / 3");
    // Picking another colour swaps the pictures and starts again at the first one.
    await page.locator('label[title="White"]').click();
    await expect(page.getByText("Color: White")).toBeVisible();
    await expect(page.getByTestId("gallery-position")).toHaveText("1 / 2");
    await expect(page.getByRole("link", { name: "Size Guide", exact: true })).toHaveAttribute("href", "/size-guide");
    await expect(page.getByRole("link", { name: "Share on WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    await page.getByRole("button", { name: "Find in store" }).click();
    await expect(page.getByRole("dialog", { name: "Find in store" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("also-like").getByTestId("product-card").first()).toBeVisible();
    await expect(page.getByTestId("recently-viewed").getByText("Linen Blend Shirt")).toBeVisible();
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    // No sideways scrolling on phones.
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("draft products are not reachable publicly", async ({ page }) => {
    const res = await page.goto("/product/unreleased-draft-jacket");
    expect(res?.status()).toBe(404);
  });

  test("guest can pick a size, add to cart, change quantity and remove", async ({ page }) => {
    await page.goto("/product/essential-crew-tee");
    await expect(page.getByRole("heading", { level: 1, name: "Essential Crew Tee" })).toBeVisible();
    await page.getByRole("button", { name: "Add to bag" }).click();
    await expect(page.locator("main [role=alert], form [role=alert], div[role=alert]:not(#__next-route-announcer__)").filter({ hasNotText: /^$/ }).first()).toHaveText("Please choose a size.");

    // Pick the first size with plenty of stock so quantity can be raised later.
    const sizes = page.locator('input[name="size"]:not([disabled])');
    const n = await sizes.count();
    for (let i = 0; i < n; i++) {
      await sizes.nth(i).locator("xpath=..").click();
      if ((await page.getByTestId("availability").textContent()) === "In stock") break;
    }
    await expect(page.getByTestId("availability")).toHaveText("In stock");
    await page.getByRole("button", { name: "Add to bag" }).click();
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
