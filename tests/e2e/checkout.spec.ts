import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import { createTestUser, deleteTestUser } from "./helpers";

const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const created: string[] = [];
let pool: Pool;

test.beforeAll(() => {
  if (/supabase\.co/.test(DB_URL)) throw new Error("E2E fixtures only run against local Supabase");
  pool = new Pool({ connectionString: DB_URL, max: 2 });
});
test.afterAll(async () => {
  for (const id of created) await deleteTestUser(id).catch(() => undefined);
  await pool.end();
});

async function inStockVariant() {
  const { rows } = await pool.query<{ id: string; title: string }>(
    `select v.id, p.title from public.product_variants v
       join public.products p on p.id = v.product_id
       join public.stock_balances b on b.variant_id = v.id
      where p.status = 'active' and v.is_active and v.price_minor < 400000
      group by v.id, p.title having sum(b.on_hand - b.reserved) >= 5
      order by random() limit 1`,
  );
  if (!rows[0]) throw new Error("no in-stock variant in seed data");
  return rows[0];
}

const randomPhone = () => `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function addToCart(page: Page, baseURL: string, variantId: string) {
  const res = await page.request.post("/api/cart/items", {
    headers: { Origin: baseURL },
    data: { variantId, quantity: 1, mode: "increment" },
  });
  expect(res.ok()).toBeTruthy();
}

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
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function transition(page: Page, title: string, to: string, reason?: string) {
  const form = page.getByRole("form", { name: new RegExp(`^${title}:`) });
  await form.getByRole("combobox").selectOption({ label: to });
  if (reason) await form.getByPlaceholder(/Reason/).fill(reason);
  await form.getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("form", { name: new RegExp(`^${title}:`) }).getByRole("status")).toHaveText("Status updated.");
}

test.describe("cash on delivery checkout", () => {
  test("guest checks out, tracks the order, and staff fulfil it through cash collected", async ({ page, baseURL, browser }) => {
    test.setTimeout(180_000);
    const variant = await inStockVariant();
    await addToCart(page, baseURL!, variant.id);

    await page.goto("/cart");
    await page.getByRole("link", { name: "Checkout" }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    // Client-side validation keeps the customer on the page with clear messages.
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Please fix the highlighted fields." })).toBeVisible();
    await expect(page.getByText("Enter a Bangladesh mobile number")).toBeVisible();

    await page.getByLabel("Full name").fill("Nusrat Jahan");
    await page.getByLabel("Mobile number").fill(randomPhone());
    await page.getByLabel("District").selectOption("Dhaka");
    await expect(page.getByTestId("checkout-shipping")).not.toHaveText(/Choose district|…/);
    await page.getByLabel("Area / thana").fill("Mohammadpur");
    await page.getByLabel("House, road, landmark").fill("House 7, Road 3, near the mosque");
    await page.getByRole("button", { name: /Place order/ }).click();

    await expect(page).toHaveURL(/\/order\/success$/);
    await expect(page.getByRole("heading", { name: "Your order is placed" })).toBeVisible();
    await expect(page.getByTestId("order-headline")).toHaveText("Order placed");
    const orderNumber = (await page.getByRole("heading", { level: 2 }).first().textContent())!.trim();
    expect(orderNumber).toMatch(/^FBK-\d+$/);
    const trackUrl = await page.getByTestId("tracking-link").inputValue();
    expect(trackUrl).toContain(`order=${orderNumber}`);

    // The cart is now empty.
    await page.goto("/cart");
    await expect(page.getByText("Your cart is empty.")).toBeVisible();

    // A wrong tracking code reveals nothing.
    await page.goto(`/orders/track?order=${orderNumber}&token=${"A".repeat(32)}`);
    await expect(page.getByRole("alert").filter({ hasText: "couldn't find an order" })).toBeVisible();

    // Staff side
    const staffUser = await createTestUser("order_manager");
    created.push(staffUser.id);
    const staffCtx = await browser.newContext();
    const admin = await staffCtx.newPage();
    await signInWithMfa(admin, staffUser.email, staffUser.password);
    await admin.goto(`/admin/orders?view=all&q=${orderNumber}`);
    await admin.getByRole("link", { name: orderNumber }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(orderNumber);

    // Guard: cannot mark ready before packing.
    await admin.getByRole("form", { name: /^Shipment:/ }).getByRole("button", { name: "Update" }).click();
    await expect(admin.getByRole("form", { name: /^Shipment:/ }).getByRole("alert")).toHaveText("Pack the order before marking it ready for pickup.");

    await transition(admin, "Fulfilment", "Confirmed");
    await transition(admin, "Fulfilment", "Being picked");
    await transition(admin, "Fulfilment", "Packed");
    const ship = admin.getByRole("form", { name: "Courier and tracking" });
    await ship.getByRole("combobox", { name: "Courier", exact: true }).selectOption("other");
    await ship.getByLabel("Display name").fill("Test Courier");
    await ship.getByLabel("Tracking number").fill("TC-12345");
    await ship.getByLabel("Tracking link (https)").fill("https://courier.example/track/TC-12345");
    await ship.getByRole("button", { name: "Save shipment" }).click();
    await expect(ship.getByRole("status")).toHaveText("Shipment saved.");
    await transition(admin, "Shipment", "Ready for courier pickup");
    await transition(admin, "Shipment", "With the courier");
    await transition(admin, "Shipment", "In transit");
    await transition(admin, "Shipment", "Out for delivery");
    await transition(admin, "Shipment", "Delivered");
    await transition(admin, "Payment", "Cash collected");
    await expect(admin.getByTestId("order-statuses")).toContainText("Cash collected");
    await expect(admin.getByTestId("order-timeline")).toContainText("Order placed");
    await staffCtx.close();

    // Customer sees the result on the private tracking link.
    await page.goto(trackUrl.replace(/^https?:\/\/[^/]+/, ""));
    await expect(page.getByTestId("order-headline")).toHaveText("Delivered");
    await expect(page.getByText("Test Courier · TC-12345")).toBeVisible();
    await expect(page.getByText("Nusrat ·").or(page.getByText(/For Nusrat/))).toBeVisible();
    await expect(page.getByText("House 7")).toHaveCount(0);
  });

  test("checkout page has no serious accessibility violations", async ({ page, baseURL }) => {
    const variant = await inStockVariant();
    await addToCart(page, baseURL!, variant.id);
    await page.goto("/checkout");
    await page.getByLabel("District").selectOption("Sylhet");
    await expect(page.getByTestId("checkout-shipping")).not.toHaveText(/Choose district|…/);
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("checkout API rejects cross-site and malformed requests", async ({ request, baseURL }) => {
    const bad = await request.post("/api/checkout/orders", { headers: { Origin: "https://evil.example" }, data: {} });
    expect(bad.status()).toBe(403);
    const invalid = await request.post("/api/checkout/orders", { headers: { Origin: baseURL! }, data: { phone: "123" } });
    expect(invalid.status()).toBe(422);
  });
});
