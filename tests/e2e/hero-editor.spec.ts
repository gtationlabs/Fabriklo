import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createTestUser, deleteTestUser } from "./helpers";

const created: string[] = [];
test.afterAll(async () => {
  for (const id of created) await deleteTestUser(id).catch(() => undefined);
});

async function signInWithMfa(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Can't scan? Enter the key manually").click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Authentication code").fill(
    new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate(),
  );
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

test("content editor drafts, previews, publishes and rolls back the store tour", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const u = await createTestUser("content_editor");
  created.push(u.id);
  await signInWithMfa(page, u.email, u.password);
  await page.getByRole("link", { name: "Content & hero" }).click();
  await expect(page.getByRole("heading", { name: "Home store tour" })).toBeVisible();

  const scene1 = page.getByRole("form", { name: "Scene 1" });
  const original = await scene1.getByLabel("Heading").inputValue();
  const draft = `Welcome ${randomUUID().slice(0, 5)}`;

  // Unsafe links are refused with a clear message.
  await scene1.getByLabel(/Button link/).fill("//evil.example");
  await scene1.getByRole("button", { name: "Save draft" }).click();
  await expect(scene1.getByRole("alert")).toHaveText("Links must be internal paths such as /shop");
  await scene1.getByLabel(/Button link/).fill("/shop");
  await scene1.getByLabel("Heading").fill(draft);
  await scene1.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("form", { name: "Scene 1" }).getByRole("status")).toContainText("Draft saved");

  // Draft is visible in preview but not on the live site.
  await page.goto("/admin/content/preview");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(draft);
  const visitor = await browser.newPage();
  await visitor.goto("/");
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(original);

  // Publish → live.
  await page.goto("/admin/content");
  const liveRow = page.getByTestId("hero-versions").locator("li").filter({ hasText: "Live" });
  const liveBefore = (await liveRow.textContent())!.match(/Version (\d+)/)![1];
  await page.getByRole("form", { name: "Publish tour" }).getByLabel(/What changed/).fill("E2E heading test");
  await page.getByRole("button", { name: "Publish draft" }).click();
  await expect(page.getByRole("form", { name: "Publish tour" }).getByRole("status")).toContainText("is live");
  await visitor.reload();
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(draft);

  // Roll back to the previous version → original heading is live again.
  const versions = page.getByTestId("hero-versions");
  await versions.getByRole("button", { name: `Roll back to version ${liveBefore}`, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "is live again" })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(original);
  await visitor.close();
});

test("content editor edits a help page with blocks, publishes it and rolls back", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const u = await createTestUser("content_editor");
  created.push(u.id);
  await signInWithMfa(page, u.email, u.password);
  await page.goto("/admin/content");
  await page.getByTestId("page-list").getByRole("link", { name: "Size guide" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Size guide" })).toBeVisible();

  const marker = `Measured ${randomUUID().slice(0, 5)}`;
  await page.getByRole("button", { name: "paragraph", exact: true }).click();
  const last = page.getByTestId("block").last();
  await last.getByLabel("Text").fill(`${marker} with a [link](/shop) and **bold** text.`);
  // An unsafe link is refused by validation before anything is saved.
  await page.getByRole("button", { name: "cta", exact: true }).click();
  await page.getByTestId("block").last().getByLabel("Internal link").fill("https://evil.example");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("form", { name: "Page editor" }).getByRole("alert")).toContainText("internal paths");
  await page.getByTestId("block").last().getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("form", { name: "Page editor" }).getByRole("status")).toContainText("Draft saved");

  const visitor = await browser.newPage();
  await visitor.goto("/size-guide");
  await expect(visitor.getByText(marker)).toHaveCount(0);

  await page.getByRole("button", { name: "Publish draft" }).click();
  await expect(page.getByRole("form", { name: "Publish page" }).getByRole("status")).toContainText("is live");
  await visitor.reload();
  await expect(visitor.getByText(marker)).toBeVisible();
  await expect(visitor.getByRole("article").getByRole("link", { name: "link" })).toHaveAttribute("href", "/shop");

  await page.getByRole("button", { name: "Roll back to v1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "is live again" })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByText(marker)).toHaveCount(0);
  await visitor.close();
});
