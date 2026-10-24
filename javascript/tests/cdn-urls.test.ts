import { describe, expect, test } from "bun:test";
import { getAssetUrl } from "../src/app";
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

describe("getAssetUrl", () => {
  const cases: CdnAssetUrlOptions[] = [
    { assetIdentifier: "asset-1" },
    { assetIdentifier: "a/b c", resource: "rendered", lens: "thumb", allowAgeRestricted: true },
    {
      assetIdentifier: "asset-1",
      transform: { type: "imageTransform", options: { width: 320, format: "webp" } },
    },
    { assetIdentifier: "asset-1", resource: "placeholder" },
  ];

  test("builds the same URLs as the server client's cdn.getAssetUrl", () => {
    const client = new CalmLensServerClient({
      apiKey: "key",
      projectId: "project 1",
      cdnBaseUrl: "http://localhost:6130/v1/",
      fetch: failingFetch,
      cdnFetch: failingFetch,
    });
    for (const options of cases) {
      expect(
        getAssetUrl({
          projectId: "project 1",
          cdnBaseUrl: "http://localhost:6130/v1/",
          ...options,
        }),
      ).toBe(client.cdn.getAssetUrl(options));
    }
  });

  test("defaults to the hosted CDN and builds placeholder URLs", () => {
    expect(getAssetUrl({ projectId: "project-1", assetIdentifier: "asset-1" })).toBe(
      "https://cdn.calmlens.com/v1/assets/project-1/asset-1/rendered",
    );
    expect(
      getAssetUrl({ projectId: "project-1", assetIdentifier: "asset-1", resource: "placeholder" }),
    ).toBe("https://cdn.calmlens.com/v1/assets/project-1/asset-1/placeholder");
  });

  test("rejects a lens or transform on the original, extras on a placeholder, and unknown resources", () => {
    const base = { projectId: "project-1", assetIdentifier: "asset-1" };
    for (const extra of [
      { lens: "thumb" },
      { transform: "width=10" },
      { allowAgeRestricted: true },
    ]) {
      expect(codeOf(() => getAssetUrl({ ...base, resource: "placeholder", ...extra }))).toBe(
        "sdk/invalid-argument",
      );
    }
    for (const extra of [{ lens: "thumb" }, { transform: "width=10" }]) {
      expect(codeOf(() => getAssetUrl({ ...base, resource: "original", ...extra }))).toBe(
        "sdk/invalid-argument",
      );
    }
    expect(getAssetUrl({ ...base, resource: "original" })).toBe(
      "https://cdn.calmlens.com/v1/assets/project-1/asset-1/original",
    );
    expect(codeOf(() => getAssetUrl({ ...base, resource: "content" as never }))).toBe(
      "sdk/invalid-argument",
    );
    expect(codeOf(() => getAssetUrl({ ...base, projectId: ".." }))).toBe("sdk/invalid-argument");
  });
});
