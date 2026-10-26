import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import { createTestUser, deleteTestUser } from "./helpers";

/**
 * Slice 8 end to end: theme versions on the live store, store settings that the
 * storefront and checkout pick up, staff invitation → password → MFA → suspension,
 * and the audit viewer. Values changed here are restored at the end so the other
 * specs keep their demo rates.
 */
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const created: string[] = [];
let pool: Pool;
let originalZone: { fee_minor: number; free_over_minor: number | null } | null = null;

test.beforeAll(() => {
  if (/supabase\.co/.test(DB_URL)) throw new Error("E2E fixtures only run against local Supabase");
  pool = new Pool({ connectionString: DB_URL, max: 2 });
});
test.afterAll(async () => {
  // Restore demo values other specs rely on (the theme is republished with defaults by the theme test itself).
  await pool.query(`update public.site_settings set value = '{"name": "Fabriklo", "tagline": "Considered clothing for everyday Dhaka", "currency": "BDT", "locale": "en-BD"}' where key = 'store.identity'`).catch(() => undefined);
  await pool.query(`update public.site_settings set value = '{"enabled": true, "max_order_minor": 2000000}' where key = 'checkout.cod'`).catch(() => undefined);
  await pool.query(`update public.site_settings set value = '{"rates_confirmed": false}' where key = 'store.setup'`).catch(() => undefined);
  if (originalZone) await pool.query(`update public.shipping_zones set fee_minor = $1, free_over_minor = $2 where code = 'inside-dhaka'`, [originalZone.fee_minor, originalZone.free_over_minor]).catch(() => undefined);
  await pool.query(`delete from public.staff_members where user_id in (select id from auth.users where email like 'invitee-%@test.fabriklo.local')`).catch(() => undefined);
  await pool.query(`delete from auth.users where email like 'invitee-%@test.fabriklo.local'`).catch(() => undefined);
  for (const id of created) await deleteTestUser(id).catch(() => undefined);
  await pool.end();
});

