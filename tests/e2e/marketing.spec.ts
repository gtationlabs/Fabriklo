import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import { createTestUser, deleteTestUser } from "./helpers";

/**
 * Slice 7 end to end, with the LABELLED MOCK message providers (the test server
 * runs with NOTIFY_ALLOW_MOCK=true, so nothing is delivered; the outbox keeps a
 * preview of what would have been sent).
 */
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const created: string[] = [];
let pool: Pool;

/** Rules and coupons left by an earlier run would fire again (two live rules → two emails), so clear them before and after. */
async function cleanupFixtures() {
  await pool.query(`delete from public.automation_rules where name like 'E2E %'`);
  await pool.query(`delete from public.promotions where code like 'E2E%' and redemption_count = 0`);
}

test.beforeAll(async () => {
  if (/supabase\.co/.test(DB_URL)) throw new Error("E2E fixtures only run against local Supabase");
  pool = new Pool({ connectionString: DB_URL, max: 2 });
  await cleanupFixtures();
});
test.afterAll(async () => {
  await cleanupFixtures().catch(() => undefined);
  for (const id of created) await deleteTestUser(id).catch(() => undefined);
  await pool.end();
});

const randomPhone = () => `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function inStockVariant() {
  const { rows } = await pool.query<{ id: string; price_minor: number }>(
    `select v.id, v.price_minor from public.product_variants v
       join public.products p on p.id = v.product_id
       join public.stock_balances b on b.variant_id = v.id
      where p.status = 'active' and v.is_active and v.price_minor between 100000 and 400000
      group by v.id, v.price_minor having sum(b.on_hand - b.reserved) >= 5
      order by random() limit 1`,
  );
  if (!rows[0]) throw new Error("no in-stock variant in seed data");
  return rows[0];
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

async function waitForRow<T extends Record<string, unknown>>(sql: string, params: unknown[], timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { rows } = await pool.query<T>(sql, params);
    if (rows[0]) return rows[0];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for: ${sql}`);
}

