import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import { createTestUser, deleteTestUser } from "./helpers";

/**
 * Online payment through the LABELLED SANDBOX MOCK (the test server runs with
 * PAYMENTS_ALLOW_MOCK=true and no SSLCOMMERZ credentials). The mock exercises
 * the same session → redirect → server-side validation → settle pipeline a real
 * gateway would; nothing here claims a live gateway works.
 */
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
  const { rows } = await pool.query<{ id: string }>(
    `select v.id from public.product_variants v join public.products p on p.id = v.product_id join public.stock_balances b on b.variant_id = v.id
      where p.status = 'active' and v.is_active and v.price_minor < 400000 group by v.id having sum(b.on_hand - b.reserved) >= 5 order by random() limit 1`,
  );
  if (!rows[0]) throw new Error("no in-stock variant in seed data");
  return rows[0].id;
}

const randomPhone = () => `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function startOnlineCheckout(page: Page, baseURL: string) {
  const variant = await inStockVariant();
  const res = await page.request.post("/api/cart/items", { headers: { Origin: baseURL }, data: { variantId: variant, quantity: 1, mode: "increment" } });
  expect(res.ok()).toBeTruthy();
  await page.goto("/checkout");
  await page.getByLabel("Full name").fill("Tania Rahman");
  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel("District").selectOption("Dhaka");
  await expect(page.getByTestId("checkout-shipping")).not.toHaveText(/Choose district|…/);
  await page.getByLabel("Area / thana").fill("Dhanmondi");
  await page.getByLabel("House, road, landmark").fill("House 12, Road 5");
  const online = page.getByRole("radio", { name: /Pay online/ });
  await online.check();
  await expect(page.getByText("Sandbox mock: no real money moves.")).toBeVisible();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page).toHaveURL(/\/pay\/mock\/FBK-\d+-1$/);
  await expect(page.getByRole("status")).toContainText("SANDBOX MOCK GATEWAY");
  const tranId = (await page.getByTestId("mock-tran-id").textContent())!.trim();
  const { rows } = await pool.query<{ id: string; payment_status: string; reserved: number }>(
    `select o.id, o.payment_status, (select count(*)::int from public.inventory_reservations r where r.order_id = o.id and r.status = 'active') as reserved
       from public.orders o where o.order_number = $1`,
    [tranId.replace(/-\d+$/, "")],
  );
  expect(rows[0]!.payment_status).toBe("awaiting_payment");
  expect(rows[0]!.reserved).toBe(1);
  return { tranId, orderId: rows[0]!.id, orderNumber: tranId.replace(/-\d+$/, "") };
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

test.describe("online payment (sandbox mock)", () => {
  test("pays through the mock gateway; the order is paid only after server-side validation; staff see the attempt", async ({ page, baseURL, browser }) => {
    test.setTimeout(120_000);
    const { tranId, orderId, orderNumber } = await startOnlineCheckout(page, baseURL!);

    // A forged "success" return without a validation id changes nothing.
    const forged = await page.request.post("/api/payments/mock/return?outcome=success", { form: { tran_id: tranId, status: "VALID", amount: "1.00" }, maxRedirects: 0 });
    expect(forged.status()).toBe(303);
    await page.goto("/order/payment");
    await expect(page.getByTestId("payment-headline")).toHaveText("Waiting for your payment");
    // The mock's IPN endpoint does not exist: only real providers get one.
    expect((await page.request.post("/api/payments/mock/ipn", { form: { tran_id: tranId } })).status()).toBe(404);

    await page.goto(`/pay/mock/${tranId}`);
    await page.getByRole("button", { name: "Simulate successful payment" }).click();
    await expect(page).toHaveURL(/\/order\/payment$/);
    await expect(page.getByTestId("payment-headline")).toHaveText("Payment received");
    await expect(page.getByText("sandbox mock gateway (no real money moved)")).toBeVisible();
    await expect(page.getByTestId("tracking-link")).toHaveValue(new RegExp(`order=${orderNumber}`));

    const { rows } = await pool.query<{ payment_status: string; tx: string; committed: number; events: string[] }>(
      `select o.payment_status,
              (select status from public.payment_transactions t where t.tran_id = $2) as tx,
              (select count(*)::int from public.inventory_reservations r where r.order_id = o.id and r.status = 'committed') as committed,
              (select array_agg(e.kind order by e.id) from public.payment_events e join public.payment_transactions t on t.id = e.transaction_id where t.order_id = o.id) as events
         from public.orders o where o.id = $1`,
      [orderId, tranId],
    );
    expect(rows[0]).toMatchObject({ payment_status: "paid", tx: "valid", committed: 1 });
    expect(rows[0]!.events).toEqual(["session_created", "return", "ipn", "validation", "settled"]);

    // Pressing the mock button again is a no-op (closed attempt).
    await page.goto(`/pay/mock/${tranId}`);
    await expect(page.getByRole("button", { name: "Simulate successful payment" })).toBeDisabled();

    // Staff see the payment attempt and its events.
    const staffUser = await createTestUser("order_manager");
    created.push(staffUser.id);
    const admin = await (await browser.newContext()).newPage();
    await signInWithMfa(admin, staffUser.email, staffUser.password);
    await admin.goto(`/admin/orders/${orderId}`);
    await expect(admin.getByText("Online payment (sandbox mock, not a real payment)")).toBeVisible();
    const payments = admin.getByTestId("order-payments");
    await expect(payments).toContainText("Attempt 1");
    await expect(payments).toContainText(tranId);
    await expect(payments).toContainText("settled · valid");
    await expect(admin.getByTestId("order-statuses")).toContainText("Paid");
  });

  test("a failed payment keeps the order; the customer retries and succeeds", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const { tranId, orderNumber } = await startOnlineCheckout(page, baseURL!);
    await page.getByRole("button", { name: "Simulate failed payment" }).click();
    await expect(page).toHaveURL(/\/order\/payment$/);
    await expect(page.getByTestId("payment-headline")).toHaveText("Payment not completed");
    await expect(page.getByText("Nothing was charged.")).toBeVisible();

    await page.getByRole("button", { name: "Try paying again" }).click();
    await expect(page).toHaveURL(new RegExp(`/pay/mock/${orderNumber}-2$`));
    await page.getByRole("button", { name: "Simulate cancel (go back)" }).click();
    await expect(page.getByTestId("payment-headline")).toHaveText("Payment not completed");
    await expect(page.getByText("You cancelled on the gateway page.")).toBeVisible();

    await page.getByRole("button", { name: "Try paying again" }).click();
    await expect(page).toHaveURL(new RegExp(`/pay/mock/${orderNumber}-3$`));
    await page.getByRole("button", { name: "Simulate successful payment" }).click();
    await expect(page.getByTestId("payment-headline")).toHaveText("Payment received");
    const { rows } = await pool.query<{ status: string }>(`select status from public.payment_transactions where order_id = (select id from public.orders where order_number = $1) order by attempt`, [orderNumber]);
    expect(rows.map((r) => r.status)).toEqual(["failed", "cancelled", "valid"]);
    expect(tranId).toBe(`${orderNumber}-1`);
  });
});

test.describe("courier webhooks", () => {
  test("unconfigured couriers answer 404; the manual courier has no webhook", async ({ request }) => {
    const body = JSON.stringify({ id: "x", tracking_number: "T", status: "delivered" });
    const sig = createHmac("sha256", "not-configured").update(body).digest("hex");
    for (const c of ["manual", "pathao", "steadfast", "redx", "nope"]) {
      const res = await request.post(`/api/couriers/${c}/webhook`, { data: body, headers: { "content-type": "application/json", "x-webhook-signature": sig } });
      expect(res.status(), c).toBe(404);
    }
  });
});
