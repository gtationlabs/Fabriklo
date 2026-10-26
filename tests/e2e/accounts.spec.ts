import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { serviceClient } from "./helpers";

const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const createdEmails: string[] = [];

test.afterAll(async () => {
  const svc = serviceClient();
  const { data } = await svc.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email && createdEmails.includes(u.email)) await svc.auth.admin.deleteUser(u.id);
});

async function inStockVariant() {
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  try {
    const { rows } = await pool.query<{ id: string }>(
      `select v.id from public.product_variants v join public.products p on p.id = v.product_id join public.stock_balances b on b.variant_id = v.id
        where p.status = 'active' and v.is_active and v.price_minor < 400000 group by v.id having sum(b.on_hand - b.reserved) >= 5 limit 1`,
    );
    return rows[0]!.id;
  } finally {
    await pool.end();
  }
}

async function axeSerious(page: Page) {
  const r = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

test.describe("customer accounts", () => {
  test("register, save an address, check out with it prefilled, see the order in the account", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const email = `e2e-cust-${randomUUID().slice(0, 8)}@test.fabriklo.local`;
    createdEmails.push(email);
    const password = `Pw-${randomUUID().slice(0, 12)}1`;

    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/login\?next=(%2F|\/)account$/);
    expect(await axeSerious(page)).toEqual([]);
    await page.getByRole("link", { name: "Create an account" }).click();

    // Weak password is refused with guidance.
    await page.getByLabel("Full name").fill("Farhana Akter");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel(/^Password/).fill("onlyletterspassword");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "letters and numbers" })).toBeVisible();
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText("Hello Farhana Akter.")).toBeVisible();

    // Save an address.
    await page.getByRole("link", { name: "Manage addresses" }).click();
    const form = page.getByRole("form", { name: "New address" });
    await form.getByLabel("Recipient name").fill("Farhana Akter");
    await form.getByLabel("Mobile number").fill("01811223344");
    await form.getByLabel("District").selectOption("Chattogram");
    await form.getByLabel("Area / thana").fill("Panchlaish");
    await form.getByLabel("House, road, landmark").fill("Flat 3B, House 22, Road 1");
    await form.getByRole("button", { name: "Save address" }).click();
    await expect(page.getByTestId("address-list")).toContainText("Flat 3B");
    await expect(page.getByTestId("address-list")).toContainText("Default");

    // Checkout is prefilled from the saved address and quotes the right zone.
    const variant = await inStockVariant();
    const res = await page.request.post("/api/cart/items", { headers: { Origin: baseURL! }, data: { variantId: variant, quantity: 1, mode: "increment" } });
    expect(res.ok()).toBeTruthy();
    await page.goto("/checkout");
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("Farhana Akter");
    await expect(page.getByLabel("District")).toHaveValue("Chattogram");
    await expect(page.getByTestId("checkout-shipping")).toHaveText("৳130");
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/order\/success$/);
    const orderNumber = (await page.getByRole("heading", { level: 2 }).first().textContent())!.trim();

    // The order shows in the account, with details, and is gone after sign-out.
    await page.goto("/account");
    await expect(page.getByTestId("account-orders")).toContainText(orderNumber);
    await page.getByRole("link", { name: orderNumber }).click();
    await expect(page.getByTestId("order-headline")).toHaveText("Order placed");
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto(`/account/orders/${orderNumber}`);
    await expect(page).toHaveURL(/\/account\/login/);

    // Sign back in; wrong password first.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: `Order ${orderNumber}` })).toBeVisible();
  });

  test("password reset always answers the same way", async ({ page }) => {
    await page.goto("/account/forgot");
    await page.getByLabel("Email").fill(`nobody-${randomUUID().slice(0, 6)}@test.fabriklo.local`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If that email has an account");
  });
});

test.describe("content pages", () => {
  test("starter legal and help pages render from the CMS", async ({ page }) => {
    await page.goto("/shipping");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shipping & delivery");
    await expect(page.getByRole("article").getByRole("link", { name: "track an order" })).toHaveAttribute("href", "/orders/track");
    expect(await axeSerious(page)).toEqual([]);
    await page.goto("/privacy");
    await expect(page.getByText("Last updated")).toBeVisible();
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Shipping & delivery");
  });
});
