import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { createTestUser, deleteTestUser } from "./helpers";

/**
 * Staff two-step sign-in is OFF by default: email + password opens the admin.
 * A super admin can switch authenticator codes back on from Settings → Security.
 */
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
let pool: Pool;
const created: string[] = [];

test.beforeAll(async () => {
  pool = new Pool({ connectionString: DB_URL, max: 1 });
  await pool.query(`update private.security_settings set staff_mfa_required = false`);
});
test.afterAll(async () => {
  // The rest of the E2E run expects the strict policy (see global-setup.ts).
  await pool.query(`update private.security_settings set staff_mfa_required = true`);
  await pool.end();
  for (const id of created) await deleteTestUser(id).catch(() => undefined);
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("admin sign-in without an authenticator code", () => {
  test("staff go straight to the dashboard; customers are still kept out", async ({ page, browser }) => {
    const staff = await createTestUser("support_agent");
    created.push(staff.id);
    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.goto("/admin/mfa");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/orders");
    await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();

    const customer = await createTestUser(null);
    created.push(customer.id);
    const ctx = await browser.newContext();
    const cp = await ctx.newPage();
    await signIn(cp, customer.email, customer.password);
    await expect(cp).toHaveURL(/error=not_staff/);
    await ctx.close();
  });

  test("a super admin can turn authenticator codes back on, which sends staff to set one up", async ({ page }) => {
    const owner = await createTestUser("super_admin");
    created.push(owner.id);
    await signIn(page, owner.email, owner.password);
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto("/admin/settings/security");
    await expect(page.getByTestId("staff-mfa-status")).toContainText("Off: password only");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Turn on authenticator codes" }).click();
    // The owner's own password-only session no longer qualifies: straight to authenticator setup.
    await expect(page).toHaveURL(/\/admin\/mfa$/);
    await expect(page.getByRole("heading", { name: "Set up two-factor authentication" })).toBeVisible();

    const { rows } = await pool.query<{ v: boolean }>(`select staff_mfa_required as v from private.security_settings`);
    expect(rows[0].v).toBe(true);
    const { rows: audit } = await pool.query(`select 1 from public.audit_events where actor_id = $1 and action = 'settings.staff_mfa'`, [owner.id]);
    expect(audit).toHaveLength(1);

    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/mfa$/);
  });
});
