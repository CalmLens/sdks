import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Each test runs on every library tab against the dev server's mock API and CDN, which decide
// from the file name: "sensitive" age-restricts, "blocked" blocks, anything else is allowed.
const TABS = [
  { hash: "react", name: "React" },
  { hash: "vue", name: "Vue" },
  { hash: "svelte", name: "Svelte" },
  { hash: "elements", name: "Web components" },
];

const catPhoto = () =>
  readFile(new URL("../../../javascript/test-files/test_cat_1.jpg", import.meta.url));

const open = async (page: Page, hash: string) => {
  await page.goto(`/#${hash}`);
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("button", { name: /^Select files?$/ })).toBeVisible();
  return panel;
};

/** The uploader's row for a file. */
const row = (panel: Locator, name: string) => panel.getByRole("listitem").filter({ hasText: name });
/** The gallery's item for a file, captioned with its name and moderation status. */
const galleryItem = (panel: Locator, name: string) =>
  panel.getByRole("list").last().getByRole("listitem").filter({ hasText: name });

/** Whether an image has been decoded, so it actually shows. */
const loaded = (image: Locator) =>
  image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

const sample = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();

for (const tab of TABS) {
  test.describe(tab.name, () => {
    test("uploads a photo picked from the keyboard and shows it in the gallery", async ({
      page,
    }) => {
      const panel = await open(page, tab.hash);
      const chooser = page.waitForEvent("filechooser");
      await panel.getByRole("button", { name: /^Select files?$/ }).focus();
      await page.keyboard.press("Enter");
      await (await chooser).setFiles({
        name: "picked-cat.jpg",
        mimeType: "image/jpeg",
        buffer: await catPhoto(),
      });

      const item = galleryItem(panel, "picked-cat.jpg");
      await expect(item.getByText("allowed", { exact: true })).toBeVisible({ timeout: 15_000 });
      const image = item.getByRole("img", { name: "picked-cat.jpg" });
      await expect.poll(() => loaded(image)).toBe(true);
      expect(
        await image.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname),
      ).toMatch(/\/mock-cdn\/v1\/assets\/[^/]+\/[^/]+\/rendered\/width=\d+$/);
    });

    test("shows the bytes sent while a large photo uploads", async ({ page }) => {
      const panel = await open(page, tab.hash);
      await sample(page, "Large photo (6 MB)");

      // The mock reads the upload slowly, so the bar passes through partial values.
      await page.waitForFunction(() =>
        [...document.querySelectorAll("[role=tabpanel] [role=progressbar][aria-valuenow]")].some(
          (bar) => {
            const value = Number(bar.getAttribute("aria-valuenow"));
            return value > 0 && value < 100;
          },
        ),
      );
      await expect(
        galleryItem(panel, "large-photo.jpg").getByText("allowed", { exact: true }),
      ).toBeVisible({
        timeout: 20_000,
      });
    });

    test("keeps a sensitive photo behind the reveal button until the viewer is allowed", async ({
      page,
    }) => {
      const panel = await open(page, tab.hash);
      await sample(page, "Sensitive photo");

      const item = galleryItem(panel, "sensitive-photo.png");
      const reveal = item.getByRole("button", { name: "View" });
      await expect(reveal).toBeVisible({ timeout: 15_000 });
      await expect(item.getByRole("img", { name: "sensitive-photo.png" })).toHaveCount(0);

      page.once("dialog", (dialog) => dialog.accept());
      await reveal.click();
      const image = item.getByRole("img", { name: "sensitive-photo.png" });
      await expect.poll(() => loaded(image)).toBe(true);
      expect(await image.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(
        "ageConfirmed=true",
      );
      await expect(
        page.getByRole("checkbox", { name: "Viewer may see sensitive media" }),
      ).toBeChecked();
    });

    test("refuses a blocked photo and leaves it out of the gallery", async ({ page }) => {
      const panel = await open(page, tab.hash);
      await sample(page, "Photo");
      await sample(page, "Blocked photo");

      // Both are decided; the allowed photo reaches the gallery and the blocked one never does.
      await expect(galleryItem(panel, "cat.jpg").getByText("allowed", { exact: true })).toBeVisible(
        {
          timeout: 15_000,
        },
      );
      const blocked = row(panel, "blocked-photo.jpg");
      await expect(blocked.getByRole("button", { name: "Remove blocked-photo.jpg" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(blocked.getByRole("button", { name: "Retry" })).toHaveCount(0);
      await expect(galleryItem(panel, "blocked-photo.jpg")).toHaveCount(0);

      await blocked.getByRole("button", { name: "Remove blocked-photo.jpg" }).click();
      await expect(row(panel, "blocked-photo.jpg")).toHaveCount(0);
    });

    test("retries an upload the API refused", async ({ page }) => {
      let refused = false;
      await page.route("**/mock-api/v1/upload-presets/*/assets?*", async (route) => {
        if (route.request().method() === "POST" && !refused) {
          refused = true;
          // A refusal the client doesn't retry by itself (it retries 5xx and 429 responses).
          await route.fulfill({ status: 403, json: { code: "upload-preset/disabled" } });
        } else await route.fallback();
      });
      const panel = await open(page, tab.hash);
      await sample(page, "GIF");

      const retry = row(panel, "animation.gif").getByRole("button", { name: "Retry" });
      await expect(retry).toBeVisible({ timeout: 15_000 });
      await retry.click();
      await expect(
        galleryItem(panel, "animation.gif").getByText("allowed", { exact: true }),
      ).toBeVisible({
        timeout: 15_000,
      });
    });

    test("says an image is unavailable when the CDN can't serve it", async ({ page }) => {
      await page.route("**/mock-cdn/v1/assets/*/*/rendered/**", (route) =>
        route.fulfill({ status: 404, json: { code: "asset/not-found" } }),
      );
      const panel = await open(page, tab.hash);
      await sample(page, "Photo");

      const item = galleryItem(panel, "cat.jpg");
      await expect(item.getByText("Unavailable")).toBeVisible({ timeout: 15_000 });
      await expect(item.getByRole("img", { name: "cat.jpg" })).toHaveCount(0);
    });
  });
}

test("regional block notices follow API attribution automatically and request no media", async ({
  page,
}) => {
  await open(page, "elements");
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/assets/project-regional/asset-regional/"))
      requested.push(request.url());
  });
  await page.evaluate(() => {
    const media = document.createElement("calmlens-media") as HTMLElement & {
      asset: unknown;
      messages: Record<string, string>;
    };
    media.id = "regional-notice-fixture";
    media.setAttribute("region", "DE");
    media.setAttribute("cdn-base-url", `${location.origin}/mock-cdn/v1`);
    media.messages = { regionalUnavailable: "msg:regional", unavailable: "msg:unavailable" };
    media.asset = {
      delivery: {
        viewerRegion: "DE",
        jurisdiction: "DE",
        action: "block",
        blocked: true,
        reason: "regional-rule",
        ageCheckStandard: "any",
      },
      id: "asset-regional",
      projectId: "project-regional",
      classification: {
        moderation: {
          status: "allowed",
        },
      },
    };
    document.body.append(media);
  });
  const fixture = page.locator("#regional-notice-fixture");
  await expect(fixture.getByText("msg:regional", { exact: true })).toBeVisible();
  await expect(fixture.getByRole("img")).toHaveCount(0);
  await fixture.evaluate((node) => {
    const media = node as HTMLElement & {
      asset: { classification: { moderation: { status: string } } };
    };
    media.asset = {
      ...media.asset,
      classification: {
        moderation: { ...media.asset.classification.moderation, status: "blocked" },
      },
    };
  });
  await expect(fixture.getByText("msg:unavailable", { exact: true })).toBeVisible();
  await expect(fixture.getByText("msg:regional", { exact: true })).toHaveCount(0);
  expect(requested).toEqual([]);
});
