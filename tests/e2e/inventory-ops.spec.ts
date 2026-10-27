import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import sharp from "sharp";
import { createTestUser, deleteTestUser } from "./helpers";

/**
 * Slice 10 end to end: product photos uploaded through the admin show up on
 * the storefront; a purchase order is drafted, ordered and received into
 * stock; a transfer moves stock between warehouses. Every change made here is
 * undone at the end so other specs keep their demo balances.
 */
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const created: string[] = [];
let pool: Pool;
let jpeg: Buffer;
let product: { id: string; slug: string; title: string };
let variant: { id: string; sku: string };
let warehouses: { id: string; name: string }[];

test.beforeAll(async () => {
  if (/supabase\.co/.test(DB_URL)) throw new Error("E2E fixtures only run against local Supabase");
  pool = new Pool({ connectionString: DB_URL, max: 2 });
  jpeg = await sharp({ create: { width: 900, height: 1100, channels: 3, background: "#b58a63" } }).jpeg({ quality: 80 }).toBuffer();
  const { rows: [p] } = await pool.query<{ id: string; slug: string; title: string }>(
    `select p.id, p.slug, p.title from public.products p where p.status = 'active' and exists (select 1 from public.product_variants v where v.product_id = p.id and v.is_active) order by p.created_at limit 1`,
  );
  product = p;
  const { rows: [v] } = await pool.query<{ id: string; sku: string }>(`select id, sku from public.product_variants where product_id = $1 and is_active order by sku limit 1`, [product.id]);
  variant = v;
  const { rows: w } = await pool.query<{ id: string; name: string }>(`select id, name from public.warehouses where is_active order by is_default desc, name`);
  warehouses = w;
  expect(warehouses.length).toBeGreaterThanOrEqual(2);
});