async function enrolMfa(page: Page) {
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await page.getByText("Can't scan? Enter the key manually").click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
  await page.getByLabel("Authentication code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function signInWithMfa(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await enrolMfa(page);
}

async function themeVars(page: Page) {
  return page.evaluate(() => document.getElementById("theme-vars")?.textContent ?? "");
}

test.describe("theme, settings, staff and audit (admin)", () => {
  test("theme draft → preview → publish changes the live store; rollback restores the previous version", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const admin = await createTestUser("super_admin");
    created.push(admin.id);
    // Baseline: nothing published (the store renders its built-in defaults); versions from earlier runs stay (append-only).
    await pool.query(`update public.themes set published_version_id = null where key = 'default'`);
    const { rows: [{ base }] } = await pool.query<{ base: number }>(`select coalesce(max(version), 0)::int as base from public.theme_versions where theme_key = 'default'`);
    await signInWithMfa(page, admin.email, admin.password);

    await page.goto("/admin/content/theme");
    const form = page.getByRole("form", { name: "Theme draft" });
    await form.getByLabel("Page background", { exact: true }).fill("#FFFFFF");
    await form.getByRole("combobox", { name: /^Heading font/ }).selectOption("playfair");
    await form.getByRole("combobox", { name: /^Corners/ }).selectOption("lg");
    // The scoped preview follows the draft instantly.
    await expect(page.getByTestId("theme-preview")).toHaveAttribute("style", /--color-paper:\s*#ffffff/);
    await expect(page.getByTestId("contrast-checks")).toContainText("meet WCAG AA");
    // An unreadable pair is flagged before saving.
    await form.getByLabel("Body text", { exact: true }).fill("#dddddd");
    await expect(page.getByTestId("contrast-checks")).toContainText("needs at least");
    await form.getByLabel("Body text", { exact: true }).fill("#2e2b28");
    await form.getByRole("button", { name: "Save draft" }).click();
    await expect(form.getByRole("status")).toContainText("Draft saved");

    // Draft is visible in the preview page only; the store is unchanged.
    const preview = await browser.newContext({ storageState: await page.context().storageState() });
    const pp = await preview.newPage();
    await pp.goto("/admin/content/preview?theme=draft");
    await expect(pp.getByTestId("hero-preview")).toHaveAttribute("style", /--color-paper:\s*#ffffff/);
    await preview.close();
    const guest = await browser.newContext();
    const gp = await guest.newPage();
    await gp.goto("/shop");
    expect(await themeVars(gp)).toContain("--color-paper:#fbf8f3");
    expect(await themeVars(gp)).toContain("--font-display:var(--font-cormorant)");

    // Publish → live.
    await page.getByRole("form", { name: "Publish theme" }).getByRole("button", { name: "Publish draft theme" }).click();
    await expect(page.getByRole("form", { name: "Publish theme" }).getByRole("status")).toContainText(`Published version ${base + 1}`);
    await gp.goto("/shop");
    const live = await themeVars(gp);
    expect(live).toContain("--color-paper:#ffffff");
    expect(live).toContain("--font-display:var(--font-playfair)");
    expect(live).toContain("--ui-radius-sm:1.000rem");
    expect(await gp.locator("#theme-vars").getAttribute("data-theme-published")).toBe("1");
    expect(await gp.locator("html").getAttribute("class")).toMatch(/_variable/);

    // Second version, then roll back to the first.
    await page.goto("/admin/content/theme");
    await page.getByRole("form", { name: "Theme draft" }).getByLabel("Page background", { exact: true }).fill("#fbf8f3");
    await page.getByRole("form", { name: "Theme draft" }).getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("form", { name: "Theme draft" }).getByRole("status")).toContainText("Draft saved");
    await page.getByRole("form", { name: "Publish theme" }).getByLabel(/What changed/).fill("back to paper");
    await page.getByRole("form", { name: "Publish theme" }).getByRole("button", { name: "Publish draft theme" }).click();
    await expect(page.getByTestId("theme-versions")).toContainText(`Version ${base + 2}`);
    await page.getByTestId("theme-versions").getByRole("button", { name: `Roll back to version ${base + 1}` }).click();
    await expect(page.getByText(`Version ${base + 1} is live again`)).toBeVisible();
    await gp.goto("/shop");
    expect(await themeVars(gp)).toContain("--color-paper:#ffffff");

    // Leave the store on the defaults for the other specs.
    await page.goto("/admin/content/theme");
    const f2 = page.getByRole("form", { name: "Theme draft" });
    await f2.getByLabel("Page background", { exact: true }).fill("#fbf8f3");
    await f2.getByRole("combobox", { name: /^Heading font/ }).selectOption("cormorant");
    await f2.getByRole("combobox", { name: /^Corners/ }).selectOption("sm");
    await f2.getByRole("button", { name: "Save draft" }).click();
    await expect(f2.getByRole("status")).toContainText("Draft saved");
    await page.getByRole("form", { name: "Publish theme" }).getByRole("button", { name: "Publish draft theme" }).click();
    await expect(page.getByRole("form", { name: "Publish theme" }).getByRole("status")).toContainText(`Published version ${base + 3}`);
    await guest.close();

    // A content editor can draft but has no publish form.
    const editor = await createTestUser("content_editor");
    created.push(editor.id);
    const ctx = await browser.newContext();
    const ep = await ctx.newPage();
    await signInWithMfa(ep, editor.email, editor.password);
    await ep.goto("/admin/content/theme");
    await expect(ep.getByRole("form", { name: "Theme draft" })).toBeVisible();
    await expect(ep.getByRole("form", { name: "Publish theme" })).toHaveCount(0);
    await ctx.close();
  });

  test("settings change the storefront name, the COD limit and a zone fee; the audit log records it", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const { rows } = await pool.query<{ fee_minor: number; free_over_minor: number | null }>(`select fee_minor, free_over_minor from public.shipping_zones where code = 'inside-dhaka'`);
    originalZone = rows[0] ?? null;
    const admin = await createTestUser("admin");
    created.push(admin.id);
    await signInWithMfa(page, admin.email, admin.password);

    await page.goto("/admin/settings");
    await expect(page.getByTestId("demo-rates-warning")).toBeVisible();
    const identity = page.getByRole("form", { name: "Store identity" });
    await identity.getByLabel(/^Store name/).fill("E2E Boutique");
    await identity.getByRole("button", { name: "Save identity" }).click();
    await expect(identity.getByRole("status")).toContainText("saved");
    // Rejected input never reaches the database.
    await identity.getByLabel(/^Store name/).fill("<b>x</b>");
    await identity.getByRole("button", { name: "Save identity" }).click();
    await expect(identity.getByRole("alert")).toContainText("angle brackets");

    const cod = page.getByRole("form", { name: "Cash on delivery" });
    await cod.getByLabel(/^Maximum order for cash on delivery/).fill("50");
    await cod.getByRole("button", { name: "Save cash on delivery" }).click();
    await expect(cod.getByRole("alert")).toContainText("between ৳100");
    await cod.getByLabel(/^Maximum order for cash on delivery/).fill("15000");
    await cod.getByRole("button", { name: "Save cash on delivery" }).click();
    await expect(cod.getByRole("status")).toContainText("saved");

    const zone = page.getByRole("form", { name: /^Zone: Inside Dhaka/ });
    await zone.getByLabel("Delivery fee (৳)").fill("99");
    await zone.getByRole("button", { name: "Save zone" }).click();
    await expect(zone.getByRole("status")).toContainText("Zone saved");
    // A district that is already in another zone is refused by the database.
    const newZone = page.getByRole("form", { name: "New zone" });
    await newZone.getByLabel("Code").fill("dup-zone");
    await newZone.getByLabel("Name").fill("Duplicate");
    await newZone.getByLabel("Delivery fee (৳)").fill("10");
    await newZone.locator("details").evaluate((d) => { (d as HTMLDetailsElement).open = true; });
    await newZone.locator('input[name="districts"][value="Dhaka"]').check();
    await newZone.getByRole("button", { name: "Create zone" }).click();
    await expect(newZone.getByRole("alert")).toContainText("already covered");
    await page.getByRole("form", { name: "Rates status" }).getByLabel(/real ones/).check();
    await page.getByRole("form", { name: "Rates status" }).getByRole("button", { name: "Update" }).click();
    await expect(page.getByTestId("demo-rates-warning")).toHaveCount(0);

    // Storefront + checkout pick the new values up.
    const guest = await browser.newContext();
    const gp = await guest.newPage();
    await gp.goto("/shop");
    await expect(gp.getByTestId("brand-name")).toHaveText("E2E Boutique");
    await expect(gp).toHaveTitle(/E2E Boutique/);
    const { rows: [variant] } = await pool.query<{ id: string }>(
      `select v.id from public.product_variants v join public.products p on p.id = v.product_id join public.stock_balances b on b.variant_id = v.id
        where p.status = 'active' and v.is_active and v.price_minor between 100000 and 400000 group by v.id having sum(b.on_hand - b.reserved) >= 5 limit 1`,
    );
    const add = await gp.request.post("/api/cart/items", { headers: { Origin: baseURL! }, data: { variantId: variant!.id, quantity: 1, mode: "increment" } });
    expect(add.ok()).toBeTruthy();
    await gp.goto("/checkout");
    await gp.getByLabel("District").selectOption("Dhaka");
    await expect(gp.getByTestId("checkout-shipping")).toContainText("99");
    await guest.close();

    // Audit log: the settings changes are there, filterable, exportable, masked.
    await page.goto("/admin/audit?action=settings.update");
    await expect(page.getByTestId("audit-table")).toContainText("store.identity");
    await expect(page.getByTestId("audit-table")).toContainText("checkout.cod");
    await page.goto("/admin/audit?entity_type=shipping_zones");
    await expect(page.getByTestId("audit-table")).toContainText("fee_minor");
    const csv = await page.request.get("/admin/audit/export?action=settings.update");
    expect(csv.status()).toBe(200);
    const body = await csv.text();
    expect(body.split("\r\n")[0]).toContain("changed_keys");
    expect(body).toContain("E2E Boutique");

    // Someone without settings.manage is sent away from Settings.
    const support = await createTestUser("support_agent");
    created.push(support.id);
    const ctx = await browser.newContext();
    const sp = await ctx.newPage();
    await signInWithMfa(sp, support.email, support.password);
    await sp.goto("/admin/settings");
    await expect(sp).toHaveURL(/\/admin\?denied=settings\.manage/);
    await sp.goto("/admin/audit");
    await expect(sp).toHaveURL(/\/admin\?denied=audit\.read/);
    await ctx.close();
  });

  test("staff invitation link → password → MFA → active; suspension locks them out; MFA reset is audited", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const admin = await createTestUser("super_admin");
    created.push(admin.id);
    await signInWithMfa(page, admin.email, admin.password);
    const email = `invitee-${randomUUID().slice(0, 8)}@test.fabriklo.local`;

    await page.goto("/admin/staff");
    const invite = page.getByRole("form", { name: "Invite staff" });
    await invite.getByLabel("Email").fill(email);
    await invite.getByLabel("Display name").fill("Invitee E2E");
    await invite.getByRole("combobox", { name: "Role" }).selectOption("order_manager");
    await invite.getByRole("button", { name: "Add staff member" }).click();
    await expect(invite.getByRole("status")).toContainText("Invitation created");
    const link = await page.getByTestId("once-link").getByRole("textbox").inputValue();
    expect(link).toMatch(/\/admin\/welcome\?token_hash=/);
    await expect(page.getByTestId("staff-table").locator(`[data-email="${email}"]`)).toContainText("invited");
    // Same person twice is refused.
    await invite.getByLabel("Email").fill(email);
    await invite.getByLabel("Display name").fill("Invitee E2E");
    await invite.getByRole("button", { name: "Add staff member" }).click();
    await expect(invite.getByRole("alert")).toContainText("already a staff member");

    // The invitee accepts in a fresh browser: password → MFA → admin.
    const ctx = await browser.newContext();
    const ip = await ctx.newPage();
    await ip.goto(link);
    await ip.getByRole("button", { name: "Accept invitation" }).click();
    await ip.getByLabel(/^New password/).fill("lettersonlypassword");
    await ip.getByLabel("Confirm password").fill("lettersonlypassword");
    await ip.getByRole("button", { name: "Save password and set up MFA" }).click();
    await expect(ip.locator("form").getByRole("alert")).toContainText("letters and numbers");
    const password = `Invitee-${randomUUID()}`;
    await ip.getByLabel(/^New password/).fill(password);
    await ip.getByLabel("Confirm password").fill(password);
    await ip.getByRole("button", { name: "Save password and set up MFA" }).click();
    await enrolMfa(ip);
    await ip.goto("/admin/orders");
    await expect(ip.getByRole("heading", { name: "Orders" })).toBeVisible();
    // A used link cannot be replayed.
    const replay = await ctx.newPage();
    await replay.goto(link);
    await replay.getByRole("button", { name: "Accept invitation" }).click();
    await expect(replay.locator("form").getByRole("alert")).toContainText("expired or was already used");
    await replay.close();

    await page.goto("/admin/staff");
    const row = page.getByTestId("staff-table").locator(`[data-email="${email}"]`);
    await expect(row).toContainText("active");
    await expect(row).toContainText("Enrolled");
    // Order manager cannot reach the staff page itself.
    await ip.goto("/admin/staff");
    await expect(ip).toHaveURL(/\/admin\?denied=staff\.manage/);

    // Suspend → next request refused.
    await row.getByRole("button", { name: /^Suspend/ }).click();
    await expect(page.getByText(/^Suspended/)).toBeVisible();
    await ip.goto("/admin/orders");
    await expect(ip).toHaveURL(/\/admin\/login\?error=not_staff/);
    await ctx.close();

    // Reactivate, then reset their authenticator: factors gone, event audited under the admin.
    await page.goto("/admin/staff");
    await row.getByRole("button", { name: /^Reactivate/ }).click();
    await expect(page.getByText("Reactivated.")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: /^Reset authenticator/ }).click();
    await expect(page.getByText(/Authenticator reset \(1 factor removed\)/)).toBeVisible();
    const { rows: factors } = await pool.query(`select 1 from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = $1`, [email]);
    expect(factors).toHaveLength(0);
    const { rows: audit } = await pool.query<{ actor_id: string; action: string }>(
      `select a.actor_id, a.action from public.audit_events a join auth.users u on u.id::text = a.entity_id where u.email = $1 and a.action in ('staff.invite_link','staff.activate','staff.mfa_reset') order by a.id`, [email]);
    expect(audit.map((a) => a.action)).toEqual(["staff.invite_link", "staff.activate", "staff.mfa_reset"]);
    expect(audit[0]!.actor_id).toBe(admin.id);
    expect(audit[2]!.actor_id).toBe(admin.id);
    // The admin's own row has no actions.
    await expect(page.getByTestId("staff-table").locator(`[data-email="${admin.email}"]`)).toContainText("Ask another admin");
  });
});
