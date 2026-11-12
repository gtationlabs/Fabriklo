import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import { createTestUser, deleteTestUser } from "./helpers";

/**
 * Admin dashboard modules end to end: sidebar + user menu, settings hub,
 * categories, checkout leads captured from the real checkout, reviews from the
 * product page through moderation, shipping methods at checkout, API keys.
 */
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const created: string[] = [];
let pool: Pool;
const tag = randomUUID().slice(0, 6);

test.beforeAll(() => {
  if (/supabase\.co/.test(DB_URL)) throw new Error("E2E fixtures only run against local Supabase");
  pool = new Pool({ connectionString: DB_URL, max: 2 });
});
test.afterAll(async () => {
  await pool.query(`delete from public.categories where slug like 'e2e-%'`).catch(() => undefined);
  await pool.query(`update public.shipping_methods set is_active = false where code = 'express'`).catch(() => undefined);
  await pool.query(`delete from public.product_reviews where body like '%e2e-${tag}%'`).catch(() => undefined);
  await pool.query(`delete from public.api_keys where name like 'E2E %'`).catch(() => undefined);
  for (const id of created) await deleteTestUser(id).catch(() => undefined);
  await pool.end();
});

async function signInWithMfa(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await page.getByText("Can't scan? Enter the key manually").click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
  await page.getByLabel("Authentication code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function stockedProduct() {
  const { rows } = await pool.query<{ id: string; slug: string }>(
    `select v.id, p.slug from public.product_variants v join public.products p on p.id = v.product_id join public.stock_balances b on b.variant_id = v.id
      where p.status = 'active' and v.is_active and v.price_minor between 100000 and 400000 group by v.id, p.slug having sum(b.on_hand - b.reserved) >= 5 limit 1`,
  );
  return rows[0]!;
}

test.describe("admin modules", () => {
  test("sidebar, user menu, settings hub and categories", async ({ page }) => {
    test.setTimeout(120_000);
    const owner = await createTestUser("super_admin");
    created.push(owner.id);
    await signInWithMfa(page, owner.email, owner.password);

    const nav = page.getByRole("navigation", { name: "Admin" });
    for (const label of ["Dashboard", "Products", "Categories", "Orders", "Checkout Leads", "Slider", "Coupons", "Shipping Zones", "Shipping Methods", "Reviews", "Courier", "Payment Methods", "Users", "Settings"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("admin-email")).toHaveText(owner.email);

    // User menu → View Profile.
    await page.getByTestId("user-menu-button").click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu.getByRole("menuitem", { name: "Account Settings" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Logout" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "View Profile" }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/profile$/);
    const profile = page.getByRole("form", { name: "Profile details" });
    await profile.getByLabel("Display name").fill("Owner Ayesha");
    await profile.getByLabel("Job title").fill("Founder");
    await profile.getByRole("button", { name: "Save profile" }).click();
    await expect(profile.getByRole("status")).toContainText("Profile saved");
    await expect(page.getByTestId("user-menu-button")).toContainText("Owner Ayesha");

    // Settings search filters the section list.
    const settingsNav = page.getByRole("navigation", { name: "Settings" });
    await page.getByPlaceholder("Search settings...").fill("pixel");
    await expect(settingsNav.getByRole("link", { name: "Meta Pixels & Datasets" })).toBeVisible();
    await expect(settingsNav.getByRole("link", { name: "Profile" })).toHaveCount(0);
    await page.getByPlaceholder("Search settings...").fill("");
    for (const label of ["Account", "Security", "Store details", "Invoice & packing slip", "Social profiles", "API & Webhooks"]) {
      await expect(settingsNav.getByRole("link", { name: label })).toBeVisible();
    }
    const exp = await page.request.get("/admin/settings/export");
    expect(exp.status()).toBe(200);
    expect(await exp.json()).toHaveProperty("shipping_methods");

    // Categories: create, refuse a duplicate slug, delete.
    await page.goto("/admin/categories");
    const form = page.getByRole("form", { name: "New category" });
    await form.getByLabel("Name", { exact: true }).fill(`E2E ${tag}`);
    await form.getByLabel("Slug").fill(`e2e-${tag}`);
    await form.getByRole("button", { name: "Create category" }).click();
    await expect(form.getByRole("status")).toContainText("Category created");
    await form.getByLabel("Slug").fill(`e2e-${tag}`);
    await form.getByRole("button", { name: "Create category" }).click();
    await expect(form.getByRole("alert")).toContainText("already used");
    await expect(page.getByTestId("categories-list")).toContainText(`E2E ${tag}`);
    page.once("dialog", (d) => void d.accept());
    const summary = page.getByTestId("categories-list").locator("summary").filter({ hasText: `E2E ${tag}` });
    await summary.click();
    await page.getByRole("form", { name: `Delete E2E ${tag}` }).getByRole("button", { name: "Delete" }).click();
    await expect(summary).toHaveCount(0);

    // Every new module page renders for the owner.
    for (const [href, heading] of [
      ["/admin/checkout-leads", "Checkout Leads"], ["/admin/slider", "Slider"], ["/admin/reviews", "Reviews"], ["/admin/shipping-zones", "Shipping Zones"],
      ["/admin/shipping-methods", "Shipping Methods"], ["/admin/courier", "Courier"], ["/admin/payment-methods", "Payment Methods"], ["/admin/users", "Users"],
      ["/admin/settings/security", "Settings"], ["/admin/settings/invoice", "Settings"], ["/admin/settings/meta-pixels", "Settings"],
    ] as const) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });

  test("checkout leads, delivery options and the read-only API", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const owner = await createTestUser("super_admin");
    created.push(owner.id);
    await signInWithMfa(page, owner.email, owner.password);

    // Switch on the express option.
    await page.goto("/admin/shipping-methods");
    const express = page.getByRole("form", { name: "Method: Express delivery" });
    await express.getByLabel("Extra charge (৳)").fill("120");
    await express.getByLabel("Active").check({ force: true });
    await express.getByRole("button", { name: "Save option" }).click();
    await expect(express.getByRole("status")).toContainText("saved");

    // A shopper types their number at checkout, picks express, and leaves.
    const v = await stockedProduct();
    const guest = await browser.newContext();
    const gp = await guest.newPage();
    await gp.goto("/shop");
    const add = await gp.request.post("/api/cart/items", { headers: { Origin: baseURL! }, data: { variantId: v.id, quantity: 1, mode: "increment" } });
    expect(add.ok()).toBeTruthy();
    await gp.goto("/checkout");
    await gp.getByLabel("Full name").fill(`Lead ${tag}`);
    await gp.getByLabel("Mobile number").fill("01712 345678");
    await gp.getByLabel("District").selectOption("Dhaka");
    await expect(gp.getByTestId("checkout-shipping")).toHaveText(/\d/);
    const before = Number((await gp.getByTestId("checkout-shipping").textContent())!.replace(/\D/g, ""));
    const options = gp.getByTestId("delivery-options");
    await options.getByLabel(/Express delivery/).click();
    await expect(options.getByLabel(/Express delivery/)).toBeChecked();
    await expect(gp.getByTestId("checkout-shipping")).not.toHaveText(String(before));
    const after = Number((await gp.getByTestId("checkout-shipping").textContent())!.replace(/\D/g, ""));
    expect(after - before).toBe(120);
    await gp.getByLabel("Area / thana").click(); // blur → lead saved
    await expect.poll(async () => (await pool.query(`select 1 from public.checkout_leads where name = $1`, [`Lead ${tag}`])).rowCount, { timeout: 10_000 }).toBe(1);
    await guest.close();

    await page.goto("/admin/checkout-leads");
    const lead = page.getByTestId("leads-list").locator("li").filter({ hasText: `Lead ${tag}` });
    await expect(lead).toContainText("+8801712345678");
    await lead.getByLabel("Status").selectOption("contacted");
    await lead.getByLabel("Note").fill("Called, ordering tonight");
    await lead.getByRole("button", { name: "Update" }).click();
    await expect(lead.getByRole("status")).toContainText("Lead updated");

    // API key: shown once, works with its scope only.
    await page.goto("/admin/settings/api");
    const keyForm = page.getByRole("form", { name: "Create API key" });
    await keyForm.getByLabel("Key name").fill(`E2E ${tag}`);
    await keyForm.getByRole("button", { name: "Create key" }).click();
    const secret = (await page.getByTestId("one-time-secret").locator("code").textContent())!.trim();
    expect(secret).toMatch(/^fbk_/);
    const ok = await page.request.get("/api/v1/products?limit=2", { headers: { Authorization: `Bearer ${secret}` } });
    expect(ok.status()).toBe(200);
    expect(((await ok.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
    expect((await page.request.get("/api/v1/orders", { headers: { Authorization: `Bearer ${secret}` } })).status()).toBe(403);
    expect((await page.request.get("/api/v1/products")).status()).toBe(401);
  });

  test("a customer review is held, approved in the admin, then shown on the product page", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const v = await stockedProduct();
    const cust = await createTestUser(null);
    created.push(cust.id);
    const cctx = await browser.newContext();
    const cp = await cctx.newPage();
    await cp.goto(`/account/login?next=${encodeURIComponent(`/product/${v.slug}`)}`);
    await cp.getByLabel("Email").fill(cust.email);
    await cp.getByLabel("Password").fill(cust.password);
    await cp.getByRole("button", { name: "Sign in" }).click();
    await expect(cp).toHaveURL(new RegExp(`/product/${v.slug}`));
    const section = cp.getByTestId("product-reviews");
    await section.getByText("Write a review").click();
    const form = cp.getByRole("form", { name: "Write a review" });
    await form.getByLabel("Name shown").fill("Mitu R.");
    await form.getByLabel("Your review").fill(`Soft fabric, true colour. e2e-${tag}`);
    await form.getByRole("button", { name: "Submit review" }).click();
    await expect(form.getByRole("status")).toContainText("once our team has checked it");
    await cp.reload();
    await expect(cp.getByTestId("product-reviews")).not.toContainText(`e2e-${tag}`);

    const mod = await createTestUser("content_editor");
    created.push(mod.id);
    await signInWithMfa(page, mod.email, mod.password);
    await page.goto("/admin/reviews?status=pending");
    const item = page.getByTestId("reviews-list").locator("li").filter({ hasText: `e2e-${tag}` });
    await item.getByLabel("Public reply (optional)").fill("Thank you, Mitu!");
    await item.getByRole("button", { name: "Save" }).click();
    // Approved: it leaves the pending list.
    await expect(item).toHaveCount(0);

    await cp.reload();
    await expect(cp.getByTestId("product-reviews")).toContainText(`e2e-${tag}`);
    await expect(cp.getByTestId("product-reviews")).toContainText("Thank you, Mitu!");
    await cctx.close();
  });
});
