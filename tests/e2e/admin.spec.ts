import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createTestUser, deleteTestUser } from "./helpers";

const created: string[] = [];
test.afterAll(async () => {
  for (const id of created) await deleteTestUser(id).catch(() => undefined);
});

function totp(secret: string) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("admin access control", () => {
  test("anonymous visitors are sent to the staff login", async ({ page }) => {
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a customer account cannot enter the admin", async ({ page }) => {
    const u = await createTestUser(null);
    created.push(u.id);
    await signIn(page, u.email, u.password);
    await expect(page).toHaveURL(/error=not_staff/);
    await expect(page.locator("main [role=alert], form [role=alert], div[role=alert]:not(#__next-route-announcer__)").filter({ hasNotText: /^$/ }).first()).toContainText("does not have staff access");
  });

  test("wrong password shows a generic error", async ({ page }) => {
    await signIn(page, "nobody@test.fabriklo.local", "wrong-password-123");
    await expect(page.locator("main [role=alert], form [role=alert], div[role=alert]:not(#__next-route-announcer__)").filter({ hasNotText: /^$/ }).first()).toHaveText("Email or password is incorrect.");
  });
});

test.describe("staff vertical slice", () => {
  test("MFA enrolment, product CRUD, variants, stock and publish to storefront", async ({ page }) => {
    test.setTimeout(120_000);
    const u = await createTestUser("admin");
    created.push(u.id);

    await signIn(page, u.email, u.password);
    await expect(page).toHaveURL(/\/admin\/mfa$/);
    // aal1 session cannot reach the console.
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/mfa$/);

    await page.getByText("Can't scan? Enter the key manually").click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.getByLabel("Authentication code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Active products")).toBeVisible();

    // Create a draft product
    const suffix = randomUUID().slice(0, 6);
    const title = `E2E Linen Shirt ${suffix}`;
    await page.goto("/admin/products/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Subtitle", { exact: true }).fill("Created by the end-to-end test");
    await page.getByLabel("Category", { exact: true }).selectOption({ label: "Shirts" });
    await page.getByLabel("Audience", { exact: true }).selectOption("men");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const adminUrl = page.url().replace(/\?.*$/, "");

    // Publishing without variants is refused
    await page.getByLabel("Status", { exact: true }).selectOption("active");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.locator("main [role=alert], form [role=alert], div[role=alert]:not(#__next-route-announcer__)").filter({ hasNotText: /^$/ }).first()).toContainText("Add at least one active variant");

    // Add a variant (validation first)
    const sku = `E2E-${suffix.toUpperCase()}-M`;
    await page.getByLabel("SKU", { exact: true }).fill(sku);
    await page.getByLabel("Size", { exact: true }).fill("M");
    await page.getByLabel("Colour", { exact: true }).fill("Sand");
    await page.getByLabel("Colour hex", { exact: true }).fill("#C2B280");
    await page.getByLabel("Price (৳)", { exact: true }).fill("abc");
    await page.getByRole("button", { name: "Add variant" }).click();
    await expect(page.getByText("Enter an amount in taka, e.g. 1290")).toBeVisible();
    await page.getByLabel("Price (৳)", { exact: true }).fill("1890");
    await page.getByRole("button", { name: "Add variant" }).click();
    await expect(page.getByTestId(`variant-${sku}`)).toBeVisible();
    await expect(page.getByTestId(`stock-${sku}`)).toContainText("0 available");

    // Receive stock with a reason (ledger + audit)
    const row = page.getByTestId(`variant-${sku}`);
    await row.getByRole("button", { name: "Adjust stock" }).click();
    await row.getByLabel("Quantity (use − to remove)").fill("7");
    await row.getByLabel("Reason (required, audited)").fill("Initial delivery from supplier");
    await row.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId(`stock-${sku}`)).toContainText("7 available");

    // Publish
    await page.getByLabel("Status", { exact: true }).selectOption("active");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Status: active")).toBeVisible();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Visible on the storefront with the right price and stock, purchasable
    await page.goto(`/product/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId("price")).toContainText("1,890");
    await page.locator('input[name="size"][value="M"]').locator("xpath=..").click();
    await expect(page.getByTestId("availability")).toHaveText("In stock");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByRole("status")).toContainText("Added 1");

    // Archive again so repeated runs don't clutter the demo shop
    await page.goto("/admin/products");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await page.goto(adminUrl);
    await page.getByLabel("Status", { exact: true }).selectOption("archived");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Status: archived")).toBeVisible();
    const gone = await page.goto(`/product/${slug}`);
    expect(gone?.status()).toBe(404);
  });

  test("support agent sees products read-only and no inventory menu", async ({ page }) => {
    const u = await createTestUser("support_agent");
    created.push(u.id);
    await signIn(page, u.email, u.password);
    await page.getByText("Can't scan? Enter the key manually").click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.getByLabel("Authentication code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Admin" });
    await expect(nav.getByRole("link", { name: "Products" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Inventory" })).toHaveCount(0);
    await page.goto("/admin/inventory");
    await expect(page).toHaveURL(/denied=inventory\.read/);
    await page.goto("/admin/products/new");
    await expect(page).toHaveURL(/denied=products\.write/);
  });
});
