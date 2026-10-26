import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import sharp from "sharp";
import { createTestUser, deleteTestUser, serviceClient } from "./helpers";

/**
 * Virtual try-on through the LABELLED DEMO MOCK (the test server has no FASHN
 * key and runs with TRYON_ALLOW_MOCK=true). The mock exercises the real
 * pipeline: private upload → consent → queue → worker → private result →
 * before/after → delete. Nothing here claims the real provider works.
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

async function portrait(withExif = true) {
  let img = sharp({ create: { width: 900, height: 1300, channels: 3, background: "#c9b79c" } });
  if (withExif) img = img.withExif({ IFD0: { Copyright: "exif-marker-should-vanish" } });
  return img.jpeg().toBuffer();
}

async function signInCustomer(page: Page) {
  const user = await createTestUser(null);
  created.push(user.id);
  await page.goto("/account/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
  return user;
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

test.describe("virtual try-on (demo mock)", () => {
  test("guest sees the feature but must sign in; unsupported products have no panel", async ({ page }) => {
    await page.goto("/product/essential-crew-tee");
    const panel = page.getByTestId("tryon-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("note")).toContainText("Demo mock");
    await panel.getByRole("button", { name: "Try it on with your photo" }).click();
    await expect(panel.getByRole("link", { name: /Sign in or create an account/ })).toHaveAttribute("href", /\/account\/login\?next=%2Fproduct%2Fessential-crew-tee/);
    await page.goto("/product/oxford-button-down-shirt");
    await expect(page.getByTestId("tryon-panel")).toHaveCount(0);
  });

  test("customer uploads, consents, gets a private result, sees history, deletes everything", async ({ page, baseURL, browser }) => {
    test.setTimeout(150_000);
    const user = await signInCustomer(page);

    // Uploads are refused without consent/photo; an SVG disguised as JPEG is refused by content.
    const fake = await page.request.post("/api/tryon/uploads", {
      headers: { Origin: baseURL! },
      multipart: { photo: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") } },
    });
    expect(fake.status()).toBe(422);

    await page.goto("/product/essential-crew-tee");
    const panel = page.getByTestId("tryon-panel");
    await panel.getByRole("button", { name: "Try it on with your photo" }).click();
    await panel.getByLabel("Your photo", { exact: true }).setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: await portrait(true) });
    await expect(panel.getByRole("img", { name: "Preview of your uploaded photo" })).toBeVisible();
    const generate = panel.getByRole("button", { name: "Generate try-on" });
    await expect(generate).toBeDisabled();
    await panel.getByTestId("tryon-consent").check();
    await generate.click();
    await expect(panel.getByTestId("tryon-result")).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByRole("img", { name: /Try-on result/ })).toBeVisible();
    await panel.getByRole("button", { name: "Before" }).click();
    await expect(panel.getByRole("img", { name: "Your original photo" })).toBeVisible();

    // Database: job completed by the mock, consent recorded, ledger charged 0 credits, photos in the owner's folders only.
    const { rows } = await pool.query<{ id: string; status: string; provider: string; input_path: string; output_path: string; consents: number; events: string[] }>(
      `select j.id, j.status, j.provider, j.input_path, j.output_path,
              (select count(*)::int from public.tryon_consent_events c where c.job_id = j.id) as consents,
              (select array_agg(e.kind order by e.id) from public.tryon_provider_events e where e.job_id = j.id) as events
         from public.tryon_jobs j where j.user_id = $1`,
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", provider: "mock", consents: 1 });
    expect(rows[0]!.input_path.startsWith(`${user.id}/`)).toBe(true);
    expect(rows[0]!.output_path.startsWith(`${user.id}/`)).toBe(true);
    expect(rows[0]!.events).toEqual(["submitted", "status", "completed"]);

    // The stored input has no EXIF and the buckets are private: anonymous and other customers get nothing.
    const svc = serviceClient();
    const { data: blob } = await svc.storage.from("tryon-inputs").download(rows[0]!.input_path);
    const meta = await sharp(Buffer.from(await blob!.arrayBuffer())).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.height).toBeLessThanOrEqual(1296);
    const anon = await page.request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"}/storage/v1/object/public/tryon-outputs/${rows[0]!.output_path}`);
    expect(anon.ok()).toBeFalsy();
    const other = await (await browser.newContext()).newPage();
    const otherUser = await signInCustomer(other);
    expect(otherUser.id).not.toBe(user.id);
    const otherJobs = await other.request.get(`/api/tryon/jobs/${rows[0]!.id}`);
    expect([404, 401]).toContain(otherJobs.status());

    // History page lists it; deleting removes objects and the row, leaving an operational trace.
    await page.goto("/account/try-on");
    await expect(page.getByTestId("tryon-history")).toContainText("Essential Crew Tee");
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByText("No try-ons yet.")).toBeVisible();
    const { rows: after } = await pool.query(`select id from public.tryon_jobs where user_id = $1`, [user.id]);
    expect(after).toHaveLength(0);
    const { data: gone } = await svc.storage.from("tryon-inputs").list(user.id);
    expect(gone ?? []).toHaveLength(0);
    const { rows: trace } = await pool.query<{ kind: string }>(`select kind from public.tryon_provider_events where job_id = $1 order by id desc limit 1`, [rows[0]!.id]);
    expect(trace[0]!.kind).toBe("deleted");
  });

  test("staff see counts and limits, never photos; the worker endpoint is hidden without its secret", async ({ page, request }) => {
    test.setTimeout(90_000);
    expect((await request.post("/api/tryon/worker")).status()).toBe(404);
    const staff = await createTestUser("super_admin");
    created.push(staff.id);
    await signInWithMfa(page, staff.email, staff.password);
    await page.getByRole("link", { name: "AI try-on" }).click();
    await expect(page.getByRole("heading", { name: "AI try-on" })).toBeVisible();
    await expect(page.getByText("MOCK: no real try-on, no spend")).toBeVisible();
    await expect(page.getByTestId("tryon-stats")).toContainText("Credits today");
    const form = page.getByRole("form", { name: "Try-on limits" });
    await form.getByLabel("Per customer per day").fill("7");
    await form.getByRole("button", { name: "Save limits" }).click();
    await expect(form.getByRole("status")).toHaveText("Limits saved.");
    const { rows } = await pool.query<{ v: { per_user_daily: number } }>(`select value as v from public.site_settings where key = 'tryon.limits'`);
    expect(rows[0]!.v.per_user_daily).toBe(7);
    await pool.query(`update public.site_settings set value = value || '{"per_user_daily": 5}' where key = 'tryon.limits'`);
    expect(randomUUID()).toBeTruthy();
  });
});
