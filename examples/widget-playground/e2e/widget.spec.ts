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
      // Record every partial value the bar takes, however briefly it shows.
      await page.evaluate(() => {
        const state = window as unknown as { partialProgress: number[] };
        state.partialProgress = [];
        new MutationObserver(() => {
          for (const bar of document.querySelectorAll(
            "[role=tabpanel] [role=progressbar][aria-valuenow]",
          )) {
            const value = Number(bar.getAttribute("aria-valuenow"));
            if (value > 0 && value < 100 && value !== state.partialProgress.at(-1))
              state.partialProgress.push(value);
          }
        }).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["aria-valuenow"],
        });
      });

      // The mock reads uploads slowly, but the browser and the server's socket can buffer up to
      // about 10 MB between them, so a 6 MB photo can be sent at once and skip every partial
      // value. 18 MB (the photo, padded after its end marker) has to wait for the slow reads, and
      // goes in three parts, which the bar counts as one file.
      const photo = await readFile(
        new URL("../../../javascript/test-files/large.jpg", import.meta.url),
      );
      const chooser = page.waitForEvent("filechooser");
      await panel.getByRole("button", { name: /^Select files?$/ }).click();
      await (await chooser).setFiles({
        name: "large-photo.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.concat([photo, Buffer.alloc(18_000_000 - photo.length)]),
      });

      const progress = () =>
        page.evaluate(() => (window as unknown as { partialProgress: number[] }).partialProgress);
      await expect
        .poll(async () => (await progress()).length, { timeout: 15_000 })
        .toBeGreaterThan(0);
      await expect(
        galleryItem(panel, "large-photo.jpg").getByText("allowed", { exact: true }),
      ).toBeVisible({
        timeout: 20_000,
      });
      // The bar never restarts when the next part starts.
      const values = await progress();
      expect(values).toEqual([...values].sort((a, b) => a - b));
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
      expect(
        JSON.parse(
          new URL(await image.evaluate((img: HTMLImageElement) => img.currentSrc)).searchParams.get(
            "viewerClaims",
          )!,
        ),
      ).toEqual({ ageConfirmed: true });
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

test("a regional refusal follows the CDN's info for the viewer's claims and requests no media", async ({
  page,
}) => {
  await open(page, "elements");
  const requested: URL[] = [];
  // The CDN decides availability for the claims the info request carries: blocked in DE here.
  await page.route("**/mock-cdn/v1/assets/project-regional/asset-regional/**", (route) => {
    const url = new URL(route.request().url());
    requested.push(url);
    if (!url.pathname.endsWith("/info")) {
      return route.fulfill({ status: 403, json: { code: "asset/not-available" } });
    }
    const claims = JSON.parse(url.searchParams.get("viewerClaims") ?? "{}");
    return route.fulfill({
      json: {
        id: "asset-regional",
        projectId: "project-regional",
        type: "image",
        externalUrl: null,
        content: { width: 240, height: 160, rendered: null, preview: null, hls: null },
        availability: claims.region === "DE" ? "unavailable" : "available",
      },
    });
  });
  await page.evaluate(() => {
    const asset = document.createElement("calmlens-asset") as HTMLElement & {
      messages: Record<string, string>;
    };
    asset.id = "regional-notice-fixture";
    asset.setAttribute(
      "src",
      `${location.origin}/mock-cdn/v1/assets/project-regional/asset-regional`,
    );
    asset.setAttribute("viewer-claims", JSON.stringify({ region: "DE" }));
    asset.setAttribute("alt", "Regional photo");
    asset.messages = { unavailable: "msg:unavailable" };
    document.body.append(asset);
  });
  const fixture = page.locator("#regional-notice-fixture");
  await expect(fixture.getByText("msg:unavailable", { exact: true })).toBeVisible();
  await expect(fixture.getByRole("img", { name: "Regional photo" })).toHaveCount(0);
  expect(requested.map((url) => url.pathname)).toEqual([
    "/mock-cdn/v1/assets/project-regional/asset-regional/info",
  ]);
  expect(JSON.parse(requested[0]?.searchParams.get("viewerClaims") ?? "null")).toEqual({
    region: "DE",
  });
});
