import { expect, test } from "bun:test";
import { budgetKey, DEFAULT_DAILY_MODERATION_LIMIT, dailyModerationLimit } from "../src/budget";
import { applyOutcomeTo, externalIdFor, isUploadFor, takeUploadDraft } from "../src/content";
import type { Comment, Env, Post, Sandbox } from "../src/data";
import { getModeration, isLoopbackHost, ModerationNotConfigured } from "../src/moderation";

const env = (vars: Partial<Env>) => ({ CALMGRAM: undefined, ...vars }) as unknown as Env;

test("refuses to run without CalmLens keys unless demo mode is requested", () => {
  expect(() => getModeration(env({}))).toThrow(ModerationNotConfigured);
  expect(() => getModeration(env({ CALMLENS_API_KEY: "key" }))).toThrow(ModerationNotConfigured);
  expect(getModeration(env({ CALMLENS_DEMO: "1" })).mode).toBe("demo");
  expect(getModeration(env({ CALMLENS_API_KEY: "key", CALMLENS_PROJECT_ID: "p" })).mode).toBe(
    "calmlens",
  );
});

test("lets browsers upload through the configured preset only in live mode", () => {
  const live = { CALMLENS_API_KEY: "key", CALMLENS_PROJECT_ID: "p" };
  expect(
    getModeration(env({ ...live, CALMLENS_UPLOAD_PRESET_ID: "preset-1" })).uploadPresetId,
  ).toBe("preset-1");
  expect(getModeration(env(live)).uploadPresetId).toBeNull();
  // Demo mode simulates moderation on the Worker, so photos are always posted there.
  expect(
    getModeration(env({ CALMLENS_DEMO: "1", CALMLENS_UPLOAD_PRESET_ID: "preset-1" }))
      .uploadPresetId,
  ).toBeNull();
});

test("treats only loopback hostnames as local", () => {
  for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.8.0.1", "[::1]"]) {
    expect(isLoopbackHost(host)).toBe(true);
  }
  for (const host of ["example.calmlens.com", "10.0.0.1", "localhost.evil.com", "0.0.0.0"]) {
    expect(isLoopbackHost(host)).toBe(false);
  }
});

const post: Post = {
  id: "p1",
  author: "misty_heron_42",
  caption: "",
  createdAt: 0,
  assetId: "asset-1",
  status: "pending",
  flagged: false,
  findings: [],
  checkedAt: 0,
};
const comment: Comment = { ...post, id: "c1", postId: "p1", text: "hi", assetId: "asset-2" };

test("applies a decision only to the record whose asset and externalId it names", () => {
  expect(externalIdFor(post)).toBe("post-p1");
  expect(externalIdFor(comment)).toBe("comment-c1");
  const decision = { status: "approved", flagged: false, findings: [] } as const;

  const wrongExternalId = { ...post };
  expect(
    applyOutcomeTo(wrongExternalId, { ...decision, assetId: "asset-1", externalId: "post-p2" }),
  ).toBe(false);
  expect(wrongExternalId.status).toBe("pending");

  const wrongAsset = { ...comment };
  expect(
    applyOutcomeTo(wrongAsset, { ...decision, assetId: "asset-1", externalId: "comment-c1" }),
  ).toBe(false);
  expect(wrongAsset.status).toBe("pending");

  const matching = { ...post };
  expect(applyOutcomeTo(matching, { ...decision, assetId: "asset-1", externalId: "post-p1" })).toBe(
    true,
  );
  expect(matching.status).toBe("approved");
});

test("counts the daily budget per UTC day and ignores invalid limits", () => {
  expect(budgetKey(new Date("2026-10-14T23:59:59Z"))).not.toBe(
    budgetKey(new Date("2026-10-15T00:00:00Z")),
  );
  expect(budgetKey(new Date("2026-10-14T00:00:00Z"))).toBe(
    budgetKey(new Date("2026-10-14T23:59:59Z")),
  );
  expect(dailyModerationLimit({ CALMGRAM_DAILY_MODERATION_LIMIT: "50" })).toBe(50);
  for (const invalid of [undefined, "", "-1", "abc", "1.5"]) {
    expect(dailyModerationLimit({ CALMGRAM_DAILY_MODERATION_LIMIT: invalid })).toBe(
      DEFAULT_DAILY_MODERATION_LIMIT,
    );
  }
});

test("accepts a browser upload only once, and only while its draft is fresh", () => {
  const now = 1_000_000_000;
  const sandbox = {
    uploads: [
      { postId: "fresh", startedAt: now - 60_000 },
      { postId: "stale", startedAt: now - 60 * 60 * 1000 },
    ],
  } as Sandbox;
  expect(takeUploadDraft(sandbox, "unknown", now)).toBeNull();
  expect(takeUploadDraft(sandbox, "stale", now)).toBeNull();
  expect(takeUploadDraft(sandbox, "fresh", now)).toEqual({
    postId: "fresh",
    startedAt: now - 60_000,
  });
  expect(takeUploadDraft(sandbox, "fresh", now)).toBeNull();
  expect(sandbox.uploads).toEqual([]);
});

test("attaches only the asset uploaded with this post's token through this app's preset", () => {
  const draft = { postId: "p1", startedAt: 0 };
  const asset = {
    assetId: "asset-1",
    externalId: "post-p1",
    uploadPresetId: "preset-1",
    status: "pending",
    flagged: false,
    findings: [],
  } as const;
  expect(isUploadFor(asset, draft, "preset-1")).toBe(true);
  // Someone else's upload, or an asset this browser didn't upload with our token.
  expect(isUploadFor({ ...asset, externalId: "post-p2" }, draft, "preset-1")).toBe(false);
  expect(isUploadFor({ ...asset, externalId: null }, draft, "preset-1")).toBe(false);
  // Uploaded through another preset, or not through a preset at all.
  expect(isUploadFor({ ...asset, uploadPresetId: "preset-2" }, draft, "preset-1")).toBe(false);
  expect(isUploadFor({ ...asset, uploadPresetId: null }, draft, null)).toBe(false);
});
