import { describe, expect, test } from "bun:test";
import { CalmLensAppClient, getAssetInfo } from "../src/app";
import type { CdnAssetUrlOptions } from "../src/index";
import { CalmLensServerClient } from "../src/server";

const failingFetch = (async () => {
  throw new Error("Building a CDN URL must not send a request");
}) as unknown as typeof fetch;

const codeOf = (build: () => unknown) => {
  try {
    build();
  } catch (error) {
    return (error as { code: string }).code;
  }
  throw new Error("Expected an error");
};

describe("cdn.getAssetUrl on the app client", () => {
  const cases: CdnAssetUrlOptions[] = [
    { assetId: "asset-1" },
    { externalId: "post/1 ✓", resource: "preview", lens: "thumb" },
    { assetId: "a/b c", resource: "rendered", viewerClaims: { ageConfirmed: true } },
    { assetId: "asset-1", resource: "rendered", transform: { width: 320, format: "webp" } },
    { projectId: "project-2", assetId: "asset-1", resource: "info" },
  ];

  test("builds the same URLs as the server client, without a request", () => {
    const settings = { projectId: "project 1", cdnBaseUrl: "http://localhost:6130/v1/" };
    const server = new CalmLensServerClient({
      apiKey: "key",
      ...settings,
      fetch: failingFetch,
      cdnFetch: failingFetch,
    });
    const app = new CalmLensAppClient({ uploadPresetId: "preset-1", ...settings });
    for (const options of cases) {
      expect(app.cdn.getAssetUrl(options)).toBe(server.cdn.getAssetUrl(options));
    }
  });

  test("needs a project, from its options or the call", () => {
    const app = new CalmLensAppClient({ uploadPresetId: "preset-1" });
    expect(codeOf(() => app.cdn.getAssetUrl({ assetId: "asset-1" }))).toBe("sdk/invalid-argument");
    expect(app.cdn.getAssetUrl({ projectId: "project-1", assetId: "asset-1" })).toBe(
      "https://cdn.calmlens.com/v1/assets/project-1/asset-1",
    );
  });
});

describe("getAssetInfo", () => {
  const info = {
    id: "asset-1",
    projectId: "project-1",
    type: "image",
    externalUrl: null,
    content: {
      format: "image/png",
      width: 4,
      height: 3,
      durationSeconds: null,
      pageCount: null,
      rendered: { kind: "image", format: "image/png", width: 4, height: 3 },
      preview: null,
      hls: null,
    },
    availability: "available",
  };
  const recording = (response: () => Response) => {
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return response();
    }) as typeof globalThis.fetch;
    return { urls, fetch };
  };

  test("reads {url}/info, keeping the viewer claims the URL carries", async () => {
    const { urls, fetch } = recording(() => Response.json(info));
    const base = "https://cdn.test/v1/assets/project-1/sig_abc";
    const claims = encodeURIComponent(JSON.stringify({ region: "GB" }));
    expect(await getAssetInfo(`${base}?viewerClaims=${claims}`, { fetch })).toEqual(info as never);
    expect(urls).toEqual([`${base}/info?viewerClaims=${claims}`]);
  });

  test("sends the claims it is given in place of the URL's, leaving out the defaults", async () => {
    const { urls, fetch } = recording(() => Response.json(info));
    const base = "https://cdn.test/v1/assets/project-1/asset-1";
    await getAssetInfo(`${base}?viewerClaims=%7B%22region%22%3A%22GB%22%7D`, {
      fetch,
      viewerClaims: { ageConfirmed: false },
    });
    await getAssetInfo(base, { fetch, viewerClaims: { ageConfirmed: true } });
    expect(urls).toEqual([
      `${base}/info`,
      `${base}/info?viewerClaims=${encodeURIComponent('{"ageConfirmed":true}')}`,
    ]);
  });

  test("raises the CDN's error code, such as an expired grant's", async () => {
    const { fetch } = recording(() =>
      Response.json({ code: "signed-url/expired", message: "Expired" }, { status: 403 }),
    );
    await expect(
      getAssetInfo("https://cdn.test/v1/assets/project-1/sig_abc", { fetch }),
    ).rejects.toMatchObject({ code: "signed-url/expired", status: 403 });
  });

  test("refuses a body that is not asset info", async () => {
    const { fetch } = recording(() => Response.json({ id: "asset-1" }));
    await expect(
      getAssetInfo("https://cdn.test/v1/assets/project-1/asset-1", { fetch }),
    ).rejects.toMatchObject({ code: "sdk/invalid-response" });
  });
});