test.afterAll(async () => {
  // Photos added by this spec (storage objects are removed by the admin action; rows are the source of truth).
  await pool.query(`delete from public.product_media where product_id = $1 and alt like 'E2E %'`, [product.id]).catch(() => undefined);
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

async function onHand(variantId: string, warehouseId: string) {
  const { rows } = await pool.query<{ on_hand: number }>(`select on_hand from public.stock_balances where variant_id = $1 and warehouse_id = $2`, [variantId, warehouseId]);
  return rows[0]?.on_hand ?? 0;
}

/** Type into the SKU search and pick the first matching hit. */
async function addLine(page: Page, form: ReturnType<Page["getByRole"]>, sku: string) {
  await form.getByLabel("Add a SKU").fill(sku);
  await page.getByRole("option", { name: new RegExp(sku) }).first().click();
  await expect(form.getByTestId("line-row")).toHaveCount(1);
}

test.describe("product photos, purchase orders and transfers (admin)", () => {
  test("photos uploaded in the admin appear on the product card and gallery; alt, order and removal are managed", async ({ page }) => {
    test.setTimeout(180_000);
    const admin = await createTestUser("super_admin");
    created.push(admin.id);
    await signInWithMfa(page, admin.email, admin.password);

    await page.goto(`/admin/products/${product.id}`);
    const upload = page.getByRole("form", { name: "Add photos" });
    await upload.getByLabel(/^Photos/).setInputFiles([
      { name: "front.jpg", mimeType: "image/jpeg", buffer: jpeg },
      { name: "back.jpg", mimeType: "image/jpeg", buffer: jpeg },
    ]);
    await upload.getByLabel(/Describe the photos/).fill("E2E studio photo");
    await upload.getByRole("button", { name: "Add photos" }).click();
    await expect(upload.getByRole("status")).toContainText("2 photos added");
    const items = page.getByTestId("media-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Primary photo");
    // The admin thumbnail is served from the public bucket and actually loads.
    const loaded = await items.first().locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(loaded).toBe(true);

    // A bad file is skipped with a reason, good ones still save.
    await upload.getByLabel(/^Photos/).setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }]);
    await upload.getByLabel(/Describe the photos/).fill("E2E not an image");
    await upload.getByRole("button", { name: "Add photos" }).click();
    await expect(upload.getByRole("alert")).toContainText("notes.txt");
    await expect(items).toHaveCount(2);

    // Reorder: photo 2 becomes primary.
    const secondId = await items.nth(1).getAttribute("data-media-id");
    await page.getByRole("button", { name: "Move photo 2 earlier" }).click();
    await expect(items.first()).toHaveAttribute("data-media-id", secondId!);

    // Alt text edit.
    const edit = page.getByRole("form", { name: "Edit photo 1" });
    await edit.getByLabel("Alt text for photo 1").fill("E2E back view of the tee");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit.getByRole("status")).toContainText("Photo updated");

    // Storefront: card image and gallery.
    await page.goto("/shop");
    const card = page.getByTestId("product-card").filter({ hasText: product.title }).first();
    await expect(card.locator("img")).toHaveAttribute("alt", "E2E back view of the tee");
    await page.goto(`/product/${product.slug}`);
    const gallery = page.getByTestId("product-gallery");
    await expect(gallery.getByTestId("gallery-main")).toHaveAttribute("alt", "E2E back view of the tee");
    await page.getByRole("button", { name: /^Show photo 2/ }).click();
    await expect(gallery.getByTestId("gallery-main")).toHaveAttribute("alt", /E2E studio photo/);

    // Removal (confirm dialog) and the storage object goes with it.
    await page.goto(`/admin/products/${product.id}`);
    const removedId = await items.nth(1).getAttribute("data-media-id");
    const { rows: [removed] } = await pool.query<{ storage_path: string }>(`select storage_path from public.product_media where id = $1`, [removedId]);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Remove photo 2" }).click();
    await expect(items).toHaveCount(1);
    const { rows: gone } = await pool.query(`select 1 from storage.objects where bucket_id = 'product-media' and name = $1`, [removed.storage_path]);
    expect(gone).toHaveLength(0);
  });

  test("purchase order: draft → ordered → received puts stock on hand; a transfer moves it between warehouses", async ({ page }) => {
    test.setTimeout(180_000);
    const admin = await createTestUser("super_admin");
    created.push(admin.id);
    await signInWithMfa(page, admin.email, admin.password);
    const [main, backroom] = warehouses;
    const mainBefore = await onHand(variant.id, main.id);
    const backBefore = await onHand(variant.id, backroom.id);

    // Draft a purchase order with one line.
    await page.goto("/admin/inventory/purchase-orders/new");
    const form = page.getByRole("form", { name: "New purchase order" });
    await form.getByLabel("Supplier", { exact: true }).fill("E2E Mills");
    await form.getByLabel("Deliver to warehouse").selectOption(main.id);
    await addLine(page, form, variant.sku);
    await form.getByLabel(`Quantity for ${variant.sku}`).fill("7");
    await form.getByLabel(`Unit cost for ${variant.sku}`).fill("450");
    await form.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/admin\/inventory\/purchase-orders\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("po-status")).toHaveText("Draft");
    const poUrl = page.url();

    // Order it, then receive part and the rest.
    await page.getByTestId("po-mark-ordered").click();
    await expect(page.getByTestId("po-status")).toHaveText("Ordered");
    const receive = page.getByRole("form", { name: "Receive stock" });
    await receive.getByLabel(`Quantity arriving for ${variant.sku}`).fill("3");
    await receive.getByRole("button", { name: "Receive into stock" }).click();
    await expect(page.getByTestId("po-status")).toHaveText("Partly received");
    await expect(page.getByTestId("line-received")).toHaveText("3");
    expect(await onHand(variant.id, main.id)).toBe(mainBefore + 3);
    await receive.getByLabel(`Quantity arriving for ${variant.sku}`).fill("4");
    await receive.getByRole("button", { name: "Receive into stock" }).click();
    await expect(page.getByTestId("po-status")).toHaveText("Received");
    expect(await onHand(variant.id, main.id)).toBe(mainBefore + 7);
    await expect(page.getByRole("form", { name: "Receive stock" })).toHaveCount(0);

    // The list shows it as received.
    await page.goto("/admin/inventory/purchase-orders");
    const poNumber = poUrl.split("/").pop()!;
    await expect(page.getByTestId("po-table")).toContainText("E2E Mills");
    expect(poNumber).toMatch(/[0-9a-f-]{36}/);

    // Transfer 5 of them to the backroom.
    await page.goto("/admin/inventory/transfers/new");
    const tform = page.getByRole("form", { name: "New transfer" });
    await tform.getByLabel("From warehouse").selectOption(main.id);
    await tform.getByLabel("To warehouse").selectOption(backroom.id);
    await addLine(page, tform, variant.sku);
    await tform.getByLabel(`Quantity for ${variant.sku}`).fill("5");
    await tform.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/admin\/inventory\/transfers\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("transfer-status")).toHaveText("Draft");
    await page.getByTestId("transfer-send").click();
    await expect(page.getByTestId("transfer-status")).toHaveText("In transit");
    expect(await onHand(variant.id, main.id)).toBe(mainBefore + 2);
    expect(await onHand(variant.id, backroom.id)).toBe(backBefore);
    await page.getByTestId("transfer-receive").click();
    await expect(page.getByTestId("transfer-status")).toHaveText("Received");
    expect(await onHand(variant.id, main.id)).toBe(mainBefore + 2);
    expect(await onHand(variant.id, backroom.id)).toBe(backBefore + 5);

    // Put the demo balances back through the ledger (not by editing balances).
    await pool.query(`select private.apply_stock_movement($1, $2, 'adjust', -2, 0, 'E2E cleanup', 'adjustment', null, null)`, [variant.id, main.id]);
    await pool.query(`select private.apply_stock_movement($1, $2, 'adjust', -5, 0, 'E2E cleanup', 'adjustment', null, null)`, [variant.id, backroom.id]);
    expect(await onHand(variant.id, main.id)).toBe(mainBefore);
    expect(await onHand(variant.id, backroom.id)).toBe(backBefore);
  });
});