test.describe("marketing, coupons and automation (mock providers)", () => {
  test("staff create a coupon and a live rule; a guest redeems the coupon; the order confirmation goes through the outbox exactly once", async ({ page, baseURL, browser }) => {
    test.setTimeout(240_000);
    const code = `E2E${randomUUID().slice(0, 6).toUpperCase()}`;
    const staffUser = await createTestUser("super_admin");
    created.push(staffUser.id);
    const staffCtx = await browser.newContext();
    const admin = await staffCtx.newPage();
    await signInWithMfa(admin, staffUser.email, staffUser.password);

    // Coupon: 10% off the whole order, one use per customer.
    await admin.getByRole("link", { name: "Marketing" }).click();
    await expect(admin.getByRole("heading", { name: "Marketing" })).toBeVisible();
    await expect(admin.getByTestId("marketing-stats")).toContainText("Outbox");
    await admin.goto("/admin/marketing/coupons/new");
    const pf = admin.getByRole("form", { name: "New promotion" });
    await pf.getByLabel(/^Code/).fill(code);
    await pf.getByLabel("Name", { exact: true }).fill("E2E ten percent");
    await pf.getByLabel(/^Percent/).fill("10");
    await pf.getByLabel("One use per customer").check();
    await pf.getByRole("button", { name: "Create promotion" }).click();
    await expect(admin).toHaveURL(/\/admin\/marketing\/coupons\/[0-9a-f-]{36}$/);
    await expect(admin.getByRole("heading", { name: "E2E ten percent" })).toBeVisible();

    // Rule: live order confirmation email to the customer.
    await admin.goto("/admin/marketing/rules/new");
    const rf = admin.getByRole("form", { name: "New rule" });
    await rf.getByLabel("Name", { exact: true }).fill("E2E confirm orders");
    await rf.getByRole("combobox", { name: "Trigger" }).selectOption("order.placed");
    await rf.getByRole("combobox", { name: "Mode" }).selectOption("live");
    await rf.getByRole("checkbox", { name: "Active" }).check();
    await rf.getByRole("combobox", { name: "Type" }).selectOption("email");
    await rf.getByRole("combobox", { name: "Template" }).selectOption("order_confirmation");
    await rf.getByRole("button", { name: "Create rule" }).click();
    await expect(admin).toHaveURL(/\/admin\/marketing\/rules\/[0-9a-f-]{36}$/);
    const ruleUrl = admin.url();
    await expect(admin.getByRole("heading", { name: "E2E confirm orders" })).toBeVisible();

    // A webhook to a host that is not allowlisted is refused when the rule is saved.
    await admin.goto("/admin/marketing/rules/new");
    const wf = admin.getByRole("form", { name: "New rule" });
    await wf.getByLabel("Name", { exact: true }).fill("E2E bad webhook");
    await wf.getByRole("combobox", { name: "Type" }).selectOption("webhook");
    await wf.getByLabel(/^URL/).fill("https://evil.example.net/hook");
    await wf.getByRole("button", { name: "Create rule" }).click();
    await expect(wf.getByRole("alert")).toContainText("not on the allowlist");

    // Guest: coupon at checkout.
    const variant = await inStockVariant();
    const add = await page.request.post("/api/cart/items", { headers: { Origin: baseURL! }, data: { variantId: variant.id, quantity: 1, mode: "increment" } });
    expect(add.ok()).toBeTruthy();
    await page.goto("/checkout");
    const box = page.getByTestId("coupon-box");
    await box.getByPlaceholder("Coupon code").fill("NOSUCHCODE");
    await box.getByRole("button", { name: "Apply" }).click();
    await expect(box.getByRole("alert")).toHaveText("We don't recognise that code.");
    await box.getByPlaceholder("Coupon code").fill(code.toLowerCase());
    await box.getByRole("button", { name: "Apply" }).click();
    await expect(box.getByRole("status")).toHaveText("Coupon applied.");
    await expect(box).toContainText(code);
    const expectedDiscount = Math.floor(Number(variant.price_minor) / 10);
    await expect(page.getByTestId("checkout-discount")).toContainText(String(Math.round(expectedDiscount / 100)));

    const email = `buyer-${randomUUID().slice(0, 8)}@example.com`;
    await page.getByLabel("Full name").fill("Tanvir Hasan");
    await page.getByLabel("Mobile number").fill(randomPhone());
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("District").selectOption("Dhaka");
    await expect(page.getByTestId("checkout-shipping")).not.toHaveText(/Choose district|…/);
    await page.getByLabel("Area / thana").fill("Gulshan");
    await page.getByLabel("House, road, landmark").fill("House 2, Road 9, near the park");
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/order\/success$/);
    const orderNumber = (await page.getByRole("heading", { level: 2 }).first().textContent())!.trim();

    // Database: discount committed atomically with the order and the redemption recorded once.
    const { rows: [order] } = await pool.query<{ id: string; discount_minor: string; coupon_code: string; subtotal_minor: string; redemptions: number }>(
      `select o.id, o.discount_minor, o.coupon_code, o.subtotal_minor, (select count(*)::int from public.coupon_redemptions r where r.order_id = o.id) as redemptions
         from public.orders o where o.order_number = $1`, [orderNumber]);
    expect(order).toMatchObject({ coupon_code: code, redemptions: 1 });
    expect(Number(order!.discount_minor)).toBe(expectedDiscount);

    // The order.placed event was processed by the live rule: one queued → sent (mock) message, never two.
    const sent = await waitForRow<{ status: string; provider: string; preview: string; n: number }>(
      `select o.status, o.provider, o.payload ->> 'preview' as preview,
              (select count(*)::int from public.notification_outbox x where x.recipient = $1 and x.template_key = 'order_confirmation') as n
         from public.notification_outbox o where o.recipient = $1 and o.template_key = 'order_confirmation' and o.status = 'sent'`, [email]);
    expect(sent).toMatchObject({ provider: "mock-email", n: 1 });
    expect(sent.preview).toContain(orderNumber);
    expect(sent.preview).toContain("Tanvir Hasan");
    const { rows: execs } = await pool.query<{ status: string }>(`select x.status from public.automation_executions x join public.marketing_events e on e.id = x.event_id where e.order_id = $1`, [order!.id]);
    expect(execs.map((e) => e.status)).toEqual(["queued"]);

    // Staff see the execution on the rule, the sent message (labelled mock) in the outbox, and the redemption on the coupon.
    await admin.goto(ruleUrl);
    await expect(admin.getByTestId("rule-executions")).toContainText("queued");
    await admin.getByRole("button", { name: /Test against recent events/ }).click();
    await expect(admin.getByTestId("rule-test-results")).toContainText("yes");
    await admin.goto("/admin/marketing/outbox?status=sent");
    await expect(admin.getByText("MOCK providers deliver nothing")).toBeVisible();
    const row = admin.getByTestId("outbox-table").getByRole("row").filter({ hasText: email });
    await expect(row).toContainText("mock-email");
    await admin.goto("/admin/marketing/coupons");
    await expect(admin.getByTestId("promotions-table").getByRole("row").filter({ hasText: code })).toContainText("1 ");
    await staffCtx.close();
  });

  test("newsletter double opt-in through the mock mailer, then unsubscribe; the worker endpoint is hidden", async ({ page, request }) => {
    test.setTimeout(120_000);
    expect((await request.post("/api/automation/worker")).status()).toBe(404);
    const email = `news-${randomUUID().slice(0, 8)}@example.com`;
    await page.goto("/shop");
    const form = page.getByRole("form", { name: "Newsletter" });
    await form.getByLabel("Newsletter").fill(email);
    await form.getByRole("button", { name: "Join" }).click();
    await expect(form.getByRole("status")).toContainText("Check your inbox");
    const mail = await waitForRow<{ token: string; message_class: string }>(
      `select payload ->> 'confirm_token' as token, message_class from public.notification_outbox where recipient = $1 and template_key = 'newsletter_confirm' and status = 'sent'`, [email]);
    expect(mail.message_class).toBe("transactional");
    const { rows: [pending] } = await pool.query<{ status: string }>(`select status from public.newsletter_subscriptions where email = $1`, [email]);
    expect(pending!.status).toBe("pending");

    await page.goto(`/newsletter/confirm?token=${"0".repeat(48)}`);
    await expect(page.getByRole("heading", { name: "That link didn't work" })).toBeVisible();
    await page.goto(`/newsletter/confirm?token=${mail.token}`);
    await expect(page.getByRole("heading", { name: "You're subscribed" })).toBeVisible();
    const { rows: [sub] } = await pool.query<{ status: string }>(`select status from public.newsletter_subscriptions where email = $1`, [email]);
    expect(sub!.status).toBe("subscribed");

    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
    await pool.query(`select public.newsletter_unsubscribe_token_set($1, $2)`, [email, token]);
    await page.goto(`/newsletter/unsubscribe?token=${token}`);
    await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
    const { rows: [supp] } = await pool.query(`select 1 from public.unsubscribes where identifier = $1 and channel = 'email'`, [email]);
    expect(supp).toBeTruthy();
  });

  test("cookie consent gates attribution capture", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/shop?utm_source=e2e-test&utm_medium=test");
    const banner = page.getByTestId("consent-banner");
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Essential only" }).click();
    await expect(banner).toHaveCount(0);
    let cookies = await ctx.cookies();
    expect(cookies.find((c) => c.name === "fbk_consent")?.value).toContain("%22analytics%22%3Afalse");
    expect(cookies.find((c) => c.name === "fbk_utm")).toBeUndefined();
    await page.reload();
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    await ctx.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto("/shop?utm_source=e2e-test&utm_campaign=launch");
    await page2.getByTestId("consent-banner").getByRole("button", { name: "Accept all" }).click();
    await expect.poll(async () => (await ctx2.cookies()).find((c) => c.name === "fbk_utm")?.value ?? "").toContain("e2e-test");
    cookies = await ctx2.cookies();
    expect(decodeURIComponent(cookies.find((c) => c.name === "fbk_utm")!.value)).toContain('"utm_campaign":"launch"');
    await ctx2.close();
  });
});
